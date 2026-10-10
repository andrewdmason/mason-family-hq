"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { outcomeLabel, type ClipPitch, type PitchOutcome } from "@/lib/clips/types";
import { planDuration, planOffsets, quickTimeAt, type PlanSegment } from "@/lib/clips/plan";
import type { Detection } from "@/lib/clips/detect";
import { cn } from "@/lib/utils";

// The timeline, in two shapes.
//
// Full: the whole video. Tap or drag to seek; a dot per pitch, colored like a
// scorebook — green ball, red strike, amber foul, blue in play; swings filled,
// takes hollow, untagged plain white — with a ring on the last pitch. Tapping a dot jumps to it and selects it; dragging one moves it. The
// stretches the quick version plays are faintly tinted.
//
// Quick: the scrubber *is* the quick version — just the pitch windows, end to
// end with a small gap between pitches, each swing's slow replay a violet
// striped "¼×" extension after its window — no dot, so it never reads as
// another pitch. Switching modes animates between the two: the
// tinted windows slide together as the gaps fold away.
//
// Auto-detection (full only, while the experiment is on): the sound's onset
// strength drawn faintly behind the track, and a red tick at each detected
// pitch — brighter the stronger it is — to compare against the dots.

const GAP_PX = 6;
// The pitch-tools popover keeps at least this far from the screen's edges.
const TOOLS_MARGIN = 8;
const LABEL_MIN_PX = 64;
const DOT_STYLE: Record<PitchOutcome | "none", string> = {
  none: "bg-white/70",
  ball: "bg-black ring-2 ring-emerald-400",
  called_strike: "bg-black ring-2 ring-red-500",
  swinging_strike: "bg-red-500",
  foul: "bg-amber-400",
  in_play: "bg-blue-500",
};

