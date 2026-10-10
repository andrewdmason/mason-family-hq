"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AudioWaveform,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Check,
  Pencil,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Share,
  StepBack,
  StepForward,
  Trash2,
  X,
  ZoomIn,
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
import { ZoomBox } from "@/components/clips/player/zoom-box";
import {
  buildQuickPlan,
  jumpTarget,
  planDuration,
  planOffsets,
  quickTimeAt,
  type PlanSegment,
} from "@/lib/clips/plan";
import { formatClock } from "@/lib/clips/format";
import { compareToMarks, detectPitches, DETECT, type Detection } from "@/lib/clips/detect";
import { decodeAudio } from "@/lib/clips/detect-audio";
import { createClient } from "@/lib/supabase/client";
import {
  AT_BAT_RESULTS,
  CLIPS_BUCKET,
  PITCH_OUTCOMES,
  countsBefore,
  isContact,
  resultLabel,
  resultName,
  type AtBatResult,
  type ClipAtBat,
  type ClipPitch,
  type ClipZoom,
} from "@/lib/clips/types";
import {
  addPitch,
  markAtBatDone,
  setAtBatZoom,
  setReplayZoom,
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
// Two modes. Watching (the default once an at-bat is marked) walks the quick
// version — the stretch around each pitch plus a slow replay of each swing —
// on a scrubber collapsed to just those moments. Editing is the whole video on
// the full timeline, where pitches are added, moved and labeled; Done goes back
// to watching. Internally watching is "quick" mode and editing "full".

const SPEEDS = [1, 0.5, 0.25] as const;
const HOLD_DELAY_MS = 350;
const HOLD_FPS = 12;
const JOG_PX_PER_FRAME = 6;
const MIN_PITCH_GAP_S = 1.5;

type Mode = "quick" | "full"; // quick = watching, full = editing

export function AtBatPlayer({
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
  const video = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<{ videoUrl: string; isPlaybackCopy: boolean } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [pitches, setPitches] = useState<ClipPitch[]>(atBat.pitches);
  const [result, setResult] = useState<AtBatResult | null>(atBat.result);
  const [duration, setDuration] = useState(atBat.durationS ?? 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  // Marked at-bats open for watching; unmarked ones open on the full timeline
  // for marking.
  const [editing, setEditing] = useState(!atBat.markedAt || atBat.pitches.length === 0);
  const mode: Mode = editing ? "full" : "quick";
  // Replay zoom: one box for the whole video, set in edit mode.
  const [zoom, setZoom] = useState<ClipZoom | null>(atBat.zoom);
  const [replayZoom, setReplayZoomOn] = useState(atBat.replayZoom);
  const [zoomEditing, setZoomEditing] = useState(false);
  // Where the picture sits inside the video area (the zoom box lays over it).
  const videoArea = useRef<HTMLDivElement>(null);
  const [videoRect, setVideoRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
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
  // A seek waiting for the one in flight to land (see seek()).
  const pendingSeek = useRef<{ t: number; fast: boolean } | null>(null);
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

  useEffect(() => {
    const v = video.current;
    const area = videoArea.current;
    if (!v || !area) return;
    // Offsets measure the untransformed box (a zoomed replay scales the element).
    const measure = () =>
      setVideoRect({ left: v.offsetLeft, top: v.offsetTop, width: v.offsetWidth, height: v.offsetHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    ro.observe(area);
    v.addEventListener("loadedmetadata", measure);
    return () => {
      ro.disconnect();
      v.removeEventListener("loadedmetadata", measure);
    };
  }, [media]);

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
      // Where playback is headed — a seek may still be landing.
      const t = pendingSeek.current?.t ?? v.currentTime;
      const cur = segIdx.current != null ? planRef.current[segIdx.current] : null;
      // At its very end (stepped to the last frame) the loop moves straight on.
      const inCurrent = cur && t >= cur.start - 0.01 && t <= cur.end;
      if (!inCurrent) {
        // Inside a pitch window (say, after tapping the scrubber): carry on
        // from right here. Between pitches: skip ahead to the next one.
        const i = segmentFor(t);
        const seg = planRef.current[i];
        if (t >= seg.start - 0.01 && t < seg.end - 0.05) {
          setSeg(i);
          v.playbackRate = seg.rate * speedRef.current;
          v.muted = seg.muted;
        } else applySegment(i);
      }
    } else {
      leaveSegments();
      if (v.ended) v.currentTime = 0;
    }
    v.play().catch(() => {});
  }, [applySegment, leaveSegments, segmentFor, setSeg]);

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

  // Seeks are coalesced: while the decoder is still landing one, a newer
  // request just replaces the pending target, applied the moment it lands.
  // Firing a fresh seek on every pointer move instead cancels the one in
  // flight, so nothing paints until the finger stops. `fast` (used while
  // dragging on a video without a playback copy, whose full frames are a
  // second apart) snaps to the nearest full frame so the picture keeps up;
  // the drag ends with a precise seek.
  const applySeek = useCallback((v: HTMLVideoElement, t: number, fast: boolean) => {
    if (fast && typeof v.fastSeek === "function") v.fastSeek(t);
    else v.currentTime = t;
  }, []);
  const seek = useCallback(
    (t: number, opts: { fast?: boolean; keepSeg?: boolean } = {}) => {
      const v = video.current;
      if (!v) return;
      if (segIdx.current != null && !opts.keepSeg) leaveSegments();
      const target = Math.min(Math.max(0, t), v.duration || t);
      setTime(target);
      if (v.seeking) pendingSeek.current = { t: target, fast: !!opts.fast };
      else applySeek(v, target, !!opts.fast);
    },
    [applySeek, leaveSegments],
  );
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onSeeked = () => {
      const next = pendingSeek.current;
      if (!next) return;
      pendingSeek.current = null;
      applySeek(v, next.t, next.fast);
    };
    v.addEventListener("seeked", onSeeked);
    return () => v.removeEventListener("seeked", onSeeked);
  }, [media, applySeek]);
  const dragSeekIsFast = !media?.isPlaybackCopy;
  const lastScrubT = useRef<{ t: number; seg: number | null } | null>(null);

  /** Seek within a quick-mode segment (a pitch window or a replay), taking on its speed and sound. */
  const seekQuick = useCallback(
    (i: number, t: number, opts: { fast?: boolean } = {}) => {
      const v = video.current;
      const seg = planRef.current[i];
      if (!v || !seg) return;
      setSeg(i);
      v.playbackRate = seg.rate * speedRef.current;
      v.muted = seg.muted;
      seek(t, { ...opts, keepSeg: true });
    },
    [seek, setSeg],
  );
  const resumeAfterScrub = useRef(false);

  const frameAt = useCallback((t: number) => Math.floor(t * fps + 1e-3), [fps]);
  const frameTime = useCallback((frame: number) => (Math.max(0, frame) + 0.5) / fps, [fps]);

  /**
   * Seek to a frame. Watching, it stays on the quick timeline: a frame inside
   * the current pitch window or replay stays in it (a replay's source range
   * sits inside its pitch window, so a plain seek would land back in the
   * real-speed copy). Past an edge, `cross` moves into the neighbouring
   * segment; `clamp` holds at the edge.
   */
  const seekFrame = useCallback(
    (frame: number, edge: "cross" | "clamp") => {
      const t = frameTime(frame);
      const p = planRef.current;
      const i = segIdx.current;
      const seg = i != null ? p[i] : null;
      if (modeRef.current !== "quick" || i == null || !seg) {
        seek(t);
        return;
      }
      const half = 0.5 / fps;
      const first = frameTime(frameAt(seg.start + half));
      const last = frameTime(frameAt(seg.end - half));
      if (t >= first && t <= last) seekQuick(i, t);
      else if (edge === "clamp") seekQuick(i, t < first ? first : last);
      else if (t > last && p[i + 1]) seekQuick(i + 1, frameTime(frameAt(p[i + 1].start + half)));
      else if (t < first && p[i - 1]) seekQuick(i - 1, frameTime(frameAt(p[i - 1].end - half)));
    },
    [fps, frameAt, frameTime, seek, seekQuick],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const v = video.current;
      if (!v || v.seeking) return;
      v.pause();
      seekFrame(frameAt(v.currentTime) + dir, "cross");
    },
    [frameAt, seekFrame],
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
    // Held inside one segment: the drag measures from where it started, so
    // crossing into a neighbour would flip back and forth.
    if (frameAt(v.currentTime) !== target) seekFrame(target, "clamp");
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
    if (!v || !editing) return;
    // Marking doesn't interrupt playback — tap + (or M) as the pitch goes by.
    const t = frameTime(frameAt(v.currentTime));
    // Pitches are seconds apart, so a tap right next to an existing marker
    // (say, during its slow-motion replay) means that pitch — select it
    // rather than stacking a duplicate.
    const near = sorted.find((p) => Math.abs(p.t - t) < MIN_PITCH_GAP_S);
    if (near) {
      setSelectedId(near.id);
      return;
    }
    const tempId = `temp-${++tempSeq.current}`;
    posterDirty.current = true;
    setPitches((list) => [...list, { id: tempId, t, outcome: null, source: "manual" }]);
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

  function patchPitch(id: string, patch: Partial<Pick<ClipPitch, "t" | "outcome">>) {
    const next = { ...patch };
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
    const key = [...sorted].reverse().find(isContact) ?? sorted[sorted.length - 1];
    if (lastPosterT.current != null && Math.abs(lastPosterT.current - key.t) < 0.01) return;
    const timer = setTimeout(() => {
      posterDirty.current = false;
      lastPosterT.current = key.t;
      capturePoster(atBat.id, media.videoUrl, key.t).catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, [sorted, media, atBat.id]);

  // --- Modes ------------------------------------------------------------------------------

  function startEditing() {
    leaveSegments();
    setEditing(true);
  }

  // --- Auto-detection (experiment) -------------------------------------------------------
  // Edit mode's Detect button: find pitches from the sound and lay red ticks
  // beside the hand-marked dots, with a running score. Nothing is saved.
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectThreshold, setDetectThreshold] = useState<number>(DETECT.defaultThresholdDb);
  const detectAbort = useRef<AbortController | null>(null);
  useEffect(() => () => detectAbort.current?.abort(), []);

  async function runDetection() {
    if (!media || detectAbort.current) return;
    const abort = new AbortController();
    detectAbort.current = abort;
    setDetecting(true);
    setDetectStatus("Downloading…");
    try {
      const { samples, rate } = await decodeAudio(
        media.videoUrl,
        (f) => setDetectStatus(`Downloading ${Math.round(f * 100)}%`),
        abort.signal,
      );
      setDetectStatus("Listening…");
      // Let the status paint before the (brief) synchronous crunch.
      await new Promise((r) => setTimeout(r, 0));
      setDetection(detectPitches(samples, rate));
      setDetectStatus(null);
    } catch (e) {
      if (!abort.signal.aborted) setDetectStatus(e instanceof Error ? e.message : "Detection failed");
    } finally {
      detectAbort.current = null;
      setDetecting(false);
    }
  }

  function closeDetection() {
    detectAbort.current?.abort();
    setDetection(null);
    setDetectStatus(null);
  }

  const detectScore = useMemo(() => {
    if (!detection) return null;
    const shown = detection.onsets.filter((o) => o.strength >= detectThreshold);
    return { shown: shown.length, ...compareToMarks(shown, sorted.map((p) => p.t)) };
  }, [detection, detectThreshold, sorted]);

  function finishEditing() {
    if (!sorted.length) return;
    setSelectedId(null);
    setZoomEditing(false);
    setEditing(false);
    markAtBatDone(atBat.id).catch(report);
  }

  // --- Keyboard (desktop) ----------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialog || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const v = video.current;
      if (!v) return;
      // YouTube's shortcuts: space/K play-pause, ←/→ 5s, J/L 10s, ,/. one
      // frame. Shift+←/→ jumps between pitches.
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        if (v.paused) play();
        else pause();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (e.shiftKey) jumpToPitch(dir);
        else seek(v.currentTime + dir * 5);
      } else if (e.key === "j" || e.key === "l") {
        seek(v.currentTime + (e.key === "l" ? 10 : -10));
      } else if (e.key === "," || e.key === ".") {
        step(e.key === "." ? 1 : -1);
      } else if (editing && (e.key === "p" || e.key === "m")) addHere();
      else if (editing && selected && PITCH_OUTCOMES.some((o) => o.key === e.key)) {
        const o = PITCH_OUTCOMES.find((x) => x.key === e.key)!.value;
        patchPitch(selected.id, { outcome: selected.outcome === o ? null : o });
      }
      else if (editing && selected && (e.key === "Backspace" || e.key === "Delete")) removePitch(selected.id);
      else if (e.key === "Escape") setSelectedId(null);
      else if (e.key === "e") {
        if (editing) finishEditing();
        else startEditing();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- Render ----------------------------------------------------------------------

  const seg: PlanSegment | null =
    mode === "quick" && segShown != null ? (plan[segShown] ?? null) : null;
  const badge = resultLabel(result);
  const quickLength = plan.length ? planDuration(plan) : 0;
  const quickOn = mode === "quick" && plan.length > 0;
  const quickNow = quickOn ? quickTimeAt(plan, planOffsets(plan), segShown, time) : 0;

  // Zoom a replay into the box: scale the picture so the box fills it, and
  // clip to the box so nothing spills into the letterbox around the video.
  const zoomed = !editing && !!zoom && replayZoom && !!seg?.replay;
  const zoomStyle: React.CSSProperties = {
    transformOrigin: "0 0",
    transition: "transform 350ms ease, clip-path 350ms ease",
    transform: zoomed && zoom ? `scale(${1 / zoom.s}) translate(${-zoom.x * 100}%, ${-zoom.y * 100}%)` : "none",
    clipPath:
      zoomed && zoom
        ? `inset(${zoom.y * 100}% ${(1 - zoom.x - zoom.s) * 100}% ${(1 - zoom.y - zoom.s) * 100}% ${zoom.x * 100}%)`
        : "inset(0% 0% 0% 0%)",
  };

  const scrubber = (
    <Scrubber
      duration={duration}
      time={time}
      pitches={sorted}
      plan={plan}
      quick={quickOn}
      activeSeg={segShown}
      selectedId={editing ? selectedId : null}
      selectedTools={editing && selected ? pitchTools(selected) : null}
      onSeek={(t) => {
        lastScrubT.current = { t, seg: null };
        seek(t, { fast: scrubbing.current && dragSeekIsFast });
      }}
      onSeekQuick={(i, t) => {
        lastScrubT.current = { t, seg: i };
        seekQuick(i, t, { fast: scrubbing.current && dragSeekIsFast });
      }}
      onScrubStart={() => {
        // Hold still while dragging so frames keep up, then carry on
        // playing from the new spot if it was playing before.
        scrubbing.current = true;
        lastScrubT.current = null;
        resumeAfterScrub.current = !!video.current && !video.current.paused;
        pause();
      }}
      onScrubEnd={() => {
        scrubbing.current = false;
        // Land exactly where the finger stopped (drags may have snapped).
        const last = lastScrubT.current;
        if (dragSeekIsFast && last) {
          if (last.seg != null) seekQuick(last.seg, last.t);
          else seek(last.t);
        }
        if (resumeAfterScrub.current) play();
        resumeAfterScrub.current = false;
      }}
      onSelect={(id) => editing && setSelectedId(id)}
      onDragPitch={(id, t) => setPitches((list) => list.map((p) => (p.id === id ? { ...p, t } : p)))}
      onDropPitch={(id, t) => patchPitch(id, { t: frameTime(frameAt(t)) })}
      detection={editing ? detection : null}
      detectThreshold={detectThreshold}
    />
  );

  // The selected pitch's tools, shown in a popover over its dot. Every change
  // saves as you make it.
  function pitchTools(p: ClipPitch) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-1 rounded-2xl bg-neutral-800 p-1 text-xs shadow-lg ring-1 ring-white/10">
        <span className="px-2 tabular-nums text-white/60">
          P{sorted.findIndex((x) => x.id === p.id) + 1} · {countsBefore(sorted)[sorted.findIndex((x) => x.id === p.id)]}
        </span>
        {PITCH_OUTCOMES.map((o) => (
          <Pill
            key={o.value}
            active={p.outcome === o.value}
            title={`${o.label} (${o.key.toUpperCase()})`}
            onClick={() => patchPitch(p.id, { outcome: p.outcome === o.value ? null : o.value })}
          >
            {o.label}
          </Pill>
        ))}
        <Pill onClick={() => patchPitch(p.id, { t: frameTime(frameAt(video.current?.currentTime ?? 0)) })}>
          Move here
        </Pill>
        <Pill onClick={() => removePitch(p.id)} aria-label="Delete pitch">
          <Trash2 className="size-3.5" />
        </Pill>
        <Pill onClick={() => setSelectedId(null)} aria-label="Done with this pitch">
          <X className="size-3.5" />
        </Pill>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-black text-white select-none"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Top bar: back to the game, step between its at-bats, what's playing (or
          the editing banner), result, Edit/Done, menu */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-2">
        <Link
          href={`/clips/game/${game.id}`}
          className="flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-sm text-white/80 hover:bg-white/10"
        >
          <ChevronLeft className="size-5 shrink-0" />
          <span className="hidden truncate sm:inline">{game.name}</span>
        </Link>
        <div className="flex min-w-0 items-center text-sm text-white/60">
          <AtBatStep href={prevId ? `/clips/at-bat/${prevId}` : null} label="Previous at-bat">
            <ChevronLeft className="size-4" />
          </AtBatStep>
          <span className="truncate tabular-nums">
            AB {index + 1} of {count}
            {result && <span className="text-white/90"> · {resultName(result)}</span>}
          </span>
          <AtBatStep href={nextId ? `/clips/at-bat/${nextId}` : null} label="Next at-bat">
            <ChevronRight className="size-4" />
          </AtBatStep>
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
          {editing ? (
            <span className="hidden truncate rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs text-amber-200 sm:inline">
              {sorted.length
                ? "Editing · tap a dot to adjust it, or + to add a pitch"
                : "Editing · tap + as each pitch reaches the plate"}
            </span>
          ) : seg?.replay ? (
            <span className="flex items-center gap-1.5 truncate rounded-full bg-violet-500/85 px-2.5 py-0.5 text-xs font-semibold">
              <RotateCcw className="size-3.5 shrink-0" /> Slow-mo replay · ¼×
            </span>
          ) : seg ? (
            <span className="truncate text-xs text-white/60">{seg.caption}</span>
          ) : null}
        </div>
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => setDialog("result")}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 font-mono text-xs font-semibold",
                badge ? "bg-white/15" : "text-white/60 ring-1 ring-white/20 hover:bg-white/10",
              )}
            >
              {badge ?? "Result"}
            </button>
            <button
              type="button"
              onClick={finishEditing}
              disabled={!sorted.length}
              title={sorted.length ? "Done marking (E)" : "Mark at least one pitch first"}
              className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 text-xs font-semibold disabled:opacity-40"
            >
              <Check className="size-4" /> Done
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={startEditing}
              title="Edit pitches (E)"
              className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/15"
            >
              <Pencil className="size-3.5" /> Edit
            </button>
          </>
        )}
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

      {/* Video */}
      <div
        ref={videoArea}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
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
            style={zoomStyle}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {zoomEditing && videoRect && (
          <ZoomBox
            rect={videoRect}
            zoom={zoom}
            onChange={setZoom}
            onCommit={(z) => {
              setZoom(z);
              setReplayZoomOn(true);
              setAtBatZoom(atBat.id, z).catch(report);
            }}
          />
        )}
        {!media && !mediaError && <Loader2 className="size-8 animate-spin text-white/60" />}
        {mediaError && <p className="px-6 text-center text-sm text-white/70">{mediaError}</p>}
        {saveError && (
          <button
            className="absolute inset-x-3 bottom-3 rounded-md bg-red-600/90 px-3 py-2 text-left text-xs"
            onClick={() => setSaveError(null)}
          >
            {saveError} — tap to dismiss
          </button>
        )}
      </div>

      {/* Auto-detection readout: progress, then the score against the marks */}
      {editing && (detectStatus || detectScore) && (
        <div className="flex shrink-0 items-center gap-2 px-3 pt-1 text-xs text-red-200">
          <AudioWaveform className="size-3.5 shrink-0 text-red-400" />
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {detectStatus ?? (detectScore && describeScore(detectScore, sorted.length))}
          </span>
          {detectScore && !detectStatus && (
            <>
              <Pill
                className="h-7 px-2.5"
                title="Show only stronger detections"
                onClick={() => setDetectThreshold((x) => x + 2)}
              >
                Fewer
              </Pill>
              <Pill
                className="h-7 px-2.5"
                title="Show weaker detections too"
                onClick={() => setDetectThreshold((x) => Math.max(DETECT.floorDb, x - 2))}
              >
                More
              </Pill>
              <span className="w-10 text-right font-mono text-[10px] text-red-200/60">{detectThreshold} dB</span>
            </>
          )}
          <button
            type="button"
            aria-label="Close auto-detection"
            className="rounded-full p-1 text-white/60 hover:bg-white/10"
            onClick={closeDetection}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Scrubber */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-1">
        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-white/70">
          {formatClock(quickOn ? quickNow : time)}
        </span>
        {scrubber}
        <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-white/50">
          {formatClock(quickOn ? quickLength : duration)}
        </span>
      </div>

      {/* Edit tools, on their own row so the transport below fits a phone */}
      {editing && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-2 pt-2">
          <Pill
            active={!!detection}
            onClick={() => (detection ? closeDetection() : runDetection())}
            disabled={!media || detecting}
            className="h-9"
            title="Auto-detect pitches from the sound, to compare with your marks"
          >
            {detecting ? <Loader2 className="size-4 animate-spin" /> : <AudioWaveform className="size-4" />}
            Detect
          </Pill>
          <Pill active={zoomEditing} onClick={() => setZoomEditing((x) => !x)} className="h-9" title="Zoom for replays">
            <ZoomIn className="size-4" /> {zoomEditing ? "Done" : "Zoom"}
          </Pill>
          {zoomEditing && zoom && (
            <Pill
              className="h-9"
              onClick={() => {
                setZoom(null);
                setAtBatZoom(atBat.id, null).catch(report);
              }}
            >
              Remove zoom
            </Pill>
          )}
        </div>
      )}

      {/* Transport, split to the thumbs: pitch + frame on the outside edges,
          play and speed (plus + Pitch while editing) in the middle. The middle
          never shrinks below its buttons; the edge buttons narrow instead. */}
      <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2 pt-1 sm:gap-2">
        <TransportButton label="Previous pitch" onClick={() => jumpToPitch(-1)} disabled={!sorted.length}>
          <ChevronFirst className="size-6" />
        </TransportButton>
        <TransportButton label="Frame back" hold onHoldStart={() => startHold(-1)} onHoldEnd={stopHold}>
          <StepBack className="size-6" />
        </TransportButton>

        <div className="flex flex-1 items-center justify-center gap-1.5 sm:gap-2">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white text-black active:bg-white/80"
            onClick={() => (playing ? pause() : play())}
          >
            {playing ? <Pause className="size-6" fill="currentColor" /> : <Play className="size-6 translate-x-0.5" fill="currentColor" />}
          </button>
          {editing && (
            <button
              type="button"
              aria-label="Mark a pitch here"
              title="Mark a pitch here (M)"
              className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-emerald-500/85 px-3 text-xs font-semibold active:bg-emerald-500"
              onClick={addHere}
            >
              <Plus className="size-4" /> Pitch
            </button>
          )}
          {!editing && zoom && (
            <Pill
              active={replayZoom}
              className="h-9"
              title={replayZoom ? "Replays zoom in — tap to turn off" : "Zoom in on replays"}
              onClick={() => {
                const on = !replayZoom;
                setReplayZoomOn(on);
                setReplayZoom(atBat.id, on).catch(report);
              }}
            >
              <ZoomIn className="size-4" />
            </Pill>
          )}
          <Pill onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} className="h-9">
            {speed === 1 ? "1×" : speed === 0.5 ? "½×" : "¼×"}
          </Pill>
        </div>

        <TransportButton label="Frame forward" hold onHoldStart={() => startHold(1)} onHoldEnd={stopHold}>
          <StepForward className="size-6" />
        </TransportButton>
        <TransportButton label="Next pitch" onClick={() => jumpToPitch(1)} disabled={!sorted.length}>
          <ChevronLast className="size-6" />
        </TransportButton>
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

