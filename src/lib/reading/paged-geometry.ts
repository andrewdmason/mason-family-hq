/**
 * The arithmetic of a paged book: how wide a column is, where each column sits,
 * and which page a given x-coordinate falls on.
 *
 * Pagination is done with CSS multi-column on the whole book at a fixed height,
 * so the browser fragments the text into columns that run off to the right. A
 * "page" is one screenful of columns, and turning a page is a horizontal
 * translate — no relayout, no scrolling.
 *
 * Which columns a page shows is the one thing here that isn't fixed: a chapter
 * has to open a page rather than turn up beside the end of the last one, so a page
 * gives up its outer column when the next chapter's is sitting in it. That makes
 * the column-to-page mapping a measured list rather than a division — see Pages,
 * which is where every function that used to divide by `cols` now lives.
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
  /** How many columns a FULL page shows at once — see Pages for the exceptions. */
  cols: 1 | 2;
  /** Width of the clip box at its widest: `cols` columns and the gaps between them. */
  viewW: number;
  /** Distance from one column's left edge to the next. */
  colStride: number;
  /** Left offset of the clip box within the window. */
  offsetX: number;
};

/**
 * Where the pages fall on the strip.
 *
 * Deliberately a measured list rather than the arithmetic it replaced, because a
 * chapter is not allowed to open in the middle of a spread. A page that would
 * have shown the end of one chapter on the left and the start of the next on the
 * right is cut short instead: the reader sees the closing column with white space
 * beside it, and the chapter begins the next page — which is what a printed book
 * does, and what the page turn is for.
 *
 * The consequence worth knowing about is that the pairing PARITY flips at every
 * such chapter. That is exactly why this can't be `col / cols`: after one
 * odd-column chapter opening, every spread for the rest of the window is the
 * other pairing, and arithmetic anchored at column zero would show the reader a
 * heading halfway down their page for the rest of the book.
 *
 * On a single-column page nothing is ever cut short, so `starts` is 0, 1, 2, …
 * and every function below reduces to the arithmetic it replaced.
 *
 * None of this reaches the text: it describes where the window onto the strip
 * sits and how wide it is, both of which are repaints. The book's fragmentation
 * stays independent of how many columns a page shows — see the note on
 * PageGeometry, which is the invariant the reader's performance rests on.
 */
export type Pages = {
  /** First column of each page, ascending. `starts[0]` is always 0. */
  starts: number[];
  /** Columns in the whole strip. */
  columns: number;
  /** Columns a page shows when nothing cuts it short — `cols` when it was built. */
  perPage: 1 | 2;
  /**
   * Columns a chapter opens in. Kept rather than discarded so the rule can be
   * checked against the result instead of assumed — see assertPagesMoveForward.
   */
  opens: number[];
};

/** How many whole columns a strip of this width holds. */
export function columnsInWidth(scrollWidth: number, g: PageGeometry): number {
  // scrollWidth omits the trailing gap after the final column, so add it back
  // before dividing by the stride.
  return Math.max(1, Math.round((scrollWidth + g.gap) / g.colStride));
}

/**
 * Cut the strip into pages, breaking early wherever a chapter opens.
 *
 * `opens` is the columns chapters begin in, in any order; a chapter that already
 * begins a page costs nothing, which is every chapter in a one-column layout.
 */
export function buildPages(columns: number, opens: Iterable<number>, g: PageGeometry): Pages {
  const total = Math.max(1, columns);
  const stops = new Set<number>();
  const kept: number[] = [];
  for (const col of opens) {
    if (col <= 0 || col >= total || stops.has(col)) continue;
    stops.add(col);
    kept.push(col);
  }

  const starts: number[] = [];
  let col = 0;
  while (col < total) {
    starts.push(col);
    let next = col + g.cols;
    // The first chapter opening strictly inside this page ends it early.
    for (let c = col + 1; c < next; c++) {
      if (stops.has(c)) {
        next = c;
        break;
      }
    }
    col = next;
  }
  return { starts, columns: total, perPage: g.cols, opens: kept.sort((a, b) => a - b) };
}

/**
 * What a strip looks like before it has been measured: one page, showing as much
 * of itself as the page has room for.
 *
 * Deliberately generous rather than minimal. Every function below is capped by
 * the geometry, so a page can't come out wider than the window allows — but one
 * that came out NARROWER would clip half the text away and look like a layout
 * with nothing in it, which is a worse thing to be wrong about for the frame
 * before the measurement lands.
 */
export const UNMEASURED_PAGES: Pages = { starts: [0], columns: 2, perPage: 2, opens: [] };

export function pageCount(pages: Pages): number {
  return pages.starts.length;
}

export function firstColOfPage(page: number, pages: Pages): number {
  if (page <= 0) return 0;
  return pages.starts[Math.min(page, pages.starts.length - 1)] ?? 0;
}

/** How many columns this page actually shows — `perPage`, unless a chapter cut it short. */
export function colsOnPage(page: number, pages: Pages): number {
  const start = firstColOfPage(page, pages);
  const end = pages.starts[page + 1] ?? pages.columns;
  return Math.max(1, Math.min(pages.perPage, end - start));
}

/** The page a column is shown on: the last page starting at or before it. */
export function pageForCol(col: number, pages: Pages): number {
  const { starts } = pages;
  let lo = 0;
  let hi = starts.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= col) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** How far the strip is translated to show a page. */
export function pageOffset(page: number, pages: Pages, g: PageGeometry): number {
  return firstColOfPage(page, pages) * g.colStride;
}

/**
 * Width of the clip box for a page — narrower than `viewW` on a short page, and
 * never wider than the window allows however out of date the map is.
 */
export function pageWidth(page: number, pages: Pages, g: PageGeometry): number {
  return Math.min(colsOnPage(page, pages), g.cols) * g.colStride - g.gap;
}

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
