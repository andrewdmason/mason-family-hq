import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { todayLocal } from "@/lib/journal/today";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Whether the Today view should show the "Write in your journal" nudge row
 * for the signed-in user. It shows until they've actually journaled today —
 * or checked the row off (a per-day dismissal). Both reset when the local
 * date rolls over.
 *
 * "Journaled" can't be just "an entry row exists": /journal/new inserts an
 * open entry on page load, so navigating there and bouncing would silence the
 * nudge. Written means a closed entry for today (quotes/recaps close on
 * creation), or a today entry with at least one user-authored message.
 */
export async function getJournalNudgePending(
  supabase: Supabase
): Promise<boolean> {
  const userId = await requireUserId(supabase);
  const today = await todayLocal();

  const { data: dismissal } = await supabase
    .from("journal_nudge_dismissals")
    .select("user_id")
    .eq("user_id", userId)
    .eq("dismissed_on", today)
    .maybeSingle();
  if (dismissal) return false;

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id, status")
    .eq("user_id", userId)
    .eq("entry_date", today);
  if (!entries || entries.length === 0) return true;
  if (entries.some((e) => e.status === "closed")) return false;

  const { count } = await supabase
    .from("journal_messages")
    .select("id", { count: "exact", head: true })
    .in(
      "entry_id",
      entries.map((e) => e.id)
    )
    .eq("role", "user");
  return (count ?? 0) === 0;
}
