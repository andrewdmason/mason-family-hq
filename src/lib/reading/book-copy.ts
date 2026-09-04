import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";

/**
 * Putting a book on somebody else's shelf so a shared mark has somewhere to land.
 *
 * The reason this copies the converted FILE rather than telling them to go and
 * find the book is the whole reason sharing works at all. A mark's position is
 * an offset into one particular conversion of one particular set of bytes. Two
 * people who bought the same title in different places do not share that space
 * — their paragraphs break in different places and their character counts drift
 * — so an anchor moved between them lands in the wrong sentence, or in nothing.
 * Copy the artifact and the offsets are not merely close, they are identical.
 *
 * And the conversion is NEVER re-run. It would cost five minutes of compute to
 * reproduce a file we already have, and any drift at all in the PDF path would
 * silently break every mark that had been shared out of that book.
 */

export type CopyOutcome = {
  bookId: string;
  /**
   * Whether the two copies share a character space. "identical" means an anchor
   * transfers verbatim; "different" means it has to be found again by its words.
   */
  charSpace: "identical" | "different";
};

/** sha256 of the converted html — see migration 00182 for why that file. */
export async function contentHashFor(
  client: SupabaseClient,
  contentPath: string
): Promise<string | null> {
  const { data } = await client.storage
    .from(READING_BOOKS_BUCKET)
    .download(contentPath);
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * The hash, computed and remembered the first time anyone asks.
 *
 * Older books predate the column, and backfilling every one of them would mean
 * downloading a library's worth of HTML to answer a question nobody had asked
 * yet. This answers it when it is asked and writes the answer down.
 */
export async function hashOf(
  client: SupabaseClient,
  bookId: string,
  userId: string
): Promise<string | null> {
  const { data } = await client
    .from("reading_book_content")
    .select("content_path, content_hash")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { content_path: string | null; content_hash: string | null };
  if (row.content_hash) return row.content_hash;
  if (!row.content_path) return null;

  const hash = await contentHashFor(client, row.content_path);
  if (hash) {
    await client
      .from("reading_book_content")
      .update({ content_hash: hash })
      .eq("book_id", bookId)
      .eq("user_id", userId);
  }
  return hash;
}

/** Fold away the differences between two people's idea of the same title. */
function normalizeTitle(s: string | null): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Make sure `recipientId` has this book, and say whether their copy's character
 * space is the sender's.
 *
 * Every write here is on a client that can act across members, after the caller
 * has been verified — the same shape as recommending a book onto somebody's
 * shelf, which already writes a row into another member's library.
 */
export async function ensureBookCopy(
  admin: SupabaseClient,
  input: { sourceBookId: string; ownerId: string; recipientId: string }
): Promise<CopyOutcome | null> {
  const { data: srcBook } = await admin
    .from("reading_books")
    .select("*")
    .eq("id", input.sourceBookId)
    .eq("user_id", input.ownerId)
    .maybeSingle();
  if (!srcBook) return null;
  const src = srcBook as Record<string, unknown>;

  // 1. Already a copy of this exact book. The strongest answer available and the
  //    only one that needs no further thought.
  const { data: existingCopy } = await admin
    .from("reading_books")
    .select("id")
    .eq("user_id", input.recipientId)
    .eq("copied_from_book_id", input.sourceBookId)
    .maybeSingle();
  if (existingCopy) {
    return { bookId: (existingCopy as { id: string }).id, charSpace: "identical" };
  }

  // 2. An article they already saved from the same URL. Same title, different
  //    capture — the words are usually the same and the offsets never are.
  const sourceUrl = (src.source_url as string | null) ?? null;
  if (src.type === "article" && sourceUrl) {
    const { data: sameUrl } = await admin
      .from("reading_books")
      .select("id")
      .eq("user_id", input.recipientId)
      .eq("source_url", sourceUrl)
      .maybeSingle();
    if (sameUrl) {
      return { bookId: (sameUrl as { id: string }).id, charSpace: "different" };
    }
  }

  // 3. A book of theirs whose CONVERSION is byte-identical to this one. Rare but
  //    free to check, and when it hits the anchor transfers untouched.
  const srcHash = await hashOf(admin, input.sourceBookId, input.ownerId);
  if (srcHash) {
    const { data: theirs } = await admin
      .from("reading_book_content")
      .select("book_id")
      .eq("user_id", input.recipientId)
      .eq("content_hash", srcHash)
      .maybeSingle();
    if (theirs) {
      return { bookId: (theirs as { book_id: string }).book_id, charSpace: "identical" };
    }
  }

  // 4. The same title, from a different file. Their copy is the one they are
  //    actually reading, so it wins — the mark gets found again by its words
  //    rather than a second copy of the book appearing on their shelf.
  const isbn = (src.isbn as string | null) ?? null;
  const { data: candidates } = await admin
    .from("reading_books")
    .select("id, title, author, isbn")
    .eq("user_id", input.recipientId);

  const theirBooks = (candidates ?? []) as {
    id: string;
    title: string | null;
    author: string | null;
    isbn: string | null;
  }[];

  const byIsbn = isbn ? theirBooks.find((b) => b.isbn && b.isbn === isbn) : null;
  if (byIsbn) return { bookId: byIsbn.id, charSpace: "different" };

  const wantTitle = normalizeTitle(src.title as string | null);
  const wantAuthor = normalizeTitle(src.author as string | null);
  const byTitle = wantTitle
    ? theirBooks.find(
        (b) =>
          normalizeTitle(b.title) === wantTitle &&
          (!wantAuthor || normalizeTitle(b.author) === wantAuthor)
      )
    : null;
  if (byTitle) return { bookId: byTitle.id, charSpace: "different" };

  // 5. They don't have it. Copy it.
  return copyBook(admin, { src, input, srcHash });
}

async function copyBook(
  admin: SupabaseClient,
  args: {
    src: Record<string, unknown>;
    input: { sourceBookId: string; ownerId: string; recipientId: string };
    srcHash: string | null;
  }
): Promise<CopyOutcome | null> {
  const { src, input } = args;

  const { data: srcContent } = await admin
    .from("reading_book_content")
    .select("*")
    .eq("book_id", input.sourceBookId)
    .eq("user_id", input.ownerId)
    .maybeSingle();
  if (!srcContent) return null;
  const content = srcContent as Record<string, unknown>;
  if (content.status !== "ready" || !content.content_path) return null;

  // Claim the shelf slot BEFORE doing any work. A concurrent second attempt
  // loses on the unique index, and losing is the signal to wait for the winner
  // rather than to start a parallel copy.
  const { data: inserted, error: insertErr } = await admin
    .from("reading_books")
    .insert({
      user_id: input.recipientId,
      copied_from_book_id: input.sourceBookId,
      title: src.title,
      author: src.author,
      total_pages: src.total_pages,
      cover_image_url: src.cover_image_url,
      isbn: src.isbn,
      openlibrary_key: src.openlibrary_key,
      published_year: src.published_year,
      genres: src.genres,
      fiction: src.fiction,
      genre: src.genre,
      genre_source: src.genre_source,
      type: src.type,
      source_url: src.source_url,
      site_name: src.site_name,
      excerpt: src.excerpt,
      word_count: src.word_count,
      spoiler_free: src.spoiler_free,
      // Their copy, their reading. Nothing about how far the sender got, what
      // they thought of it, or when they finished comes along — and it lands as
      // in-progress rather than queued because being shown a passage from a book
      // is being handed the book, not being told about it.
      status: "in_progress",
      current_page: 0,
      started_at: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      const { data: winner } = await admin
        .from("reading_books")
        .select("id")
        .eq("user_id", input.recipientId)
        .eq("copied_from_book_id", input.sourceBookId)
        .maybeSingle();
      return winner
        ? { bookId: (winner as { id: string }).id, charSpace: "identical" }
        : null;
    }
    throw new Error(insertErr.message);
  }

  const bookId = (inserted as { id: string }).id;

  const storage = admin.storage.from(READING_BOOKS_BUCKET);
  const srcContentPath = content.content_path as string;
  const srcSourcePath = content.source_path as string;
  const dstContentPath = `${input.recipientId}/${bookId}/content.html`;
  const dstSourcePath = `${input.recipientId}/${bookId}/source.${
    srcSourcePath.split(".").pop() ?? "bin"
  }`;

  // Both paths are written up front — source_path is NOT NULL — and the row
  // stays 'processing' until the page map is in, so nothing can open a
  // half-copied book. The reader already refuses anything not 'ready'.
  const { error: contentErr } = await admin
    .from("reading_book_content")
    .insert({
      book_id: bookId,
      user_id: input.recipientId,
      status: "processing",
      source_format: content.source_format,
      source_path: dstSourcePath,
      content_path: dstContentPath,
      page_count: content.page_count,
      has_real_pages: content.has_real_pages,
      char_count: content.char_count,
      word_count: content.word_count,
      toc: content.toc,
      content_hash: args.srcHash,
    });
  if (contentErr) throw new Error(contentErr.message);

  // Server-side copy — no download and re-upload, and no chance of the bytes
  // changing in transit, which is the one thing that would break every anchor.
  const copied = await storage.copy(srcContentPath, dstContentPath);
  if (copied.error) throw new Error(copied.error.message);

  // Best effort. Losing the original costs the ability to re-convert later;
  // losing the conversion would cost the ability to read at all, and that one
  // is not allowed to fail.
  await storage.copy(srcSourcePath, dstSourcePath);

  const { data: pages } = await admin
    .from("reading_book_pages")
    .select("page_number, anchor_id, char_start, char_end")
    .eq("book_id", input.sourceBookId)
    .eq("user_id", input.ownerId)
    .order("page_number", { ascending: true });

  const pageRows = ((pages ?? []) as {
    page_number: number;
    anchor_id: string;
    char_start: number;
    char_end: number;
  }[]).map((p) => ({ ...p, book_id: bookId, user_id: input.recipientId }));

  for (let i = 0; i < pageRows.length; i += 500) {
    const { error } = await admin
      .from("reading_book_pages")
      .insert(pageRows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  await admin
    .from("reading_book_content")
    .update({ status: "ready" })
    .eq("book_id", bookId)
    .eq("user_id", input.recipientId);

  return { bookId, charSpace: "identical" };
}
