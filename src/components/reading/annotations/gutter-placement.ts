"use client";

import { useCallback, useEffect, useState } from "react";
import { blockElements, blockTopWithin } from "@/lib/reading/annotation-anchors";
import {
  colContentRight,
  colIndexForX,
  pageForCol,
  type PageGeometry,
} from "@/lib/reading/paged-geometry";
import {
  annotationKind,
  type AnnotationSummary,
} from "@/lib/reading/annotation-types";

/**
 * Layout for the right-hand annotation gutter.
 *
 * A margin icon means "there is something here you can't see" — a note's text,
 * a conversation. Plain highlights are therefore left out on purpose: the
 * yellow IS the whole annotation, and an icon beside every one turns a clean
 * margin into a picket fence.
 *
 * Everything that does qualify gets its own icon, stacked downward from its
 * block's top — several on one paragraph read as a short column rather than a
 * single counted badge, so each stays its own target.
 *
 * The "start a chat here" affordance deliberately lives in the LEFT margin
 * instead (see paragraph-hover-target.tsx), so adding and opening never share
 * space.
 *
 * Paged mode has no such luxury: two columns use up the margins, and the left
 * column has no outer margin at all. So each marker follows its own column —
 * into the column gap for a left-hand column, into the outer margin for the
 * right-hand one — and only blocks visible on the current page get a marker,
 * since the rest aren't on screen to point at.
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
  /** Paged only: viewport x for the marker. Null while scrolling, where a class positions it. */
  left: number | null;
  annotations: AnnotationSummary[];
};

export type PagedGutterContext = {
  geom: PageGeometry;
  pageIndex: number;
  /** The fixed reading area the markers are positioned against. */
  viewport: HTMLDivElement | null;
};

export function useGutterPlacement(
  annotations: AnnotationSummary[],
  contentRef: React.RefObject<HTMLDivElement | null>,
  layoutNonce: number,
  paged: PagedGutterContext | null
): GutterRow[] {
  const [rows, setRows] = useState<GutterRow[]>([]);

  const place = useCallback(() => {
    const container = contentRef.current;
    if (!container || annotations.length === 0) {
      setRows([]);
      return;
    }
    const els = blockElements(container);
    // Grouped by block index rather than by pixel position: two annotations on
    // the same paragraph share an anchor even if a reflow moves them.
    const byBlock = new Map<number, AnnotationSummary[]>();
    for (const a of annotations) {
      if (annotationKind(a) === "highlight") continue;
      const index = a.anchor?.blockIndex ?? -1;
      if (!els[index]) continue;
      byBlock.set(index, [...(byBlock.get(index) ?? []), a]);
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
          annotations: list,
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
          annotations: list,
        }))
        .sort((a, b) => a.top - b.top)
    );
  }, [annotations, contentRef, paged]);

  // Next frame rather than synchronously, so we measure a laid-out DOM.
  //
  // Placement depends on the book HTML being in the container, and that arrives
  // from a signed storage URL long after the annotations arrive from the
  // database — so the first pass measures an empty container and finds nothing.
  // Observed symptom: no margin icons at all on load, while a single synthetic
  // resize event brought all seven back, which is what proved the measurement
  // was fine and only the scheduling wasn't.
  //
  // The caller folds useContentVersion into `layoutNonce` so this re-runs when
  // the content actually lands; the ResizeObserver additionally covers a
  // container that changes size without changing children, such as images
  // decoding late and pushing every block after them down.
  useEffect(() => {
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    const container = contentRef.current;
    const observer = new ResizeObserver(() => place());
    if (container) observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [place, contentRef, layoutNonce]);

  return rows;
}
