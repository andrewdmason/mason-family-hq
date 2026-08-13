"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSignedPlaybackUrl } from "@/app/practice/timer/audio-actions";
import { reprocessSession } from "@/app/practice/session/link-actions";
import type { PracticeSessionStatus } from "@/lib/types";

/**
 * Per-row affordances on the session list (plan U8): play kept audio once the
 * session is ready (lazy signed URL — nothing is signed until asked), and
 * retry a failed transcription. Everything stays inline and non-blocking.
 */
export function SessionRowActions({
  sessionId,
  status,
  recordingPath,
}: {
  sessionId: string;
  status: PracticeSessionStatus;
  recordingPath: string | null;
}) {
  const router = useRouter();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function play() {
    setBusy(true);
    setError(null);
    try {
      setAudioUrl(await createSignedPlaybackUrl(recordingPath!));
    } catch {
      setError("Playback failed");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    setError(null);
    const res = await reprocessSession(sessionId);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Retry failed");
    else router.refresh();
  }

  if (status === "failed" && recordingPath) {
    return (
      <span className="flex items-center gap-1">
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button size="sm" variant="ghost" onClick={retry} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />} Retry
        </Button>
      </span>
    );
  }

  if (status === "ready" && recordingPath) {
    if (audioUrl) {
      return <audio controls autoPlay src={audioUrl} className="h-8 w-44 sm:w-56" />;
    }
    return (
      <span className="flex items-center gap-1">
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button
          size="sm"
          variant="ghost"
          onClick={play}
          disabled={busy}
          aria-label="Play session audio"
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
        </Button>
      </span>
    );
  }

  return null;
}
