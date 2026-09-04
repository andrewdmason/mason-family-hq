import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookBlock } from "@/lib/reading/block-stream";
import { planChapters } from "@/lib/reading/audio/chapters";
import { totalCharsOf } from "@/lib/reading/reading-progress";
import type { ReadingTocEntry } from "@/lib/types";
import type { PlainBlock, PlainChapter, PlainChapterStatus, PlainPlan, PlainTerm } from "./types";

/**
 * The chapter list for a conversion, derived once and then read back.
 *
 * Derivation is a WRITE, exactly as the audiobook plan is: the reader, the
 * translator and the batch reconciler all have to agree on what "chapter 4"
 * means, and two derivations that disagreed by one paragraph would store a
 * translation against the wrong range. The audio planner is reused wholesale
 * (front matter folded in, short entries merged, long ones split) so a chapter
 * here is the same chapter Listen shows.
 *
 * Keyed by content hash. There is no content_version to go stale: a
 * re-conversion changes the hash, and the old rows simply stop being anyone's.
 */

type ChapterRow = {
  chapter_index: number;
  title: string;
  anchor_id: string | null;
  block_start: number;
  block_end: number;
  char_start: number;
  char_end: number;
  status: PlainChapterStatus;
  error_message: string | null;
};

const CHAPTER_COLUMNS =
  "chapter_index, title, anchor_id, block_start, block_end, char_start, char_end, status, error_message";

function toChapter(row: ChapterRow): PlainChapter {
  return {
    index: row.chapter_index,
    title: row.title,
    anchorId: row.anchor_id,
    blockStart: row.block_start,
    blockEnd: row.block_end,
    charStart: row.char_start,
    charEnd: row.char_end,
    status: row.status,
    error: row.error_message,
  };
}

/** Index of the first block whose charStart is at or after `charOffset`. */
function blockAtOrAfter(blocks: BookBlock[], charOffset: number): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].charStart < charOffset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The chapters as pure data, without touching the database. Shared by the plan
 * writer and by the peek route, which needs a chapter index for a paragraph in
 * a book nobody has enabled yet — and must not create rows to get one.
 */
export function derivePlainChapters(
  blocks: BookBlock[],
  toc: ReadingTocEntry[],
  title: string
): Omit<PlainChapter, "status" | "error">[] {
  const total = totalCharsOf(blocks);
  const planned = planChapters(blocks, toc, title, total);
  const byStart = new Map(blocks.filter((b) => b.id).map((b) => [b.charStart, b.id]));
  return planned.map((c, index) => {
    const blockStart = blockAtOrAfter(blocks, c.charStart);
    const blockEnd = blockAtOrAfter(blocks, c.charEnd);
    return {
      index,
      title: c.title,
      anchorId: byStart.get(c.charStart) ?? null,
      blockStart,
      blockEnd,
      charStart: c.charStart,
      charEnd: c.charEnd,
    };
  });
}

/** The chapter a block belongs to, or null when it sits in front matter. */
export function chapterIndexForBlock(
  chapters: { index: number; blockStart: number; blockEnd: number }[],
  blockIndex: number
): number | null {
  for (const c of chapters) {
    if (blockIndex >= c.blockStart && blockIndex < c.blockEnd) return c.index;
  }
  return null;
}

/**
 * Make sure the chapter rows exist for a hash, and return them.
 *
 * Idempotent: a second caller racing the first loses on the primary key and
 * reads back what the winner wrote.
 */
export async function ensurePlainChapters(
  admin: SupabaseClient,
  hash: string,
  blocks: BookBlock[],
  toc: ReadingTocEntry[],
  title: string
): Promise<PlainChapter[]> {
  const existing = await readChapters(admin, hash);
  if (existing.length > 0) return existing;

  const rows = derivePlainChapters(blocks, toc, title).map((c) => ({
    content_hash: hash,
    chapter_index: c.index,
    title: c.title,
    anchor_id: c.anchorId,
    block_start: c.blockStart,
    block_end: c.blockEnd,
    char_start: c.charStart,
    char_end: c.charEnd,
    status: "pending" as const,
  }));
  if (rows.length === 0) return [];

  const { error } = await admin
    .from("reading_plain_chapters")
    .upsert(rows, { onConflict: "content_hash,chapter_index", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return readChapters(admin, hash);
}

export async function readChapters(
  client: SupabaseClient,
  hash: string
): Promise<PlainChapter[]> {
  const { data, error } = await client
    .from("reading_plain_chapters")
    .select(CHAPTER_COLUMNS)
    .eq("content_hash", hash)
    .order("chapter_index", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChapterRow[]).map(toChapter);
}

/**
 * Everything the reader needs for a hash: chapter statuses, the paragraphs of
 * READY chapters only, and the glossary.
 *
 * Paragraphs from a chapter that is still pending or failed are deliberately
 * left out even when some exist (a peek stored them, or a chunk landed before a
 * later one failed): the page must never be a patchwork of faces. Those
 * paragraphs are still served through the counterpart panel.
 */
export async function readPlainPlan(client: SupabaseClient, hash: string): Promise<PlainPlan> {
  const chapters = await readChapters(client, hash);
  const ready = chapters.filter((c) => c.status === "ready").map((c) => c.index);

  let blocks: PlainBlock[] = [];
  if (ready.length > 0) {
    const { data, error } = await client
      .from("reading_plain_blocks")
      .select("block_index, chapter_index, kept, text")
      .eq("content_hash", hash)
      .in("chapter_index", ready)
      .order("block_index", { ascending: true });
    if (error) throw new Error(error.message);
    blocks = ((data ?? []) as {
      block_index: number;
      chapter_index: number;
      kept: boolean;
      text: string | null;
    }[]).map((r) => ({
      index: r.block_index,
      chapterIndex: r.chapter_index,
      kept: r.kept,
      text: r.text,
    }));
  }

  const { data: termRows, error: termError } = await client
    .from("reading_plain_terms")
    .select("term, definition, first_chapter_index")
    .eq("content_hash", hash);
  if (termError) throw new Error(termError.message);
  const terms: PlainTerm[] = ((termRows ?? []) as {
    term: string;
    definition: string;
    first_chapter_index: number;
  }[]).map((r) => ({
    term: r.term,
    definition: r.definition,
    firstChapterIndex: r.first_chapter_index,
  }));

  return { hash, chapters, blocks, terms };
}

/** Stored paragraphs for a block range regardless of chapter status — the peek. */
export async function readPlainBlocks(
  client: SupabaseClient,
  hash: string,
  from: number,
  to: number
): Promise<PlainBlock[]> {
  const { data, error } = await client
    .from("reading_plain_blocks")
    .select("block_index, chapter_index, kept, text")
    .eq("content_hash", hash)
    .gte("block_index", from)
    .lt("block_index", to)
    .order("block_index", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    block_index: number;
    chapter_index: number;
    kept: boolean;
    text: string | null;
  }[]).map((r) => ({
    index: r.block_index,
    chapterIndex: r.chapter_index,
    kept: r.kept,
    text: r.text,
  }));
}

/** The newest change to a hash's chapters, for the read route's ETag. */
export async function planVersion(client: SupabaseClient, hash: string): Promise<string> {
  const { data } = await client
    .from("reading_plain_chapters")
    .select("updated_at")
    .eq("content_hash", hash)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.updated_at as string | undefined) ?? "none";
}
