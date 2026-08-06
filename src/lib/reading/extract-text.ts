import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { blockMap, stripHtmlToText, textFromBlocks } from "@/lib/reading/block-stream";
import { articleHtmlToText } from "@/lib/reading/article-sanitize";
import {
  chapterBounds,
  chapterSpan,
  summarizableChapters,
} from "@/lib/reading/reading-progress";
import type { ReadingTocEntry } from "@/lib/types";
import {
  MAX_CHAPTER_INDEX_ENTRIES,
  chapterMarks,
  pageMarks,
  spliceMarks,
  type ContextMark,
  type PageRange,
} from "@/lib/reading/context-markup";

/**
 * Pulling plain text back out of a converted book so a quiz can be scoped to
 * "through page N", or a reader chat to "through the page I'm on".
 *
 * The conversion records each page's character range against a stream of BLOCK
 * texts (see block-stream.ts, which owns that reconstruction and is shared with
 * the reader client). This module is the storage-and-range layer on top of it:
 * resolve a page range to char offsets, download the content, slice, and window.
 */

/** Largest text we feed the quiz model (~15k tokens). Longer ranges get windowed. */
const MAX_QUIZ_CONTEXT_CHARS = 60_000;

/**
 * Backstop on a single chapter. Not a real limit — the longest chapter in the
 * longest book on the shelf is an order of magnitude under it — just a guard so
 * a book whose contents resolve to one enormous "chapter" can't build a
 * multi-megabyte request.
 */
const MAX_CHAPTER_CONTEXT_CHARS = 400_000;

export { stripHtmlToText };

/**
 * The whole article as plain text.
 *
 * There is no range to resolve: an article has no page map, so there is nothing
 * to scope "through page N" against and no [p.N] markers to interleave. That
 * also means hasPageMarkers is false, which is what makes buildReaderChatSystem
 * leave the citation rule out of the prompt — the model is never asked to cite
 * pages that don't exist.
 */
async function getArticleText(
  client: SupabaseClient,
  contentPath: string,
  budget: number
): Promise<BookTextSlice | null> {
  const download = await client.storage
    .from(READING_BOOKS_BUCKET)
    .download(contentPath);
  if (download.error || !download.data) return null;

  const { text, truncated } = fitToBudget(
    articleHtmlToText(await download.data.text()),
    budget
  );
  return {
    text,
    fromEffectivePage: 1,
    throughEffectivePage: 1,
    hasRealPages: false,
    truncated,
    hasPageMarkers: false,
    hasChapterMarkers: false,
    chapters: [],
  };
}

/**
 * Trim text to the model budget while preserving cumulative coverage: keep the
 * opening (early grounding) and the most recent material (what the quiz leans on)
 * with an elision marker between. Short text passes through untouched.
 */
function fitToBudget(
  text: string,
  budget: number
): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false };
  const headChars = Math.floor(budget * 0.2);
  const tailChars = budget - headChars;
  const head = text.slice(0, headChars);
  const tail = text.slice(text.length - tailChars);
  return {
    text: `${head}\n\n[…earlier pages omitted for length…]\n\n${tail}`,
    truncated: true,
  };
}

export type ChapterText = {
  /** The heading's own text, exactly as the contents lists it. */
  title: string;
  /** The chapter's plain text, heading line included. */
  text: string;
  /** Whether the middle was elided to fit MAX_CHAPTER_CONTEXT_CHARS. */
  truncated: boolean;
};

/**
 * One chapter's text, for a summary of that chapter and nothing else.
 *
 * Bounded by chapterSpan over the book's own contents, which is also exactly
 * the list the reader makes tappable — so the text summarized here is the span
 * the reader pointed at, with no second definition of where a chapter starts and
 * stops. See chapterSpan for why "the next heading" is the wrong boundary.
 *
 * Deliberately unmarked, unlike the reader-chat slice: a recap of one chapter
 * has no pages worth citing that the reader isn't already looking at, and no
 * other chapters in it to index. What the model gets is the chapter, plainly.
 *
 * Returns null when the book isn't converted, the heading isn't one of the
 * contents' own, or the span comes back empty. Scoping is the caller's: pass the
 * resolved member client and userId (see resolveReadingScope).
 */
