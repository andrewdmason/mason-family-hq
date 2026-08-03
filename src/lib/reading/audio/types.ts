/**
 * The shapes the player, the routes and the synthesizer all agree on.
 *
 * Client-safe: the player imports these directly, so nothing here may reach for
 * the database or the filesystem.
 */

export type AudioChapterStatus = "pending" | "preparing" | "ready" | "failed";

/**
 * One chapter of a book, as the player sees it.
 *
 * `charStart`/`charEnd` are the conversion char space — the same numbers the
 * reader uses for position — which is what lets "where the voice is" and "where
 * I was reading" be a single value rather than two.
 */
export type AudioChapter = {
  index: number;
  title: string;
  charStart: number;
  charEnd: number;
  status: AudioChapterStatus;
  durationMs: number | null;
  /** Characters billed, once it has been synthesized. */
  billedChars: number | null;
  error: string | null;
};

export type AudioPlan = {
  bookId: string;
  title: string;
  author: string | null;
  chapters: AudioChapter[];
  /** Sum of billedChars across ready chapters, in dollars. */
  spentDollars: number;
};

/**
 * One spoken sentence: when it starts, and what it covers in the book.
 *
 * This is the entire follow-along mechanism. Given the audio's current time,
 * binary-search for the cue that contains it; `s`/`e` are a book character range,
 * which the reader turns into a DOM range to highlight and a position to save.
 *
 * Sentence granularity rather than per-character: a chapter is a couple of
 * hundred sentences, so the whole map is a few kilobytes and can be fetched
 * alongside the audio, where a per-character map would be half a megabyte.
 *
 * Field names are one letter because this is downloaded per chapter and the
 * savings are most of the file.
 */
export type AudioCue = {
  /** Milliseconds into the chapter's audio. */
  t: number;
  /** Book char offset where this sentence starts. */
  s: number;
  /** Book char offset just past where it ends. */
  e: number;
};

export type AudioTimings = {
  v: 1;
  durationMs: number;
  cues: AudioCue[];
};

/**
 * The cue playing at `ms`, by binary search.
 *
 * Returns the last cue at or before the time, so the gap between two sentences
 * belongs to the one that just finished rather than flickering to nothing.
 * Null only when there are no cues at all.
 */
export function cueAt(cues: AudioCue[], ms: number): AudioCue | null {
  if (cues.length === 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].t <= ms) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return cues[best];
}

/**
 * The inverse: where in the audio a book character offset is spoken.
 *
 * Used when you start listening from where you were reading — the reader hands
 * over a character offset and the player has to know where to drop the needle.
 * Interpolates within the cue rather than snapping to its start, so resuming
 * mid-sentence doesn't rewind a whole sentence every time.
 */
export function timeAtChar(cues: AudioCue[], charOffset: number): number {
  if (cues.length === 0) return 0;
  let lo = 0;
  let hi = cues.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].s <= charOffset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const cue = cues[best];
  const next = cues[best + 1];
  if (!next || cue.e <= cue.s) return cue.t;
  const through = Math.min(1, Math.max(0, (charOffset - cue.s) / (cue.e - cue.s)));
  return cue.t + through * (next.t - cue.t);
}

/**
 * Whether the sentence being spoken falls on the page in front of the reader.
 *
 * Both sides are ranges in the same character space, so this is an overlap test
 * and nothing else — no measuring, no DOM, no second notion of where anything
 * is. That matters more than it looks: asking the page's elements whether they
 * are on screen cannot tell a paged reader apart, because a paged book is one
 * tall strip of columns running off to the right and every page of it sits in
 * the same vertical band. The next page is beside you, not below you.
 *
 * `pageEnd` is the first character past the bottom of the page. The last page of
 * a book has no such character, and the caller passes the page's own start
 * instead — which reads here as "this page runs to the end of the book".
 */
export function cueOnPage(cue: AudioCue, pageStart: number, pageEnd: number): boolean {
  if (cue.e <= pageStart) return false;
  return pageEnd <= pageStart || cue.s < pageEnd;
}

/** The chapter containing a character offset, or the last one before it. */
export function chapterAtChar(chapters: AudioChapter[], charOffset: number): AudioChapter | null {
  if (chapters.length === 0) return null;
  let found = chapters[0];
  for (const chapter of chapters) {
    if (chapter.charStart <= charOffset) found = chapter;
    else break;
  }
  return found;
}
