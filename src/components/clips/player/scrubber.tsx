"use client";

import { useRef } from "react";
import { pitchKind, type ClipPitch } from "@/lib/clips/types";
import type { PlanSegment } from "@/lib/clips/plan";
import { cn } from "@/lib/utils";

// The timeline: a track you can tap or drag to seek, with a dot per pitch —
// white for takes, yellow for swings and misses, green for contact — and a
// ring around the at-bat's last pitch. In quick mode the stretches the quick
// version plays are tinted. In edit mode the dots can be dragged to move them.

const DOT_COLOR = {
  take: "bg-white",
  miss: "bg-yellow-400",
  contact: "bg-emerald-400",
} as const;

export function Scrubber({
  duration,
  time,
  pitches,
  plan,
  editing,
  selectedId,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onSelect,
  onDragPitch,
  onDropPitch,
}: {
  duration: number;
  time: number;
  pitches: ClipPitch[];
  plan: PlanSegment[] | null;
  editing: boolean;
  selectedId: string | null;
  onSeek: (t: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onSelect: (id: string) => void;
  onDragPitch: (id: string, t: number) => void;
  onDropPitch: (id: string, t: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "seek" } | { kind: "pitch"; id: string; moved: boolean; t: number } | null>(null);
  const pct = (t: number) => (duration > 0 ? `${Math.min(100, Math.max(0, (t / duration) * 100))}%` : "0%");

  function timeAt(clientX: number) {
    const r = track.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  }

  const lastId = pitches.length ? pitches[pitches.length - 1].id : null;

  return (
    <div
      ref={track}
      className="relative h-10 flex-1 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        if (!duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { kind: "seek" };
        onScrubStart();
        onSeek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const t = timeAt(e.clientX);
        if (d.kind === "seek") onSeek(t);
        else {
          d.moved = true;
          d.t = t;
          onDragPitch(d.id, t);
          onSeek(t);
        }
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.kind === "pitch" && d.moved) onDropPitch(d.id, d.t);
        onScrubEnd();
      }}
      onPointerCancel={() => {
        drag.current = null;
        onScrubEnd();
      }}
    >
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
        {plan?.map((s, i) =>
          s.replay ? null : (
            <div
              key={i}
              className="absolute inset-y-0 bg-white/35"
              style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }}
            />
          ),
        )}
        <div className="absolute inset-y-0 left-0 bg-white/70" style={{ width: pct(time) }} />
      </div>

      {/* Pitch dots */}
      {pitches.map((p) => {
        const selected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            aria-label={`Pitch at ${p.t.toFixed(2)}s`}
            className="absolute top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: pct(p.t) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(p.id);
              if (editing) {
                track.current!.setPointerCapture(e.pointerId);
                drag.current = { kind: "pitch", id: p.id, moved: false, t: p.t };
                onScrubStart();
              } else {
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
        style={{ left: pct(time) }}
      />
    </div>
  );
}
