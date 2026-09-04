/**
 * The shapes the reader, the routes and the translator all agree on.
 *
 * Client-safe: the reader imports these directly, so nothing here may reach for
 * the database, the model, or the filesystem.
 */

/** Which text a reader sees a book in. Stored per reader on reading_book_state. */
export type ReadingFace = "original" | "plain";

export type PlainChapterStatus = "pending" | "preparing" | "batched" | "ready" | "failed";

/**
 * One chapter of a book as a unit of translation.
 *
 * `blockStart`/`blockEnd` are a half-open range of block indices in the original
 * block map (block-stream.ts); `charStart`/`charEnd` the matching range in the
 * conversion char space. The reader uses the char range to answer "which
 * chapter am I in" and the block range to know which paragraphs to swap.
 */
export type PlainChapter = {
  index: number;
  title: string;
  anchorId: string | null;
  blockStart: number;
  blockEnd: number;
  charStart: number;
  charEnd: number;
  status: PlainChapterStatus;
  error: string | null;
};

/**
 * One translated paragraph. `text` is null when the translator kept the
 * original (a quotation, verse, an epigraph): the reader renders the original
 * slice for it, so a kept paragraph is a decision, not a gap.
 */
export type PlainBlock = {
  index: number;
  chapterIndex: number;
  kept: boolean;
  text: string | null;
};

/** A word the translator left untranslated, and what it means in this book. */
export type PlainTerm = {
  term: string;
  definition: string;
  /** Chapters before this one must not underline the term. */
  firstChapterIndex: number;
};

/**
 * Everything the reader needs to render a book in the plain face: which
 * chapters exist and how far along they are, the paragraphs that are ready,
 * and the glossary. Empty `chapters` means nobody has ever turned Plain English
 * on for this conversion.
 */
export type PlainPlan = {
  hash: string;
  chapters: PlainChapter[];
  blocks: PlainBlock[];
  terms: PlainTerm[];
};

/** What one chapter's generation cost, for the estimate shown before a run. */
export type PlainUsage = {
  inputTokens: number;
  outputTokens: number;
};
