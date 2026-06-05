import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import type { HomeJournalAudience } from "./types";

/**
 * The date of the signed-in member's most recent *finished* entry of a given
 * audience — a closed private entry for the personal widget, a closed family
 * entry for the family widget. Null when they've never posted that kind. Used to
 * render "last posted X days ago". RLS scopes the read to the caller's rows.
 */
export async function lastPostedDate(
  audience: HomeJournalAudience
): Promise<string | null> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const visibility = audience === "family" ? "family" : "private";
  const { data } = await supabase
    .from("journal_entries")
    .select("entry_date")
    .eq("user_id", userId)
    .eq("visibility", visibility)
    .eq("status", "closed")
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.entry_date as string | null) ?? null;
}
