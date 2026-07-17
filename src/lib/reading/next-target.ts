import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capTarget, defaultTargetPage } from "@/lib/reading/targets";
import {
  WORDS_PER_PAGE,
  chapterSpans,
  contentWordCount,
  pickChapterTarget,
  wordsToPage,
} from "@/lib/reading/chapter-target";
import type { ReadingTargetChapter, ReadingTocEntry } from "@/lib/types";

export type ResolvedTarget = {
  targetPage: number | null;
  targetChapter: ReadingTargetChapter | null;
};

/**
 * Decide a book's next weekly target — the one place page-goal vs chapter-goal is
 * chosen, so every caller (advance, convert, edit) stays a single call.
 *
 * Chapter snapping applies only to books whose pages are synthetic (a reflowable
 * EPUB with no real page-list) and that have a real chapter list: for those the
 * page space is defined as 280-word pages, so `current_page` maps to a word
 * offset directly. Everything else — articles, PDFs, page-list EPUBs, books not
 * yet (re)converted — keeps the plain page goal, with no chapter label.
 */
export async function resolveNextTarget(
  client: SupabaseClient,
  userId: string,
  book: { id: string; total_pages: number | null },
  currentPage: number,
  increment: number
): Promise<ResolvedTarget> {
  const fallback: ResolvedTarget = {
    targetPage: defaultTargetPage(currentPage, increment, book.total_pages),
    targetChapter: null,
  };

  const { data: content } = await client
    .from("reading_book_content")
    .select("status, has_real_pages, word_count, toc")
    .eq("book_id", book.id)
    .eq("user_id", userId)
    .maybeSingle();

  const wordCount = (content?.word_count as number | null) ?? null;
  // Synthetic-page books only: real page numbers already track the printed edition.
  if (
    !content ||
    content.status !== "ready" ||
    content.has_real_pages ||
    !wordCount ||
    wordCount <= 0
  ) {
    return fallback;
  }

  const toc = (content.toc as ReadingTocEntry[]) ?? [];
  const spans = chapterSpans(toc, wordCount);
  if (spans.length === 0) return fallback;

  // The story's length, excluding any trailing back matter (previews etc.).
  const contentWords = contentWordCount(spans, wordCount);
  const currentWord = currentPage * WORDS_PER_PAGE;
  const pick = pickChapterTarget({
    currentWord,
    weeklyPageGoal: increment,
    chapters: spans,
    totalWords: contentWords,
  });
  if (!pick) return fallback;

  // Resolve the snapped word target back to a page for the existing machinery.
  // A target at the book's end must equal total_pages exactly, or advanceStretch
  // (which finishes at current_page >= total_pages) would never mark it finished.
  const atEnd = pick.targetWord >= contentWords;
  const rawPage =
    atEnd && book.total_pages != null ? book.total_pages : wordsToPage(pick.targetWord);

  return {
    targetPage: capTarget(rawPage, book.total_pages),
    targetChapter: pick.chapter,
  };
}
