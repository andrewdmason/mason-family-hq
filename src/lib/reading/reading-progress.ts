/**
 * "How far in am I, and how much is left?" — computed from character offsets
 * rather than pixels.
 *
 * The reader used to derive both from scroll position: percent was
 * scrollY/scrollHeight, and words-left-in-chapter was the pixel distance to the
 * next heading as a share of the document. That worked while there was exactly
 * one layout. A paged book has no scroll height at all, and the same book is a
 * different number of pixels tall at every font size — so all of it moves onto
 * the character space, which is the same on every device.
 *
 * Shared by both reading modes on purpose: the two must never disagree about
 * what "43%" means just because one of them is scrolling.
 */

import type { BookBlock } from "@/lib/reading/block-stream";
import { minutesToRead } from "@/lib/reading/reading-time";
import type { ReadingTocEntry } from "@/lib/types";

export type ChapterBound = {
  title: string;
  anchorId: string;
  /** Where the chapter's heading begins in the char space. */
  charStart: number;
  /** Cumulative body words before the heading, when the TOC recorded it. */
  startWord: number | null;
};

export type ReadingProgress = {
  percent: number;
  minutesLeft: number | null;
  chapter: { title: string; anchorId: string; minutesLeft: number | null } | null;
};

/** Total characters in the book, counted the way the converter counted them. */
export function totalCharsOf(blocks: BookBlock[]): number {
  const last = blocks.at(-1);
  return last ? last.charStart + last.text.length + 1 : 0;
}

/**
 * Resolve the table of contents into character positions.
 *
 * Skips an entry that merely repeats the book's own title — some TOCs lead with
 * it, and treating it as a chapter makes the readout say the book's name back to
 * you instead of naming where you are.
 */
export function chapterBounds(
  toc: ReadingTocEntry[],
  bookTitle: string,
  blocks: BookBlock[]
): ChapterBound[] {
  const byId = new Map<string, BookBlock>();
  for (const block of blocks) {
    if (block.id) byId.set(block.id, block);
  }
  const skip = bookTitle.trim().toLowerCase();
  const bounds: ChapterBound[] = [];
  for (const entry of toc) {
    if (entry.title.trim().toLowerCase() === skip) continue;
    const block = byId.get(entry.anchorId);
    if (!block) continue;
    bounds.push({
      title: entry.title,
      anchorId: entry.anchorId,
      charStart: block.charStart,
      startWord: entry.startWord ?? null,
    });
  }
  return bounds.sort((a, b) => a.charStart - b.charStart);
}

export function chapterIndexAt(charTop: number, chapters: ChapterBound[]): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].charStart <= charTop) found = i;
    else break;
  }
  return found;
}

export function progressAt(
  charTop: number,
  totalChars: number,
  wordCount: number | null,
  chapters: ChapterBound[],
  atEnd: boolean,
  /**
   * Last character visible alongside charTop. Paged mode passes the end of the
   * page; scrolling leaves it out, which reduces this to "the chapter I'm in".
   */
  charEnd?: number
): ReadingProgress {
  // The last page is 100%, not "the last page's first character" — otherwise a
  // finished book stubbornly reads 99%. A book we know nothing about yet is 0%,
  // not 100%: this gets called before the text has loaded.
  const ratio =
    totalChars <= 0 ? 0 : atEnd ? 1 : Math.min(1, Math.max(0, charTop / totalChars));
  const percent = Math.round(ratio * 100);
  const minutesLeft = minutesToRead(wordCount != null ? wordCount * (1 - ratio) : null);

  // Before the first heading you're in front matter, and with fewer than two
  // chapters a chapter readout would only echo the book's own progress.
  let ci = chapters.length >= 2 ? chapterIndexAt(charTop, chapters) : -1;
  if (ci < 0) return { percent, minutesLeft, chapter: null };

  // A chapter starts a new column, so on a two-column spread a chapter can begin
  // in the right-hand column while the left is still finishing the last one.
  // Name the new one: its heading is right there on the page, and naming the
  // chapter you just left reads as the reader having failed to go anywhere.
  if (charEnd != null && charEnd > charTop) {
    for (let i = ci + 1; i < chapters.length; i++) {
      if (chapters[i].charStart < charEnd) ci = i;
      else break;
    }
  }

  const cur = chapters[ci];
  const next = chapters[ci + 1] ?? null;
  const nextStart = next?.charStart ?? totalChars;
  const span = Math.max(1, nextStart - cur.charStart);
  const through = Math.min(1, Math.max(0, (charTop - cur.charStart) / span));

  let wordsLeft: number | null = null;
  const nextWord = next?.startWord ?? (next == null ? wordCount : null);
  if (cur.startWord != null && nextWord != null) {
    // Real word offsets from the TOC: the chapter's true length, scaled by how
    // far through its characters we are.
    wordsLeft = Math.max(0, (1 - through) * (nextWord - cur.startWord));
  } else if (wordCount != null && totalChars > 0) {
    // Older TOCs have no word offsets, so characters stand in for words — the
    // same even-distribution assumption the pixel version made, minus the
    // dependence on how the text happens to be laid out right now.
    wordsLeft = (wordCount * Math.max(0, nextStart - charTop)) / totalChars;
  }

  return {
    percent,
    minutesLeft,
    chapter: {
      title: cur.title,
      anchorId: cur.anchorId,
      minutesLeft: minutesToRead(wordsLeft),
    },
  };
}
