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
  /** Only present when the classifier resolved a year worth writing. */
  published_year?: number;
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
  publishedYear?: number | null;
}): CategoryWrite {
  return {
    fiction: result.fiction,
    genre: result.genre,
    genre_source: "ai",
    spoiler_free: spoilerDefaultFor(result.fiction),
    // Left out of the patch entirely when there's no year, so a book the
    // classifier doesn't recognise keeps whatever the add flow found for it.
    ...(result.publishedYear ? { published_year: result.publishedYear } : {}),
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
 *
 * The publication year rides along for free, and this is where it gets settled
 * for the four add paths that never talk to the AI. It deliberately overwrites
 * the year the insert wrote: the typeahead's comes from Open Library's
 * `first_publish_year`, which is the earliest edition record in the catalogue
 * and disagrees with the truth about half the time (Klara and the Sun as 2019,
 * The Alchemist as 2010, Kiki's Delivery Service as 2020). This runs seconds
 * after the row is created, so there is no hand-set year to trample — and a book
 * the classifier doesn't recognise keeps the catalogue's answer.
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
        ? { fiction: knownFiction, genre: knownGenre, publishedYear: null }
        : await classifyBook(book.title, book.author);
    const result = {
      fiction: knownFiction ?? guess.fiction,
      genre: knownGenre ?? guess.genre,
      publishedYear: guess.publishedYear,
    };

    const categorized = result.fiction != null || result.genre != null;
    // Nothing learned — leave the row alone rather than stamping genre_source
    // and teaching the backfill to skip a book it could still classify later.
    if (!categorized && result.publishedYear == null) return;

    // A year on its own doesn't make the book classified, so it's written on its
    // own too rather than stamping genre_source over a still-empty genre.
    const patch: Record<string, unknown> = categorized
      ? categoryWrite(result)
      : { published_year: result.publishedYear };

    const { error } = await client
      .from("reading_books")
      .update(patch)
      .eq("id", book.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(
      `[reading/categorize] failed for book ${book.id}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
