import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyBook } from "@/lib/reading/classify-book";
import type { ReadingGenre } from "@/lib/reading/book-genres";

/**
 * Classify a saved book and write the result back to its row.
 *
 * The one place the fiction/genre columns are filled from the AI, shared by the
 * add flow and the backfill script so there is no second copy to drift. Best
 * effort throughout: the book is already saved by the time this runs, so a
 * failure here leaves an uncategorised book, never a broken add.
 */

/** What a classification writes. Exposed so the backfill can preview it. */
export type CategoryWrite = {
  fiction: boolean | null;
  genre: ReadingGenre | null;
  genre_source: "ai";
  spoiler_free: boolean;
};

/**
 * The spoiler default that goes with a fiction verdict.
 *
 * Not simply `fiction`: unknown stays protected. The harm is asymmetric — a
 * spoiled novel can't be un-spoiled, while an over-narrow non-fiction chat is one
 * toggle away — so only a positive "this is non-fiction" opens the whole book to
 * a new chat.
 */
export function spoilerDefaultFor(fiction: boolean | null): boolean {
  return fiction !== false;
}

/** The row patch for a classification result. */
export function categoryWrite(result: {
  fiction: boolean | null;
  genre: ReadingGenre | null;
}): CategoryWrite {
  return {
    fiction: result.fiction,
    genre: result.genre,
    genre_source: "ai",
    spoiler_free: spoilerDefaultFor(result.fiction),
  };
}

/**
 * Classify one book and save the verdict. Never throws.
 *
 * `hints` are answers the caller already has — the AI title lookup in the add
 * flow reports fiction and genre itself. A hint always wins over the classifier,
 * and the API call is skipped entirely when both hints are present, so we don't
 * pay twice for the same question. A partial hint still triggers the call, to
 * fill the gap, and is then merged back over the result.
 */
export async function categorizeBook(
  client: SupabaseClient,
  book: { id: string; title: string; author: string | null },
  hints?: { fiction?: boolean | null; genre?: ReadingGenre | null }
): Promise<void> {
  try {
    const knownFiction = hints?.fiction ?? null;
    const knownGenre = hints?.genre ?? null;
    const guess =
      knownFiction != null && knownGenre != null
        ? { fiction: knownFiction, genre: knownGenre }
        : await classifyBook(book.title, book.author);
    const result = {
      fiction: knownFiction ?? guess.fiction,
      genre: knownGenre ?? guess.genre,
    };

    // Nothing learned — leave the row alone rather than stamping genre_source
    // and teaching the backfill to skip a book it could still classify later.
    if (result.fiction == null && result.genre == null) return;

    const { error } = await client
      .from("reading_books")
      .update(categoryWrite(result))
      .eq("id", book.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(
      `[reading/categorize] failed for book ${book.id}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
