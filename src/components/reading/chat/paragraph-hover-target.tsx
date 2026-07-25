"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { blockElements, blockTopWithin } from "@/lib/reading/chat-anchors";

/** How close to a paragraph gap the cursor must be for the target to appear. */
const GAP_BAND_PX = 14;

/**
 * Hover between two paragraphs to reveal a "start a chat here" target.
 *
 * It lives in the LEFT margin, opposite the existing-chat markers on the right.
 * Two gutters with one job each: left adds, right opens. An earlier version put
 * it in the right gutter below whatever chats were already there, which read as
 * "a third comment" rather than a control, and drifted away from the gap it
 * actually refers to.
 *
 * Desktop only. Guarded on a real pointer rather than viewport width: a touch
 * device has no hover state, so this would otherwise latch on after a tap.
 */
export function ParagraphHoverTarget({
  contentRef,
  onStart,
  layoutNonce,
  disabled,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** blockIndex is the block BELOW the gap. */
  onStart: (blockIndex: number) => void;
  layoutNonce: number;
  disabled: boolean;
}) {
  const [hit, setHit] = useState<{ top: number; blockIndex: number } | null>(null);

  useEffect(() => {
    if (disabled) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const container = contentRef.current;
    if (!container) return;

    let tops: number[] = [];
    const remeasure = () => {
      tops = blockElements(container).map((el) => blockTopWithin(el, container));
    };
    remeasure();

    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      // The reading column plus the left gutter the affordance lives in, so the
      // target doesn't vanish as you reach for it.
      if (e.clientX < rect.left - 48 || e.clientX > rect.right) {
        setHit(null);
        return;
      }
      const y = e.clientY - rect.top;
      let best: { top: number; blockIndex: number } | null = null;
      for (let i = 1; i < tops.length; i++) {
        const distance = Math.abs(tops[i] - y);
        if (distance <= GAP_BAND_PX && (!best || distance < Math.abs(best.top - y))) {
          best = { top: tops[i], blockIndex: i };
        }
      }
      setHit(best);
    };

    const onLeave = () => setHit(null);

    window.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", remeasure);
    };
  }, [contentRef, layoutNonce, disabled]);

  if (!hit || disabled) return null;

  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 h-px -translate-y-1/2 bg-foreground/15"
        style={{ top: hit.top }}
      />
      {/* Centred on the gap line, since it refers to that gap specifically. */}
      <button
        type="button"
        onClick={() => onStart(hit.blockIndex)}
        aria-label="Start a chat here"
        style={{ top: hit.top }}
        className="pointer-events-auto absolute -left-9 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:border-foreground/30 hover:text-foreground max-md:left-0"
      >
        <MessageSquarePlus className="h-3 w-3" />
      </button>
    </>
  );
}
