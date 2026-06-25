import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadingScope } from "@/lib/reading/scope";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { defaultTargetPage } from "@/lib/reading/targets";
import { readingTargetDueDateKey } from "@/lib/reading/target-due";
import { recordAdvanceAndCheckMilestones } from "@/lib/reading/bonus";
import {
  ensureStretchQuiz,
  type EnsureStretchResult,
} from "@/lib/reading/ensure-stretch-quiz";

/** The fields of a book needed to advance its milestone / prepare its quiz. */
export type StretchBook = {
  id: string;
  current_page: number;
  target_page: number | null;
  total_pages: number | null;
};

/**
 * The member's default weekly target increment (reading_settings.weekly_page_goal),
 * or 0 when unset. Works in self mode (RLS lets a member read their own goal) and
 * owner-on-behalf mode (admin client by the member's email).
 */
export async function readingIncrement(
  client: SupabaseClient,
  email: string | null
): Promise<number> {
  if (!email) return 0;
  const { data } = await client
    .from("reading_settings")
    .select("weekly_page_goal")
    .eq("member_email", email)
    .maybeSingle();
  const goal = (data?.weekly_page_goal as number | null) ?? 0;
  return goal > 0 ? Math.floor(goal) : 0;
}

/**
 * Best-effort: ensure the book's CURRENT stretch ([current_page, target]) has a
 * published quiz. Swallows errors (returns the status) so it can be fired from any
 * happy path without risking the user's action.
 */
export async function ensureStretchQuizInline(
  scope: ReadingScope,
  book: StretchBook
): Promise<EnsureStretchResult> {
  const through = book.target_page ?? book.total_pages;
  if (through == null || through <= 0) return { quizId: null, status: "no_content" };
  const fromPage = book.current_page > 1 ? book.current_page : null;
  if (fromPage != null && fromPage >= through) {
    return { quizId: null, status: "no_content" };
  }
  try {
    return await ensureStretchQuiz(scope, book.id, fromPage, through);
  } catch (err) {
    console.error(
      "[reading] ensureStretchQuiz failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { quizId: null, status: "error" };
  }
}

/**
 * Advance a book to a reached milestone: bump current_page (and the next target),
 * archive when the book is finished, log a check-in to keep weekly math intact,
 * and pre-generate the next stretch's quiz. `reachedPage` defaults to the book's
 * current target; pass the quiz's through_page when advancing from a passed quiz.
 * Never moves current_page backward. `quizId` (when this advance came from a quiz)
 * is recorded on the bonus-ledger row.
 */
export async function advanceStretch(
  scope: ReadingScope,
  book: StretchBook,
  reachedPage?: number,
  quizId?: string | null
): Promise<{ finished: boolean; nextTarget: number | null; newCurrent: number }> {
  const { client, userId, email } = scope;
  const candidate =
    reachedPage ?? book.target_page ?? book.total_pages ?? book.current_page;
  const newCurrent = Math.max(book.current_page, candidate);
  const finished = book.total_pages != null && newCurrent >= book.total_pages;
  const increment = await readingIncrement(client, email);
  const nextTarget = finished
    ? null
    : defaultTargetPage(newCurrent, increment, book.total_pages);

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const { error: updateError } = await client
    .from("reading_books")
    .update({
      current_page: newCurrent,
      target_page: nextTarget,
      target_locked: false,
      // A fresh stretch is due the Friday after today, granting a new week.
      target_due: nextTarget != null ? readingTargetDueDateKey(today) : null,
      status: finished ? "archive" : "in_progress",
      finished_at: finished ? today : null,
    })
    .eq("id", book.id)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);

  await client.from("reading_checkins").insert({
    user_id: userId,
    book_id: book.id,
    checked_on: today,
    page: newCurrent,
  });

  // Bank bonus pages for this advance and stamp any milestone it just reached.
  // Best-effort inside the helper — never rolls back the advance.
  await recordAdvanceAndCheckMilestones(scope, {
    bookId: book.id,
    oldCurrent: book.current_page,
    newCurrent,
    increment,
    advancedOn: today,
    quizId,
  });

  revalidatePath("/reader");

  if (!finished && nextTarget != null) {
    await ensureStretchQuizInline(scope, {
      id: book.id,
      current_page: newCurrent,
      target_page: nextTarget,
      total_pages: book.total_pages,
    });
  }
  return { finished, nextTarget, newCurrent };
}
