/**
 * Snapping a weekly reading goal to a chapter boundary. Pure and dependency-free
 * (types only), so it can be reasoned about and tested in isolation.
 *
 * Why this exists: a reflowable EPUB's own page numbers are synthetic — they
 * shift with font and device and don't match any printed edition. Word count is
 * stable, so we define a page as 280 words and express the weekly goal in those
 * pages. But "read to word 76,214" is meaningless to a kid, so we snap the raw
 * word target to the nearest sensible chapter boundary and phrase the goal as a
 * chapter ("finish Chapter 8" / "about halfway through Chapter 8").
 *
 * The snapping rule (in order):
 *   1. Round DOWN to a just-completed chapter if its end is within 5% of the
 *      week's reading — a hair short is better than a whole extra chapter.
 *   2. Otherwise round UP to the next chapter, unless that overshoots the target
 *      by more than 10 pages.
 *   3. If rounding up is too far, land mid-chapter and phrase it as a fraction.
 */

import type { ReadingTargetChapter } from "@/lib/types";

/** A printed-ish page is defined as this many words (calibrated against real
 *  paperbacks: e.g. Catching Fire is ~281 words/page). */
export const WORDS_PER_PAGE = 280;
/** Round the target down to a finished chapter when it's within this share of the
 *  week's reading (not of the whole book). */
export const ROUND_DOWN_TOLERANCE = 0.05;
/** Never round up to a chapter that overshoots the target by more than this many
 *  pages — beyond it, we land mid-chapter instead. */
export const ROUND_UP_MAX_PAGES = 10;
/** Fewer real chapters than this and there's nothing worth snapping to, so the
 *  caller falls back to a plain page goal. */
export const MIN_CHAPTERS = 2;

/** A chapter's word span: [startWord, endWord). */
export type ChapterSpan = { title: string; startWord: number; endWord: number };

/**
 * Front/back matter that shows up in a book's TOC but isn't the story — a next-
 * book preview, the author bio, copyright, the contents page itself, etc. These
 * are excluded from chapter goals (and from the word count that defines the book's
 * length) so a book "finishes" at the end of its last real chapter, not after a
 * 8,000-word teaser for the sequel. Matched on the title's opening words.
 */
const NON_CONTENT_TITLE =
  /^(cover|title page|copyright|contents|table of contents|dedication|acknowledg|about the (author|publisher)|also (by|available)|by the same author|other books|newsletter|praise for|excerpt|preview|teaser|sneak peek|bonus|end of book|back ad|advertisement|discussion guide|reading group|a note (on|about)|imprint|colophon)\b/i;

/** Whether a TOC title names actual story content (vs front/back matter). */
function isContentSection(title: string): boolean {
  return !NON_CONTENT_TITLE.test(title.trim());
}

/**
 * The book's content length in words: the end of the last real chapter, ignoring
 * any trailing back matter. Falls back to the raw total when there are no spans.
 */
export function contentWordCount(spans: ChapterSpan[], totalWords: number): number {
  return spans.length ? spans[spans.length - 1].endWord : totalWords;
}

export type ChapterTargetPick = {
  /** The exact word offset to aim for (a chapter end, or a mid-chapter point). */
  targetWord: number;
  chapter: ReadingTargetChapter;
};

/** Convert a word offset into a 280-word page number (min 1). */
export function wordsToPage(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_PAGE));
}

/**
 * A quiz/stretch page range as a chapter label — "Through Chapter 8" or
 * "Chapter 5 – Chapter 8" — for chapter books whose pages are synthetic. Returns
 * null when there's no chapter list (real-page books, articles), so the caller
 * falls back to the page range.
 */
export function coverageChapterLabel(
  chapters: { title: string; endPage: number }[],
  fromPage: number | null,
  throughPage: number
): string | null {
  if (chapters.length === 0) return null;
  const chapterFor = (page: number) =>
    (chapters.find((c) => c.endPage >= page) ?? chapters[chapters.length - 1]).title;
  const through = chapterFor(throughPage);
  if (fromPage == null || fromPage <= 1) return `Through ${through}`;
  const from = chapterFor(fromPage);
  return from !== through ? `${from} – ${through}` : through;
}

/**
 * Build chapter spans from stored TOC entries carrying `startWord`. Uses the
 * finest level present (chapters over parts), so a "Part I" divider sharing a
 * spot with its first chapter doesn't create a zero-length span. Returns [] when
 * there aren't enough real chapters to snap to — the signal to fall back to
 * plain page goals (articles, un-reconverted books, page-numbered TOCs, etc.).
 */
