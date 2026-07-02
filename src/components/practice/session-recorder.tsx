"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MicIcon, SquareIcon, Loader2Icon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { createSession } from "@/app/practice/session/actions";
import {
  effectiveInputDeviceId,
  formatDeviceLabel,
  pickMimeType,
  resolveRecordingDeviceId,
  supportedContentType,
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

type StatusResult = {
  status: string;
  taskCount?: number;
  error?: string | null;
  audioRetained?: boolean;
};

async function pollStatus(sessionId: string): Promise<StatusResult> {
  const deadline = Date.now() + 25 * 60 * 1000; // ceiling for very long sessions
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const r = await fetch(`/practice/session/api/status?sessionId=${sessionId}`);
      if (r.ok) {
        const s = (await r.json()) as StatusResult;
        if (s.status === "ready" || s.status === "failed") return s;
      }
    } catch {
      /* transient network blip — keep polling */
    }
  }
  return { status: "failed", error: "Timed out waiting for processing" };
}

type Phase = "idle" | "recording" | "working" | "done" | "error";

export function SessionRecorder() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ taskCount: number; retain: boolean } | null>(null);

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
    setResult(null);
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
    setPhase("working");
    recorderRef.current?.stop(); // triggers finish()
  }

  // Upload a blob (recorded or picked) and run it through the pipeline, polling
  // for the result. Shared by the mic recorder and the "process a file" path.
  async function processBlob(blob: Blob, ext: string) {
    setError(null);
    setPhase("working");
    try {
      const { sessionId, path, token } = await createSession(ext);
      const supabase = createClient();
      // The SDK ignores the contentType option for Blob bodies and uses the
      // blob's own .type, so re-wrap the blob with a bucket-supported type.
      const contentType = supportedContentType(blob.type, ext);
      const upload =
        blob.type === contentType ? blob : new Blob([blob], { type: contentType });
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
      // Processing runs in the background (long recordings take minutes); poll
      // the status route until it's ready or failed.
      const final = await pollStatus(sessionId);
      if (final.status !== "ready") {
        throw new Error(final.error ?? "Processing failed");
      }
      setResult({ taskCount: final.taskCount ?? 0, retain: !!final.audioRetained });
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while processing.");
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

  function handleFilePick(file: File) {
    setResult(null);
    const ext = file.name.includes(".") ? file.name.split(".").pop()! : "m4a";
    void processBlob(file, ext);
  }

  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border bg-card p-8 text-center">
      {phase === "idle" && (
        <>
          <p className="text-sm text-muted-foreground">
            Tap start, play, then tap stop. Your session is matched to your
            pieces and logged automatically.
          </p>
          <Button size="lg" onClick={start}>
            <MicIcon /> Start listening
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
                if (f) handleFilePick(f);
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
            <p className="text-sm text-muted-foreground">Listening…</p>
          )}
          <Button size="lg" variant="secondary" onClick={stop}>
            <SquareIcon /> Stop &amp; log
          </Button>
        </>
      )}

      {phase === "working" && (
        <>
          <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Analyzing your practice and matching it to your pieces…
          </p>
        </>
      )}

      {phase === "done" && (
        <>
          <CheckCircle2Icon className="size-8 text-green-600 dark:text-green-500" />
          <p className="text-sm">
            {result?.taskCount
              ? `Logged ${result.taskCount} ${result.taskCount === 1 ? "entry" : "entries"}.`
              : "Nothing recognized this time."}
            {result?.retain ? " (Kept the audio — I wasn't fully sure about part of it.)" : ""}
          </p>
          <div className="flex gap-2">
            <Link href="/practice"><Button variant="default">View practice log</Button></Link>
            <Button variant="outline" onClick={() => setPhase("idle")}>Record another</Button>
          </div>
        </>
      )}

      {phase === "error" && (
        <>
          <AlertCircleIcon className="size-8 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => setPhase("idle")}>Try again</Button>
        </>
      )}
    </div>
  );
}
