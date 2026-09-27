"use client";

import { useRef } from "react";
import type { ClipZoom } from "@/lib/clips/types";

// The replay-zoom editor, laid exactly over the video picture. Tap to drop a
// 2× box centered there (tapping outside an existing box moves it there);
// drag the box to move it, drag its corner to resize. The box always keeps the
// video's shape, so it's stored as a top-left corner plus one size, all as
// fractions of the frame.

const DEFAULT_SIZE = 0.5; // 2×
const MIN_SIZE = 0.15; // ~6.7×

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function placeAt(fx: number, fy: number, s: number): ClipZoom {
  return { x: clamp(fx - s / 2, 0, 1 - s), y: clamp(fy - s / 2, 0, 1 - s), s };
}

export function ZoomBox({
  rect,
  zoom,
  onChange,
  onCommit,
}: {
  /** Where the video picture sits, in px within the player's video area. */
  rect: { left: number; top: number; width: number; height: number };
  zoom: ClipZoom | null;
  onChange: (zoom: ClipZoom) => void;
  onCommit: (zoom: ClipZoom) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { kind: "move"; fx: number; fy: number; start: ClipZoom }
    | { kind: "resize"; start: ClipZoom }
    | null
  >(null);
  const latest = useRef<ClipZoom | null>(zoom);

  function frac(e: React.PointerEvent) {
    const r = area.current!.getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
  }

  function update(z: ClipZoom) {
    latest.current = z;
    onChange(z);
  }

  return (
    <div
      ref={area}
      className="absolute z-10 touch-none overflow-hidden"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={(e) => {
        e.stopPropagation();
        const { fx, fy } = frac(e);
        // A tap outside the box (or with no box yet) centers one there.
        const z = placeAt(fx, fy, zoom?.s ?? DEFAULT_SIZE);
        update(z);
        onCommit(z);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const { fx, fy } = frac(e);
        if (d.kind === "move") {
          update({
            ...d.start,
            x: clamp(d.start.x + fx - d.fx, 0, 1 - d.start.s),
            y: clamp(d.start.y + fy - d.fy, 0, 1 - d.start.s),
          });
        } else {
          const s = clamp(Math.max(fx - d.start.x, fy - d.start.y), MIN_SIZE, Math.min(1 - d.start.x, 1 - d.start.y));
          update({ ...d.start, s });
        }
      }}
      onPointerUp={() => {
        if (drag.current && latest.current) onCommit(latest.current);
        drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      {!zoom ? (
        <div className="pointer-events-none flex size-full items-center justify-center bg-black/35">
          <span className="rounded-full bg-black/70 px-3 py-1.5 text-sm">Tap your batter to zoom there</span>
        </div>
      ) : (
        <div
          className="absolute cursor-move rounded-sm border-2 border-white"
          style={{
            left: `${zoom.x * 100}%`,
            top: `${zoom.y * 100}%`,
            width: `${zoom.s * 100}%`,
            height: `${zoom.s * 100}%`,
            // Dim everything outside the box.
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            area.current!.setPointerCapture(e.pointerId);
            const { fx, fy } = frac(e);
            drag.current = { kind: "move", fx, fy, start: zoom };
          }}
        >
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
            {(1 / zoom.s).toFixed(1)}×
          </span>
          <span
            aria-label="Resize zoom"
            className="absolute -bottom-2.5 -right-2.5 size-6 cursor-nwse-resize rounded-full border-2 border-white bg-black/70"
            onPointerDown={(e) => {
              e.stopPropagation();
              area.current!.setPointerCapture(e.pointerId);
              drag.current = { kind: "resize", start: zoom };
            }}
          />
        </div>
      )}
    </div>
  );
}
