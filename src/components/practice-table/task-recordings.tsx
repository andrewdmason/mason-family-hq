"use client";

// Per-task recordings list for the day view (plan U6). Renders below a task
// row: one compact line per practice_recordings row — kind icon, playback,
// duration, and per-status treatment. Everything is quiet and inline (AE8):
// pending states are a pulsing dot + muted label, never a blocking spinner;
// missing alignment renders as absence, never a warning (R8).
//
// Section mapping is read-time via the shared band helper (KTD5): sections
// come from PieceSectionsContext (shipped with the feed, deduped per piece)
// and alignment.totalMeasures comes from the row itself.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Disc3Icon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createSignedPlaybackUrl } from "@/app/practice/timer/audio-actions";
import { reprocessSegment } from "@/app/practice/recordings/sweep-actions";
import {
  createSignedSegmentDownloadUrl,
  deleteSegment,
} from "@/app/practice/recordings/segment-actions";
import { emitOptimisticTaskUpdate } from "@/lib/optimistic-task";
import {
  computeSectionBands,
  sectionsForSpan,
} from "@/lib/practice/section-bands";
import type {
  PieceSectionWithChildren,
  PracticeRecordingKind,
  TaskRecordingDisplay,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Section trees by piece_id for span → section display. Provided once at the
 * PracticeTable level (merged across loaded feed days) so the list needs no
 * client fetch and no prop threading through the dnd tree.
 */
export const PieceSectionsContext = createContext<
  Record<string, PieceSectionWithChildren[]>
>({});

const KIND_ICONS: Record<
  PracticeRecordingKind,
  typeof MicIcon
> = {
  auto: MicIcon,
  manual: Disc3Icon,
  performance: StarIcon,
};

const KIND_LABELS: Record<PracticeRecordingKind, string> = {
  auto: "Auto-captured segment",
  manual: "Manual take",
  performance: "Performance",
};

function formatDuration(rec: TaskRecordingDisplay): string | null {
  if (rec.duration_seconds == null) return null;
  const start = rec.trim_start ?? 0;
  const end = rec.trim_end ?? rec.duration_seconds;
  const total = Math.max(0, Math.round(end - start));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * "mm. 52–60 · Coda"-style location line from alignment spans. Null when
 * there is no alignment or no spans (render as absence — R8). When no placed
 * sections cover the spans, measure numbers alone.
 */
function enrichmentText(
  rec: TaskRecordingDisplay,
  sections: PieceSectionWithChildren[] | undefined
): string | null {
  const alignment = rec.alignment;
  if (!alignment || alignment.spans.length === 0) return null;

  const ranges: string[] = [];
  for (const span of alignment.spans) {
    const r =
      span.measureStart === span.measureEnd
        ? `${span.measureStart}`
        : `${span.measureStart}–${span.measureEnd}`;
    if (!ranges.includes(r)) ranges.push(r);
  }
  const prefix =
    ranges.length === 1 && !ranges[0].includes("–") ? "m." : "mm.";
  const measureText = `${prefix} ${ranges.join(", ")}`;

  const bands = computeSectionBands(sections ?? [], alignment.totalMeasures);
  const labels: string[] = [];
  for (const span of alignment.spans) {
    const { parents, subs } = sectionsForSpan(
      bands,
      span.measureStart,
      span.measureEnd
    );
    for (const band of subs.length > 0 ? subs : parents) {
      if (!labels.includes(band.section.label)) labels.push(band.section.label);
    }
  }

  return labels.length > 0
    ? `${measureText} · ${labels.join(", ")}`
    : measureText;
}

export function TaskRecordings({
  taskId,
  pieceId,
  recordings,
}: {
  taskId: string;
  pieceId: string | null;
  recordings: TaskRecordingDisplay[];
}) {
  const sectionsByPiece = useContext(PieceSectionsContext);
  const sections = pieceId ? sectionsByPiece[pieceId] : undefined;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCacheRef = useRef(new Map<string, string>());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const playingRecRef = useRef<TaskRecordingDisplay | null>(null);

  // Stop playback when the list unmounts (row deleted, day paged out).
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  const stopPlayback = useCallback(() => {
    audioRef.current?.pause();
    playingRecRef.current = null;
    setPlayingId(null);
  }, []);

  const handlePlayToggle = useCallback(
    async (rec: TaskRecordingDisplay) => {
      if (!rec.audio_path || rec.status === "recorded") return;
      if (playingId === rec.id) {
        stopPlayback();
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      setLoadingId(rec.id);
      try {
        let url = urlCacheRef.current.get(rec.id);
        if (!url) {
          url = await createSignedPlaybackUrl(rec.audio_path);
          urlCacheRef.current.set(rec.id, url);
        }
        if (audio.src !== url) {
          audio.src = url;
        }
        audio.currentTime = rec.trim_start ?? 0;
        playingRecRef.current = rec;
        await audio.play();
        setPlayingId(rec.id);
      } catch {
        playingRecRef.current = null;
        setPlayingId(null);
      } finally {
        setLoadingId(null);
      }
    },
    [playingId, stopPlayback]
  );

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    const rec = playingRecRef.current;
    if (!audio || !rec) return;
    if (rec.trim_end != null && audio.currentTime >= rec.trim_end - 0.02) {
      stopPlayback();
    }
  }, [stopPlayback]);

  const handleReprocess = useCallback(
    async (rec: TaskRecordingDisplay) => {
      // Quiet optimistic flip into the pending treatment; server revalidation
      // (reprocessSegment revalidates /practice) brings the real outcome.
      emitOptimisticTaskUpdate(taskId, {
        recordings: recordings.map((r) =>
          r.id === rec.id
            ? { ...r, status: "processing" as const, error_message: null }
            : r
        ),
      });
      const result = await reprocessSegment(rec.id);
      if (!result.ok) {
        emitOptimisticTaskUpdate(taskId, {
          recordings: recordings.map((r) =>
            r.id === rec.id
              ? {
                  ...r,
                  status: rec.status,
                  error_message: result.error ?? rec.error_message,
                }
              : r
          ),
        });
      }
    },
    [taskId, recordings]
  );

  const handleDelete = useCallback(
    async (rec: TaskRecordingDisplay) => {
      if (playingId === rec.id) stopPlayback();
      emitOptimisticTaskUpdate(taskId, {
        recordings: recordings.filter((r) => r.id !== rec.id),
      });
      const result = await deleteSegment(rec.id);
      if (!result.ok) {
        emitOptimisticTaskUpdate(taskId, { recordings });
      }
    },
    [taskId, recordings, playingId, stopPlayback]
  );

  const handleDownload = useCallback(async (rec: TaskRecordingDisplay) => {
    if (!rec.audio_path) return;
    try {
      const url = await createSignedSegmentDownloadUrl(rec.audio_path);
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Quiet failure — nothing blocks (AE8).
    }
  }, []);

  if (recordings.length === 0) return null;

  return (
    <div className="ml-8 border-b border-l border-r border-border/60 bg-muted/20 px-2 py-1 text-xs">
      <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onEnded={stopPlayback} preload="none" />
      <ul className="flex flex-col">
        {recordings.map((rec) => {
          const KindIcon = KIND_ICONS[rec.kind];
          const duration = formatDuration(rec);
          const location = enrichmentText(rec, sections);
          const isPending =
            rec.status === "recorded" ||
            rec.status === "uploaded" ||
            rec.status === "processing";
          const pendingLabel =
            rec.status === "recorded" ? "uploading…" : "processing…";
          const playable = !!rec.audio_path && rec.status !== "recorded";
          const isPlaying = playingId === rec.id;
          const reprocessable =
            rec.status === "failed" || rec.status === "skipped";

          return (
            <li
              key={rec.id}
              className="group/rec flex min-w-0 items-center gap-1.5 py-0.5"
            >
              <KindIcon
                className="size-3 shrink-0 text-muted-foreground/60"
                aria-label={KIND_LABELS[rec.kind]}
              />
              <button
                type="button"
                onClick={() => void handlePlayToggle(rec)}
                disabled={!playable || loadingId === rec.id}
                aria-label={isPlaying ? "Pause" : "Play"}
                title={playable ? (isPlaying ? "Pause" : "Play") : undefined}
                className={cn(
                  "shrink-0 rounded p-0.5 transition-opacity",
                  playable
                    ? "text-muted-foreground opacity-70 hover:opacity-100"
                    : "text-muted-foreground/30 cursor-default"
                )}
              >
                {isPlaying ? (
                  <PauseIcon className="size-3" />
                ) : (
                  <PlayIcon className="size-3" />
                )}
              </button>
              {duration && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {duration}
                </span>
              )}
              {rec.title && (
                <span className="truncate text-muted-foreground">
                  {rec.title}
                </span>
              )}

              {isPending && (
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground/70">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60" />
                  {pendingLabel}
                </span>
              )}
              {location && (
                <span className="truncate text-muted-foreground">
                  {location}
                </span>
              )}
              {rec.status === "failed" && (
                <span
                  className="truncate text-muted-foreground/70"
                  title={rec.error_message ?? undefined}
                >
                  processing failed
                </span>
              )}
              {rec.status === "skipped" && (
                <span className="truncate text-muted-foreground/70">
                  too short to analyze
                </span>
              )}
              {reprocessable && (
                <button
                  type="button"
                  onClick={() => void handleReprocess(rec)}
                  title="Reprocess"
                  aria-label="Reprocess recording"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                >
                  <RotateCcwIcon className="size-3" />
                </button>
              )}

              <span className="flex-1" />
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Recording actions"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/rec:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    disabled={!playable}
                    onClick={() => void handleDownload(rec)}
                  >
                    <DownloadIcon />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void handleDelete(rec)}
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
