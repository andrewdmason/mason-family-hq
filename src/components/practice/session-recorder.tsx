"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MicIcon, SquareIcon, Loader2Icon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { createSession } from "@/app/practice/session/actions";

function pickMimeType(): { mime: string; ext: "webm" | "m4a" } {
  if (typeof MediaRecorder === "undefined") {
    return { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" };
  }
  const candidates: Array<{ mime: string; ext: "webm" | "m4a" }> = [
    { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
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

  function cleanupStream() {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function start() {
    setError(null);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      });
      streamRef.current = stream;
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

  async function finish() {
    try {
      const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType });
      if (blob.size < 2000) {
        setError("That recording was too short — play for a few seconds before stopping.");
        setPhase("error");
        return;
      }
      const { sessionId, path, token } = await createSession(extRef.current);
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("task-audio")
        .uploadToSignedUrl(path, token, blob, { upsert: true, contentType: blob.type || undefined });
      if (upErr) throw new Error(upErr.message);

      const res = await fetch("/practice/session/api/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "failed") {
        throw new Error(data.error ?? "Processing failed");
      }
      setResult({ taskCount: data.taskCount ?? 0, retain: !!data.retain });
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while processing.");
      setPhase("error");
    }
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
        </>
      )}

      {phase === "recording" && (
        <>
          <div className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
            <span className="size-3 animate-pulse rounded-full bg-red-500" />
            {fmt(seconds)}
          </div>
          <p className="text-sm text-muted-foreground">Listening…</p>
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
