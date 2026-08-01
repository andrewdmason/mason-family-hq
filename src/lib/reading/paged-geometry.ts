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
  MARGIN_MEASURE_PX,
  effectiveColumns,
  marginInsetFor,
  type ReaderSettings,
} from "@/lib/reading/reader-settings";

/** Bands reserved for the header and footer, which text never enters. */
export const PAGE_PAD_TOP = 56;
export const PAGE_PAD_BOTTOM = 52;

/** Must match the chat panel's own width (chat-panel.tsx, w-[26rem]) plus gutter clearance. */
export const CHAT_PANEL_WIDTH = 448;

/** Smallest column we'll render before giving up on the requested layout. */
const MIN_COLUMN_WIDTH = 240;

/**
 * The floor, for a screen this wide.
 *
 * A flat 240px is right on anything phone-sized: it stops a narrowed area from
 * turning the book into a ribbon. On a 6" e-reader it does the opposite — 240px
 * of a 300px screen is 80% of the display, so the floor, not the reader, is
 * choosing the margins, and all three settings land on the same column. Below
 * that the floor has to give way proportionally or the Margins control is inert.
 *
 * 0.62 leaves the widest setting a visible margin without dropping the measure
 * somewhere unreadable. Unchanged at 388px and up, so no screen in the verify
 * suite moves.
 */
function minColumnWidth(availableWidth: number): number {
  return Math.min(MIN_COLUMN_WIDTH, Math.round(availableWidth * 0.62));
}

/**
 * The two halves of this type are the whole design.
 *
 * The browser's column breaking sees only the first three numbers: a column box
 * is `colW` by `pageH`, and the boxes are `gap` apart. Everything else describes
 * how the finished strip is *looked at* — how many of those columns a page shows
 * and where the window onto them sits. Changing anything in the second group is
 * a repaint; changing anything in the first re-fragments the whole book, which is
 * the most expensive thing this reader does.
 *
 * Crucially `cols` is in the second group. The flow element is always exactly one
 * column wide, so showing one column or two is a property of the clip box, not of
 * the text. That's what lets the chat panel open on an iPad without re-laying-out
 * a million characters — verified identical fragmentation in both Chromium and
 * WebKit, to zero sub-pixels, at full book length.
 */
export type PageGeometry = {
  // — Fragmentation. Changing any of these re-lays-out the entire book.
  /** Width of one text column, and of the flow element itself. */
  colW: number;
  gap: number;
  /** Height of the text area. */
  pageH: number;

  // — Viewing. Changing any of these is a repaint.
  /** How many columns a page shows at once. */
  cols: 1 | 2;
  /** Width of the clip box: exactly `cols` columns and the gaps between them. */
  viewW: number;
  /** Distance from one column's left edge to the next. */
  colStride: number;
  /** Distance from one page's left edge to the next. */
  pageStride: number;
  /** Left offset of the clip box within the window. */
  offsetX: number;
};

/**
 * How the chat is being presented, which is the only thing about it the geometry
 * needs to know.
 *
 * The three cases differ in what they're allowed to cost, and two of them cost
 * nothing. Closed and FLOATING are the same geometry: a floating panel sits over
 * the page and the page is not told, so no column is lost, nothing slides, and
 * closing it puts nothing back. Docked has width of its own, so the book is laid
 * out in what's left and may lose a column — which is why it's a button and not
 * a default. A sheet is "closed" here too; it deliberately takes nothing.
 */
export type ChatPanelPresentation = "closed" | "floating" | "docked";

/**
 * The width the book itself has to work with: the window, less whatever a side
 * panel has taken. A panel presented over the book — a sheet — takes nothing.
 */
export function bookAreaWidth(clipW: number, sidePanelOpen: boolean): number {
  return Math.max(MIN_COLUMN_WIDTH, clipW - (sidePanelOpen ? CHAT_PANEL_WIDTH : 0));
}

/**
 * How wide a column is — the only width decision the browser's column breaking
 * ever sees, and so the only one that can cost a re-fragmentation.
 *
 * Asked of the FULL window, always. The chat panel is not allowed to reach this
 * function: what it can do is change how many of these columns a page shows, and
 * where they sit, neither of which the text notices.
 */
