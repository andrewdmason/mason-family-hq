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

/**
 * The width the book itself has to work with: the window, less whatever the chat
 * panel has taken.
 *
 * Every layout question is asked of this rather than of the window, so opening a
 * chat narrows the page instead of redefining it.
 */
export function bookAreaWidth(clipW: number, chatPanelOpen: boolean): number {
  return Math.max(MIN_COLUMN_WIDTH, clipW - (chatPanelOpen ? CHAT_PANEL_WIDTH : 0));
}

/** The column shape a given width produces — everything fragmentation depends on. */
function columnsFor(width: number, settings: ReaderSettings) {
  const cols = effectiveColumns(settings, width);
  const gap = cols === 2 ? COLUMN_GAP : 0;
  const avail = Math.max(MIN_COLUMN_WIDTH, width - MARGIN_INSET_PX[settings.margins] * 2);

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
  return { cols, gap, colW, contentW, colStride: colW + gap };
}

export function computeGeometry(
  clipW: number,
  clipH: number,
  settings: ReaderSettings,
  chatPanelOpen: boolean
): PageGeometry {
  const usable = bookAreaWidth(clipW, chatPanelOpen);

  // The columns are measured against the FULL window, not the narrowed one, and
  // the panel is only allowed to change where the text sits — not how wide it
  // is. That distinction is the whole point: re-fragmenting a 1.1M-character
  // book costs hundreds of milliseconds, and it was being paid twice for every
  // chat — once opening, once closing — which is the single most frequent thing
  // that made the reader feel slow.
  //
  // Wherever the panel can take its width out of the margin, the text keeps its
  // exact column shape and merely shifts left, so `sameFragmentation` holds and
  // nothing repaginates. Only when the panel would genuinely collide with the
  // text (a narrow window) do we fall back to narrowing it and paying the
  // relayout, because there the alternative is text hidden underneath a panel.
  const full = columnsFor(clipW, settings);
  const shape = full.contentW <= usable ? full : columnsFor(usable, settings);

  return {
    ...shape,
    pageStride: shape.cols * shape.colStride,
    pageH: Math.max(120, clipH - PAGE_PAD_TOP - PAGE_PAD_BOTTOM),
    // Centred in what's left of the screen once the panel has taken its share.
    offsetX: Math.max(0, Math.round((usable - shape.contentW) / 2)),
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

/** True when two geometries are identical (so we can skip the state update entirely). */
export function sameGeometry(a: PageGeometry | null, b: PageGeometry | null): boolean {
  if (!a || !b) return a === b;
  return sameFragmentation(a, b) && a.offsetX === b.offsetX;
}

/**
 * True when two geometries would fragment the text identically.
 *
 * Only the column shape and the page height decide where the browser breaks
 * columns; `offsetX` just says where the resulting flow is painted. Separating
 * the two is what lets the chat panel slide the book sideways without paying to
 * re-fragment it — see computeGeometry.
 */
export function sameFragmentation(a: PageGeometry, b: PageGeometry): boolean {
  return a.cols === b.cols && a.colW === b.colW && a.gap === b.gap && a.pageH === b.pageH;
}
