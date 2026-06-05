import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";

/**
 * The Home dashboard's per-person, per-day AI cache (see migration 00099). Each
 * AI-generated widget payload is stored once per (user, day, widget_key) and
 * reused for the rest of the day, so the page renders instantly and generation
 * fires at most once per day per widget. Reads are RLS-scoped to the caller's
 * own rows, so no explicit user filter is needed on the read.
 */
export async function readHomeCache<T>(
  widgetKey: string,
  date: string
): Promise<T | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("home_ai_cache")
    .select("payload")
    .eq("cache_date", date)
    .eq("widget_key", widgetKey)
    .maybeSingle();
  return (data?.payload as T | undefined) ?? null;
}

/** Persist a freshly generated widget payload for today. */
export async function writeHomeCache(
  widgetKey: string,
  date: string,
  payload: unknown
): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await supabase.from("home_ai_cache").upsert(
    {
      user_id: userId,
      cache_date: date,
      widget_key: widgetKey,
      payload,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,cache_date,widget_key" }
  );
}