export async function getChapterText(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  anchorId: string
): Promise<ChapterText | null> {
  const { data: content } = await client
    .from("reading_book_content")
    .select("content_path, status, toc")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready" || !content.content_path) return null;

  const { data: book } = await client
    .from("reading_books")
    .select("title")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return null;

  const download = await client.storage
    .from(READING_BOOKS_BUCKET)
    .download(content.content_path as string);
  if (download.error || !download.data) return null;

  const blocks = blockMap(await download.data.text());
  const bounds = chapterBounds(
    (content.toc ?? []) as ReadingTocEntry[],
    book.title as string,
    blocks
  );
  // Gated on the same list the reader can tap, so the route can't be asked for
  // a recap of a part divider or the copyright page.
  if (!summarizableChapters(bounds).some((c) => c.anchorId === anchorId)) {
    return null;
  }

  const fullText = textFromBlocks(blocks);
  const span = chapterSpan(bounds, anchorId, fullText.length);
  if (!span) return null;

  const { text, truncated } = fitToBudget(
    fullText.slice(span.from, span.to).trim(),
    MAX_CHAPTER_CONTEXT_CHARS
  );
  if (!text) return null;

  return { title: span.title, text, truncated };
}

export type TextForRangeOptions = {
  /**
   * Interleave "[p.N]" markers at page boundaries so a model can cite pages
   * (reader chat). Markers are added while BUILDING the output, never spliced
   * into the counted stream, so the canonical char space is untouched.
   * Silently a no-op for books with no page map.
   */
  pageMarkers?: boolean;
  /**
   * Prefix each chapter/section heading with "## " and return the list of them,
   * so a model can be told where chapters begin (reader chat). Like pageMarkers,
   * the prefix is added while BUILDING the output and never enters the counted
   * stream. No-op for text with no heading blocks.
   */
  chapterMarkers?: boolean;
  /**
   * Char budget before head/tail elision. Defaults to MAX_QUIZ_CONTEXT_CHARS.
   * Reader chat passes a much larger cap and relies on token counting instead.
   */
  maxChars?: number | null;
  /**
   * End-of-range fallback in char space, used ONLY when the book has no page
   * map to resolve `throughPage` against (an unchaptered synthetic-page EPUB).
   * Lets a spoiler-scoped chat still cut at its anchor instead of taking the
   * whole book. Ignored when a page map exists — there, end-of-anchor-page is
   * the cleaner boundary than a mid-page cut.
   */
  throughCharOffset?: number | null;
};

export type BookTextSlice = {
  /** The plain text covering the requested page range. */
  text: string;
  /** The first page the slice actually covers (clamped to the page map). */
  fromEffectivePage: number;
  /** The last page the slice actually covers (clamped to the page map). */
  throughEffectivePage: number;
  hasRealPages: boolean;
  /** Whether the text was windowed to fit the model budget. */
  truncated: boolean;
  /** Whether "[p.N]" markers were actually emitted (see options.pageMarkers). */
  hasPageMarkers: boolean;
  /** Whether "## " chapter markers were emitted (see options.chapterMarkers). */
  hasChapterMarkers: boolean;
  /**
   * The heading lines in the slice, in reading order — exactly as they appear in
   * the marked-up text, so a chapter named here can be found there verbatim.
   * Empty when chapterMarkers is off, the text has no headings, or the slice was
   * windowed (an index that promises chapters the elision removed is worse than
   * none).
   */
  chapters: string[];
};

/**
 * Get the book's text for a page range, ready to hand to the quiz generator.
 * `fromPage` is the first covered page (null/<=1 → from the very beginning);
 * `throughPage` is the last. Returns null when the book has no ready content. The
 * caller is responsible for scoping: pass the resolved member `client` and
 * `userId` (see resolveReadingScope) — every query here filters by `userId`.
 */
