"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Loader2,
  Pause,
  Pencil,
  Play,
  Share,
  StepBack,
  StepForward,
  Trash2,
  Turtle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportDialog } from "@/components/clips/export-dialog";
import {
  BATTED_BALLS,
  PLAY_RESULTS,
  pitchShowing,
  playResultOf,
  reelCaption,
  scorebookResult,
  segmentAt,
  type PlayResult,
} from "@/lib/clips/reel";
import {
  PITCH_OUTCOMES,
  isSwing,
  resultName,
  type AtBatResult,
  type BattedBall,
  type ClipAtBat,
  type ClipPitch,
  type PitchOutcome,
} from "@/lib/clips/types";
import { deleteAtBat, exportAtBat, getReelMedia, relabelCameraPitch } from "@/app/(clips)/clips/actions";
import { cn } from "@/lib/utils";

// The player for a Clips Camera pitch reel — the website twin of the phone's.
// Nothing is baked into the reel, so speed and captions happen here: Play runs
// at real speed and Slow at ¼ (smooth on swings, which keep every 240fps
// frame). The GameChanger field view, a file of its own, is the last stretch
// of the same timeline. The controls lie over the video; tap it to show or
// hide them, drag across it to jog.

const SLOW = 0.25;
const HOLD_DELAY_MS = 350;
const HOLD_FPS = 12;
/** Field views are GameChanger's own video; step them at a typical 30fps. */
const FIELD_FPS = 30;

type Rate = 0 | 1 | typeof SLOW;

