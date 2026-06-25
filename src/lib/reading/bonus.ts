import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReadingScope } from "@/lib/reading/scope";
import { creditReadingBonus } from "@/lib/bucks/earn";

/**
 * Bonus pages earned by an advance: the pages read beyond the normal weekly
 * target (current_page + increment). Never negative, never more than the pages
 * actually advanced, and always 0 when there's no weekly goal (increment <= 0) —
 * with no goal there's no baseline to exceed.
 */
export function bonusForAdvance(
  oldCurrent: number,
  newCurrent: number,
  increment: number
): number {
  const advanced = Math.max(0, newCurrent - oldCurrent);
  if (increment <= 0 || advanced === 0) return 0;
  const normalTarget = oldCurrent + increment;
  return Math.min(advanced, Math.max(0, newCurrent - normalTarget));
}

/**
 * Record a real advance in the ledger and credit its bonus pages to the kid's
 * Mason Bucks wallet (1 page = 1 Buck). Called from advanceStretch (the single
 * advance choke point) on every pass/override/no-content advance. Best-effort: a
 * ledger or credit failure is logged and swallowed so it never rolls back the
 * advance the reader earned. Writes nothing when the page didn't move forward.
 *
 * Reward milestones are retired — they live in the Mason Bucks app as prizes now,
 * so this no longer scans thresholds. The return value (kept for the call sites)
 * is always empty; the milestone-celebration plumbing is removed with the reader
 * milestone UI.
 */
export async function recordAdvanceAndCheckMilestones(
  scope: ReadingScope,
  input: {
    bookId: string;
    oldCurrent: number;
    newCurrent: number;
    increment: number;
    advancedOn: string;
    quizId?: string | null;
  }
): Promise<string[]> {
  // Writes here are system bookkeeping that fire while the reader is in self mode
  // (a kid passing their own quiz), where the session client has SELECT-only RLS
  // on these tables. Use the service role for the writes, always scoped to the
  // trusted userId — matching the tables' write design.
  const { userId } = scope;
  const client = createAdminClient();
  const pagesAdvanced = Math.max(0, input.newCurrent - input.oldCurrent);
  if (pagesAdvanced === 0) return [];

  const bonusPages = bonusForAdvance(
    input.oldCurrent,
    input.newCurrent,
    input.increment
  );

  try {
    const { data: advance, error } = await client
      .from("reading_stretch_advances")
      .insert({
        user_id: userId,
        book_id: input.bookId,
        quiz_id: input.quizId ?? null,
        pages_advanced: pagesAdvanced,
        bonus_pages: bonusPages,
        advanced_on: input.advancedOn,
      })
      .select("id")
      .single();
    if (error || !advance) {
      console.error("[reading] ledger insert failed:", error?.message);
      return [];
    }

    // Credit the bonus pages to the Mason Bucks wallet, keyed to this advance.
    await creditReadingBonus(userId, advance.id as string, bonusPages);
  } catch (err) {
    console.error(
      "[reading] recordAdvanceAndCheckMilestones failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
  return [];
}
