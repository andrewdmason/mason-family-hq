"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PauseIcon,
  PlayIcon,
  Loader2Icon,
  AlertCircleIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createSignedPlaybackUrl } from "@/app/practice/timer/audio-actions";
import type { Recording } from "@/app/practice/recordings/actions";

type Props = {
  recording: Recording | null;
  isPlaying: boolean;
  onPlayingChange: (next: boolean) => void;
  onClose: () => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function recordingTitle(rec: Recording): string {
  return rec.audioTitle ?? rec.pieceName ?? "General";
}

function recordingSubtitle(rec: Recording): string {
  const parts: string[] = [];
  if (rec.audioTitle && rec.pieceName) parts.push(rec.pieceName);
  if (rec.pieceComposer) parts.push(rec.pieceComposer);
  if (rec.workName) parts.push(rec.workName);
  return parts.join(" · ");
}

export function RecordingsPlayerBar({
  recording,
  isPlaying,
  onPlayingChange,
  onClose,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const trimStart = recording?.trimStartSeconds ?? 0;
  const trimEnd =
    recording?.trimEndSeconds ?? recording?.durationSeconds ?? duration;
  const effDuration = Math.max(0, trimEnd - trimStart);
  const effCurrent = Math.max(0, currentTime - trimStart);

  // Load a new audio source whenever the recording changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!recording) {
      audio.removeAttribute("src");
      audio.load();
      setCurrentTime(0);
      setDuration(0);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCurrentTime(recording.trimStartSeconds ?? 0);
    setDuration(recording.durationSeconds || 0);
    (async () => {
      try {
        const signedUrl = await createSignedPlaybackUrl(recording.audioPath);
        if (cancelled) return;
        audio.src = signedUrl;
        audio.currentTime = recording.trimStartSeconds ?? 0;
        setLoading(false);
        if (isPlaying) {
          try {
            await audio.play();
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Could not start playback";
            if (!cancelled) {
              setError(message);
              onPlayingChange(false);
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Could not load recording";
        setError(message);
        setLoading(false);
        onPlayingChange(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We only want to react when the recording target changes, not on
    // isPlaying — that's handled by the play/pause effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording?.id]);

  // Respond to play/pause requests from the parent.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!recording) return;
    if (loading) return;
    if (isPlaying) {
      // If we're past the trim region, jump back to start before resuming.
      const end = recording.trimEndSeconds ?? audio.duration;
      const start = recording.trimStartSeconds ?? 0;
      if (audio.currentTime < start - 0.001 || audio.currentTime >= end - 0.05) {
        audio.currentTime = start;
      }
      void audio.play().catch((err) => {
        const message =
          err instanceof Error ? err.message : "Could not start playback";
        setError(message);
        onPlayingChange(false);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, loading, recording, onPlayingChange]);

  // Space-bar toggles playback (when not focused in a text field).
  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
        if (tag === "BUTTON") return;
      }
      e.preventDefault();
      onPlayingChange(!isPlaying);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recording, isPlaying, onPlayingChange]);

  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !recording) return;
    if (scrubbing) return;
    const t = audio.currentTime;
    setCurrentTime(t);
    const end = recording.trimEndSeconds;
    if (end != null && t >= end - 0.02) {
      audio.pause();
      audio.currentTime = recording.trimStartSeconds ?? 0;
      onPlayingChange(false);
    }
  }, [recording, scrubbing, onPlayingChange]);

  const onLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration);
  }, []);

  const onEnded = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !recording) return;
    audio.currentTime = recording.trimStartSeconds ?? 0;
    onPlayingChange(false);
  }, [recording, onPlayingChange]);

  const onScrubChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio || !recording) return;
      const v = Number(e.target.value);
      const next = (recording.trimStartSeconds ?? 0) + v;
      setCurrentTime(next);
      audio.currentTime = next;
    },
    [recording]
  );

  if (!recording) return null;

  const title = recordingTitle(recording);
  const subtitle = recordingSubtitle(recording);
  const showPause = isPlaying && !loading;

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur",
        "supports-[backdrop-filter]:bg-background/80"
      )}
    >
      <audio
        ref={audioRef}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        preload="metadata"
      />
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2 sm:px-6 sm:py-3">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPlayingChange(!isPlaying)}
          disabled={loading}
          aria-label={showPause ? "Pause" : "Play"}
          title={showPause ? "Pause" : "Play"}
        >
          {loading ? (
            <Loader2Icon className="animate-spin" />
          ) : showPause ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </Button>

        <div className="min-w-0 flex-shrink-0 max-w-[40%] sm:max-w-[28%]">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && (
            <div className="truncate text-xs text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>

        <div className="flex flex-1 items-center gap-2 min-w-0">
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
            {formatTime(effCurrent)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(effDuration, 0.001)}
            step={0.05}
            value={Math.min(effCurrent, effDuration)}
            onPointerDown={() => setScrubbing(true)}
            onPointerUp={() => setScrubbing(false)}
            onChange={onScrubChange}
            disabled={loading || effDuration <= 0}
            aria-label="Seek"
            className="w-full accent-primary"
          />
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
            {formatTime(effDuration)}
          </span>
        </div>

        {error && (
          <div
            className="hidden items-center gap-1 text-xs text-red-500 sm:flex"
            title={error}
          >
            <AlertCircleIcon className="size-3.5" />
            <span className="max-w-[12rem] truncate">{error}</span>
          </div>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close player"
          title="Close"
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