export async function getTextForRange(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  fromPage: number | null,
  throughPage: number,
  options?: TextForRangeOptions
): Promise<BookTextSlice | null> {
  const budget = options?.maxChars ?? MAX_QUIZ_CONTEXT_CHARS;
  const { data: content } = await client
    .from("reading_book_content")
    .select("content_path, status, has_real_pages, page_count, char_count, source_format")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready" || !content.content_path) {
    return null;
  }

  // Articles short-circuit the whole page-range machinery below: they have no
  // reading_book_pages rows, so every one of those queries comes back empty and
  // falls through to "the whole thing" regardless. Branching here also keeps the
  // book path, and its exact char offsets, completely untouched.
  if (content.source_format === "article") {
    return getArticleText(client, content.content_path as string, budget);
  }

  const hasRealPages = content.has_real_pages as boolean;
  const charCount = (content.char_count as number | null) ?? null;
  const pageCount = (content.page_count as number | null) ?? null;

  // End of range: the highest mapped page at or below throughPage (also clamps a
  // too-large page to the last page). Falls back to the whole book when there's
  // no page map (e.g. an EPUB without source pagination).
  let charEnd: number | null = null;
  let throughEffectivePage = throughPage;
  const { data: endPage } = await client
    .from("reading_book_pages")
    .select("page_number, char_end")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .lte("page_number", throughPage)
    .order("page_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (endPage && endPage.char_end != null) {
    charEnd = endPage.char_end as number;
    throughEffectivePage = endPage.page_number as number;
  } else {
    // No page map to resolve throughPage against. Take the whole book, unless
    // the caller gave a char-space boundary (a spoiler-scoped reader chat on an
    // unchaptered synthetic-page EPUB, where pages don't exist to cut on).
    charEnd = charCount;
    if (options?.throughCharOffset != null) {
      charEnd =
        charEnd != null
          ? Math.min(charEnd, options.throughCharOffset)
          : options.throughCharOffset;
    }
    throughEffectivePage = pageCount ?? throughPage;
  }

  // Start of range: the first mapped page at or after fromPage (its char_start).
  // Null/<=1 fromPage, or no matching page, means start from the beginning.
  let charStart = 0;
  let fromEffectivePage = 1;
  if (fromPage != null && fromPage > 1) {
    const { data: startPage } = await client
      .from("reading_book_pages")
      .select("page_number, char_start")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .gte("page_number", fromPage)
      .order("page_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (startPage && startPage.char_start != null) {
      charStart = startPage.char_start as number;
      fromEffectivePage = startPage.page_number as number;
    }
  }

  // Guard against an inverted/empty range — fall back to "through" coverage.
  if (charEnd != null && charStart >= charEnd) {
    charStart = 0;
    fromEffectivePage = 1;
  }

  const download = await client.storage
    .from(READING_BOOKS_BUCKET)
    .download(content.content_path);
  if (download.error || !download.data) return null;

  const html = await download.data.text();
  const blocks = blockMap(html);
  const fullText = textFromBlocks(blocks);
  const effectiveEnd = charEnd ?? fullText.length;

  // What the model sees on top of the plain text. Both kinds are spliced in by
  // context-markup, never written into fullText, so the char offsets everything
  // else depends on stay exact.
  let marks: ContextMark[] = [];

  // Reader chat: label each page so the model can cite "[p.212]" and the client
  // can turn that into a jump.
  let hasPageMarkers = false;
  if (options?.pageMarkers) {
    const { data: pageRows } = await client
      .from("reading_book_pages")
      .select("page_number, char_start, char_end")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .gt("char_end", charStart)
      .lt("char_start", effectiveEnd)
      .order("page_number", { ascending: true });

    marks = pageMarks((pageRows ?? []) as PageRange[], charStart, effectiveEnd);
    hasPageMarkers = marks.length > 0;
  }

  // Reader chat: make chapter starts visible, and index them.
  let chapters: string[] = [];
  if (options?.chapterMarkers) {
    const found = chapterMarks(blocks, charStart, effectiveEnd);
    marks = marks.concat(found.marks);
    chapters = found.titles;
  }

  const { text, truncated } = fitToBudget(
    spliceMarks(fullText, charStart, effectiveEnd, marks),
    budget
  );

  return {
    text,
    fromEffectivePage,
    throughEffectivePage,
    hasRealPages,
    truncated,
    hasPageMarkers,
    hasChapterMarkers: chapters.length > 0,
    // A windowed slice has had its middle elided, so the index would name
    // chapters that are no longer in the text.
    chapters: truncated || chapters.length > MAX_CHAPTER_INDEX_ENTRIES ? [] : chapters,
  };
}
