import type { SupabaseClient } from "@supabase/supabase-js";

/** Which ledger sum a milestone thresholds against. */
export type MilestoneMetric = "bonus_pages" | "total_pages";

/** The reading_stretch_advances column each metric sums. */
export function metricColumn(metric: MilestoneMetric): "bonus_pages" | "pages_advanced" {
  return metric === "bonus_pages" ? "bonus_pages" : "pages_advanced";
}

/**
 * Sum a kid's ledger for one metric, optionally only counting advances on/after a
 * start date (a seasonal milestone). The per-kid ledger is small (one row per
 * stretch advance), so we fetch and sum in JS rather than an rpc. Must be called
 * with an already-scoped client; always filters by the passed userId.
 */
export async function sumMetricSince(
  client: SupabaseClient,
  userId: string,
  metric: MilestoneMetric,
  startOn: string | null
): Promise<number> {
  const column = metricColumn(metric);
  let query = client
    .from("reading_stretch_advances")
    .select(column)
    .eq("user_id", userId);
  if (startOn) query = query.gte("advanced_on", startOn);
  const { data, error } = await query;
  if (error || !data) return 0;
  return data.reduce(
    (sum, row) => sum + ((row as Record<string, number>)[column] ?? 0),
    0
  );
}