export function ReelPlayer({
  atBat,
  game,
  index,
  count,
  prevId,
  nextId,
}: {
  atBat: ClipAtBat;
  game: { id: string; name: string };
  index: number;
  count: number;
  prevId: string | null;
  nextId: string | null;
}) {
  const router = useRouter();
  const segments = useMemo(() => atBat.reel ?? [], [atBat.reel]);
  const reelV = useRef<HTMLVideoElement>(null);
  const fieldV = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<{ reelUrl: string; fieldViewUrl: string | null } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [pitches, setPitches] = useState<ClipPitch[]>(atBat.pitches);
  const [result, setResult] = useState<AtBatResult | null>(atBat.result);
  const [reelLength, setReelLength] = useState(segments[segments.length - 1]?.end ?? 0);
  const [time, setTime] = useState(0);
  const [rate, setRateState] = useState<Rate>(0);
  const [onField, setOnFieldState] = useState(false);
  const [controls, setControls] = useState(true);
  const [dialog, setDialog] = useState<"export" | "delete" | null>(null);
  const [relabeling, setRelabeling] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sorted = useMemo(() => [...pitches].sort((a, b) => a.t - b.t), [pitches]);
  const field = atBat.fieldView && media?.fieldViewUrl ? atBat.fieldView : null;
  const fieldLength = field ? Math.max(0, field.end - field.start) : 0;
  const total = reelLength + fieldLength;

  // The engine reads these without re-subscribing.
  const rateRef = useRef<Rate>(0);
  const onFieldRef = useRef(false);
  const live = useRef({ reelLength, field, total });
  useLayoutEffect(() => {
    live.current = { reelLength, field, total };
  }, [reelLength, field, total]);
  const setRate = (r: Rate) => {
    rateRef.current = r;
    setRateState(r);
  };
  const setOnField = (f: boolean) => {
    onFieldRef.current = f;
    setOnFieldState(f);
  };
  const active = () => (onFieldRef.current ? fieldV.current : reelV.current);

  useEffect(() => {
    getReelMedia(atBat.id)
      .then(setMedia)
      .catch((e) => setMediaError(e instanceof Error ? e.message : "Could not load the video"));
  }, [atBat.id]);

  // --- Playback ----------------------------------------------------------------

  const run = (v: HTMLVideoElement | null, r: Rate) => {
    if (!v) return;
    if (r === 0) {
      v.pause();
      return;
    }
    v.playbackRate = r;
    // Slowed-down crowd noise sounds awful.
    v.muted = r !== 1;
    v.play().catch(() => {});
  };

  // Seeks are coalesced per video: a newer target waits for the one in flight
  // to land, so dragging shows the latest spot rather than nothing at all.
  const pending = useRef(new Map<HTMLVideoElement, number>());
  const seekTo = useCallback((t: number) => {
    const { reelLength, field, total } = live.current;
    const target = Math.min(Math.max(0, t), Math.max(0, total - 0.01));
    setTime(target);
    const toField = !!field && target >= reelLength;
    if (toField !== onFieldRef.current) {
      active()?.pause();
      setOnField(toField);
      run(active(), rateRef.current);
    }
    const v = active();
    if (!v) return;
    const local = toField && field ? field.start + target - reelLength : target;
    if (v.seeking) pending.current.set(v, local);
    else v.currentTime = local;
  }, []);

  useEffect(() => {
    const vids = [reelV.current, fieldV.current].filter((v): v is HTMLVideoElement => !!v);
    const onSeeked = (e: Event) => {
      const v = e.currentTarget as HTMLVideoElement;
      const next = pending.current.get(v);
      if (next == null) return;
      pending.current.delete(v);
      v.currentTime = next;
    };
    vids.forEach((v) => v.addEventListener("seeked", onSeeked));
    return () => vids.forEach((v) => v.removeEventListener("seeked", onSeeked));
  }, [media]);

  const play = useCallback(
    (r: 1 | typeof SLOW) => {
      if (time >= total - 0.05) seekTo(0);
      setRate(r);
      run(active(), r);
    },
    [seekTo, time, total],
  );
  const pause = useCallback(() => {
    setRate(0);
    reelV.current?.pause();
    fieldV.current?.pause();
  }, []);
  const togglePlay = () => (rate === 1 ? pause() : play(1));
  const toggleSlow = () => (rate === SLOW ? pause() : play(SLOW));

  // The playhead follows the video; the field view stops at its trim.
  const scrubbing = useRef(false);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = active();
      const { reelLength, field } = live.current;
      if (v && !scrubbing.current && !pending.current.has(v) && !v.seeking) {
        if (onFieldRef.current && field) {
          setTime(reelLength + v.currentTime - field.start);
          if (!v.paused && v.currentTime >= field.end - 0.02) {
            v.pause();
            setRate(0);
          }
        } else {
          setTime(v.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** The reel ran out: on into the field view while playing, else stop there. */
  function reelEnded() {
    const { field } = live.current;
    if (rateRef.current > 0 && field && fieldV.current) {
      setOnField(true);
      fieldV.current.currentTime = field.start;
      run(fieldV.current, rateRef.current);
    } else {
      setRate(0);
    }
  }

  // --- Frames, pitches ---------------------------------------------------------------

  const step = useCallback(
    (dir: 1 | -1) => {
      pause();
      const v = active();
      if (!v) return;
      const { reelLength, field } = live.current;
      const t = onFieldRef.current && field ? reelLength + v.currentTime - field.start : v.currentTime;
      const seg = onFieldRef.current ? null : segmentAt(t, segments);
      const fps = seg?.fps ?? FIELD_FPS;
      const base = seg?.start ?? reelLength;
      // Land mid-frame, so a frame boundary never rounds the wrong way.
      const frame = Math.floor((t - base) * fps + 1e-3) + dir;
      seekTo(base + (frame + 0.5) / fps);
    },
    [pause, seekTo, segments],
  );

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimer.current = holdInterval.current = null;
  }, []);
  const startHold = (dir: 1 | -1) => {
    stopHold();
    step(dir);
    holdTimer.current = setTimeout(() => {
      holdInterval.current = setInterval(() => step(dir), 1000 / HOLD_FPS);
    }, HOLD_DELAY_MS);
  };
  useEffect(() => stopHold, [stopHold]);

  /** Previous/Next stops: each pitch's mark, and the field view's start. */
  const marks = useMemo(() => {
    const out = sorted.map((p) => p.t);
    if (field) out.push(reelLength);
    return out;
  }, [sorted, field, reelLength]);
  const lastJump = useRef<{ t: number; at: number } | null>(null);
  const jumpTo = (t: number) => {
    lastJump.current = { t, at: Date.now() };
    seekTo(t);
  };
  /** Onto the next mark, or back to the last one behind — the one before that if you're right on it. */
  function jump(dir: 1 | -1) {
    if (dir > 0) {
      const next = marks.find((m) => m > time + 0.01);
      if (next != null) jumpTo(next);
      return;
    }
    const behind = marks.filter((m) => m <= time + 0.01);
    const last = behind[behind.length - 1];
    if (last == null) return jumpTo(0);
    const j = lastJump.current;
    const justLanded = !!j && Math.abs(j.t - last) < 0.01 && Date.now() - j.at < 1500;
    jumpTo(time - last > 0.5 && !justLanded ? last : (behind[behind.length - 2] ?? 0));
  }

  // --- The picture: tap for the controls, drag to jog ------------------------------------

  const jog = useRef<{ x: number; from: number; width: number; moved: boolean } | null>(null);
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    jog.current = { x: e.clientX, from: time, width: e.currentTarget.clientWidth, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const j = jog.current;
    if (!j) return;
    const dx = e.clientX - j.x;
    if (!j.moved && Math.abs(dx) < 8) return;
    if (!j.moved) {
      j.moved = true;
      pause();
    }
    // The full width is two seconds.
    seekTo(j.from + (dx / Math.max(1, j.width)) * 2);
  }
  function onPointerUp() {
    const j = jog.current;
    jog.current = null;
    if (j && !j.moved) setControls((c) => !c);
  }

  // --- Keyboard (desktop): space play, S slow, ←/→ pitches, ,/. frames ----------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialog || relabeling != null || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "s") toggleSlow();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        jump(e.key === "ArrowRight" ? 1 : -1);
      } else if (e.key === "," || e.key === ".") step(e.key === "." ? 1 : -1);
      else if (e.key === "Escape") router.push(`/clips/game/${game.id}`);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- Relabeling --------------------------------------------------------------------------

  function relabel(i: number, outcome: PitchOutcome, battedBall: BattedBall | null, playResult: PlayResult | null) {
    const p = sorted[i];
    const inPlay = outcome === "in_play";
    const next = sorted.map((x) => (x.id === p.id ? { ...x, outcome, battedBall: inPlay ? battedBall : null } : x));
    setPitches(next);
    setResult(scorebookResult(next, inPlay ? playResult : playResultOf(result)));
    relabelCameraPitch(atBat.id, p.id, { outcome, battedBall, playResult })
      .then(setResult)
      .catch((e) => setSaveError(e instanceof Error ? e.message : "Couldn't save the label"));
  }

  // --- Render -----------------------------------------------------------------------------

  const current = onField ? null : pitchShowing(time, segments, sorted.map((p) => p.t));

  return (
    <div className="fixed inset-0 z-40 bg-black text-white select-none">
      {/* The picture, as big as the screen allows */}
      <div
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (jog.current = null)}
        style={{ touchAction: "none" }}
      >
        {media && (
          <video
            ref={reelV}
            src={media.reelUrl}
            playsInline
            preload="auto"
            disablePictureInPicture
            className={cn("absolute inset-0 size-full object-contain", onField && "invisible")}
            onLoadedMetadata={(e) => {
              setReelLength(e.currentTarget.duration);
              // Start playing, as the phone does — if the browser allows it.
              const v = e.currentTarget;
              v.play()
                .then(() => setRate(1))
                .catch(() => setRate(0));
            }}
            onEnded={reelEnded}
            onError={() =>
              setMediaError("This browser can't play the at-bat's video. Try Safari, or Chrome on a Mac.")
            }
          />
        )}
        {media?.fieldViewUrl && field && (
          <video
            ref={fieldV}
            src={media.fieldViewUrl}
            playsInline
            preload="auto"
            disablePictureInPicture
            className={cn("absolute inset-0 size-full object-contain", !onField && "invisible")}
            onLoadedMetadata={(e) => (e.currentTarget.currentTime = field.start)}
            onEnded={() => setRate(0)}
          />
        )}
        {!media && !mediaError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-white/60" />
          </div>
        )}
        {mediaError && (
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-white/70">{mediaError}</p>
        )}
      </div>

      {/* Shading behind the controls, to the screen's edges */}
      {controls && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/65 to-transparent" />
        </div>
      )}

      {/* Title, Share, Close */}
      {controls && (
        <div
          className="absolute inset-x-0 top-0 flex items-center gap-1 pr-1 pl-3"
          style={{
            paddingTop: "max(env(safe-area-inset-top), 0.5rem)",
            paddingLeft: "max(env(safe-area-inset-left), 0.75rem)",
            paddingRight: "max(env(safe-area-inset-right), 0.25rem)",
          }}
        >
          <AtBatStep href={prevId ? `/clips/at-bat/${prevId}` : null} label="Previous at-bat">
            <ChevronLeft className="size-5" />
          </AtBatStep>
          <span className="truncate text-base font-semibold drop-shadow">
            AB {index + 1} of {count}
            {result && <span> · {resultName(result)}</span>}
            <span className="hidden font-normal text-white/70 sm:inline"> · {game.name}</span>
          </span>
          <AtBatStep href={nextId ? `/clips/at-bat/${nextId}` : null} label="Next at-bat">
            <ChevronRight className="size-5" />
          </AtBatStep>
          <div className="flex-1" />
          <IconButton label="Share" onClick={() => setDialog("export")}>
            <Share className="size-6" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="At-bat options"
                  className="flex size-11 items-center justify-center rounded-lg drop-shadow hover:bg-white/10"
                />
              }
            >
              <Ellipsis className="size-6" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                <Trash2 /> Delete at-bat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            href={`/clips/game/${game.id}`}
            aria-label="Close"
            title="Close"
            className="flex size-11 items-center justify-center rounded-lg drop-shadow hover:bg-white/10"
          >
            <X className="size-6" />
          </Link>
        </div>
      )}

      {/* Caption (always up), then the scrubber and transport */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col"
        style={{
          paddingLeft: "max(env(safe-area-inset-left), 0.75rem)",
          paddingRight: "max(env(safe-area-inset-right), 0.75rem)",
          paddingBottom: controls ? "0.25rem" : "max(env(safe-area-inset-bottom), 1.5rem)",
        }}
      >
        {current != null && sorted[current] && (
          <button
            type="button"
            onClick={() => {
              pause();
              setRelabeling(current);
            }}
            className="pointer-events-auto mb-1 flex w-fit items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold"
            aria-label="Relabel this pitch"
          >
            {reelCaption(sorted, current, result)}
            <Pencil className="size-3 opacity-70" />
          </button>
        )}
        {saveError && (
          <button
            type="button"
            className="pointer-events-auto mb-1 w-fit rounded-md bg-red-600/90 px-3 py-1.5 text-left text-xs"
            onClick={() => setSaveError(null)}
          >
            {saveError} — tap to dismiss
          </button>
        )}
        {controls && (
          <div className="pointer-events-auto">
            <ReelScrubber
              total={total}
              time={time}
              reelLength={reelLength}
              hasField={!!field}
              pitches={sorted}
              onScrubStart={() => {
                scrubbing.current = true;
                const was = rateRef.current;
                pause();
                return was;
              }}
              onScrub={seekTo}
              onScrubEnd={(was) => {
                scrubbing.current = false;
                if (was) play(was);
              }}
              onPitch={(i) => jumpTo(sorted[i].t)}
            />
            <div className="relative flex h-16 items-center">
              <div className="flex">
                <TransportButton label="Previous pitch" onClick={() => jump(-1)} disabled={!marks.length}>
                  <ArrowLeft className="size-5" strokeWidth={2.75} />
                  <Bookmark className="size-6" fill="currentColor" />
                </TransportButton>
                <TransportButton label="Next pitch" onClick={() => jump(1)} disabled={!marks.length}>
                  <Bookmark className="size-6" fill="currentColor" />
                  <ArrowRight className="size-5" strokeWidth={2.75} />
                </TransportButton>
              </div>
              <div className="absolute left-1/2 flex -translate-x-1/2">
                <TransportButton label={rate === 1 ? "Pause" : "Play"} onClick={togglePlay}>
                  {rate === 1 ? (
                    <Pause className="size-9" fill="currentColor" />
                  ) : (
                    <Play className="size-9" fill="currentColor" />
                  )}
                </TransportButton>
                <TransportButton
                  label={rate === SLOW ? "Pause slow motion" : "Play in slow motion"}
                  onClick={toggleSlow}
                  wide
                >
                  {rate === SLOW ? <Pause className="size-7" fill="currentColor" /> : <Turtle className="size-8" />}
                  <span className="text-base font-bold">¼×</span>
                </TransportButton>
              </div>
              <div className="ml-auto flex">
                <TransportButton label="Back one frame" onHoldStart={() => startHold(-1)} onHoldEnd={stopHold}>
                  <StepBack className="size-7" fill="currentColor" />
                </TransportButton>
                <TransportButton label="Forward one frame" onHoldStart={() => startHold(1)} onHoldEnd={stopHold}>
                  <StepForward className="size-7" fill="currentColor" />
                </TransportButton>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="hidden">
        {/* Prefetch neighbours so stepping through a game is instant. */}
        {prevId && <Link href={`/clips/at-bat/${prevId}`} prefetch />}
        {nextId && <Link href={`/clips/at-bat/${nextId}`} prefetch />}
      </div>

      <ExportDialog
        open={dialog === "export"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`AB ${index + 1}`}
        start={() => exportAtBat(atBat.id, { replays: true })}
        choices={[
          { label: "With slow-mo replays", start: () => exportAtBat(atBat.id, { replays: true }) },
          { label: "Real speed only", start: () => exportAtBat(atBat.id, { replays: false }) },
        ]}
      />

      <RelabelDialog
        key={relabeling != null ? sorted[relabeling]?.id : "none"}
        pitch={relabeling != null ? (sorted[relabeling] ?? null) : null}
        number={relabeling != null ? relabeling + 1 : 0}
        playResult={playResultOf(result)}
        onClose={() => setRelabeling(null)}
        onDone={(outcome, battedBall, playResult) => {
          if (relabeling != null) relabel(relabeling, outcome, battedBall, playResult);
          setRelabeling(null);
        }}
      />

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this at-bat?</DialogTitle>
            <DialogDescription>The video and its pitches are deleted for everyone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteAtBat(atBat.id);
                router.push(`/clips/game/${game.id}`);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Pieces ----------------------------------------------------------------------------

function AtBatStep({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "flex size-9 shrink-0 items-center justify-center rounded-lg drop-shadow";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={cn(cls, "hover:bg-white/10")}>
      {children}
    </Link>
  ) : (
    <span aria-hidden className={cn(cls, "opacity-30")}>
      {children}
    </span>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-lg drop-shadow hover:bg-white/10"
    >
      {children}
    </button>
  );
}

/** A transport button: a tap, or (with hold handlers) one step then ~12 a second while held. */
function TransportButton({
  label,
  onClick,
  onHoldStart,
  onHoldEnd,
  disabled,
  wide,
  children,
}: {
  label: string;
  onClick?: () => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  disabled?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const hold = !!onHoldStart;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "flex h-16 items-center justify-center gap-1 rounded-xl drop-shadow active:bg-white/15 disabled:opacity-30",
        wide ? "w-24" : "w-[4.5rem]",
      )}
      style={{ touchAction: "none", WebkitTouchCallout: "none" }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={hold ? undefined : onClick}
      onPointerDown={
        hold
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onHoldStart?.();
            }
          : undefined
      }
      onPointerUp={hold ? onHoldEnd : undefined}
      onPointerCancel={hold ? onHoldEnd : undefined}
      onLostPointerCapture={hold ? onHoldEnd : undefined}
    >
      {children}
    </button>
  );
}

/**
 * The timeline: a marker per pitch (swings orange, takes white, unlabeled
 * hollow; a ring on the last), the field view's stretch in blue. Tap a marker
 * to go to that pitch, or drag to scrub.
 */
function ReelScrubber({
  total,
  time,
  reelLength,
  hasField,
  pitches,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onPitch,
}: {
  total: number;
  time: number;
  reelLength: number;
  hasField: boolean;
  pitches: ClipPitch[];
  onScrubStart: () => Rate;
  onScrub: (t: number) => void;
  onScrubEnd: (resume: Rate) => void;
  onPitch: (i: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; moved: boolean; resume: Rate } | null>(null);
  const len = Math.max(total, 0.01);
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), len) / len) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * len;
  };

  return (
    <div
      ref={bar}
      className="relative h-8 cursor-pointer"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, moved: false, resume: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.abs(e.clientX - d.x) < 4) return;
        if (!d.moved) {
          d.moved = true;
          d.resume = onScrubStart();
        }
        onScrub(timeAt(e.clientX));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.moved) return onScrubEnd(d.resume);
        // A tap: the nearest marker if it's close, else that spot.
        const r = bar.current!.getBoundingClientRect();
        let best = -1;
        let bestPx = Infinity;
        pitches.forEach((p, i) => {
          const px = Math.abs(r.left + (p.t / len) * r.width - e.clientX);
          if (px < bestPx) [best, bestPx] = [i, px];
        });
        if (best >= 0 && bestPx < 18) onPitch(best);
        else onScrub(timeAt(e.clientX));
      }}
      onPointerCancel={() => (drag.current = null)}
      role="slider"
      aria-label="Timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(time)}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25" />
      {hasField && (
        <div
          className="absolute top-1/2 right-0 h-1 -translate-y-1/2 rounded-full bg-blue-500/70"
          style={{ left: pct(reelLength) }}
        />
      )}
      <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-white/85" style={{ width: pct(time) }} />
      {pitches.map((p, i) => {
        const swing = isSwing(p);
        const last = i === pitches.length - 1;
        return (
          <div
            key={p.id}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: pct(p.t) }}
          >
            <div
              className={cn(
                "size-2.5 rounded-full",
                !p.outcome ? "border-2 border-white/80" : swing ? "bg-orange-500" : "bg-white",
              )}
            />
            {last && (
              <div
                className={cn(
                  "absolute top-1/2 left-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px]",
                  swing ? "border-orange-500" : "border-white",
                )}
              />
            )}
          </div>
        );
      })}
      <div
        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
        style={{ left: pct(time) }}
      />
    </div>
  );
}

