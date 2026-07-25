"use client";

import { useCallback, useEffect, useState } from "react";
import { blockElements, blockTopWithin } from "@/lib/reading/chat-anchors";
import type { ReaderChatSummary } from "@/lib/reading/chat-types";

/**
 * Layout for the right-hand chat gutter, where existing chats are marked.
 *
 * Every chat anchored to a block gets its own icon, stacked downward from that
 * block's top — several chats on one paragraph read as a short column rather
 * than a single counted badge, so each is its own target.
 *
 * The "start a chat here" affordance deliberately lives in the LEFT margin
 * instead (see paragraph-hover-target.tsx), so adding and opening never share
 * space.
 */

/** Icon height (24px) plus the gap between stacked icons. */
export const MARKER_PITCH = 28;

/**
 * The gutter sits just outside the text column on desktop and tucks against the
 * column edge on phones, where there is no margin to spare.
 */
export const GUTTER_X_CLASS = "-right-9 max-md:right-0";

export type GutterRow = {
  blockIndex: number;
  /** Offset of the anchoring block from the top of the content container. */
  top: number;
  chats: ReaderChatSummary[];
};

export function useGutterPlacement(
  chats: ReaderChatSummary[],
  contentRef: React.RefObject<HTMLDivElement | null>,
  layoutNonce: number
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
    setRows(
      [...byBlock.entries()]
        .map(([blockIndex, list]) => ({
          blockIndex,
          top: Math.round(blockTopWithin(els[blockIndex], container)),
          chats: list,
        }))
        .sort((a, b) => a.top - b.top)
    );
  }, [chats, contentRef]);

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
