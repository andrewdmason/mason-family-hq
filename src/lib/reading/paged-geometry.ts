/**
 * The arithmetic of a paged book: how wide a column is, where each column sits,
 * and which page a given x-coordinate falls on.
 *
 * Pagination is done with CSS multi-column on the whole book at a fixed height,
 * so the browser fragments the text into columns that run off to the right. A
 * "page" is one screenful of columns, and turning a page is a horizontal
 * translate — no relayout, no scrolling.
 *
 * Everything here is quantised to whole pixels on purpose. A 600-page book is
 * 600+ column strides wide; a third of a pixel of error per stride is 200px of
 * drift by the end, which is the difference between the right page and the
 * wrong one.
 *
 * Pure maths, no DOM — paged-position.ts does the measuring.
 */

import {
  COLUMN_GAP,
  MARGIN_INSET_PX,
  MARGIN_MEASURE_PX,
  effectiveColumns,
  type ReaderSettings,
} from "@/lib/reading/reader-settings";

/** Bands reserved for the header and footer, which text never enters. */
export const PAGE_PAD_TOP = 56;
export const PAGE_PAD_BOTTOM = 52;

/** Must match the chat panel's own width (chat-panel.tsx, w-[26rem]) plus gutter clearance. */
export const CHAT_PANEL_WIDTH = 448;

/** Smallest column we'll render before giving up on the requested layout. */
const MIN_COLUMN_WIDTH = 240;

export type PageGeometry = {
  cols: 1 | 2;
  /** Width of one text column. */
  colW: number;
  gap: number;
  /** Width of the flow element: exactly `cols` columns and the gaps between them. */
  contentW: number;
  /** Distance from one column's left edge to the next. */
  colStride: number;
  /** Distance from one page's left edge to the next. */
  pageStride: number;
  /** Height of the text area. */
  pageH: number;
  /** Left offset of the flow element within the clip box. */
  offsetX: number;
};

export function computeGeometry(
  clipW: number,
  clipH: number,
  settings: ReaderSettings,
  chatPanelOpen: boolean
): PageGeometry {
  // The chat panel takes the right-hand side of the screen, so the book gets
  // what's left — which is rarely enough for two columns.
  const panel = chatPanelOpen ? CHAT_PANEL_WIDTH : 0;
  const usable = Math.max(MIN_COLUMN_WIDTH, clipW - panel);
  const cols = chatPanelOpen ? 1 : effectiveColumns(settings, clipW);

  const gap = cols === 2 ? COLUMN_GAP : 0;
  const avail = Math.max(MIN_COLUMN_WIDTH, usable - MARGIN_INSET_PX[settings.margins] * 2);

  // Whichever binds first: the measure the reader asked for, or what the window
  // can actually give. On a desktop the measure wins and the setting visibly
  // changes the text width; on a phone there's no room to choose, so the inset
  // wins and the setting changes the gap to the screen edge instead.
  const colW = Math.max(
    MIN_COLUMN_WIDTH,
    Math.min(
      MARGIN_MEASURE_PX[settings.margins],
      Math.floor((avail - gap * (cols - 1)) / cols)
    )
  );
  // Re-derived from the floored column width, so contentW is always an exact
  // whole number of strides and the translate lands on a column boundary.
  const contentW = colW * cols + gap * (cols - 1);
  const colStride = colW + gap;

  return {
    cols,
    colW,
    gap,
    contentW,
    colStride,
    pageStride: cols * colStride,
    pageH: Math.max(120, clipH - PAGE_PAD_TOP - PAGE_PAD_BOTTOM),
    // Centred in what's left of the screen once the panel has taken its share.
    offsetX: Math.max(0, Math.round((usable - contentW) / 2)),
  };
}

/**
 * Which column a viewport x-coordinate sits in, given the flow's own left edge.
 *
 * The 2px of slack matters: line boxes land exactly on column lefts in layout
 * units, and a rect reported at x = colStride - 0.004 would otherwise round to
 * the previous column and put the reader a page behind.
 */
export function colIndexForX(x: number, flowLeft: number, g: PageGeometry): number {
  return Math.max(0, Math.floor((x - flowLeft + 2) / g.colStride));
}

export function pageForCol(col: number, g: PageGeometry): number {
  return Math.floor(col / g.cols);
}

export function firstColOfPage(page: number, g: PageGeometry): number {
  return page * g.cols;
}

/** Viewport x of the right-hand text edge of a column. */
export function colContentRight(col: number, flowLeft: number, g: PageGeometry): number {
  return flowLeft + col * g.colStride + g.colW;
}

/** True when two geometries would produce identical layout (so we can skip repaginating). */
export function sameGeometry(a: PageGeometry | null, b: PageGeometry | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.cols === b.cols &&
    a.colW === b.colW &&
    a.gap === b.gap &&
    a.pageH === b.pageH &&
    a.offsetX === b.offsetX
  );
}
