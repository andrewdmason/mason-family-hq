"use client";

import { useEffect } from "react";
import {
  rangeForAnchor,
  renderedBlocks,
  type ResolvedAnchor,
} from "@/lib/reading/annotation-anchors";
import type { FaceTextOf } from "@/lib/reading/face-map";
import { ensureHighlightStyles, HELD_HIGHLIGHT } from "./use-annotation-highlights";

/**
 * A passage that runs off the page.
 *
 * Dragging a selection across a page turn is the thing every e-reader does
 * badly, because the gesture that turns the page is the gesture that ends the
 * selection. This takes the drag out of it: the reader selects where the passage
 * STARTS, taps Continue, the page turns, and they select where it ENDS. The two
 * selections become one passage at the moment they act on it.
 *
 * What is held between the two is a resolved anchor, not a DOM range. The book
 * is one flow and a page turn is a translate, so a range would usually survive
 * — but not across a window seam, where the flow is re-rendered around the new
 * position. An anchor is re-found in whatever is rendered now, and the window
 * always keeps a margin behind the reader, so the start is still on the strip.
 */
export type HeldSelection = ResolvedAnchor;

/** The held start, re-found in the page as it is rendered now. */
export function heldRange(
  held: HeldSelection,
  container: HTMLElement,
  base: number,
  faceTextOf?: FaceTextOf
): Range | null {
  return rangeForAnchor(
    held.anchor,
    container,
    renderedBlocks(container, base),
    faceTextOf,
    held.plainQuotedText
  );
}

/**
 * The passage from the held start to the end of a fresh selection — or the
 * fresh selection alone when it doesn't follow the held start, which is what
 * happens when the reader turns back and selects something before it.
 */
export function extendFromHeld(start: Range | null, selection: Range): Range {
  if (!start || start.compareBoundaryPoints(Range.START_TO_START, selection) >= 0) {
    return selection;
  }
  const joined = selection.cloneRange();
  joined.setStart(start.startContainer, start.startOffset);
  return joined;
}

/**
 * Keep the held start visible on the page.
 *
 * While the reader is choosing where the passage ends, the mark runs from the
 * held start to the front of their live selection, so the page shows one
 * passage rather than two pieces. With no live selection it shows what was
 * held — which is what they see if they turn back to check.
 */
export function useHeldSelectionHighlight(
  held: HeldSelection | null,
  live: Range | null,
  contentRef: React.RefObject<HTMLDivElement | null>,
  layoutNonce: number,
  base: number,
  faceTextOf?: FaceTextOf
) {
  useEffect(() => {
    if (!held) return;
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const container = contentRef.current;
    if (!container) return;
    const start = heldRange(held, container, base, faceTextOf);
    if (!start) return;
    ensureHighlightStyles();
    const painted = start.cloneRange();
    if (live && start.compareBoundaryPoints(Range.START_TO_START, live) < 0) {
      painted.setEnd(live.startContainer, live.startOffset);
    }
    const highlight = new Highlight(painted);
    highlight.priority = 0;
    CSS.highlights.set(HELD_HIGHLIGHT, highlight);
    return () => {
      CSS.highlights.delete(HELD_HIGHLIGHT);
    };
  }, [held, live, contentRef, layoutNonce, base, faceTextOf]);
}