export function chapterSpans(
  toc: { title: string; level: number; startWord?: number | null }[],
  totalWords: number
): ChapterSpan[] {
  const withWords = toc.filter(
    (t): t is { title: string; level: number; startWord: number } =>
      typeof t.startWord === "number" && t.startWord >= 0
  );
  if (withWords.length === 0) return [];

  // Prefer chapter-level (2) entries; fall back to part-level (1) only if that's
  // all there is. A mixed Part+chapter nav thus reduces to just the chapters.
  const hasChapters = withWords.some((t) => t.level >= 2);
  const chosen = hasChapters ? withWords.filter((t) => t.level >= 2) : withWords;

  // Boundaries come from the full sorted list (so a real chapter's end is the
  // start of whatever follows — including a back-matter section), but front/back
  // matter itself is dropped from the returned chapters.
  const sorted = [...chosen].sort((a, b) => a.startWord - b.startWord);
  const spans: ChapterSpan[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].startWord;
    const end = i + 1 < sorted.length ? sorted[i + 1].startWord : totalWords;
    if (end <= start) continue; // drop zero-length spans (coincident offsets)
    if (!isContentSection(sorted[i].title)) continue; // drop front/back matter
    spans.push({ title: sorted[i].title, startWord: start, endWord: end });
  }
  return spans.length >= MIN_CHAPTERS ? spans : [];
}

/**
 * Snap a weekly goal to a chapter boundary. Returns null when there's nothing to
 * snap to: no goal set, no chapters, or already at the end of the book.
 */
export function pickChapterTarget(input: {
  /** Where the reader is now, in words. */
  currentWord: number;
  /** The member's weekly goal, in 280-word pages. */
  weeklyPageGoal: number;
  chapters: ChapterSpan[];
  totalWords: number;
}): ChapterTargetPick | null {
  const { currentWord, weeklyPageGoal, chapters, totalWords } = input;
  if (weeklyPageGoal <= 0 || chapters.length === 0 || currentWord >= totalWords) {
    return null;
  }

  const weeklyWords = weeklyPageGoal * WORDS_PER_PAGE;
  const target = currentWord + weeklyWords;

  // Chapter END offsets ahead of the reader, in order.
  const ends = chapters.map((c) => c.endWord).filter((e) => e > currentWord);
  if (ends.length === 0) return null;

  // down = last chapter end strictly before the target; up = first at/after it.
  let down: number | null = null;
  let up: number | null = null;
  for (const e of ends) {
    if (e < target) down = e;
    else {
      up = e;
      break;
    }
  }

  const endPick = (endWord: number): ChapterTargetPick => {
    const ch = chapters.find((c) => c.endWord === endWord) ?? chapters[chapters.length - 1];
    return {
      targetWord: endWord,
      chapter: { title: ch.title, kind: "chapter_end", fraction: null },
    };
  };

  // 1. Round down to a just-finished chapter within 5% of the week's reading.
  if (down != null && target - down <= ROUND_DOWN_TOLERANCE * weeklyWords) {
    return endPick(down);
  }
  // 2. No chapter ahead ends at/after the target → aim for the last one (finish).
  if (up == null) return endPick(ends[ends.length - 1]);
  // 3. Round up to the next chapter unless it overshoots by more than 10 pages.
  if (up - target <= ROUND_UP_MAX_PAGES * WORDS_PER_PAGE) return endPick(up);
  // 4. Too far to round up: land mid-chapter, as a fraction of the chapter that
  //    contains the target.
  const containing =
    chapters.find((c) => target > c.startWord && target <= c.endWord) ??
    chapters.find((c) => c.endWord === up)!;
  const span = containing.endWord - containing.startWord;
  const fraction = span > 0 ? (target - containing.startWord) / span : 0;
  return {
    targetWord: target,
    chapter: {
      title: containing.title,
      kind: "chapter_fraction",
      fraction: Math.min(1, Math.max(0, fraction)),
    },
  };
}

/** "Chapter 8" from a bare "8"; leaves named sections ("Prologue") untouched. */
function chapterName(title: string): string {
  const t = title.trim();
  return /^\d{1,3}$/.test(t) ? `Chapter ${t}` : t;
}

/** A friendly phrase for a mid-chapter fraction. */
function fractionPhrase(fraction: number): string {
  if (fraction <= 0.15) return "just into";
  if (fraction < 0.3) return "a quarter of the way through";
  if (fraction < 0.42) return "a third of the way through";
  if (fraction < 0.58) return "halfway through";
  if (fraction < 0.71) return "two-thirds of the way through";
  if (fraction < 0.85) return "three-quarters of the way through";
  return "almost to the end of";
}

/** The goal phrase: "finish Chapter 8" or "halfway through Chapter 8". */
export function chapterTargetLabel(chapter: ReadingTargetChapter): string {
  const name = chapterName(chapter.title);
  if (chapter.kind === "chapter_end") return `finish ${name}`;
  return `${fractionPhrase(chapter.fraction ?? 0)} ${name}`;
}
