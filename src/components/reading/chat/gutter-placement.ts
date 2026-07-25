"use client";

import { useCallback, useEffect, useState } from "react";
import { blockElements, blockTopWithin } from "@/lib/reading/chat-anchors";
import {
  colContentRight,
  colIndexForX,
  pageForCol,
  type PageGeometry,
} from "@/lib/reading/paged-geometry";
import type { ReaderChatSummary } from "@/lib/reading/chat-types";

/**
 * Layout for the chat gutter, where existing chats are marked.
 *
 * Every chat anchored to a block gets its own icon, stacked downward from that
 * block's top — several chats on one paragraph read as a short column rather
 * than a single counted badge, so each is its own target.
 *
 * Scrolling puts the gutter in the right margin, opposite the "start a chat
 * here" affordance on the left (paragraph-hover-target.tsx), so adding and
 * opening never share space.
 *
 * Paged mode has no such luxury: two columns use up the margins, and the left
 * column has no outer margin at all. So each marker follows its own column —
 * into the column gap for a left-hand column, into the outer margin for the
 * right-hand one — and only blocks visible on the current page get a marker at
 * all, since the rest aren't on screen to point at.
 */

/** Icon height (24px) plus the gap between stacked icons. */
export const MARKER_PITCH = 28;

/** Half the icon's width, for centring it on a position. */
const MARKER_HALF = 12;

/**
 * Scrolling: the gutter sits just outside the text column on desktop and tucks
 * against the column edge on phones, where there is no margin to spare.
 */
export const GUTTER_X_CLASS = "-right-9 max-md:right-0";

export type GutterRow = {
  blockIndex: number;
  /** Distance from the top of the positioning container. */
  top: number;
  /** Paged only: viewport x for the marker. Null in scroll mode, where a class positions it. */
  left: number | null;
  chats: ReaderChatSummary[];
};

export type PagedGutterContext = {
  geom: PageGeometry;
  pageIndex: number;
  /** The fixed reading area the markers are positioned against. */
  viewport: HTMLDivElement | null;
};

export function useGutterPlacement(
  chats: ReaderChatSummary[],
  contentRef: React.RefObject<HTMLDivElement | null>,
  layoutNonce: number,
  paged: PagedGutterContext | null
): GutterRow[] {
  const [rows, setRows] = useState<GutterRow[]>([]);

  const place = useCallback(() => {
    const container = contentRef.current;
    if (!container || chats.length === 0) {
      setRows([]);
      return;
    }
    const els = blockElements(container);
    // Grouped by block index rather than by pixel position: two chats on the
    // same paragraph are the same anchor even if a reflow moves them.
    const byBlock = new Map<number, ReaderChatSummary[]>();
    for (const chat of chats) {
      const index = chat.anchor?.blockIndex ?? -1;
      if (!els[index]) continue;
      byBlock.set(index, [...(byBlock.get(index) ?? []), chat]);
    }

    const viewport = paged?.viewport ?? null;
    if (paged && viewport) {
      const { geom, pageIndex } = paged;
      const flowLeft = container.getBoundingClientRect().left;
      const view = viewport.getBoundingClientRect();
      const next: GutterRow[] = [];
      for (const [blockIndex, list] of byBlock) {
        // A block split across a column break has a rect per fragment; we want
        // the one that's actually on this page, if any.
        const fragment = Array.from(els[blockIndex].getClientRects()).find(
          (rect) => pageForCol(colIndexForX(rect.left, flowLeft, geom), geom) === pageIndex
        );
        if (!fragment) continue;
        const col = colIndexForX(fragment.left, flowLeft, geom);
        const textRight = colContentRight(col, flowLeft, geom);
        const isOuterColumn = col % geom.cols === geom.cols - 1;
        next.push({
          blockIndex,
          top: Math.round(fragment.top - view.top),
          left: Math.round(
            (isOuterColumn ? textRight + MARKER_HALF : textRight + geom.gap / 2 - MARKER_HALF) -
              view.left
          ),
          chats: list,
        });
      }
      setRows(next.sort((a, b) => a.top - b.top));
      return;
    }

    setRows(
      [...byBlock.entries()]
        .map(([blockIndex, list]) => ({
          blockIndex,
          top: Math.round(blockTopWithin(els[blockIndex], container)),
          left: null,
          chats: list,
        }))
        .sort((a, b) => a.top - b.top)
    );
  }, [chats, contentRef, paged]);

  // Next frame rather than synchronously, so we measure a laid-out DOM.
  useEffect(() => {
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    };
  }, [place, layoutNonce]);

  return rows;
}
