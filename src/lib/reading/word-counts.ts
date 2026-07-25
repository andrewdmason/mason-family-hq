/**
 * Recovering a converted book's word counts from its own HTML.
 *
 * convert.ts records word_count and each TOC entry's startWord as it emits the
 * text. Books converted before those existed (migration 00163) have neither, and
 * the reader's time-left readout is `word_count * (1 - ratio) / 250` — so it
 * silently disappears while percent-complete, which is derived from characters,
 * keeps working.
 *
 * The numbers are still recoverable: blockMap() rebuilds the exact block stream
 * the converter emitted, so counting tokens over it reproduces the converter's
 * arithmetic on the same text, and a heading's `sec-N` id gives each chapter its
 * word offset. Doing that is strictly better than reconverting, which would
 * re-parse the source with today's converter and shift the character space out
 * from under every stored annotation and chat anchor.
 *
 * Client-safe on purpose (no "server-only"), like block-stream.ts: the reader
 * holds the same HTML the server does, so either side can do this.
 */
import { blockMap } from "@/lib/reading/block-stream";
import type { ReadingTocEntry } from "@/lib/types";

/**
 * Words in a run of text: whitespace-delimited tokens. Must stay identical to
 * convert.ts `countWords`, which is what produced every stored word_count — a
 * divergence here would make backfilled books disagree with converted ones.
 */
export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export type BookWordCounts = {
  /** Total body words, in the converter's definition. */
  wordCount: number;
  /** The TOC with `startWord` filled in wherever the anchor was locatable. */
  toc: ReadingTocEntry[];
  /** Characters implied by this HTML, for checking it against the stored count. */
  charCount: number;
  /** How many TOC entries got a startWord, and out of how many. */
  located: number;
  total: number;
};

/**
 * Recount a converted book from its HTML. Returns null when the HTML yields no
 * blocks at all, which means it isn't converter output and nothing here applies.
 */
export function computeBookWordCounts(
  html: string,
  toc: ReadingTocEntry[]
): BookWordCounts | null {
  const blocks = blockMap(html);
  if (blocks.length === 0) return null;

  // Words before each block, in document order, so a heading's id resolves
  // straight to its chapter's word offset.
  const wordsBeforeId = new Map<string, number>();
  let wordCursor = 0;
  for (const block of blocks) {
    if (block.id) wordsBeforeId.set(block.id, wordCursor);
    wordCursor += countWords(block.text);
  }

  let located = 0;
  const nextToc = toc.map((entry) => {
    const startWord = wordsBeforeId.get(entry.anchorId);
    if (startWord == null) return entry;
    located++;
    return { ...entry, startWord };
  });

  // Matches convert.ts's `charCursor += text.length + 1` per emitted block.
  const last = blocks[blocks.length - 1];
  return {
    wordCount: wordCursor,
    toc: nextToc,
    charCount: last.charStart + last.text.length + 1,
    located,
    total: toc.length,
  };
}
