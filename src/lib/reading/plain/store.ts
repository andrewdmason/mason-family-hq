import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockMap, type BookBlock } from "@/lib/reading/block-stream";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import type { ReadingTocEntry } from "@/lib/types";
import { termKey, type ValidatedEntry, type ValidatedTerm } from "./validate";

/**
 * Reading and writing the translation tables.
 *
 * Every write here runs on the admin client: the plain tables have no client
 * write policy, because generation is a privileged act that the caller has
 * already been checked for (they own a copy of this conversion). Every function
 * is keyed by content hash, never by book — see the migration for why.
 */

export type HashedBook = {
  hash: string;
  blocks: BookBlock[];
  toc: ReadingTocEntry[];
  title: string;
  author: string | null;
};

/**
 * The block map for a conversion, found through ANY copy that carries the hash.
 *
 * The cron sweep has no reader in front of it, so it cannot ask "whose book";
 * it needs the original paragraphs to validate a batch result, and any copy
 * with this hash has byte-identical ones.
 */
export async function loadBookForHash(
  admin: SupabaseClient,
  hash: string
): Promise<HashedBook | null> {
  const { data: content } = await admin
    .from("reading_book_content")
    .select("book_id, user_id, content_path, toc")
    .eq("content_hash", hash)
    .eq("status", "ready")
    .not("content_path", "is", null)
    .limit(1)
    .maybeSingle();
  if (!content) return null;

  const { data: book } = await admin
    .from("reading_books")
    .select("title, author")
    .eq("id", content.book_id as string)
    .eq("user_id", content.user_id as string)
    .maybeSingle();

  const download = await admin.storage
    .from(READING_BOOKS_BUCKET)
    .download(content.content_path as string);
  if (download.error || !download.data) return null;

  return {
    hash,
    blocks: blockMap(await download.data.text()),
    toc: (content.toc as ReadingTocEntry[] | null) ?? [],
    title: (book?.title as string | undefined) ?? "Untitled",
    author: (book?.author as string | null | undefined) ?? null,
  };
}

/** The indices already translated (or kept) inside a block range. */
export async function storedBlockIndices(
  admin: SupabaseClient,
  hash: string,
  from: number,
  to: number
): Promise<Set<number>> {
  const { data, error } = await admin
    .from("reading_plain_blocks")
    .select("block_index")
    .eq("content_hash", hash)
    .gte("block_index", from)
    .lt("block_index", to);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { block_index: number }[]).map((r) => r.block_index));
}

/** Write one validated chunk's paragraphs. Upsert, so a rerun never duplicates. */
export async function storeEntries(
  admin: SupabaseClient,
  hash: string,
  chapterIndex: number,
  entries: ValidatedEntry[],
  model: string
): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    content_hash: hash,
    block_index: e.blockIndex,
    chapter_index: chapterIndex,
    kept: e.kept,
    text: e.text,
    model,
  }));
  const { error } = await admin
    .from("reading_plain_blocks")
    .upsert(rows, { onConflict: "content_hash,block_index" });
  if (error) throw new Error(error.message);
}

/**
 * Merge a chunk's terms into the book's glossary.
 *
 * A term keeps the EARLIEST chapter it was seen in, and when a lower chapter
 * arrives later (chapters translate out of order — the reader's current one
 * first) the definition is replaced along with the index, so the stored gloss
 * is always the one written with the least of the book in view.
 */
export async function storeTerms(
  admin: SupabaseClient,
  hash: string,
  chapterIndex: number,
  terms: ValidatedTerm[]
): Promise<void> {
  if (terms.length === 0) return;
  const keys = terms.map((t) => termKey(t.term));
  const { data: existingRows, error } = await admin
    .from("reading_plain_terms")
    .select("term_key, first_chapter_index")
    .eq("content_hash", hash)
    .in("term_key", keys);
  if (error) throw new Error(error.message);
  const existing = new Map(
    ((existingRows ?? []) as { term_key: string; first_chapter_index: number }[]).map((r) => [
      r.term_key,
      r.first_chapter_index,
    ])
  );

  const inserts: Record<string, unknown>[] = [];
  const updates: { key: string; term: string; definition: string }[] = [];
  for (const t of terms) {
    const key = termKey(t.term);
    const seenAt = existing.get(key);
    if (seenAt === undefined) {
      inserts.push({
        content_hash: hash,
        term_key: key,
        term: t.term,
        definition: t.definition,
        first_chapter_index: chapterIndex,
      });
    } else if (chapterIndex < seenAt) {
      updates.push({ key, term: t.term, definition: t.definition });
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await admin
      .from("reading_plain_terms")
      .upsert(inserts, { onConflict: "content_hash,term_key", ignoreDuplicates: true });
    if (insertError) throw new Error(insertError.message);
  }
  for (const u of updates) {
    await admin
      .from("reading_plain_terms")
      .update({ term: u.term, definition: u.definition, first_chapter_index: chapterIndex })
      .eq("content_hash", hash)
      .eq("term_key", u.key)
      .gt("first_chapter_index", chapterIndex);
  }
}
