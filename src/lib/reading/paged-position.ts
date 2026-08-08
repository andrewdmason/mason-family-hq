/**
 * Translating between a character offset in the book and the page it landed on.
 *
 * This is the hinge the whole paged reader turns on. Position is stored as a
 * character offset (block-stream.ts) because that's the only address that
 * survives a font-size change, a column-count change, a resize, or moving from a
 * phone to a laptop. But to show a page we need a page index, and to save a
 * position we need the character at the top of the page — so we ask the browser
 * where things actually landed, rather than trying to predict fragmentation.
 *
 * Both directions are measurement, not arithmetic: `getClientRects()` on a
 * fragmented element returns one rect per column it spans, which is exactly the
 * question we're asking.
 */

import type { BookBlock } from "@/lib/reading/block-stream";
import { textPositionAt } from "@/lib/reading/annotation-anchors";
import {
  buildPages,
  colIndexForX,
  columnsInWidth,
  firstColOfPage,
  pageCount,
  pageForCol,
  type PageGeometry,
  type Pages,
} from "@/lib/reading/paged-geometry";

/**
 * Everything a position lookup measures against.
 *
 * `blocks` is the RENDERED blocks — the window's slice of the book's stream, not
 * the whole stream — so that it stays index-parallel with `blockEls`. The slice
 * elements keep their global `charStart`, which is what lets every function here
 * take and return global character offsets while measuring only what's on the
 * page. That one property is why windowing barely touches this module.
 */
export type MeasureCtx = {
  flow: HTMLElement;
  blocks: BookBlock[];
  blockEls: HTMLElement[];
  geom: PageGeometry;
  /** Where the pages fall on this strip — measured, not arithmetic. See Pages. */
  pages: Pages;
};

function flowLeft(ctx: MeasureCtx): number {
  return ctx.flow.getBoundingClientRect().left;
}

/**
 * The column a single character renders in.
 *
 * Deliberately a one-character range rather than a collapsed caret: a caret
 * positioned exactly on a column break is ambiguous, and browsers resolve it to
 * the END of the previous column — which reads as "still on the last page" for
 * the first character of every page.
 */
function colOfCharInBlock(
  el: HTMLElement,
  offsetInBlock: number,
  left: number,
  geom: PageGeometry
): number | null {
  const pos = textPositionAt(el, offsetInBlock);
  if (!pos) return null;
  const range = el.ownerDocument.createRange();
  try {
    range.setStart(pos.node, pos.offset);
    range.setEnd(pos.node, Math.min(pos.offset + 1, pos.node.data.length));
  } catch {
    return null;
  }
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return colIndexForX(rect.left, left, geom);
}

/** Column a block starts in. */
function startColOf(el: HTMLElement, left: number, geom: PageGeometry): number {
  const rects = el.getClientRects();
  const first = rects[0] ?? el.getBoundingClientRect();
  return colIndexForX(first.left, left, geom);
}

/** Column a block ends in — different from the start when it spans a break. */
function endColOf(el: HTMLElement, left: number, geom: PageGeometry): number {
  const rects = el.getClientRects();
  const last = rects[rects.length - 1] ?? el.getBoundingClientRect();
  return colIndexForX(last.left, left, geom);
}

/**
 * The class the chapter break rule is written against (reader-prose.ts): a
 * heading with it starts a fresh column, at both levels, on every book. Asked of
 * the class rather than the tag on purpose — the class is what the CSS breaks on,
 * so measuring anything else would put a page boundary where there is no column
 * boundary to hang it on.
 */
const CHAPTER_CLASS = "reader-heading";

/**
 * Where the pages fall, measured off a strip the browser has already fragmented.
 *
 * Costs one rect read per chapter in the window — a handful, not a book — and
 * runs once per repagination, never on a page turn.
 */
export function measurePages(flow: HTMLElement, geom: PageGeometry): Pages {
  const left = flow.getBoundingClientRect().left;
  const opens: number[] = [];
  for (const el of flow.querySelectorAll<HTMLElement>(`.${CHAPTER_CLASS}`)) {
    opens.push(startColOf(el, left, geom));
  }
  return buildPages(columnsInWidth(flow.scrollWidth, geom), opens, geom);
}

