"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGapTargets, type GapTarget, type PagedGutterContext } from "./gutter-placement";

/** How close to a paragraph gap the cursor must be for the target to appear. */
const GAP_BAND_PX = 14;

/** How far left of the text the cursor may stray without losing the target. */
const REACH_PX = 48;

/** Half the button's width, for centring it on a position. */
const BUTTON_HALF = 12;

/**
 * Hover between two paragraphs to reveal a "start a chat here" target.
 *
 * It lives to the LEFT of the text, opposite the existing-chat markers on the
 * right. Two gutters with one job each: left adds, right opens. An earlier
 * version put it in the right gutter below whatever chats were already there,
 * which read as "a third comment" rather than a control, and drifted away from
 * the gap it actually refers to.
 *
 * Paged mode reads that rule per column rather than per page, because a page has
 * only one outer left margin to give. The button centres on its column's left
 * text edge rather than sitting clear of it, and that is not a compromise but
 * the thing that makes it fit: the column gap is 56px and the left column's
 * markers already sit centred in it, so a button placed fully inside the gap
 * would land on them, whereas straddling the edge clears them by 4px in the
 * worst case. (Checked, not assumed — scripts/verify-gap-targets.mts.) The
 * hairline shortens to the hovered column for the same reason, so it reads as
 * belonging to that column rather than ruling across the whole spread.
 *
 * Desktop only. Guarded on a real pointer rather than viewport width: a touch
 * device has no hover state, so this would otherwise latch on after a tap.
 */
export function ParagraphHoverTarget({
  contentRef,
  onStart,
  layoutNonce,
  disabled,
  paged,
  base,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** blockIndex is GLOBAL, and is the block BELOW the gap — see RenderedBlocks. */
  onStart: (blockIndex: number) => void;
  layoutNonce: number;
  disabled: boolean;
  /** Non-null in paged mode, where targets are per column and per page. */
  paged: PagedGutterContext | null;
  /** Global index of the first rendered block — see RenderedBlocks. */
  base: number;
}) {
  const [hit, setHit] = useState<GapTarget | null>(null);
  const targets = useGapTargets(contentRef, layoutNonce, paged, base);
  const viewport = paged?.viewport ?? null;

  useEffect(() => {
    if (disabled) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const container = contentRef.current;
    if (!container) return;

    const onMove = (e: MouseEvent) => {
      // Paged targets are measured against the fixed reading area; scrolling
      // ones against the text column, whose rect moves with the page.
      const origin = (viewport ?? container).getBoundingClientRect();
      const x = e.clientX - origin.left;
      const y = e.clientY - origin.top;

      let best: GapTarget | null = null;
      let bestDistance = GAP_BAND_PX;
      for (const target of targets) {
        // The text plus the strip the affordance lives in, so the target doesn't
        // vanish as you reach for it. In paged mode the reach is shorter than the
        // column gap, which is what stops the left column's text from lighting up
        // a gap in the right column.
        const left = target.column?.left ?? 0;
        const right = target.column ? left + target.column.width : origin.width;
        if (x < left - REACH_PX || x > right) continue;
        const distance = Math.abs(target.top - y);
        if (distance > bestDistance) continue;
        bestDistance = distance;
        best = target;
      }
      setHit(best);
    };

    const onLeave = () => setHit(null);

    // The reading area, which in paged mode is not the flow: the flow's own box
    // is one column wide and translated off to the left, so leaving it means
    // nothing.
    const area = viewport ?? container;
    window.addEventListener("mousemove", onMove);
    area.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      area.removeEventListener("mouseleave", onLeave);
    };
  }, [contentRef, disabled, targets, viewport]);

  // Only a target from the CURRENT measurement is shown. Turning the page with
  // the keyboard moves the text out from under a stationary cursor, and there is
  // no mouse event to notice with — but re-measuring replaces every target, so
  // the one being pointed at simply stops being one of them.
  if (!hit || disabled || !targets.includes(hit)) return null;

  return (
    <>
      <div
        className="pointer-events-none absolute h-px -translate-y-1/2 bg-foreground/15"
        style={
          hit.column
            ? { top: hit.top, left: hit.column.left, width: hit.column.width }
            : { top: hit.top, left: 0, right: 0 }
        }
      />
      {/* Centred on the gap line, since it refers to that gap specifically —
          except in paged mode, where it straddles the text edge and would
          therefore clip the first letter of the paragraph below. There it rests
          ON the line instead, sitting in the gap's own whitespace. */}
      <button
        type="button"
        onClick={() => onStart(hit.blockIndex)}
        aria-label="Start a chat here"
        style={
          hit.column
            ? { top: hit.top, left: hit.column.left - BUTTON_HALF }
            : { top: hit.top }
        }
        className={cn(
          "pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:border-foreground/30 hover:text-foreground",
          hit.column ? "-translate-y-full" : "-left-9 -translate-y-1/2 max-md:left-0"
        )}
      >
        <MessageSquarePlus className="h-3 w-3" />
      </button>
    </>
  );
}
