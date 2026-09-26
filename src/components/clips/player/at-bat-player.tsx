"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Share,
  StepBack,
  StepForward,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExportDialog } from "@/components/clips/export-dialog";
import { Scrubber } from "@/components/clips/player/scrubber";
import { buildQuickPlan, jumpTarget, planDuration, type PlanSegment } from "@/lib/clips/plan";
import { formatClock } from "@/lib/clips/format";
import { createClient } from "@/lib/supabase/client";
import {
  AT_BAT_RESULTS,
  CLIPS_BUCKET,
  resultLabel,
  type AtBatResult,
  type ClipAtBat,
  type ClipPitch,
} from "@/lib/clips/types";
import {
  addPitch,
  deleteAtBat,
  deletePitch,
  exportAtBat,
  getAtBatMedia,
  getPosterUpload,
  posterSaved,
  reprocessAtBat,
  setAtBatResult,
  updatePitch,
} from "@/app/(clips)/clips/actions";
import { cn } from "@/lib/utils";

// The at-bat player. Landscape first: the video fills the height, the pitch
// and frame buttons live in the side bars where your thumbs rest, and one row
// along the bottom holds play, the scrubber, speed and the quick/full switch.
// Nothing overlays the video, and nothing has to be tapped to appear.
//
// Quick mode walks the quick-version plan (the stretch around each pitch plus
// a slow replay of each swing); full mode is the whole video. Edit mode adds a
// second row for placing and labeling pitch markers.

const SPEEDS = [1, 0.5, 0.25] as const;
const HOLD_DELAY_MS = 350;
const HOLD_FPS = 12;
const JOG_PX_PER_FRAME = 6;

type Mode = "quick" | "full";

