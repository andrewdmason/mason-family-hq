import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";

/**
 * Pulling plain text back out of a converted book so a quiz can be scoped to
 * "through page N". The conversion (see convert.ts buildPagedHtml) records each
 * page's character range against a stream of BLOCK texts, where every block
 * (a <p> or <h1..h6>) contributes `block.text.length + 1` — one separator char —
 * and page anchors (empty <span>) contribute nothing. To make `char_end` line up,
 * we must rebuild that exact stream: take each block's text in document order,
 * decode the entities escapeHtml added, and follow each block with one separator.
 * A naive tag-strip would NOT line up (entities + separator spacing differ).
 */

/** Largest text we feed the quiz model (~15k tokens). Longer ranges get windowed. */
const MAX_QUIZ_CONTEXT_CHARS = 60_000;

/** Inverse of convert.ts escapeHtml — undone in reverse order to be exact. */
function decodeEntities(text: string): string {
  return text
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * Rebuild the block-text stream from converted content HTML. Each <p>/<h1..h6>
 * block becomes its (entity-decoded) text followed by a single "\n", matching the
 * `+ 1` the converter added per block. Empty page-anchor spans are skipped.
 */
export function stripHtmlToText(html: string): string {
  const blockRe = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let out = "";
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    // Strip any inline tags (there shouldn't be any inside a block, but be safe),
    // then decode entities to recover the raw text the converter counted.
    const inner = match[2].replace(/<[^>]+>/g, "");
    out += decodeEntities(inner) + "\n";
  }
  return out;
}

/**
 * Trim text to the model budget while preserving cumulative coverage: keep the
 * opening (early grounding) and the most recent material (what the quiz leans on)
 * with an elision marker between. Short text passes through untouched.
 */
function fitToBudget(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_QUIZ_CONTEXT_CHARS) return { text, truncated: false };
  const headChars = Math.floor(MAX_QUIZ_CONTEXT_CHARS * 0.2);
  const tailChars = MAX_QUIZ_CONTEXT_CHARS - headChars;
  const head = text.slice(0, headChars);
  const tail = text.slice(text.length - tailChars);
  return {
    text: `${head}\n\n[…earlier pages omitted for length…]\n\n${tail}`,
    truncated: true,
  };
}

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
  throughPage: number
): Promise<BookTextSlice | null> {
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
    charEnd = charCount;
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
  const sliced =
    charEnd != null ? fullText.slice(charStart, charEnd) : fullText.slice(charStart);
  const { text, truncated } = fitToBudget(sliced);

  return { text, fromEffectivePage, throughEffectivePage, hasRealPages, truncated };
}
