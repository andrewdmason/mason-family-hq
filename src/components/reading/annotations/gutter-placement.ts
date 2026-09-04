"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blockElements, blockTopWithin } from "@/lib/reading/annotation-anchors";
import {
  colContentRight,
  colIndexForX,
  colsOnPage,
  firstColOfPage,
  pageForCol,
  type PageGeometry,
  type Pages,
} from "@/lib/reading/paged-geometry";
import { marksGutter, type AnnotationSummary } from "@/lib/reading/annotation-types";

/**
 * Where the margin icons go: the marks that say "there is something here you
 * can't see" — a note's text, a conversation on a passage.
 *
 * Plain highlights are left out on purpose: the yellow IS the whole annotation,
 * and an icon beside every one turns a clean margin into a picket fence. The
 * exceptions are one somebody left you and one you starred — see marksGutter,
 * which is where that rule lives now so it can be checked without a DOM.
 *
 * Everything that does qualify gets its own icon, stacked downward from its
 * block's top — several on one paragraph read as a short column rather than a
 * single counted badge, so each stays its own target.
 *
 * Starting a conversation is no longer a margin affordance at all. It used to be
 * a target that appeared between two paragraphs on hover, which meant it did not
 * exist on a phone or an e-reader; it is now a control in the top margin that
 * anchors to the page, and what it leaves behind is set into the text rather
 * than beside it (see inline-chat-blocks.ts).
 *
 * Paged mode has less room: two columns use up the margins, and the left column
 * has no outer margin at all. So a marker follows its own column, going off the
 * right of it — into the column gap for a left-hand column, into the outer
 * margin for the right-hand one. Only what's on the current page is placed at
 * all; the rest isn't on screen to point at.
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
  /** Where the pages fall on the strip — see Pages. */
  pages: Pages;
  pageIndex: number;
  /** The fixed reading area the markers are positioned against. */
  viewport: HTMLDivElement | null;
};

export function useGutterPlacement(
  annotations: AnnotationSummary[],
  contentRef: React.RefObject<HTMLDivElement | null>,
  layoutNonce: number,
  paged: PagedGutterContext | null,
  /** Global index of the first rendered block — see RenderedBlocks. */
  base: number
): GutterRow[] {
  const [rows, setRows] = useState<GutterRow[]>([]);

  // Read through a ref rather than closed over, so that turning a page — which
  // changes pageIndex and nothing else — doesn't give `place` a new identity.
  // It used to, and the effect below then tore down and rebuilt the resize
  // listener and the ResizeObserver on every single page turn (and the
  // observer's initial callback fired a second placement each time).
  const pagedRef = useRef(paged);
  useEffect(() => {
    pagedRef.current = paged;
  });

  const place = useCallback(() => {
    const container = contentRef.current;
    if (!container || annotations.length === 0) {
      setRows([]);
      return;
    }
    const paged = pagedRef.current;
    const els = blockElements(container);
    // Markers only exist for blocks on the page; the rest are in another window.
    // Grouped by block index rather than by pixel position: two annotations on
    // the same paragraph share an anchor even if a reflow moves them.
    const byBlock = new Map<number, AnnotationSummary[]>();
    for (const a of annotations) {
      if (!marksGutter(a)) continue;
      const index = a.anchor?.blockIndex ?? -1;
      // Not on the page — another chapter's window. No marker, no measurement.
      if (!els[index - base]) continue;
      byBlock.set(index, [...(byBlock.get(index) ?? []), a]);
    }
    const viewport = paged?.viewport ?? null;
    if (paged && viewport) {
      const { geom, pages, pageIndex } = paged;
      const flowLeft = container.getBoundingClientRect().left;
      const view = viewport.getBoundingClientRect();
      const next: GutterRow[] = [];
      for (const [blockIndex, list] of byBlock) {
        // A block split across a column break has a rect per fragment; we want
        // the one that's actually on this page, if any.
        const el = els[blockIndex - base];
        if (!el) continue;
        const fragment = Array.from(el.getClientRects()).find(
          (rect) => pageForCol(colIndexForX(rect.left, flowLeft, geom), pages) === pageIndex
        );
        if (!fragment) continue;
        const col = colIndexForX(fragment.left, flowLeft, geom);
        const textRight = colContentRight(col, flowLeft, geom);
        // The last column of THIS page, which isn't every other column any more:
        // a page cut short by a chapter opening shows one column, and its outer
        // margin is the whole rest of the spread.
        const isOuterColumn =
          col - firstColOfPage(pageIndex, pages) === colsOnPage(pageIndex, pages) - 1;
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
          top: Math.round(blockTopWithin(els[blockIndex - base], container)),
          left: null,
          annotations: list,
        }))
        .sort((a, b) => a.top - b.top)
    );
  }, [annotations, base, contentRef]);

  usePlacementSchedule(place, contentRef, layoutNonce, paged);

  return rows;
}

/**
 * When a placement pass has to run again.
 *
 * Next frame rather than synchronously, so we measure a laid-out DOM.
 *
 * Placement depends on the book HTML being in the container, and that arrives
 * from a signed storage URL long after the annotations arrive from the
 * database — so the first pass measures an empty container and finds nothing.
 * Observed symptom: no margin icons at all on load, while a single synthetic
 * resize event brought all seven back, which is what proved the measurement
 * was fine and only the scheduling wasn't.
 *
 * The caller folds useContentVersion into `layoutNonce` so this re-runs when
 * the content actually lands; the ResizeObserver additionally covers a
 * container that changes size without changing children, such as images
 * decoding late and pushing every block after them down.
 */
function usePlacementSchedule(
  place: () => void,
  contentRef: React.RefObject<HTMLDivElement | null>,
  layoutNonce: number,
  paged: PagedGutterContext | null
) {
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

  // Turning a page moves everything but changes nothing the effect above
  // subscribes to, so it re-places on its own rather than re-arming the
  // observers. Geometry is in here for the same reason: opening the chat panel
  // on a wide window slides the page sideways without re-fragmenting the book,
  // so nothing else would notice it moved.
  const pageIndex = paged?.pageIndex ?? null;
  const viewport = paged?.viewport ?? null;
  const geom = paged?.geom ?? null;
  const pages = paged?.pages ?? null;
  useEffect(() => {
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [pageIndex, viewport, geom, pages, place]);
}
