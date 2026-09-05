"use server";

import { resolveReadingScope } from "@/lib/reading/scope";
import { pageForCharOffset } from "@/lib/reading/reader-position";
import type { ReaderBookmark } from "@/lib/reading/bookmarks";

/**
 * Bookmarks: saving a place in a book, and getting back to it.
 *
 * Scoping note that applies to every query here, as it does in
 * annotation-actions.ts — resolveReadingScope hands back a service-role client
 * in member mode, which bypasses RLS. Each read filters by the resolved userId
 * and each write sets it. Dropping one is a cross-member leak, not a bug you
 * would notice locally.
 */

const BOOKMARK_COLUMNS =
  "id, char_offset, block_index, page_number, excerpt, name, created_at";

type BookmarkRow = {
  id: string;
  char_offset: number;
  block_index: number;
  page_number: number | null;
  excerpt: string | null;
  name: string | null;
  created_at: string;
};

function toBookmark(row: BookmarkRow): ReaderBookmark {
  return {
    id: row.id,
    charOffset: row.char_offset,
    blockIndex: row.block_index,
    page: row.page_number,
    excerpt: row.excerpt,
    name: row.name,
    createdAt: row.created_at,
  };
}

/**
 * Every bookmark in this book, in reading order.
 *
 * Reading order rather than newest-first because the list sits inside the
 * contents, and a list of places should run the way the book does — the same
 * reason the chapters above it aren't sorted by when you visited them.
 */
export async function listBookmarks(
  bookId: string,
  memberEmail?: string | null
): Promise<ReaderBookmark[]> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data, error } = await client
    .from("reading_bookmarks")
    .select(BOOKMARK_COLUMNS)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .order("char_offset", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as BookmarkRow[]).map(toBookmark);
}

/**
 * Save a place.
 *
 * The offset is clamped and the page resolved here rather than trusted from the
 * client, exactly as a mark's anchor is: a bookmark that claims to be at
 * character nine million would be unreachable and would sort the list wrong.
 *
 * Bookmarking a spot that already has one returns the existing row rather than
 * failing on the unique index. The ribbon already renders solid there so this
 * shouldn't be reachable from the UI — but "the same place" being "the same
 * bookmark" is a property worth having regardless of which caller asks.
 */
export async function createBookmark(input: {
  bookId: string;
  charOffset: number;
  blockIndex: number;
  excerpt?: string | null;
  name?: string | null;
  memberEmail?: string | null;
}): Promise<ReaderBookmark> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: book } = await client
    .from("reading_books")
    .select("id, type")
    .eq("id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) throw new Error("Book not found.");
  // Articles have no page map, no chapters and nowhere to list these — see the
  // reader, which doesn't offer the control. This is the guard that matters.
  if (book.type === "article") throw new Error("Articles can't be bookmarked.");

  const { data: content } = await client
    .from("reading_book_content")
    .select("char_count, status")
    .eq("book_id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready") {
    throw new Error("This book isn't ready to read yet.");
  }

  const charCount = (content.char_count as number | null) ?? 0;
  const charOffset = Math.max(
    0,
    Math.min(Math.round(input.charOffset), Math.max(charCount, 0))
  );

  const existing = await client
    .from("reading_bookmarks")
    .select(BOOKMARK_COLUMNS)
    .eq("book_id", input.bookId)
    .eq("user_id", userId)
    .eq("char_offset", charOffset)
    .maybeSingle();
  if (existing.data) return toBookmark(existing.data as BookmarkRow);

  const page = await pageForCharOffset(client, userId, input.bookId, charOffset);

  const { data, error } = await client
    .from("reading_bookmarks")
    .insert({
      book_id: input.bookId,
      user_id: userId,
      char_offset: charOffset,
      block_index: Math.max(0, Math.round(input.blockIndex)),
      page_number: page,
      excerpt: input.excerpt?.trim() || null,
      name: input.name?.trim() || null,
    })
    .select(BOOKMARK_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  return toBookmark(data as BookmarkRow);
}

/** Give it a name, or take one away — an empty name is a legitimate state. */
export async function renameBookmark(
  bookmarkId: string,
  name: string | null,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { error } = await client
    .from("reading_bookmarks")
    .update({ name: name?.trim() || null })
    .eq("id", bookmarkId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Remove one.
 *
 * A real delete rather than a soft one: undo is held by the client, which still
 * has the row in hand and re-creates it. That keeps the table with one fewer
 * state in it, and puts the only thing that has to be right — how long the offer
 * to undo lasts — in the one place that can see it.
 */
export async function deleteBookmark(
  bookmarkId: string,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { error } = await client
    .from("reading_bookmarks")
    .delete()
    .eq("id", bookmarkId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