/**
 * The page a character offset is displayed on.
 *
 * Defined as the inverse of charOffsetAtTopOfPage rather than measured
 * directly — the last page whose first character is at or before this one. That
 * makes the two directions agree by construction, which measuring both
 * independently does not: asking the browser which column a single character
 * renders in is unreliable exactly where it matters, at a column break, where a
 * trailing space can be reported against either side. WebKit put a character one
 * page later than the page it was actually on that way.
 *
 * Costs about ten probes of a function that is itself a binary search. That's
 * fine: this runs on a repagination or a jump, never on a page turn.
 */
export function pageForCharOffset(charOffset: number, ctx: MeasureCtx): number {
  const { blocks, blockEls } = ctx;
  if (blocks.length === 0 || blockEls.length === 0) return 0;

  let lo = 0;
  let hi = pageCount(ctx.pages) - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (charOffsetAtTopOfPage(mid, ctx) <= charOffset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * The character offset at the very top of a page — what gets saved as "where I
 * am", and the primitive the rest of this module is defined against.
 *
 * Blocks start in non-decreasing column order, so this binary-searches blocks
 * (measuring only the ~13 it probes) and then, if the page opens in the middle
 * of a paragraph, binary-searches the characters within it. Both searches
 * converge on a boundary rather than trusting any single measurement, which is
 * what makes it stable where a lone rect lookup isn't.
 */
export function charOffsetAtTopOfPage(page: number, ctx: MeasureCtx): number {
  const { blocks, blockEls, geom, pages } = ctx;
  if (blocks.length === 0 || blockEls.length === 0) return 0;
  // The first page starts at the first RENDERED block, which is the front of the
  // book only when the whole book is rendered. Returning 0 here instead would
  // quietly save the reader's position as page one of the book every time they
  // sat on the first page of a window — losing their place, in the one function
  // the rest of this module is defined against.
  if (page <= 0) return blocks[0].charStart;

  const left = flowLeft(ctx);
  const targetCol = firstColOfPage(page, pages);

  // The FIRST block starting at or after this page's first column — not the
  // last one starting at or before it. A whole column's worth of blocks start
  // *in* the target column, and picking the last of those returns a position
  // near the column's foot while claiming it's the top, which puts every saved
  // position and every chapter jump about a column of text too far ahead.
  let lo = 0;
  let hi = blocks.length - 1;
  let first = blocks.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const el = blockEls[mid];
    if (!el) break;
    if (startColOf(el, left, geom) >= targetCol) {
      first = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // The block before it may still be flowing into this column, in which case
  // the page opens mid-paragraph and we need the character, not the block.
  const previous = first - 1;
  const previousEl = previous >= 0 ? blockEls[previous] : null;
  if (previousEl && endColOf(previousEl, left, geom) >= targetCol) {
    let clo = 0;
    let chi = blocks[previous].text.length;
    while (clo < chi) {
      const mid = (clo + chi) >> 1;
      const col = colOfCharInBlock(previousEl, mid, left, geom);
      if (col == null) break;
      if (col < targetCol) clo = mid + 1;
      else chi = mid;
    }
    return blocks[previous].charStart + clo;
  }

  // Otherwise the page opens with a whole block: either one that begins exactly
  // at the top of this column, or — when a forced break left the tail of the
  // previous column empty — the first one after the gap.
  const block = blocks[first];
  if (block) return block.charStart;
  const last = blocks[blocks.length - 1];
  return last.charStart + last.text.length;
}

/**
 * How far the text runs, in pixels from the flow's left edge.
 *
 * A measure of the TEXT rather than of the box around it, which is the whole
 * point: the flow is sized to hold every column it painted, so `scrollWidth`
 * answers with the box and stops moving when the text does. Used to notice a web
 * font landing late and changing every line's metrics under a laid-out book.
 *
 * Both rects are read in viewport coordinates, so the flow's page-turn transform
 * cancels and this is stable whatever page the reader is on.
 */
export function textEnd(flow: HTMLElement, blockEls: HTMLElement[]): number {
  const last = blockEls[blockEls.length - 1];
  if (!last) return -1;
  const rects = last.getClientRects();
  const rect = rects[rects.length - 1] ?? last.getBoundingClientRect();
  return Math.round(rect.right - flow.getBoundingClientRect().left);
}

/**
 * Development-only check on the invariant everything else rests on: pages run
 * forward through the book. pageForCharOffset binary-searches on that being
 * true, so if column arithmetic ever drifts far enough to make a later page
 * start earlier in the text, lookups start returning nonsense — and the symptom
 * would be a reader that quietly loses its place deep into a long book, which is
 * exactly the bug nobody finds by using it for five minutes.
 */
export function assertPagesMoveForward(ctx: MeasureCtx, totalPages: number): void {
  if (process.env.NODE_ENV === "production") return;

  // Are the blocks measurable at all? An element that isn't laid out — detached,
  // or under a display:none ancestor — reports no client rects, and every
  // position then collapses to the same answer. That reads as "monotonic" to the
  // check below, so it has to be caught separately: it is the failure mode that
  // actually happened, and from the outside it looks like navigation silently
  // doing nothing.
  const probe = ctx.blockEls[Math.floor(ctx.blockEls.length / 2)];
  if (probe && probe.getClientRects().length === 0) {
    console.warn(
      "[reader] block elements report no layout boxes — pagination can't measure. " +
        "Are they still attached to the document?"
    );
    return;
  }

  // The strip has to be an exact whole number of strides. Every page turn is a
  // multiple of the stride, so a fractional one is drift: harmless at column 5,
  // and by column 700 it's the difference between the right page and the wrong
  // one. Catching it here means catching it the moment it appears rather than
  // 200px later, deep in a book, where it reads as "the reader lost my place".
  // Page 0 must report the first rendered character, not the front of the book.
  // Under a window those differ, and the difference is the reader's saved place.
  const firstTop = charOffsetAtTopOfPage(0, ctx);
  if (firstTop !== ctx.blocks[0].charStart) {
    console.warn(
      `[reader] page 0 starts at char ${firstTop}, but the first rendered block ` +
        `starts at ${ctx.blocks[0].charStart} — saved positions will be wrong`
    );
  }

  const strideCount = (ctx.flow.scrollWidth + ctx.geom.gap) / ctx.geom.colStride;
  if (Math.abs(strideCount - Math.round(strideCount)) > 0.01) {
    console.warn(
      `[reader] the column strip isn't a whole number of strides ` +
        `(${ctx.flow.scrollWidth}px + ${ctx.geom.gap} / ${ctx.geom.colStride} = ${strideCount}) — ` +
        `page positions will drift toward the end of the book`
    );
  }

  // No chapter opens in the middle of a page. The whole point of the page map:
  // if this ever fails, a reader on a two-column spread sees the last column of
  // one chapter and the first of the next side by side, with no page turn between
  // them — which is the thing it exists to prevent, and it would look deliberate.
  for (const col of ctx.pages.opens) {
    const page = pageForCol(col, ctx.pages);
    if (col !== firstColOfPage(page, ctx.pages)) {
      console.warn(
        `[reader] a chapter opens in column ${col}, which is inside page ${page} ` +
          `(starting at column ${firstColOfPage(page, ctx.pages)}) rather than opening it`
      );
      break;
    }
  }

  // Sampled: walking every page of a 1,000-page book on every repagination
  // would cost more than the pagination did.
  const step = Math.max(1, Math.floor(totalPages / 40));
  let previous = -1;
  for (let page = 0; page < totalPages; page += step) {
    const char = charOffsetAtTopOfPage(page, ctx);
    if (char < previous) {
      console.warn(
        `[reader] page ${page} starts at char ${char}, before the previous sample at ${previous}`
      );
      return;
    }
    previous = char;
  }
}
