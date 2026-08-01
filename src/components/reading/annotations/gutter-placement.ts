"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blockElements, blockTopWithin } from "@/lib/reading/annotation-anchors";
import {
  colContentRight,
  colIndexForX,
  pageForCol,
  PAGE_PAD_TOP,
  type PageGeometry,
} from "@/lib/reading/paged-geometry";
import {
  annotationKind,
  type AnnotationSummary,
} from "@/lib/reading/annotation-types";
import { startTimer } from "@/lib/reading/perf";

/**
 * Where the margin furniture goes: the icons that reopen a chat, and the gap
 * targets that start one.
 *
 * Both are the same measurement problem — a block index turned into a place on
 * the page — so both live here and share the scheduling that makes measuring
 * reliable (see usePlacementSchedule).
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
 * The "start a chat here" affordance deliberately lives on the other side (see
 * paragraph-hover-target.tsx), so adding and opening never share space.
 *
 * Paged mode has less room: two columns use up the margins, and the left column
 * has no outer margin at all. So everything follows its own column. A marker
 * goes off the right of its column — into the column gap for a left-hand column,
 * into the outer margin for the right-hand one — and a gap target goes off the
 * left of its column, which keeps the rule intact per column instead of per
 * page. Only what's on the current page is placed at all; the rest isn't on
 * screen to point at.
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
      if (annotationKind(a) === "highlight") continue;
      const index = a.anchor?.blockIndex ?? -1;
      // Not on the page — another chapter's window. No marker, no measurement.
      if (!els[index - base]) continue;
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
        const el = els[blockIndex - base];
        if (!el) continue;
        const fragment = Array.from(el.getClientRects()).find(
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
 * A place between two paragraphs where a chat can be started.
 *
 * Measured here rather than in the hover target itself so the two sides of the
 * margin agree about where a block is, and so the hover target inherits the
 * scheduling below — which it did not have, and which is why its gaps went stale
 * whenever an article's images decoded and pushed every block down.
 */
export type GapTarget = {
  /** Global index of the block BELOW the gap — see RenderedBlocks. */
  blockIndex: number;
  /** Distance from the top of the positioning container. */
  top: number;
  /**
   * Paged only: the hovered column, in viewport x. Null while scrolling, where
   * the strip simply spans the one text column and a class positions the button.
   */
  column: { left: number; width: number } | null;
};

/**
 * How far below the top of a column a block has to start before the space above
 * it counts as a paragraph gap rather than a column break.
 */
const COLUMN_TOP_SLACK = 2;

/**
 * Every gap on the current page, measured.
 *
 * Free of React so it can be run against real Chromium and real WebKit — see
 * scripts/verify-gap-targets.mts. The rules it encodes (a paragraph's own start
 * only, nothing at a column top, indices made global) are the kind that fail
 * silently and store a wrong anchor forever, so they're checked rather than
 * reasoned about.
 */
export function measureGapTargets(
  container: HTMLElement,
  paged: PagedGutterContext | null,
  /** Global index of the first rendered block — see RenderedBlocks. */
  base: number
): GapTarget[] {
  // Gap targets are offered only between TOP-LEVEL blocks, but the index we hand
  // back must still address the full block list the anchor scheme uses. On a
  // book every block is a direct child, so this changes nothing; on an article
  // it stops us offering a "start a chat here" gap above every <li> and every
  // table cell, which would carpet the margin.
  const blocks = blockElements(container)
    .map((el, i) => ({ el, blockIndex: base + i }))
    // The gap above the very first block of the book isn't a place to write.
    .filter(({ el, blockIndex }) => el.parentElement === container && blockIndex > 0);

  const viewport = paged?.viewport ?? null;
  if (!paged || !viewport) {
    return blocks.map(({ el, blockIndex }) => ({
      blockIndex,
      top: blockTopWithin(el, container),
      column: null,
    }));
  }

  const { geom, pageIndex } = paged;
  const flowLeft = container.getBoundingClientRect().left;
  const view = viewport.getBoundingClientRect();
  const targets: GapTarget[] = [];
  for (const { el, blockIndex } of blocks) {
    // Only the fragment the block STARTS in. A paragraph continued from the
    // previous column also has a fragment at the top of this one, but that edge
    // is a column break, not a paragraph boundary — taking the first rect drops
    // it, and with it every false gap at the top of a column. (The markers
    // deliberately do the opposite: any fragment on this page.)
    const first = el.getClientRects()[0];
    if (!first) continue;
    const col = colIndexForX(first.left, flowLeft, geom);
    if (pageForCol(col, geom) !== pageIndex) continue;
    const top = first.top - view.top;
    // A block flush to the top of its column is a real boundary with no visible
    // gap to hover, and a hairline up there reads as a rule under the running
    // head rather than as a place in the text.
    if (top <= PAGE_PAD_TOP + COLUMN_TOP_SLACK) continue;
    targets.push({
      blockIndex,
      top: Math.round(top),
      column: {
        left: Math.round(flowLeft + col * geom.colStride - view.left),
        width: geom.colW,
      },
    });
  }
  return targets;
}

export function useGapTargets(
  contentRef: React.RefObject<HTMLDivElement | null>,
  layoutNonce: number,
  paged: PagedGutterContext | null,
  /** Global index of the first rendered block — see RenderedBlocks. */
  base: number
): GapTarget[] {
  const [targets, setTargets] = useState<GapTarget[]>([]);

  const pagedRef = useRef(paged);
  useEffect(() => {
    pagedRef.current = paged;
  });

  const place = useCallback(() => {
    const container = contentRef.current;
    if (!container) {
      setTargets([]);
      return;
    }
    // Every block in the window, on every page turn — the one measurement in
    // this file that isn't proportional to the number of annotations. All reads,
    // so layout flushes once; instrumented because that's the rule for anything
    // in the reader's hot paths (see perf.ts).
    const stop = startTimer("gap targets");
    const next = measureGapTargets(container, pagedRef.current, base);
    stop(`${next.length} on page`);
    setTargets(next);
  }, [base, contentRef]);

  usePlacementSchedule(place, contentRef, layoutNonce, paged);

  return targets;
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
  useEffect(() => {
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [pageIndex, viewport, geom, place]);
}
