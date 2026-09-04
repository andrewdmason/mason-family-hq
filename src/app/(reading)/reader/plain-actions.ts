"use server";

import type { ReadingFace } from "@/lib/reading/plain/types";
import { resolveReadingScope } from "@/lib/reading/scope";
import {
  loadHashedBook,
  PlainAccessError,
  resolvePlainBook,
} from "@/lib/reading/plain/access";
import { submitBatch } from "@/lib/reading/plain/batch";
import { ensurePlainChapters } from "@/lib/reading/plain/plan";
import type { PlainChapter } from "@/lib/reading/plain/types";

/**
 * Which face this reader sees this book in.
 *
 * Per reader, per book, and only that: the translation itself is the family's
 * and lives under the content hash. Upserts, because the state row is written
 * lazily by the first position save and may not exist yet.
 */
export async function setReadingFace(bookId: string, face: ReadingFace): Promise<void> {
  if (face !== "original" && face !== "plain") throw new Error("Unknown face.");
  const { client, userId } = await resolveReadingScope(null);
  const { error } = await client.from("reading_book_state").upsert(
    { book_id: bookId, user_id: userId, reading_face: face },
    { onConflict: "book_id" }
  );
  if (error) throw new Error(error.message);
}

export type EnableOutcome = {
  chapters: PlainChapter[];
  /** Chapters the client should send to the live prepare route now. */
  live: number[];
  /** Whether a batch was submitted for the rest. */
  batched: boolean;
};

/**
 * Turn Plain English on for a book that has never been translated.
 *
 * One server call does the whole kick-off, in this order: the chapter rows are
 * derived, the two chapters the reader is about to read are set aside for live
 * translation, and everything else goes into one Message Batch. Doing it here
 * rather than as separate client requests is what makes "current and next go
 * live, the rest are batched" deterministic — two requests racing from a slow
 * connection would routinely batch the chapter being read.
 *
 * The live chapters are NOT claimed here. The prepare route claims when it
 * runs; excluding them from the batch is enough, and it means a prepare that
 * never arrives leaves them `pending` for the reach-ahead to pick up.
 */
export async function enablePlainEnglish(
  bookId: string,
  currentCharOffset: number
): Promise<EnableOutcome> {
  let access;
  try {
    access = await resolvePlainBook(bookId);
  } catch (err) {
    throw new Error(err instanceof PlainAccessError ? err.message : "Couldn't open this book.");
  }

  const book = await loadHashedBook(access);
  const chapters = await ensurePlainChapters(
    access.admin,
    access.hash,
    book.blocks,
    book.toc,
    book.title
  );

  await access.scoped.from("reading_book_state").upsert(
    { book_id: bookId, user_id: access.userId, reading_face: "plain" },
    { onConflict: "book_id" }
  );

  if (chapters.length === 0) return { chapters, live: [], batched: false };

  // Already under way (or done) for this conversion: someone in the family got
  // here first. Nothing to submit; the face is set and progress takes over.
  if (chapters.some((c) => c.status !== "pending")) {
    const here = chapters.findIndex(
      (c) => currentCharOffset >= c.charStart && currentCharOffset < c.charEnd
    );
    const live = chapters
      .filter((c, i) => (i === here || i === here + 1) && c.status !== "ready")
      .map((c) => c.index);
    return { chapters, live, batched: false };
  }

  const here = Math.max(
    0,
    chapters.findIndex((c) => currentCharOffset >= c.charStart && currentCharOffset < c.charEnd)
  );
  const live = chapters.slice(here, here + 2).map((c) => c.index);

  // The live chapters are simply excluded from the batch; the prepare route
  // claims them when it runs.
  let batched = false;
  try {
    batched = (await submitBatch(access.admin, book, live)) != null;
  } catch (err) {
    // The reach-ahead translates chapters live as the reader reaches them, so
    // a failed batch submit degrades to "slower and pricier", not "broken".
    console.error("[plain] batch submit failed", err);
  }

  return { chapters, live, batched };
}
