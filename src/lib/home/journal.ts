import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import type { HomeJournalAudience } from "./types";

/** Where the signed-in member stands with one journal audience, for its widget. */
export type JournalStatus = {
  /** Date of their most recent *finished* entry of this audience, or null. */
  lastPosted: string | null;
  /**
   * Distinct dates (YYYY-MM-DD) with a finished entry within the trailing 7 days
   * (today inclusive) — drives the "how often you've posted lately" indicator.
   */
  recentDates: string[];
};

/**
 * The signed-in member's posting status for a given journal audience — a closed
 * private entry for the personal widget, a closed family entry for the family
 * widget. Returns their most recent post date (for the "last post X" line) and
 * the distinct days they posted in the trailing week (for the frequency dots).
 * RLS scopes every read to the caller's own rows.
 */
export async function getJournalStatus(
  audience: HomeJournalAudience,
  today: string
): Promise<JournalStatus> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const visibility = audience === "family" ? "family" : "private";

  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6); // 7-day window, today inclusive
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [latest, recent] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("entry_date")
      .eq("user_id", userId)
      .eq("visibility", visibility)
      .eq("status", "closed")
      .order("entry_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("journal_entries")
      .select("entry_date")
      .eq("user_id", userId)
      .eq("visibility", visibility)
      .eq("status", "closed")
      .gte("entry_date", cutoffStr),
  ]);

  const recentDates = [
    ...new Set((recent.data ?? []).map((r) => r.entry_date as string)),
  ];

  return {
    lastPosted: (latest.data?.entry_date as string | null) ?? null,
    recentDates,
  };
}
