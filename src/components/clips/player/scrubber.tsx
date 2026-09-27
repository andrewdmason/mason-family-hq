"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pitchKind, type ClipPitch } from "@/lib/clips/types";
import { planDuration, planOffsets, quickTimeAt, type PlanSegment } from "@/lib/clips/plan";
import { cn } from "@/lib/utils";

// The timeline, in two shapes.
//
// Full: the whole video. Tap or drag to seek; a dot per pitch — white for
// takes, yellow for swings and misses, green for contact, a ring on the last
// pitch. Tapping a dot jumps to it and selects it; dragging one moves it. The
// stretches the quick version plays are faintly tinted.
//
// Quick: the scrubber *is* the quick version — just the pitch windows, end to
// end with a small gap between pitches, each swing's slow replay a striped
// extension after its window. Switching modes animates between the two: the
// tinted windows slide together as the gaps fold away.

const GAP_PX = 6;
const LABEL_MIN_PX = 64;
const DOT_COLOR = {
  take: "bg-white",
  miss: "bg-yellow-400",
  contact: "bg-emerald-400",
} as const;
const KIND_SHORT = { take: "Take", miss: "Swing", contact: "Contact" } as const;

export function Scrubber({
  duration,
  time,
  pitches,
  plan,
  quick,
  activeSeg,
  selectedId,
  onSeek,
  onSeekQuick,
  onScrubStart,
  onScrubEnd,
  onSelect,
  onDragPitch,
  onDropPitch,
}: {
  duration: number;
  time: number;
  pitches: ClipPitch[];
  plan: PlanSegment[];
  quick: boolean;
  /** The quick-mode segment playing now (tells a replay from its pitch window). */
  activeSeg: number | null;
  selectedId: string | null;
  onSeek: (t: number) => void;
  onSeekQuick: (segIndex: number, t: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onSelect: (id: string) => void;
  onDragPitch: (id: string, t: number) => void;
  onDropPitch: (id: string, t: number) => void;
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
  const transition = "transition-[left,width,opacity] duration-500 ease-in-out";

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
                      "repeating-linear-gradient(135deg, rgba(255,255,255,0.28) 0 3px, rgba(255,255,255,0.1) 3px 6px)",
                    backgroundColor: "transparent",
                  }
                : style
            }
          >
            {quick && <div className="h-full bg-white/80" style={{ width: `${fill * 100}%` }} />}
          </div>
        );
      })}

      {/* Pitch labels over each window, where there's room (quick only) */}
      {quick &&
        plan.map((s, i) => {
          if (s.replay || (i > 0 && plan[i - 1].pitchIndex === s.pitchIndex)) return null;
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
              P{s.pitchIndex + 1} · {KIND_SHORT[pitchKind(p)]}
            </span>
          );
        })}

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
                "block rounded-full shadow ring-black/40",
                DOT_COLOR[pitchKind(p)],
                selected ? "size-4 ring-2 ring-offset-2 ring-offset-black ring-white" : "size-3 ring-1",
                p.id === lastId && !selected && "outline-2 outline-offset-2 outline-white",
              )}
            />
          </button>
        );
      })}

      {/* Playhead */}
      <div
        className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
        style={{ left: quick ? qLeft(qNow, geo.group[qNowSeg] ?? 0) : pct(time) }}
      />
    </div>
  );
}