export function Scrubber({
  duration,
  time,
  pitches,
  plan,
  quick,
  activeSeg,
  selectedId,
  selectedTools,
  onSeek,
  onSeekQuick,
  onScrubStart,
  onScrubEnd,
  onSelect,
  onDragPitch,
  onDropPitch,
  detection,
  detectThreshold,
}: {
  duration: number;
  time: number;
  pitches: ClipPitch[];
  plan: PlanSegment[];
  quick: boolean;
  /** The quick-mode segment playing now (tells a replay from its pitch window). */
  activeSeg: number | null;
  selectedId: string | null;
  /** Floated above the selected pitch's dot. */
  selectedTools: React.ReactNode;
  onSeek: (t: number) => void;
  onSeekQuick: (segIndex: number, t: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onSelect: (id: string) => void;
  onDragPitch: (id: string, t: number) => void;
  onDropPitch: (id: string, t: number) => void;
  detection?: Detection | null;
  /** Ticks show for onsets at least this strong (dB). */
  detectThreshold?: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "seek" } | { kind: "pitch"; id: string; moved: boolean; t: number; x: number } | null>(
    null,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Quick-timeline geometry: each segment's start (in quick seconds), which
  // pitch group it belongs to (for the gaps), and the total length.
  const geo = useMemo(() => {
    const offsets = planOffsets(plan);
    const total = planDuration(plan) || 1;
    const group: number[] = [];
    plan.forEach((s, i) => group.push(i === 0 ? 0 : group[i - 1] + (s.pitchIndex !== plan[i - 1].pitchIndex ? 1 : 0)));
    const gaps = plan.length ? group[group.length - 1] : 0;
    return { offsets, total, group, gaps };
  }, [plan]);

  // CSS for a spot on the quick timeline: a share of the width left after the
  // gaps, plus the gaps before it.
  const qLeft = (q: number, groupIdx: number) =>
    `calc(${q / geo.total} * (100% - ${geo.gaps * GAP_PX}px) + ${groupIdx * GAP_PX}px)`;
  const qWidth = (q: number) => `calc(${q / geo.total} * (100% - ${geo.gaps * GAP_PX}px))`;
  const pct = (t: number) => (duration > 0 ? `${Math.min(100, Math.max(0, (t / duration) * 100))}%` : "0%");

  const segLen = (i: number) => (plan[i].end - plan[i].start) / plan[i].rate;
  const qNow = quick ? quickTimeAt(plan, geo.offsets, activeSeg, time) : 0;
  const qNowSeg = quick
    ? Math.max(0, geo.offsets.findLastIndex((o, i) => qNow >= o && (qNow < o + segLen(i) || i === plan.length - 1)))
    : 0;

  function timeAt(clientX: number) {
    const r = track.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  }

  /** Pointer x → (segment, source time) on the quick timeline; gaps snap forward. */
  function quickAt(clientX: number): { i: number; t: number } | null {
    if (!plan.length) return null;
    const r = track.current!.getBoundingClientRect();
    const x = clientX - r.left;
    const avail = r.width - geo.gaps * GAP_PX;
    for (let i = 0; i < plan.length; i++) {
      const left = (geo.offsets[i] / geo.total) * avail + geo.group[i] * GAP_PX;
      const w = (segLen(i) / geo.total) * avail;
      if (x < left) return { i, t: plan[i].start };
      if (x <= left + w) return { i, t: plan[i].start + ((x - left) / w) * (plan[i].end - plan[i].start) };
    }
    const last = plan.length - 1;
    return { i: last, t: plan[last].end - 0.01 };
  }

  function seekTo(clientX: number) {
    if (quick) {
      const hit = quickAt(clientX);
      if (hit) onSeekQuick(hit.i, hit.t);
    } else onSeek(timeAt(clientX));
  }

  const lastId = pitches.length ? pitches[pitches.length - 1].id : null;

  // The selected dot's position in pixels, for its tools popover (kept on
  // screen near the ends of the bar).
  const selectedX = (() => {
    const j = pitches.findIndex((p) => p.id === selectedId);
    if (j < 0 || !width) return null;
    const p = pitches[j];
    if (!quick) return duration > 0 ? (p.t / duration) * width : null;
    const i = plan.findIndex((s) => !s.replay && s.pitchIndex === j);
    if (i < 0) return null;
    const avail = width - geo.gaps * GAP_PX;
    return ((geo.offsets[i] + (p.t - plan[i].start) / plan[i].rate) / geo.total) * avail + geo.group[i] * GAP_PX;
  })();
  const transition = "transition-[left,width,opacity] duration-500 ease-in-out";

  // Centre the popover over its dot, then slide it back inside the screen —
  // measured, since it wraps to a different width on a phone than a laptop.
  const tools = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tools.current;
    if (!el || !track.current || selectedX == null) return;
    const trackLeft = track.current.getBoundingClientRect().left;
    const vw = document.documentElement.clientWidth;
    const half = el.offsetWidth / 2;
    const min = TOOLS_MARGIN + half - trackLeft;
    const max = vw - TOOLS_MARGIN - half - trackLeft;
    el.style.left = `${min > max ? vw / 2 - trackLeft : Math.min(Math.max(selectedX, min), max)}px`;
  });

  return (
    <div
      ref={track}
      className="relative h-10 flex-1 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        if (!duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { kind: "seek" };
        onScrubStart();
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.kind === "seek") return seekTo(e.clientX);
        // A tap that wobbles a few pixels shouldn't nudge the marker.
        if (!d.moved && Math.abs(e.clientX - d.x) < 6) return;
        d.moved = true;
        d.t = timeAt(e.clientX);
        onDragPitch(d.id, d.t);
        onSeek(d.t);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        setDraggingId(null);
        if (d?.kind === "pitch" && d.moved) onDropPitch(d.id, d.t);
        onScrubEnd();
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDraggingId(null);
        onScrubEnd();
      }}
    >
      {/* Full-length track (fades out in quick) and its played portion */}
      <div
        className={cn(
          "absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/25 transition-opacity duration-500",
          quick && "opacity-0",
        )}
      >
        {!quick && <div className="absolute inset-y-0 left-0 rounded-full bg-white/70" style={{ width: pct(time) }} />}
      </div>

      {/* Pitch windows: tinted stretches in full, the whole bar in quick */}
      {plan.map((s, i) => {
        const fill = quick ? Math.min(1, Math.max(0, (qNow - geo.offsets[i]) / segLen(i))) : 0;
        const style = quick
          ? { left: qLeft(geo.offsets[i], geo.group[i]), width: qWidth(segLen(i)), opacity: 1 }
          : s.replay
            ? { left: pct(s.start), width: "0%", opacity: 0 }
            : { left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})`, opacity: 1 };
        return (
          <div
            key={i}
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 overflow-hidden",
              transition,
              quick ? "h-2 bg-white/30" : "h-1.5 bg-white/20",
              // Round the outer ends of each pitch group.
              (i === 0 || geo.group[i] !== geo.group[i - 1]) && "rounded-l-full",
              (i === plan.length - 1 || geo.group[i] !== geo.group[i + 1]) && "rounded-r-full",
            )}
            style={
              s.replay && quick
                ? {
                    ...style,
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(167,139,250,0.6) 0 3px, rgba(167,139,250,0.2) 3px 6px)",
                    backgroundColor: "transparent",
                  }
                : style
            }
          >
            {quick && (
              <div
                className={cn("h-full", s.replay ? "bg-violet-400" : "bg-white/80")}
                style={{ width: `${fill * 100}%` }}
              />
            )}
          </div>
        );
      })}

      {/* Pitch labels over each window, and "¼×" over each replay, where there's room (quick only) */}
      {quick &&
        plan.map((s, i) => {
          if (s.replay) {
            const px = (segLen(i) / geo.total) * (width - geo.gaps * GAP_PX);
            if (px < 24) return null;
            return (
              <span
                key={`label-${i}`}
                className="pointer-events-none absolute top-0 text-[10px] font-semibold leading-none text-violet-300"
                style={{ left: qLeft(geo.offsets[i], geo.group[i]), width: qWidth(segLen(i)), textAlign: "center" }}
              >
                ¼×
              </span>
            );
          }
          if (i > 0 && plan[i - 1].pitchIndex === s.pitchIndex) return null;
          const groupLen = plan.filter((x) => x.pitchIndex === s.pitchIndex).reduce((a, x) => a + (x.end - x.start) / x.rate, 0);
          const px = (groupLen / geo.total) * (width - geo.gaps * GAP_PX);
          const p = pitches[s.pitchIndex];
          if (!p || px < LABEL_MIN_PX) return null;
          return (
            <span
              key={`label-${i}`}
              className="pointer-events-none absolute top-0 truncate text-[10px] leading-none text-white/60"
              style={{ left: qLeft(geo.offsets[i], geo.group[i]), maxWidth: qWidth(groupLen) }}
            >
              P{s.pitchIndex + 1} · {outcomeLabel(p.outcome, "short")}
            </span>
          );
        })}

      {/* Auto-detection: strength curve and ticks (full only) */}
      {!quick && detection && detectThreshold != null && (
        <>
          <svg
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full"
            viewBox={`0 0 ${detection.curve.length} 1`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <polyline
              fill="none"
              stroke="rgb(248 113 113 / 0.45)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              points={detection.curve.map((v, i) => `${i},${1 - Math.min(1, v / 40)}`).join(" ")}
            />
            <line
              x1={0}
              x2={detection.curve.length}
              y1={1 - Math.min(1, detectThreshold / 40)}
              y2={1 - Math.min(1, detectThreshold / 40)}
              stroke="rgb(248 113 113 / 0.3)"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {detection.onsets
            .filter((o) => o.strength >= detectThreshold)
            .map((o) => (
              <button
                key={o.t}
                type="button"
                aria-label={`Detected pitch at ${o.t.toFixed(2)}s`}
                title={`${o.t.toFixed(2)}s · ${o.strength} dB`}
                className="absolute top-0 flex h-full w-3 -translate-x-1/2 justify-center"
                style={{ left: pct(o.t) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSeek(o.t);
                }}
              >
                <span
                  className="block h-full w-0.5 rounded-full bg-red-500"
                  style={{ opacity: 0.45 + 0.55 * Math.min(1, (o.strength - detectThreshold) / 15) }}
                />
              </button>
            ))}
        </>
      )}

      {/* Pitch dots */}
      {pitches.map((p, j) => {
        const selected = p.id === selectedId;
        let left: string;
        let segForDot = -1;
        if (quick) {
          segForDot = plan.findIndex((s) => !s.replay && s.pitchIndex === j);
          if (segForDot < 0) return null;
          const s = plan[segForDot];
          left = qLeft(geo.offsets[segForDot] + (p.t - s.start) / s.rate, geo.group[segForDot]);
        } else left = pct(p.t);
        return (
          <button
            key={p.id}
            type="button"
            aria-label={`Pitch ${j + 1}`}
            className={cn(
              "absolute top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
              draggingId !== p.id && transition,
            )}
            style={{ left }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(p.id);
              track.current!.setPointerCapture(e.pointerId);
              onScrubStart();
              if (quick) {
                // In quick the windows move as markers change, so dots aren't
                // draggable here — a drag from a dot just scrubs.
                drag.current = { kind: "seek" };
                onSeekQuick(segForDot, p.t);
              } else {
                drag.current = { kind: "pitch", id: p.id, moved: false, t: p.t, x: e.clientX };
                setDraggingId(p.id);
                onSeek(p.t);
              }
            }}
          >
            <span
              className={cn(
                "block rounded-full shadow",
                DOT_STYLE[p.outcome ?? "none"],
                selected ? "size-4 outline-2 outline-offset-3 outline-white" : "size-3",
                p.id === lastId && !selected && "outline-1 outline-offset-2 outline-white/80",
              )}
            />
          </button>
        );
      })}

      {selectedTools && selectedX != null && (
        <div
          ref={tools}
          className="absolute bottom-full z-10 mb-1 w-max max-w-[calc(100vw-16px)] -translate-x-1/2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {selectedTools}
        </div>
      )}

      {/* Playhead */}
      <div
        className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
        style={{ left: quick ? qLeft(qNow, geo.group[qNowSeg] ?? 0) : pct(time) }}
      />
    </div>
  );
}
