"use server";

import { resolveReadingScope } from "@/lib/reading/scope";

/**
 * The reader's notepad for a book.
 *
 * Scoping note that applies to every query here, as it does in
 * annotation-actions.ts — resolveReadingScope hands back a service-role client
 * in member mode, which bypasses RLS. Each read filters by the resolved userId
 * and each write sets it. Dropping one is a cross-member leak, not a bug you
 * would notice locally.
 */

export type BookNote = {
  /** Markdown, with places inline — see notes.ts. Empty when nothing's written. */
  markdown: string;
  /** Null until the row exists. */
  updatedAt: string | null;
};

/**
 * The note as it stands, or an empty one when it hasn't been started.
 *
 * Read on the reader's first render rather than when the notepad opens, so the
 * Contents can say whether there is anything here before anyone has asked to
 * see it. Null is never returned: an unstarted note is an empty note, and the
 * caller has one fewer state to draw.
 */
export async function getBookNote(
  bookId: string,
  memberEmail?: string | null
): Promise<BookNote> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data, error } = await client
    .from("reading_notes")
    .select("content, updated_at")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { markdown: "", updatedAt: null };

  return {
    markdown: (data.content as string) ?? "",
    updatedAt: (data.updated_at as string) ?? null,
  };
}

/**
 * Write the whole note.
 *
 * The whole document every time rather than a patch, because the editor holds
 * the whole document and the row is one column: a save is "here is the note
 * now", debounced by the client. Upsert on the unique (book, reader) index, so
 * the first save creates the row and every later one replaces it, and two
 * devices saving at once come down to whichever wrote last — which for a
 * private notepad is the honest answer.
 */
export async function saveBookNote(input: {
  bookId: string;
  markdown: string;
  memberEmail?: string | null;
}): Promise<{ updatedAt: string }> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: book } = await client
    .from("reading_books")
    .select("id")
    .eq("id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) throw new Error("Book not found.");

  const { data, error } = await client
    .from("reading_notes")
    .upsert(
      {
        book_id: input.bookId,
        user_id: userId,
        content: input.markdown,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "book_id,user_id" }
    )
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);

  return { updatedAt: data.updated_at as string };
}