export function AtBatPlayer({
  atBat,
  game,
  index,
  prevId,
  nextId,
}: {
  atBat: ClipAtBat;
  game: { id: string; name: string };
  index: number;
  prevId: string | null;
  nextId: string | null;
}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<{ videoUrl: string; isPlaybackCopy: boolean } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [pitches, setPitches] = useState<ClipPitch[]>(atBat.pitches);
  const [result, setResult] = useState<AtBatResult | null>(atBat.result);
  const [duration, setDuration] = useState(atBat.durationS ?? 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [mode, setMode] = useState<Mode>(atBat.pitches.length ? "quick" : "full");
  const [editing, setEditing] = useState(atBat.pitches.length === 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"export" | "delete" | "result" | null>(null);
  const [fps, setFps] = useState(atBat.fps ?? 30);

  const sorted = useMemo(() => [...pitches].sort((a, b) => a.t - b.t), [pitches]);
  const plan = useMemo(
    () => (duration > 0 && sorted.length ? buildQuickPlan(sorted, duration, result) : []),
    [sorted, duration, result],
  );
  const selected = pitches.find((p) => p.id === selectedId) ?? null;

  // Refs the playback loop reads without re-subscribing.
  const modeRef = useRef(mode);
  const planRef = useRef(plan);
  const speedRef = useRef(speed);
  useLayoutEffect(() => {
    modeRef.current = mode;
    planRef.current = plan;
    speedRef.current = speed;
  }, [mode, plan, speed]);
  // The quick-mode segment now playing: a ref for the loop, mirrored in state
  // for the caption.
  const segIdx = useRef<number | null>(null);
  const [segShown, setSegShown] = useState<number | null>(null);
  const setSeg = useCallback((i: number | null) => {
    segIdx.current = i;
    setSegShown(i);
  }, []);
  const scrubbing = useRef(false);

  // --- Media ------------------------------------------------------------------

  useEffect(() => {
    getAtBatMedia(atBat.id)
      .then(setMedia)
      .catch((e) => setMediaError(e instanceof Error ? e.message : "Could not load the video"));
  }, [atBat.id]);

  // No probed frame rate yet (the worker hasn't run): measure it from the
  // decoder's frame timestamps during playback.
  useEffect(() => {
    const v = video.current;
    if (atBat.fps || !v || !("requestVideoFrameCallback" in v)) return;
    const deltas: number[] = [];
    let last: number | null = null;
    let handle = 0;
    const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
      if (last != null) {
        const d = meta.mediaTime - last;
        if (d > 0.001 && d < 0.1) deltas.push(d);
      }
      last = meta.mediaTime;
      if (deltas.length >= 30) {
        const med = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
        setFps(Math.round(1 / med));
        return;
      }
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    return () => v.cancelVideoFrameCallback(handle);
  }, [atBat.fps, media]);

  // --- Playback engine ------------------------------------------------------------

  const applySegment = useCallback((i: number) => {
    const v = video.current;
    const seg = planRef.current[i];
    if (!v || !seg) return;
    setSeg(i);
    v.currentTime = seg.start;
    v.playbackRate = seg.rate * speedRef.current;
    v.muted = seg.muted;
  }, [setSeg]);

  const leaveSegments = useCallback(() => {
    const v = video.current;
    setSeg(null);
    if (v) {
      v.playbackRate = speedRef.current;
      v.muted = false;
    }
  }, [setSeg]);

  /** In quick mode, the segment to play from the current position. */
  const segmentFor = useCallback((t: number): number => {
    const p = planRef.current;
    const inside = p.findIndex((s) => !s.replay && t >= s.start - 0.01 && t < s.end - 0.05);
    if (inside >= 0) return inside;
    const next = p.findIndex((s) => !s.replay && s.start >= t);
    return next >= 0 ? next : 0;
  }, []);

  const play = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (modeRef.current === "quick" && planRef.current.length) {
      // Paused mid-segment (a replay included): carry on from here.
      const cur = segIdx.current != null ? planRef.current[segIdx.current] : null;
      const inCurrent = cur && v.currentTime >= cur.start - 0.01 && v.currentTime < cur.end - 0.02;
      if (!inCurrent) applySegment(segmentFor(v.currentTime));
    } else {
      leaveSegments();
      if (v.ended) v.currentTime = 0;
    }
    v.play().catch(() => {});
  }, [applySegment, leaveSegments, segmentFor]);

  const pause = useCallback(() => video.current?.pause(), []);

  // One animation-frame loop keeps the playhead smooth and advances quick-mode
  // segments right on their boundaries.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        if (!scrubbing.current) setTime(v.currentTime);
        const i = segIdx.current;
        if (!v.paused && modeRef.current === "quick" && i != null) {
          const seg = planRef.current[i];
          if (!seg) {
            v.pause();
          } else if (v.currentTime >= seg.end - 0.02) {
            if (i + 1 < planRef.current.length) applySegment(i + 1);
            else {
              v.pause();
              setSeg(null);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [applySegment, setSeg]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const seg = segShown != null ? plan[segShown] : null;
    v.playbackRate = (seg && mode === "quick" ? seg.rate : 1) * speed;
  }, [speed, mode, plan, segShown]);

  // --- Seeking, frames, pitches ------------------------------------------------------

  const seek = useCallback(
    (t: number) => {
      const v = video.current;
      if (!v) return;
      if (segIdx.current != null) leaveSegments();
      v.currentTime = Math.min(Math.max(0, t), v.duration || t);
      setTime(v.currentTime);
    },
    [leaveSegments],
  );

  const frameAt = useCallback((t: number) => Math.floor(t * fps + 1e-3), [fps]);
  const frameTime = useCallback((frame: number) => (Math.max(0, frame) + 0.5) / fps, [fps]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const v = video.current;
      if (!v || v.seeking) return;
      v.pause();
      seek(frameTime(frameAt(v.currentTime) + dir));
    },
    [frameAt, frameTime, seek],
  );

  const jumpToPitch = useCallback(
    (dir: 1 | -1) => {
      const v = video.current;
      if (!v || !sorted.length) return;
      const now = v.currentTime;
      if (editing) {
        // Editing: land exactly on the marker, paused and selected.
        const target =
          dir > 0
            ? sorted.find((p) => p.t > now + 0.5 / fps)
            : [...sorted].reverse().find((p) => p.t < now - 0.5 / fps);
        if (!target) return;
        v.pause();
        setSelectedId(target.id);
        seek(target.t);
        return;
      }
      // Watching: play into the pitch from its lead-in. Previous restarts the
      // current pitch unless you're right at its start.
      const targets = sorted.map((p) => jumpTarget(p.t));
      const i =
        dir > 0
          ? targets.findIndex((t) => t > now + 0.25)
          : targets.map((t, idx) => (t < now - 0.75 ? idx : -1)).filter((idx) => idx >= 0).pop() ?? -1;
      if (i < 0) return;
      if (mode === "quick" && plan.length) {
        const s = plan.findIndex((seg) => seg.pitchIndex === i);
        if (s >= 0) {
          applySegment(s);
          video.current?.play().catch(() => {});
          return;
        }
      }
      seek(targets[i]);
      video.current?.play().catch(() => {});
    },
    [applySegment, editing, fps, mode, plan, seek, sorted],
  );

  // Hold-to-play for the frame buttons: one step on press, then ~12 frames a
  // second in that direction until release — slow motion, forward or back.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimer.current = holdInterval.current = null;
  }, []);
  const startHold = useCallback(
    (dir: 1 | -1) => {
      stopHold();
      step(dir);
      holdTimer.current = setTimeout(() => {
        holdInterval.current = setInterval(() => step(dir), 1000 / HOLD_FPS);
      }, HOLD_DELAY_MS);
    },
    [step, stopHold],
  );
  useEffect(() => stopHold, [stopHold]);

  // Tap the video to play/pause; drag sideways across it to jog frame by frame.
  const jog = useRef<{ x: number; frame: number; moved: boolean } | null>(null);
  function onVideoPointerDown(e: React.PointerEvent) {
    const v = video.current;
    if (!v) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    jog.current = { x: e.clientX, frame: frameAt(v.currentTime), moved: false };
  }
  function onVideoPointerMove(e: React.PointerEvent) {
    const j = jog.current;
    const v = video.current;
    if (!j || !v) return;
    const dx = e.clientX - j.x;
    if (!j.moved && Math.abs(dx) < 8) return;
    if (!j.moved) {
      j.moved = true;
      v.pause();
    }
    const target = j.frame + Math.round(dx / JOG_PX_PER_FRAME);
    if (!v.seeking && frameAt(v.currentTime) !== target) seek(frameTime(target));
  }
  function onVideoPointerUp() {
    const j = jog.current;
    jog.current = null;
    if (!j || j.moved) return;
    if (video.current?.paused) play();
    else pause();
  }

  // --- Marker edits (optimistic; the server call follows) ------------------------------

  const [saveError, setSaveError] = useState<string | null>(null);
  const report = (e: unknown) => setSaveError(e instanceof Error ? e.message : "Couldn't save");

  const tempSeq = useRef(0);
  const posterDirty = useRef(false);
  function addHere() {
    const v = video.current;
    if (!v) return;
    v.pause();
    const t = frameTime(frameAt(v.currentTime));
    const tempId = `temp-${++tempSeq.current}`;
    posterDirty.current = true;
    setPitches((list) => [...list, { id: tempId, t, swing: false, contact: false, source: "manual" }]);
    setSelectedId(tempId);
    addPitch(atBat.id, t)
      .then((saved) => {
        setPitches((list) => list.map((p) => (p.id === tempId ? saved : p)));
        setSelectedId((id) => (id === tempId ? saved.id : id));
      })
      .catch((e) => {
        setPitches((list) => list.filter((p) => p.id !== tempId));
        report(e);
      });
  }

  function patchPitch(id: string, patch: Partial<Pick<ClipPitch, "t" | "swing" | "contact">>) {
    const next = { ...patch };
    if (next.contact) next.swing = true;
    if (next.swing === false) next.contact = false;
    posterDirty.current = true;
    setPitches((list) => list.map((p) => (p.id === id ? { ...p, ...next, source: "manual" } : p)));
    if (id.startsWith("temp-")) return;
    updatePitch(id, next).catch(report);
  }

  function removePitch(id: string) {
    posterDirty.current = true;
    setPitches((list) => list.filter((p) => p.id !== id));
    setSelectedId(null);
    if (!id.startsWith("temp-")) deletePitch(id).catch(report);
  }

  function chooseResult(r: AtBatResult | null) {
    setResult(r);
    setDialog(null);
    setAtBatResult(atBat.id, r).catch(report);
  }

  // Feed thumbnail: after edits settle, grab the frame at the key moment (the
  // last contact, else the last pitch) and save it as the at-bat's poster.
  const lastPosterT = useRef<number | null>(null);
  useEffect(() => {
    if (!media || !posterDirty.current || !sorted.length) return;
    const key = [...sorted].reverse().find((p) => p.contact) ?? sorted[sorted.length - 1];
    if (lastPosterT.current != null && Math.abs(lastPosterT.current - key.t) < 0.01) return;
    const timer = setTimeout(() => {
      posterDirty.current = false;
      lastPosterT.current = key.t;
      capturePoster(atBat.id, media.videoUrl, key.t).catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, [sorted, media, atBat.id]);

  // --- Keyboard (desktop) ----------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialog || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const v = video.current;
      if (!v) return;
      if (e.key === " ") {
        e.preventDefault();
        if (v.paused) play();
        else pause();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (e.shiftKey) jumpToPitch(dir);
        else step(dir);
      } else if (editing && (e.key === "p" || e.key === "m")) addHere();
      else if (editing && selected && e.key === "s") patchPitch(selected.id, { swing: !selected.swing });
      else if (editing && selected && e.key === "c") patchPitch(selected.id, { contact: !selected.contact });
      else if (editing && selected && (e.key === "Backspace" || e.key === "Delete")) removePitch(selected.id);
      else if (e.key === "e") setEditing((x) => !x);
      else if (e.key === "q") setMode((m) => (m === "quick" ? "full" : "quick"));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- Render ----------------------------------------------------------------------

  const seg: PlanSegment | null =
    mode === "quick" && segShown != null ? (plan[segShown] ?? null) : null;
  const badge = resultLabel(result);
  const quickLength = plan.length ? planDuration(plan) : 0;

  return (
    <div
      className="fixed inset-0 z-40 grid bg-black text-white select-none
        landscape:grid-cols-[auto_minmax(0,1fr)_auto] landscape:grid-rows-[minmax(0,1fr)_auto]
        portrait:grid-cols-2 portrait:grid-rows-[auto_auto_auto_1fr] portrait:content-start"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Left rail */}
      <Rail className="landscape:col-start-1 landscape:row-start-1 portrait:order-3 portrait:justify-end">
        <Link
          href={`/clips/game/${game.id}`}
          className="flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-white/80 hover:bg-white/10 portrait:hidden"
        >
          <ChevronLeft className="size-5" /> Game
        </Link>
        <RailButton label="Previous pitch" onClick={() => jumpToPitch(-1)} disabled={!sorted.length}>
          <ChevronFirst className="size-7" />
        </RailButton>
        <RailButton label="Frame back" hold onHoldStart={() => startHold(-1)} onHoldEnd={stopHold}>
          <StepBack className="size-7" />
        </RailButton>
        {editing && (
          <RailButton label="Add pitch here" onClick={addHere} accent>
            <Plus className="size-7" />
          </RailButton>
        )}
      </Rail>

      {/* Video */}
      <div
        className="relative flex min-h-0 items-center justify-center overflow-hidden landscape:col-start-2 landscape:row-start-1 portrait:order-1 portrait:col-span-2 portrait:aspect-video"
        onPointerDown={onVideoPointerDown}
        onPointerMove={onVideoPointerMove}
        onPointerUp={onVideoPointerUp}
        onPointerCancel={() => (jog.current = null)}
        style={{ touchAction: "none" }}
      >
        {media && (
          <video
            ref={video}
            src={media.videoUrl}
            playsInline
            preload="auto"
            disablePictureInPicture
            className="max-h-full max-w-full"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {!media && !mediaError && <Loader2 className="size-8 animate-spin text-white/60" />}
        {mediaError && <p className="px-6 text-center text-sm text-white/70">{mediaError}</p>}
        {seg && playing && (
          <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium">
            {seg.caption}
          </span>
        )}
        {saveError && (
          <button
            className="absolute inset-x-3 bottom-3 rounded-md bg-red-600/90 px-3 py-2 text-left text-xs"
            onClick={() => setSaveError(null)}
          >
            {saveError} — tap to dismiss
          </button>
        )}
      </div>

      {/* Right rail */}
      <Rail className="landscape:col-start-3 landscape:row-start-1 portrait:order-4 portrait:justify-start">
        <div className="flex h-10 items-center justify-end gap-1 portrait:hidden">
          {badge && <span className="rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-xs font-semibold">{badge}</span>}
          <PlayerMenu
            onExport={() => setDialog("export")}
            onDelete={() => setDialog("delete")}
            onReprocess={
              atBat.errorMessage || !atBat.hasPlayback
                ? () => reprocessAtBat(atBat.id).then(() => router.refresh()).catch(report)
                : null
            }
            canExport={sorted.length > 0}
          />
        </div>
        <RailButton label="Next pitch" onClick={() => jumpToPitch(1)} disabled={!sorted.length}>
          <ChevronLast className="size-7" />
        </RailButton>
        <RailButton label="Frame forward" hold onHoldStart={() => startHold(1)} onHoldEnd={stopHold}>
          <StepForward className="size-7" />
        </RailButton>
        {editing && <div className="h-14 portrait:hidden" />}
      </Rail>

      {/* Bottom bar */}
      <div className="flex flex-col gap-1 px-2 pb-1 landscape:col-span-3 landscape:row-start-2 portrait:order-2 portrait:col-span-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
            onClick={() => (playing ? pause() : play())}
          >
            {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
          </button>
          <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-white/70">
            {formatClock(time)}
          </span>
          <Scrubber
            duration={duration}
            time={time}
            pitches={sorted}
            plan={mode === "quick" ? plan : null}
            editing={editing}
            selectedId={selectedId}
            onSeek={(t) => {
              setTime(t);
              seek(t);
            }}
            onScrubStart={() => {
              scrubbing.current = true;
              pause();
            }}
            onScrubEnd={() => (scrubbing.current = false)}
            onSelect={setSelectedId}
            onDragPitch={(id, t) => setPitches((list) => list.map((p) => (p.id === id ? { ...p, t } : p)))}
            onDropPitch={(id, t) => patchPitch(id, { t: frameTime(frameAt(t)) })}
          />
          <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-white/50">
            {formatClock(duration)}
          </span>
          <Pill onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
            {speed === 1 ? "1×" : speed === 0.5 ? "½×" : "¼×"}
          </Pill>
          <div className="flex shrink-0 overflow-hidden rounded-full bg-white/10 text-xs">
            {(["quick", "full"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={m === "quick" && !sorted.length}
                onClick={() => {
                  setMode(m);
                  if (m === "full") leaveSegments();
                }}
                className={cn(
                  "px-2.5 py-1.5 disabled:opacity-40",
                  mode === m ? "bg-white text-black" : "text-white/80",
                )}
                title={m === "quick" && quickLength ? `${Math.round(quickLength)}s` : undefined}
              >
                {m === "quick" ? "Quick" : "Full"}
              </button>
            ))}
          </div>
          <Pill active={editing} onClick={() => setEditing((x) => !x)}>
            {editing ? "Done" : "Edit"}
          </Pill>
        </div>

        {editing && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
            <Pill onClick={addHere} className="landscape:hidden">
              <Plus className="size-3.5" /> Pitch
            </Pill>
            {selected ? (
              <>
                <span className="px-1 text-white/60">
                  Pitch {sorted.findIndex((p) => p.id === selected.id) + 1}
                </span>
                <Pill active={selected.swing} onClick={() => patchPitch(selected.id, { swing: !selected.swing })}>
                  Swing
                </Pill>
                <Pill active={selected.contact} onClick={() => patchPitch(selected.id, { contact: !selected.contact })}>
                  Contact
                </Pill>
                <Pill onClick={() => patchPitch(selected.id, { t: frameTime(frameAt(video.current?.currentTime ?? 0)) })}>
                  Move here
                </Pill>
                <Pill onClick={() => removePitch(selected.id)} aria-label="Delete pitch">
                  <Trash2 className="size-3.5" />
                </Pill>
              </>
            ) : (
              <span className="px-1 text-white/60">
                {sorted.length
                  ? "Tap a dot to adjust it, or add a pitch where the ball reaches the plate."
                  : "Play or step to where the ball reaches the plate, then add a pitch."}
              </span>
            )}
            <span className="flex-1" />
            <Pill onClick={() => setDialog("result")}>Result: {badge ?? "—"}</Pill>
          </div>
        )}
      </div>

      {/* Portrait header */}
      <div className="flex items-center justify-between px-2 py-1 landscape:hidden portrait:-order-1 portrait:col-span-2">
        <Link href={`/clips/game/${game.id}`} className="flex items-center gap-1 text-sm text-white/80">
          <ChevronLeft className="size-5" /> {game.name} · AB {index + 1}
        </Link>
        <div className="flex items-center gap-1">
          {badge && <span className="rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-xs font-semibold">{badge}</span>}
          <PlayerMenu
            onExport={() => setDialog("export")}
            onDelete={() => setDialog("delete")}
            onReprocess={null}
            canExport={sorted.length > 0}
          />
        </div>
      </div>

      <div className="hidden">
        {/* Prefetch neighbours so swiping through a game is instant. */}
        {prevId && <Link href={`/clips/at-bat/${prevId}`} prefetch />}
        {nextId && <Link href={`/clips/at-bat/${nextId}`} prefetch />}
      </div>

      <ExportDialog
        open={dialog === "export"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`AB ${index + 1} · quick version`}
        fileName={`${game.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ab${index + 1}.mp4`}
        start={() => exportAtBat(atBat.id)}
      />

      <Dialog open={dialog === "result"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How did it end?</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2">
            {AT_BAT_RESULTS.map((r) => (
              <Button
                key={r.value}
                variant={result === r.value ? "default" : "outline"}
                className="h-11 font-mono"
                title={r.name}
                onClick={() => chooseResult(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
          {result && (
            <Button variant="ghost" onClick={() => chooseResult(null)}>
              Clear result
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this at-bat?</DialogTitle>
            <DialogDescription>The video and its pitch markers are deleted for everyone.</DialogDescription>
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

function Rail({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-2 p-2 landscape:w-28 landscape:flex-col landscape:justify-center portrait:items-start",
        className,
      )}
    >
      {children}
    </div>
  );
}

function RailButton({
  label,
  onClick,
  hold,
  onHoldStart,
  onHoldEnd,
  disabled,
  accent,
  children,
}: {
  label: string;
  onClick?: () => void;
  hold?: boolean;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  disabled?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "flex h-14 items-center justify-center rounded-xl bg-white/10 active:bg-white/25 disabled:opacity-30 landscape:w-full portrait:w-16",
        accent && "bg-emerald-500/80 active:bg-emerald-500",
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

function Pill({
  active,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium",
        active ? "bg-white text-black" : "bg-white/10 text-white/90 active:bg-white/25",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function PlayerMenu({
  onExport,
  onDelete,
  onReprocess,
  canExport,
}: {
  onExport: () => void;
  onDelete: () => void;
  onReprocess: (() => void) | null;
  canExport: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="At-bat options"
            className="flex size-10 items-center justify-center rounded-lg text-white/80 hover:bg-white/10"
          />
        }
      >
        <MoreHorizontal className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={!canExport} onClick={onExport}>
          <Share /> Export quick version
        </DropdownMenuItem>
        {onReprocess && (
          <DropdownMenuItem onClick={onReprocess}>
            <RefreshCw /> Make playback copy
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 /> Delete at-bat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Grab one frame for the feed thumbnail on a separate, CORS-enabled video
 * element (so a missing CORS header can only cost the thumbnail, never
 * playback), then upload it as the at-bat's poster.
 */
async function capturePoster(atBatId: string, videoUrl: string, t: number) {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = videoUrl;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error("poster load"));
  });
  v.currentTime = t;
  await new Promise<void>((resolve) => (v.onseeked = () => resolve()));
  const w = 640;
  const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(v, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  v.removeAttribute("src");
  v.load();
  if (!blob) return;
  const { path, token } = await getPosterUpload(atBatId);
  const { error } = await createClient().storage.from(CLIPS_BUCKET).uploadToSignedUrl(path, token, blob, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (!error) await posterSaved(atBatId, path);
}
