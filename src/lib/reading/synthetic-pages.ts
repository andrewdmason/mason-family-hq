/**
 * The 280-word "page" layout for books whose own pagination is synthetic.
 *
 * A reflowable EPUB without a page-list has no real pages, so convert.ts lays a
 * fixed 280-words-per-page grid over the char space and stores it as
 * reading_book_pages. Those rows are what getTextForRange scopes a quiz or a
 * spoiler-bounded chat against, and what the reader chat cites as "[p.212]".
 *
 * This lives on its own because two callers must produce byte-identical rows:
 * conversion (from the block stream it is emitting) and the repair path in
 * reader/actions.ts (from the stored HTML, for books converted before synthetic
 * pages existed). Reconverting is not an option for the latter — it would re-parse
 * the source with today's converter and move the character space out from under
 * every stored annotation and chat anchor — so the layout has to be reproducible
 * from the HTML alone. One function, two callers, no drift.
 */
import { blockMap } from "@/lib/reading/block-stream";
import { countWords } from "@/lib/reading/word-counts";
import { WORDS_PER_PAGE } from "@/lib/reading/chapter-target";

export type SyntheticPage = {
  pageNumber: number;
  anchorId: string;
  charStart: number;
  charEnd: number;
};

/**
 * Cumulative (char, word) totals *after* each emitted block — the boundaries a
 * synthetic page is allowed to break on, so a page never splits a paragraph.
 */
export type BlockMark = { char: number; word: number };

/** Block marks straight off converted HTML, matching what convert.ts accumulates. */
export function blockMarksFromHtml(html: string): BlockMark[] {
  const marks: BlockMark[] = [];
  let char = 0;
  let word = 0;
  for (const block of blockMap(html)) {
    // Mirrors convert.ts `advance()`: one separator char per emitted block.
    char += block.text.length + 1;
    word += countWords(block.text);
    marks.push({ char, word });
  }
  return marks;
}

/**
 * Lay 280-word pages over a book's block boundaries. `totalChars`/`totalWords`
 * are the conversion's own totals (the last block mark), and the final page
 * always runs to totalChars so the map covers the book exactly.
 */
export function layoutSyntheticPages(
  blockMarks: BlockMark[],
  totalChars: number,
  totalWords: number
): SyntheticPage[] {
  const pages: SyntheticPage[] = [];
  if (totalWords <= 0) return pages;

  const pageTotal = Math.max(1, Math.ceil(totalWords / WORDS_PER_PAGE));
  let mark = 0;
  let startChar = 0;
  for (let pn = 1; pn <= pageTotal; pn++) {
    // First block boundary at/after this page's word threshold (monotonic).
    while (mark < blockMarks.length && blockMarks[mark].word < pn * WORDS_PER_PAGE) {
      mark++;
    }
    const endChar = pn === pageTotal ? totalChars : (blockMarks[mark]?.char ?? totalChars);
    if (endChar <= startChar) continue; // skip empty pages (incl. an overshoot tail)
    pages.push({
      pageNumber: pn,
      anchorId: `wpage-${pn}`,
      charStart: startChar,
      charEnd: endChar,
    });
    startChar = endChar;
  }
  return pages;
}