function fragmentationFor(clipW: number, settings: ReaderSettings) {
  // Whether the reader would get two columns on this window at all. It decides
  // how wide a column is, because two columns have to share the width — not how
  // many are shown, which is computeGeometry's business.
  const intent = effectiveColumns(settings, clipW);
  const floor = minColumnWidth(clipW);
  const avail = Math.max(floor, clipW - marginInsetFor(clipW, settings.margins, settings.eink) * 2);

  // Whichever binds first: the measure the reader asked for, or what the window
  // can actually give. On a desktop the measure wins and the setting visibly
  // changes the text width; on a phone there's no room to choose, so the inset
  // wins and the setting changes the gap to the screen edge instead.
  const colW = Math.max(
    floor,
    Math.min(
      MARGIN_MEASURE_PX[settings.margins],
      Math.floor((avail - COLUMN_GAP * (intent - 1)) / intent)
    )
  );
  // The gap is constant, including when only one column is shown. That's what
  // makes the one-column and two-column strips the same strip: an unchanging gap
  // between column boxes means an unchanging stride, and the extra 56px simply
  // falls outside the clip when a page shows a single column.
  return { colW, gap: COLUMN_GAP, colStride: colW + COLUMN_GAP };
}

/**
 * Below this a side panel is out of the question whatever the arithmetic says: a
 * phone has no business splitting its screen in two. Matches the media query the
 * annotation layer uses to pick a sheet.
 */
const SIDE_PANEL_MIN_WIDTH = 768;

/**
 * Whether the book can sit beside a side panel at all, or whether the chat has
 * to be presented over the top of it instead.
 *
 * False means there is not even one column's width left over — a phone, or an
 * iPad held upright. Above it the panel costs nothing but a repaint.
 *
 * The phone floor is not redundant with the width test. With wide margins a
 * phone's column is already down at the 240px minimum, which technically does
 * fit beside a panel — so without it, a phone showing the chat as a sheet would
 * still have had its book re-fragmented to a 240px ribbon underneath.
 */
export function sidePanelFits(clipW: number, settings: ReaderSettings): boolean {
  if (clipW < SIDE_PANEL_MIN_WIDTH) return false;
  return bookAreaWidth(clipW, true) >= fragmentationFor(clipW, settings).colW;
}

export function computeGeometry(
  clipW: number,
  clipH: number,
  settings: ReaderSettings,
  panel: ChatPanelPresentation
): PageGeometry {
  const frag = fragmentationFor(clipW, settings);
  // Only a DOCKED panel is allowed to change anything here. A floating one is
  // geometrically identical to no panel at all — not "cheap", not "a repaint
  // only", but the same numbers — and that is the entire point of it. Sliding the
  // page sideways to make room, which an earlier version did, is exactly the
  // disorienting re-layout the float exists to avoid: the reader's eye is in the
  // middle of a sentence and the sentence moves. A floating panel covers some of
  // the outer column and the book underneath it does not move at all.
  const usable = bookAreaWidth(clipW, panel === "docked");

  // Two columns are shown when two of this column plus the gap actually fit in
  // what's left of the screen. The insets are part of the question so the text
  // doesn't end up jammed against the edges of a narrowed area.
  //
  // This is the line a docked chat panel moves, and moving it is free: the flow
  // element is untouched, so the browser's layout never goes dirty. Docking on an
  // iPad drops the page from two columns to one and slides it — it does not
  // re-fragment the book, which is what it used to do, on every open and every
  // close, and which is what made reading with the chat open feel bad.
  //
  // Keyed to the full window, like fragmentationFor: the panel is allowed to
  // change how many columns a page shows, never how wide the margins are.
  const availView = usable - marginInsetFor(clipW, settings.margins, settings.eink) * 2;
  const cols: 1 | 2 =
    effectiveColumns(settings, clipW) === 2 && frag.colW * 2 + frag.gap <= availView ? 2 : 1;
  const viewW = cols * frag.colW + (cols - 1) * frag.gap;

  return {
    ...frag,
    pageH: Math.max(120, clipH - PAGE_PAD_TOP - PAGE_PAD_BOTTOM),
    cols,
    viewW,
    pageStride: cols * frag.colStride,
    // Centred in what's left of the screen once a docked panel has taken its
    // share. A floating panel took nothing, so this is where the page already was.
    offsetX: Math.max(0, Math.round((usable - viewW) / 2)),
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
  return sameFragmentation(a, b) && a.cols === b.cols && a.offsetX === b.offsetX;
}

/**
 * True when two geometries would fragment the text identically.
 *
 * A column box is `colW` by `pageH`, and boxes are `gap` apart; nothing else
 * decides where the browser breaks the text. `cols` is deliberately NOT here —
 * it only says how many of those boxes a page shows at once, and it used to be
 * in this comparison purely because it set the flow element's width. See the
 * note on PageGeometry.
 */
export function sameFragmentation(a: PageGeometry, b: PageGeometry): boolean {
  return a.colW === b.colW && a.gap === b.gap && a.pageH === b.pageH;
}
