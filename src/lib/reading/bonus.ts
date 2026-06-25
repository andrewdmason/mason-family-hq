import "server-only";
import type { ReadingScope } from "@/lib/reading/scope";
import { sumMetricSince } from "@/lib/reading/milestones";

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
 * Record a real advance in the ledger and stamp any milestone it just pushed over
 * the line. Called from advanceStretch (the single advance choke point) on every
 * pass/override/no-content advance. Best-effort: a ledger or milestone failure is
 * logged and swallowed so it never rolls back the advance the reader earned.
 * Writes nothing when the page didn't actually move forward. Returns the titles of
 * any milestones this advance just reached, for a celebratory hand-off to the UI.
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
  const { client, userId } = scope;
  const reached: string[] = [];
  const pagesAdvanced = Math.max(0, input.newCurrent - input.oldCurrent);
  if (pagesAdvanced === 0) return reached;

  try {
    const { error } = await client.from("reading_stretch_advances").insert({
      user_id: userId,
      book_id: input.bookId,
      quiz_id: input.quizId ?? null,
      pages_advanced: pagesAdvanced,
      bonus_pages: bonusForAdvance(
        input.oldCurrent,
        input.newCurrent,
        input.increment
      ),
      advanced_on: input.advancedOn,
    });
    if (error) {
      console.error("[reading] ledger insert failed:", error.message);
      return reached;
    }

    // Stamp any not-yet-achieved milestone whose metric just crossed its threshold.
    const { data: milestones } = await client
      .from("reading_milestones")
      .select("id, title, metric, threshold, start_on")
      .eq("user_id", userId)
      .is("achieved_at", null);
    for (const m of milestones ?? []) {
      const total = await sumMetricSince(
        client,
        userId,
        m.metric as "bonus_pages" | "total_pages",
        (m.start_on as string | null) ?? null
      );
      if (total >= (m.threshold as number)) {
        const { error: stampError } = await client
          .from("reading_milestones")
          .update({ achieved_at: new Date().toISOString() })
          .eq("id", m.id as string)
          .eq("user_id", userId)
          .is("achieved_at", null);
        if (!stampError) reached.push(m.title as string);
      }
    }
  } catch (err) {
    console.error(
      "[reading] recordAdvanceAndCheckMilestones failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
  return reached;
}
