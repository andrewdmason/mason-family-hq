"use server";

import { resolveReadingScope } from "@/lib/reading/scope";
import { appendClipMarkdown, type NotePlace } from "@/lib/reading/notes";
import { appendBlock, normalizeDoc, quoteBlock, treeToMarkdown, type NoteDoc } from "@/lib/reading/note-tree";

/**
 * The reader's notepad for a book.
 *
 * Scoping note that applies to every query here, as it does in
 * annotation-actions.ts — resolveReadingScope hands back a service-role client
 * in member mode, which bypasses RLS. Each read filters by the resolved userId
 * and each write sets it. Dropping one is a cross-member leak, not a bug you
 * would notice locally.
 *
 * Two columns, one truth. `doc` is the note as a tree (note-tree.ts) and is
 * the truth when present; `content` is markdown derived from it on every
 * save, for everything that reads the note as text. A row with `doc` null
 * predates the outline: its markdown is the truth until the notepad is next
 * opened, which parses it and writes both.
 */

export type BookNote = {
  /** Markdown, with places inline — see notes.ts. Empty when nothing's written. */
  markdown: string;
  /** The tree, or null for a row written before the outline (markdown is the truth). */
  doc: NoteDoc | null;
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
    .select("content, doc, updated_at")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { markdown: "", doc: null, updatedAt: null };

  return {
    markdown: (data.content as string) ?? "",
    doc: data.doc ? normalizeDoc(data.doc) : null,
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
  doc: NoteDoc;
  memberEmail?: string | null;
}): Promise<{ updatedAt: string }> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);
  await assertOwnBook(client, userId, input.bookId);

  const { data, error } = await client
    .from("reading_notes")
    .upsert(
      {
        book_id: input.bookId,
        user_id: userId,
        content: input.markdown,
        doc: input.doc,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "book_id,user_id" }
    )
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);

  return { updatedAt: data.updated_at as string };
}

/**
 * A passage landing in the note while the notepad isn't open to take it — a
 * highlight made on a phone with the sheet shut.
 *
 * Reads the row rather than trusting the caller's copy: the sheet is closed,
 * and another device may have saved since it was last open. With a tree, the
 * passage goes on the end as a block of its own; on a row that still has only
 * markdown, it goes on the end of that, in the same shape, and the row stays
 * markdown-only until the notepad next opens it. Returns the note as it now
 * stands, for the caller to hold.
 */
export async function appendBookNoteClip(input: {
  bookId: string;
  quote: string;
  place: NotePlace;
  memberEmail?: string | null;
}): Promise<BookNote> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);
  await assertOwnBook(client, userId, input.bookId);

  const { data: row, error: readError } = await client
    .from("reading_notes")
    .select("content, doc")
    .eq("book_id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  let doc: NoteDoc | null = null;
  let markdown: string;
  if (row?.doc) {
    doc = appendBlock(normalizeDoc(row.doc), quoteBlock(input.quote, input.place, new Date().toISOString()));
    markdown = treeToMarkdown(doc);
  } else {
    markdown = appendClipMarkdown((row?.content as string) ?? "", input.quote, input.place);
  }

  const { data, error } = await client
    .from("reading_notes")
    .upsert(
      {
        book_id: input.bookId,
        user_id: userId,
        content: markdown,
        doc,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "book_id,user_id" }
    )
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);

  return { markdown, doc, updatedAt: data.updated_at as string };
}

async function assertOwnBook(
  client: Awaited<ReturnType<typeof resolveReadingScope>>["client"],
  userId: string,
  bookId: string
) {
  const { data: book } = await client
    .from("reading_books")
    .select("id")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) throw new Error("Book not found.");
}
