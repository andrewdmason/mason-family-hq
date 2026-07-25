import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { stripHtmlToText } from "@/lib/reading/block-stream";

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

export { stripHtmlToText };

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

export type TextForRangeOptions = {
  /**
   * Interleave "[p.N]" markers at page boundaries so a model can cite pages
   * (reader chat). Markers are added while BUILDING the output, never spliced
   * into the counted stream, so the canonical char space is untouched.
   * Silently a no-op for books with no page map.
   */
  pageMarkers?: boolean;
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
    .select("content_path, status, has_real_pages, page_count, char_count")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready" || !content.content_path) {
    return null;
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
  const fullText = stripHtmlToText(html);
  const effectiveEnd = charEnd ?? fullText.length;

  let sliced = fullText.slice(charStart, effectiveEnd);
  let hasPageMarkers = false;

  // Reader chat: label each page so the model can cite "[p.212]" and the client
  // can turn that into a jump. Assembled here rather than by mutating fullText,
  // so the char offsets everything else depends on stay exact.
  if (options?.pageMarkers) {
    const { data: pageRows } = await client
      .from("reading_book_pages")
      .select("page_number, char_start, char_end")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .gt("char_end", charStart)
      .lt("char_start", effectiveEnd)
      .order("page_number", { ascending: true });

    if (pageRows && pageRows.length > 0) {
      const parts: string[] = [];
      let cursor = charStart;
      for (const row of pageRows) {
        const start = Math.max(row.char_start as number, charStart);
        const end = Math.min(row.char_end as number, effectiveEnd);
        if (end <= start) continue;
        // Anything ahead of the first page mark (front matter) stays unlabelled
        // rather than being attributed to the page that follows it.
        if (start > cursor) parts.push(fullText.slice(cursor, start));
        parts.push(`\n[p.${row.page_number}]\n`);
        parts.push(fullText.slice(start, end));
        cursor = end;
      }
      if (cursor < effectiveEnd) parts.push(fullText.slice(cursor, effectiveEnd));
      sliced = parts.join("");
      hasPageMarkers = true;
    }
  }

  const { text, truncated } = fitToBudget(sliced, budget);

  return {
    text,
    fromEffectivePage,
    throughEffectivePage,
    hasRealPages,
    truncated,
    hasPageMarkers,
  };
}
