import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockMap } from "@/lib/reading/block-stream";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { totalCharsOf } from "@/lib/reading/reading-progress";
import type { ReadingTocEntry } from "@/lib/types";
import { planChapters } from "./chapters";
import { estimateCost } from "./constants";
import type { AudioChapter, AudioChapterStatus, AudioPlan } from "./types";

/**
 * The track list for a book, derived once and then read back.
 *
 * Derivation is deliberately a WRITE, not a computation the client repeats.
 * Chapter boundaries are character offsets, and the player, the synthesizer and
 * the follow-along highlight all have to agree on them exactly; two
 * derivations that differed by a single character would put the highlight in
 * the wrong chapter with no obvious cause. So the server derives them, stores
 * them, and everything else reads the stored answer.
 *
 * Keyed by the book's content version. Re-converting a book rewrites its
 * character space, which makes every stored offset meaningless — so the plan is
 * rebuilt from scratch and any audio recorded against the old space is dropped
 * rather than left to play against the wrong text.
 */

type ChapterRow = {
  chapter_index: number;
  title: string;
  char_start: number;
  char_end: number;
  status: AudioChapterStatus;
  duration_ms: number | null;
  billed_chars: number | null;
  error_message: string | null;
};

function toChapter(row: ChapterRow): AudioChapter {
  return {
    index: row.chapter_index,
    title: row.title,
    charStart: row.char_start,
    charEnd: row.char_end,
    status: row.status,
    durationMs: row.duration_ms,
    billedChars: row.billed_chars,
    error: row.error_message,
  };
}

const CHAPTER_COLUMNS =
  "chapter_index, title, char_start, char_end, status, duration_ms, billed_chars, error_message";

/**
 * Build the plan for a book and store it, replacing anything already there.
 *
 * Downloads and parses the book, which is the expensive part — a megabyte of
 * HTML and a few thousand blocks — so it runs once per content version rather
 * than on every visit to the player.
 */
async function derive(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  contentPath: string,
  contentVersion: string,
  toc: ReadingTocEntry[],
  bookTitle: string
): Promise<AudioChapter[]> {
  const download = await client.storage.from(READING_BOOKS_BUCKET).download(contentPath);
  if (download.error || !download.data) {
    throw new Error("Couldn't open this book to work out its chapters.");
  }

  const blocks = blockMap(await download.data.text());
  const planned = planChapters(blocks, toc, bookTitle, totalCharsOf(blocks));
  if (planned.length === 0) return [];

  // Replace wholesale. The rows being removed are keyed to a character space
  // that no longer exists, so there is nothing in them worth preserving: their
  // audio would play against text that has moved.
  //
  // Their files stay in storage until the same chapter number is voiced again
  // and overwrites them, so a re-conversion that produces FEWER chapters leaves
  // the tail behind. Unreferenced and unreachable — nothing can serve a file
  // without a row pointing at it — so it's wasted bytes rather than a
  // correctness problem, and not worth a delete pass that could fail halfway
  // and orphan rows instead.
  const { error: clearError } = await client
    .from("reading_audio_chapters")
    .delete()
    .eq("book_id", bookId)
    .eq("user_id", userId);
  if (clearError) throw new Error(clearError.message);

  const rows = planned.map((chapter, index) => ({
    book_id: bookId,
    user_id: userId,
    chapter_index: index,
    title: chapter.title,
    char_start: chapter.charStart,
    char_end: chapter.charEnd,
    content_version: contentVersion,
    status: "pending" as const,
  }));

  const { data, error } = await client
    .from("reading_audio_chapters")
    .insert(rows)
    .select(CHAPTER_COLUMNS);
  if (error) throw new Error(error.message);

  return (data as ChapterRow[]).map(toChapter);
}

/**
 * The book's chapters, deriving them the first time they're asked for.
 *
 * Returns null when the book has no readable content — an upload still
 * converting, or one that failed. Articles are excluded: they're short enough
 * that chaptering them means nothing, and listening is a books feature.
 */
export async function getAudioPlan(
  client: SupabaseClient,
  userId: string,
  bookId: string
): Promise<AudioPlan | null> {
  const { data: book } = await client
    .from("reading_books")
    .select("id, title, author, type")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book || book.type === "article") return null;

  const { data: content } = await client
    .from("reading_book_content")
    .select("content_path, status, updated_at, toc, source_format")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    !content ||
    content.status !== "ready" ||
    !content.content_path ||
    content.source_format === "article"
  ) {
    return null;
  }

  const contentVersion = String(Date.parse(content.updated_at as string));

  const { data: existing, error } = await client
    .from("reading_audio_chapters")
    .select(`${CHAPTER_COLUMNS}, content_version`)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .order("chapter_index", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (existing ?? []) as (ChapterRow & { content_version: string })[];
  const current = rows.length > 0 && rows[0].content_version === contentVersion;

  const chapters = current
    ? rows.map(toChapter)
    : await derive(
        client,
        userId,
        bookId,
        content.content_path as string,
        contentVersion,
        (content.toc as ReadingTocEntry[] | null) ?? [],
        book.title as string
      );

  const billed = chapters.reduce((sum, chapter) => sum + (chapter.billedChars ?? 0), 0);

  return {
    bookId,
    title: book.title as string,
    author: (book.author as string | null) ?? null,
    chapters,
    spentDollars: estimateCost(billed),
  };
}

/**
 * What listening has cost since `since`, across every book.
 *
 * Summed from the chapters themselves rather than kept in a ledger: a chapter
 * is synthesized exactly once, so its billed character count IS the record of
 * what was spent. Nothing to keep in step.
 */
export async function getAudioSpend(
  client: SupabaseClient,
  userId: string,
  since: Date
): Promise<{ dollars: number; chapters: number }> {
  const { data, error } = await client
    .from("reading_audio_chapters")
    .select("billed_chars")
    .eq("user_id", userId)
    .eq("status", "ready")
    .gte("prepared_at", since.toISOString());
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { billed_chars: number | null }[];
  const billed = rows.reduce((sum, row) => sum + (row.billed_chars ?? 0), 0);
  return { dollars: estimateCost(billed), chapters: rows.length };
}
