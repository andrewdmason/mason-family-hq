"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { MicIcon, SquareIcon, Loader2Icon, AlertCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { createSession } from "@/app/practice/session/actions";
import {
  blobWithSupportedType,
  effectiveInputDeviceId,
  formatDeviceLabel,
  pickMimeType,
  resolveRecordingDeviceId,
} from "@/lib/practice/capture";
import {
  useAudioInputs,
  useInputDevicePreference,
  useLevelMeter,
} from "@/components/practice/use-capture";

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The longest audio the worker can finish inside Modal's 1800s job timeout
 * (KTD4): ~2min fixed floor + ~10.5s per audio-minute leaves ~159 minutes of
 * audio. The file escape hatch WARNS past this and proceeds anyway (the job
 * may time out; the audio is kept and reprocessable either way).
 */
const WORKER_AUDIO_CEILING_SECONDS = Math.floor(((1800 - 130) / 10.5) * 60);

/** Best-effort duration probe via an <audio> element's metadata; null when the
 * browser can't parse the file (we then skip the too-long warning). */
function probeDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("audio");
    let settled = false;
    const done = (d: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    el.addEventListener("loadedmetadata", () =>
      done(Number.isFinite(el.duration) ? el.duration : null)
    );
    el.addEventListener("error", () => done(null));
    setTimeout(() => done(null), 5000);
    el.preload = "metadata";
    el.src = url;
  });
}

type Phase = "idle" | "recording" | "uploading" | "error";

/**
 * Open-session recorder (plan U8): capture-only. Stop uploads the audio and
 * kicks off a background transcription-only job, then returns to idle — the
 * session appears in the sessions list as `processing` and nothing blocks
 * (R14/R15/R17). Piece linking is a separate, explicit action on the session
 * page. Also houses the "process an existing audio file" escape hatch.
 */
export function SessionRecorder() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const extRef = useRef<"webm" | "m4a">("webm");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { concreteInputs, refreshInputs } = useAudioInputs({ loadOnMount: true });
  const { deviceId, chooseDevice } = useInputDevicePreference();
  const { level, silent, heardRef, startMeter, stopMeter, resetMeter } =
    useLevelMeter();

  const effectiveDeviceId = useMemo(
    () => effectiveInputDeviceId(deviceId, concreteInputs),
    [deviceId, concreteInputs]
  );

  // The device we'll actually record from (anti-Continuity resolution).
  const resolvedDeviceId = useMemo(
    () => resolveRecordingDeviceId(effectiveDeviceId, concreteInputs),
    [effectiveDeviceId, concreteInputs]
  );

  function cleanupStream() {
    if (timerRef.current) clearInterval(timerRef.current);
    stopMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  useEffect(() => () => cleanupStream(), []);

  async function start() {
    setError(null);
    setNotice(null);
    setWarning(null);
    resetMeter();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: resolvedDeviceId ? { exact: resolvedDeviceId } : { ideal: "default" },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      // Refresh the labeled list now that permission is granted.
      await refreshInputs();
      streamRef.current = stream;
      startMeter(stream);
      const { mime, ext } = pickMimeType();
      extRef.current = ext;
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = () => void finish();
      mr.start();
      recorderRef.current = mr;
      setSeconds(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Couldn't access the microphone. Check the browser's mic permission.");
      setPhase("error");
    }
  }

  function stop() {
    cleanupStream();
    setPhase("uploading");
    recorderRef.current?.stop(); // triggers finish()
  }

  // Upload a blob (recorded or picked) and kick off background processing,
  // then return to idle — the sessions list shows the new row as processing.
  // Shared by the mic recorder and the "process a file" escape hatch.
  async function processBlob(blob: Blob, ext: string) {
    setError(null);
    setPhase("uploading");
    try {
      const { sessionId, path, token } = await createSession(ext);
      const supabase = createClient();
      const upload = blobWithSupportedType(blob, ext);
      const { error: upErr } = await supabase.storage
        .from("task-audio")
        .uploadToSignedUrl(path, token, upload, { upsert: true });
      if (upErr) throw new Error(upErr.message);

      const res = await fetch("/practice/session/api/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "failed") {
        throw new Error(data.error ?? "Couldn't start processing");
      }
      setNotice("Session saved — transcribing in the background.");
      setPhase("idle");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while uploading.");
      setPhase("error");
    }
  }

  async function finish() {
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType });
    if (blob.size < 2000) {
      setError("That recording was too short — play for a few seconds before stopping.");
      setPhase("error");
      return;
    }
    if (!heardRef.current) {
      setError("We didn't pick up any audio — check your microphone selection and try again.");
      setPhase("error");
      return;
    }
    await processBlob(blob, extRef.current);
  }

  async function handleFilePick(file: File) {
    setNotice(null);
    setWarning(null);
    const ext = file.name.includes(".") ? file.name.split(".").pop()! : "m4a";
    // Warn (never block — KTD4) when the audio is longer than the worker can
    // finish in one job.
    const duration = await probeDurationSeconds(file);
    if (duration != null && duration > WORKER_AUDIO_CEILING_SECONDS) {
      const h = Math.floor(duration / 3600);
      const m = Math.round((duration % 3600) / 60);
      setWarning(
        `That file is ~${h}h ${m}m of audio — longer than the ~2h40m the processor can finish in one job, so it may time out. Uploading anyway; the audio is kept either way.`
      );
    }
    void processBlob(file, ext);
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center">
      {phase === "idle" && (
        <>
          <p className="text-sm text-muted-foreground">
            Record an open practice session — kept with its audio and
            transcribed MIDI. Link it to pieces later if you like.
          </p>
          {notice && <p className="text-sm text-green-700 dark:text-green-500">{notice}</p>}
          {warning && <p className="text-sm text-amber-600 dark:text-amber-500">{warning}</p>}
          <Button size="lg" onClick={start}>
            <MicIcon /> Start recording
          </Button>
          {concreteInputs.length > 1 && (
            <label className="text-xs text-muted-foreground">
              Microphone:{" "}
              <select
                className="rounded border bg-background px-1.5 py-0.5 text-xs"
                value={resolvedDeviceId ?? "default"}
                onChange={(e) =>
                  chooseDevice(e.target.value === "default" ? null : e.target.value)
                }
              >
                <option value="default">System default</option>
                {concreteInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {formatDeviceLabel(d.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="text-xs text-muted-foreground">
            or{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              process an existing audio file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFilePick(f);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}

      {phase === "recording" && (
        <>
          <div className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
            <span className="size-3 animate-pulse rounded-full bg-red-500" />
            {fmt(seconds)}
          </div>
          <div className="h-2 w-48 overflow-hidden rounded-full bg-muted" aria-label="Input level">
            <div
              className={`h-full transition-[width] duration-75 ${silent ? "bg-destructive" : "bg-emerald-500"}`}
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          {silent ? (
            <p className="text-sm text-destructive">
              We&apos;re not hearing anything — check your microphone selection.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Recording…</p>
          )}
          <Button size="lg" variant="secondary" onClick={stop}>
            <SquareIcon /> Stop
          </Button>
        </>
      )}

      {phase === "uploading" && (
        <>
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Uploading the session — transcription continues in the background.
          </p>
          {warning && <p className="text-sm text-amber-600 dark:text-amber-500">{warning}</p>}
        </>
      )}

      {phase === "error" && (
        <>
          <AlertCircleIcon className="size-6 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => setPhase("idle")}>Try again</Button>
        </>
      )}
    </div>
  );
}
