/**
 * Which part of a book the paged reader actually puts in the DOM.
 *
 * Laying out a whole book as one multi-column strip costs 116–136ms for 1.1M
 * characters, and it is paid again on every font change, margin change and
 * rotation. A window is the fix: render one chapter and its neighbours — 13k to
 * 75k characters apiece across this library — and the same work costs single
 * digits.
 *
 * The property that makes it safe is already in the stylesheet. Every heading
 * the converter emits carries `break-before: column` (reader-prose.ts), so a
 * chapter always starts at a column boundary. A window that begins at a heading
 * therefore fragments into exactly the columns the whole book would have given
 * that chapter — verified in Chromium and WebKit, to the pixel, in
 * scripts/verify-window-seams.mts. Seams are invisible because there is nothing
 * to see: the columns are the same columns.
 *
 * That is also why windows are never cut mid-chapter. A window starting between
 * headings would start at a break the whole book doesn't have, and its
 * fragmentation would be its own — which is the one thing this rests on not
 * being true.
 *
 * Pure arithmetic over the block stream. No DOM, no React.
 */

import type { BookBlock } from "@/lib/reading/block-stream";

/**
 * A run of blocks that begins at a forced column break: the front matter before
 * the first heading, then one per heading. Half-open on blocks and on chars.
 */
export type BookSegment = {
  startBlock: number;
  endBlock: number;
  charStart: number;
  charEnd: number;
};

/**
 * The blocks currently rendered.
 *
 * `startBlock` is also the ANCHOR BASE: the DOM holds `endBlock - startBlock`
 * block elements, and element `i` is global block `startBlock + i`. Every
 * translation between a stored annotation anchor and the page goes through that
 * one number — see annotation-anchors.ts.
 */
export type BookWindow = {
  startBlock: number;
  endBlock: number;
  charStart: number;
  charEnd: number;
};

/**
 * How much of the book to keep rendered either side of the chapter being read,
 * so that reading into the next one doesn't have to stop and lay it out.
 *
 * Whole segments only, so this is a floor rather than a target: one 13k chapter
 * on each side isn't enough and pulls in the next, while one 75k chapter is
 * plenty on its own.
 */
export const WINDOW_MARGIN_CHARS = 30_000;

/** One past the last character of `block`, in the conversion char space. */
function charEndOf(block: BookBlock): number {
  // The converter counts a separator after every block; block-stream.ts mirrors
  // it. Without the +1 a window's char span would exclude the gap between its
  // last block and the next, and a position landing in that gap would read as
  // outside the window.
  return block.charStart + block.text.length + 1;
}

/**
 * Split the book at its forced column breaks.
 *
 * Headings, not table-of-contents entries: the TOC is a curated subset (it drops
 * entries echoing the book's own title, and skips anything whose anchor isn't in
 * the stream — see chapterBounds), whereas windowing needs EVERY forced break,
 * listed or not. A book with no headings at all comes back as a single segment,
 * which renders the whole book exactly as it did before windowing existed.
 */
export function segmentsOf(blocks: BookBlock[]): BookSegment[] {
  if (blocks.length === 0) return [];

  const starts: number[] = [];
  for (const block of blocks) {
    if (block.index === 0 || block.tag.startsWith("h")) starts.push(block.index);
  }
  // A book that opens on a heading would otherwise start with an empty segment.
  if (starts[0] !== 0) starts.unshift(0);

  return starts.map((startBlock, i) => {
    const endBlock = i + 1 < starts.length ? starts[i + 1] : blocks.length;
    return {
      startBlock,
      endBlock,
      charStart: blocks[startBlock].charStart,
      charEnd: charEndOf(blocks[endBlock - 1]),
    };
  });
}

/** The segment a character offset falls in — the last one that starts at or before it. */
export function segmentIndexAt(segments: BookSegment[], charOffset: number): number {
  let found = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].charStart <= charOffset) found = i;
    else break;
  }
  return found;
}

/**
 * The window to render for a reader sitting at `charOffset`: the segment they're
 * in, widened by whole segments until each side carries `marginChars`.
 *
 * Widening by whole segments rather than by a block count is what keeps both
 * edges on forced breaks, which is what keeps the fragmentation identical to the
 * book's own.
 */
export function windowFor(
  segments: BookSegment[],
  charOffset: number,
  marginChars: number = WINDOW_MARGIN_CHARS
): BookWindow {
  if (segments.length === 0) {
    return { startBlock: 0, endBlock: 0, charStart: 0, charEnd: 0 };
  }

  const here = segmentIndexAt(segments, charOffset);
  let first = here;
  let last = here;

  let before = 0;
  while (first > 0 && before < marginChars) {
    first -= 1;
    before += segments[first].charEnd - segments[first].charStart;
  }
  let after = 0;
  while (last + 1 < segments.length && after < marginChars) {
    last += 1;
    after += segments[last].charEnd - segments[last].charStart;
  }

  return {
    startBlock: segments[first].startBlock,
    endBlock: segments[last].endBlock,
    charStart: segments[first].charStart,
    charEnd: segments[last].charEnd,
  };
}

/** Whether a character offset is inside a window's span. */
export function windowHolds(win: BookWindow, charOffset: number): boolean {
  return charOffset >= win.charStart && charOffset < win.charEnd;
}

export function sameWindow(a: BookWindow | null, b: BookWindow | null): boolean {
  if (!a || !b) return a === b;
  return a.startBlock === b.startBlock && a.endBlock === b.endBlock;
}

/**
 * The window's markup, as an exact substring of the book's own HTML.
 *
 * A slice, never a re-serialisation. Every stored annotation anchor assumes a
 * block element's textContent is byte-identical to its `BookBlock.text`, so
 * rebuilding the markup would be one escaping bug away from silently moving
 * every highlight in the book.
 *
 * Slicing between two blocks' spans carries whatever sits between them —
 * including the zero-height page-anchor marks — so the only one ever dropped is
 * a mark sitting immediately before the window's first block. Harmless, and
 * deliberately so: page citations resolve through the recorded page marks in the
 * database, never through these elements.
 */
export function windowHtml(html: string, blocks: BookBlock[], win: BookWindow): string {
  if (win.endBlock <= win.startBlock) return "";
  return html.slice(blocks[win.startBlock].htmlStart, blocks[win.endBlock - 1].htmlEnd);
}
