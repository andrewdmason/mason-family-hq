import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where the reader has actually got to in a book.
 *
 * A spoiler-scoped chat never needs this: its context is cut at the boundary, so
 * "the end of the text" and "where the reader is" are the same place and the
 * model cannot mistake one for the other. An unscoped chat is handed the whole
 * book, and with nothing else to go on the model reads the last page it was
 * given as the reader's position — which is how a reader 80% through gets told
 * they have finished, and gets the ending explained to them unasked.
 */

export type ReaderPosition = {
  /** Character offset into the book text. */
  charOffset: number;
  /** The page containing it, or null when the book has no page map. */
  page: number | null;
  /** How far through, 0–100, or null when the book's length is unknown. */
  percent: number | null;
};

/**
 * Resolve a character offset to the page containing it: the highest page whose
 * char_start is at or before the offset. Null when the book has no page map.
 *
 * Server-side on purpose — the client knows its block index but must never get
 * to choose its own spoiler boundary.
 */
export async function pageForCharOffset(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  charOffset: number
): Promise<number | null> {
  const { data } = await client
    .from("reading_book_pages")
    .select("page_number")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .lte("char_start", charOffset)
    .order("page_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.page_number as number | undefined) ?? null;
}

/**
 * The reader's furthest known point in a book, as a page and a percentage.
 *
 * Takes the later of their saved reading position and `atLeastCharOffset` — the
 * chat's own anchor. Neither alone is right: the saved position goes stale while
 * a chat is open and can sit behind the anchor if they scrolled back, and the
 * anchor can sit far behind the position, as it does when someone 80% through
 * asks for a recap of chapter five. Whichever is further is the point past which
 * they have not read.
 *
 * Callers pass the scoped client and userId (see resolveReadingScope); both
 * queries filter by userId.
 */
export async function resolveReaderPosition(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  atLeastCharOffset: number
): Promise<ReaderPosition> {
  const [{ data: state }, { data: content }] = await Promise.all([
    client
      .from("reading_book_state")
      .select("last_char_offset")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("reading_book_content")
      .select("char_count")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const saved = (state?.last_char_offset as number | null) ?? 0;
  const charCount = (content?.char_count as number | null) ?? null;
  let charOffset = Math.max(saved, atLeastCharOffset, 0);
  if (charCount != null && charCount > 0) {
    charOffset = Math.min(charOffset, charCount);
  }

  const percent =
    charCount != null && charCount > 0
      ? Math.round((charOffset / charCount) * 100)
      : null;

  return {
    charOffset,
    page: await pageForCharOffset(client, userId, bookId, charOffset),
    percent,
  };
}