/** A pitch's labels: the outcome, then for a ball in play its kind and what it did. */
function RelabelDialog({
  pitch,
  number,
  playResult,
  onClose,
  onDone,
}: {
  pitch: ClipPitch | null;
  number: number;
  playResult: PlayResult | null;
  onClose: () => void;
  onDone: (outcome: PitchOutcome, battedBall: BattedBall | null, playResult: PlayResult | null) => void;
}) {
  // Fresh for each pitch: the parent keys this dialog by pitch.
  const [inPlay, setInPlay] = useState(false);
  const [batted, setBatted] = useState<BattedBall | null>(null);

  const grid = <T extends string>(
    items: { value: T; label: string }[],
    selected: T | null | undefined,
    choose: (v: T) => void,
  ) => (
    <div className="grid grid-cols-2 gap-2">
      {items.map((it) => (
        <Button
          key={it.value}
          variant={it.value === selected ? "default" : "outline"}
          className="h-11"
          onClick={() => choose(it.value)}
        >
          {it.label}
        </Button>
      ))}
    </div>
  );

  return (
    <Dialog open={!!pitch} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Pitch {number}
            {inPlay ? (batted ? " · result?" : " · what kind?") : ""}
          </DialogTitle>
        </DialogHeader>
        {!inPlay
          ? grid(PITCH_OUTCOMES, pitch?.outcome, (o) => (o === "in_play" ? setInPlay(true) : onDone(o, null, null)))
          : !batted
            ? grid(BATTED_BALLS, pitch?.battedBall, setBatted)
            : grid(PLAY_RESULTS, pitch?.outcome === "in_play" ? playResult : null, (r) => onDone("in_play", batted, r))}
        {inPlay && (
          <Button variant="ghost" onClick={() => (batted ? setBatted(null) : setInPlay(false))}>
            Back
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
