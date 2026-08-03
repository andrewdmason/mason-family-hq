"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEinkMode } from "@/components/reading/eink-mode";
import {
  useAudiobook,
  useAudiobookControls,
  useAudiobookPosition,
} from "@/components/audiobook/audiobook-provider";
import { RATES, SLEEP_OPTIONS } from "@/lib/reading/audio/listen-settings";
import { formatCost } from "@/lib/reading/audio/constants";
import { cn } from "@/lib/utils";

/**
 * The player, wherever you are in the app.
 *
 * A slim bar along the bottom of every screen while something is playing, and
 * nothing at all when it isn't. Tapping it opens the full controls — speed,
 * sleep timer, the chapter list — which deliberately do NOT live in the bar
 * itself: the bar's job is to be small enough that you forget it's there and
 * present enough that you can stop the voice without hunting for the reader.
 *
 * On e-ink it loses the scrubber and the progress fill. Dragging a scrubber on
 * a panel that repaints in tenths of a second is a guessing game, and a
 * progress bar that advances a pixel a second is a full-width strip of ghosting
 * by the end of a chapter.
 */

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Scrubber() {
  const { durationMs } = useAudiobook();
  const { positionMs } = useAudiobookPosition();
  const { seekTo } = useAudiobookControls();

  return (
    <div className="flex flex-1 items-center gap-2">
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatTime(positionMs)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(durationMs, 1)}
        step={500}
        value={Math.min(positionMs, durationMs || 1)}
        onChange={(e) => seekTo(Number(e.target.value))}
        disabled={durationMs <= 0}
        aria-label="Seek"
        className="w-full accent-primary"
      />
      <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
        −{formatTime(Math.max(0, durationMs - positionMs))}
      </span>
    </div>
  );
}

function TransportButtons({ large = false }: { large?: boolean }) {
  const { status, chapterIndex, chapters } = useAudiobook();
  const { toggle, skipBack, nextChapter, previousChapter } = useAudiobookControls();

  const busy = status === "preparing";
  const playing = status === "playing";
  const size = large ? ("icon-lg" as const) : ("icon-sm" as const);
  const hasNext = chapterIndex != null && chapters.some((c) => c.index === chapterIndex + 1);

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        onClick={previousChapter}
        disabled={busy || chapterIndex == null || chapterIndex === 0}
        aria-label="Previous chapter"
      >
        <SkipBack />
      </Button>
      <Button
        variant="ghost"
        size={size}
        onClick={skipBack}
        disabled={busy}
        aria-label="Back 30 seconds"
      >
        <RotateCcw />
      </Button>
      <Button
        variant="outline"
        size={size}
        onClick={toggle}
        disabled={busy}
        aria-label={playing ? "Pause" : "Play"}
      >
        {busy ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Play />}
      </Button>
      <Button
        variant="ghost"
        size={size}
        onClick={nextChapter}
        disabled={busy || !hasNext}
        aria-label="Next chapter"
      >
        <SkipForward />
      </Button>
    </>
  );
}

function NowPlaying({ onClose }: { onClose: () => void }) {
  const state = useAudiobook();
  const { setRate, setSleep, goToChapter, stop } = useAudiobookControls();
  const eink = useEinkMode();
  const chapter = state.chapters.find((c) => c.index === state.chapterIndex);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <ChevronDown />
        </Button>
        <span className="text-sm font-medium">Listening</span>
        <Button variant="ghost" size="icon-sm" onClick={stop} aria-label="Stop listening">
          <X />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-6">
        <div className="text-center">
          <p className="font-serif text-xl font-semibold text-balance">{state.title}</p>
          {state.author && (
            <p className="mt-1 text-sm text-muted-foreground">{state.author}</p>
          )}
          {chapter && (
            <p className="mt-4 text-sm text-muted-foreground">{chapter.title}</p>
          )}
        </div>

        {state.error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {state.error}
          </p>
        )}

        {!eink && <Scrubber />}

        <div className="flex items-center justify-center gap-2">
          <TransportButtons large />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Speed</p>
          <div className="flex flex-wrap gap-1.5">
            {RATES.map((rate) => (
              <Button
                key={rate}
                variant={state.rate === rate ? "default" : "outline"}
                size="sm"
                onClick={() => setRate(rate)}
              >
                {rate}×
              </Button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Sleep timer</p>
          <div className="flex flex-wrap gap-1.5">
            {SLEEP_OPTIONS.map((option) => (
              <Button
                key={String(option.value)}
                variant={state.sleep === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => setSleep(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Chapters</p>
          <div className="flex flex-col">
            {state.chapters.map((c) => (
              <button
                key={c.index}
                type="button"
                onClick={() => {
                  goToChapter(c.index);
                  onClose();
                }}
                className={cn(
                  "flex items-baseline justify-between gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                  c.index === state.chapterIndex && "bg-accent font-medium"
                )}
              >
                <span className="min-w-0 truncate">{c.title}</span>
                {/* Which chapters already exist, so "how much of this have I
                    paid for" is answerable at a glance rather than a surprise. */}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {c.status === "ready"
                    ? formatTime(c.durationMs ?? 0)
                    : c.status === "preparing"
                      ? "preparing…"
                      : c.status === "failed"
                        ? "failed"
                        : "not voiced"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Never hidden behind a settings screen. A chapter is a couple of
            dollars, and a number you can't avoid noticing is the whole
            safeguard — there is no hard cap, because a hard cap fails at the
            worst possible moment, mid-chapter. */}
        <p className="text-center text-xs text-muted-foreground">
          About {formatCost(state.spentDollars)} of narration made for this book so far.
        </p>
      </div>
    </div>
  );
}

export function AudiobookBar() {
  const state = useAudiobook();
  const { positionMs } = useAudiobookPosition();
  const eink = useEinkMode();
  const [expanded, setExpanded] = useState(false);

  if (state.status === "idle" || !state.bookId) return null;

  const chapter = state.chapters.find((c) => c.index === state.chapterIndex);
  const percent =
    state.durationMs > 0 ? Math.min(100, (positionMs / state.durationMs) * 100) : 0;

  return (
    <>
      {expanded && <NowPlaying onClose={() => setExpanded(false)} />}

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur",
          "supports-[backdrop-filter]:bg-background/80",
          // Clear of the iPhone home indicator when installed to the home screen.
          "pb-[env(safe-area-inset-bottom)]"
        )}
      >
        {!eink && (
          <div className="h-0.5 bg-border/50">
            <div className="h-full bg-foreground/70" style={{ width: `${percent}%` }} />
          </div>
        )}

        <div className="mx-auto flex max-w-4xl items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted"
            aria-label="Open player"
          >
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{state.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {state.status === "preparing"
                  ? `Preparing ${chapter?.title ?? "this chapter"}…`
                  : state.status === "error"
                    ? (state.error ?? "Something went wrong.")
                    : (chapter?.title ?? "")}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            <TransportButtons />
          </div>
        </div>
      </div>
    </>
  );
}