function AtBatStep({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "flex size-8 items-center justify-center rounded-lg";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={cn(cls, "hover:bg-white/10")}>
      {children}
    </Link>
  ) : (
    <span aria-hidden className={cn(cls, "opacity-25")}>
      {children}
    </span>
  );
}

function TransportButton({
  label,
  onClick,
  hold,
  onHoldStart,
  onHoldEnd,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  hold?: boolean;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex h-12 w-14 min-w-9 shrink items-center justify-center rounded-xl bg-white/10 active:bg-white/25 disabled:opacity-30"
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

/** "6 found · 5 of 6 pitches matched, avg 0.04s late (worst 0.21s) · 1 missed · 1 extra" */
function describeScore(
  score: { shown: number; matched: { offset: number }[]; missed: number[]; extra: number[] },
  marks: number,
): string {
  const parts = [`${score.shown} found`];
  if (marks) {
    let m = `${score.matched.length} of ${marks} pitches matched`;
    if (score.matched.length) {
      const avg = score.matched.reduce((a, x) => a + x.offset, 0) / score.matched.length;
      const worst = Math.max(...score.matched.map((x) => Math.abs(x.offset)));
      m += `, avg ${Math.abs(avg).toFixed(2)}s ${avg >= 0 ? "late" : "early"} (worst ${worst.toFixed(2)}s)`;
    }
    parts.push(m);
    if (score.missed.length) parts.push(`${score.missed.length} missed`);
  }
  if (score.extra.length) parts.push(`${score.extra.length} extra`);
  return parts.join(" · ");
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
