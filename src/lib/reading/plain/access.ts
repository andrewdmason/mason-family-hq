import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { blockMap } from "@/lib/reading/block-stream";
import { hashOf } from "@/lib/reading/book-copy";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { resolveReadingScope } from "@/lib/reading/scope";
import type { ReadingTocEntry } from "@/lib/types";
import type { HashedBook } from "./store";

/**
 * Who may ask for a translation, and of what.
 *
 * Every Plain English route resolves the book through the CALLER's own row on
 * the RLS-scoped client — never from a hash in the request — and only then
 * reaches for the admin client to read or write the shared tables. That is the
 * whole access rule: you can generate or read a translation for a conversion
 * you hold a copy of, and for nothing else. Kids included; this is a
 * comprehension feature, not a listening one.
 */

export class PlainAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 404 | 400
  ) {
    super(message);
    this.name = "PlainAccessError";
  }
}

export type PlainBookAccess = {
  userId: string;
  bookId: string;
  hash: string;
  title: string;
  author: string | null;
  fiction: boolean | null;
  toc: ReadingTocEntry[];
  contentPath: string;
  charCount: number | null;
  /** RLS client for the caller's own rows. */
  scoped: SupabaseClient;
  /** Service-role client for the shared plain tables. */
  admin: SupabaseClient;
};

/** Resolve the caller and one of their books, or throw a PlainAccessError. */
export async function resolvePlainBook(bookId: string): Promise<PlainBookAccess> {
  let scope;
  try {
    scope = await resolveReadingScope(null);
  } catch (err) {
    throw new PlainAccessError(
      err instanceof Error ? err.message : "Not authorized.",
      401
    );
  }
  const { client, userId } = scope;

  const { data: book } = await client
    .from("reading_books")
    .select("id, title, author, type, fiction")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book || book.type === "article") {
    throw new PlainAccessError("That book isn't on your shelf.", 404);
  }

  const { data: content } = await client
    .from("reading_book_content")
    .select("content_path, status, toc, source_format, char_count")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    !content ||
    content.status !== "ready" ||
    !content.content_path ||
    content.source_format === "article"
  ) {
    throw new PlainAccessError("This book isn't ready to be read yet.", 404);
  }

  const hash = await hashOf(client, bookId, userId);
  if (!hash) throw new PlainAccessError("Couldn't identify this book's text.", 404);

  return {
    userId,
    bookId,
    hash,
    title: book.title as string,
    author: (book.author as string | null) ?? null,
    fiction: (book.fiction as boolean | null) ?? null,
    toc: (content.toc as ReadingTocEntry[] | null) ?? [],
    contentPath: content.content_path as string,
    charCount: (content.char_count as number | null) ?? null,
    scoped: client,
    admin: createAdminClient(),
  };
}

/** Download and parse the caller's copy — the same bytes as any sibling copy. */
export async function loadHashedBook(access: PlainBookAccess): Promise<HashedBook> {
  const download = await access.scoped.storage
    .from(READING_BOOKS_BUCKET)
    .download(access.contentPath);
  if (download.error || !download.data) throw new Error("Couldn't open this book.");
  return {
    hash: access.hash,
    blocks: blockMap(await download.data.text()),
    toc: access.toc,
    title: access.title,
    author: access.author,
  };
}
