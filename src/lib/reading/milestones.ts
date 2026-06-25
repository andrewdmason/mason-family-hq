import type { SupabaseClient } from "@supabase/supabase-js";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";
import type { MilestoneProgress } from "@/lib/types";

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

/**
 * Load a reader's dashboard milestones: every not-yet-awarded milestone with its
 * current count and a signed reward-image URL, ordered for display — reached but
 * unawarded ones first (the celebratory state), then unreached by how close they
 * are to completion. Must be called with an already-scoped client + userId.
 */
export async function loadDashboardMilestones(
  client: SupabaseClient,
  userId: string
): Promise<MilestoneProgress[]> {
  const { data: rows } = await client
    .from("reading_milestones")
    .select("id, title, metric, threshold, image_path, start_on, achieved_at")
    .eq("user_id", userId)
    .is("awarded_at", null);
  if (!rows || rows.length === 0) return [];

  const milestones = await Promise.all(
    rows.map(async (m): Promise<MilestoneProgress> => {
      const metric = m.metric as MilestoneMetric;
      const threshold = m.threshold as number;
      const current = await sumMetricSince(
        client,
        userId,
        metric,
        (m.start_on as string | null) ?? null
      );
      const imagePath = (m.image_path as string | null) ?? null;
      let imageUrl: string | null = null;
      if (imagePath) {
        const { data: signed } = await client.storage
          .from(READING_MILESTONES_BUCKET)
          .createSignedUrl(imagePath, 60 * 60);
        imageUrl = signed?.signedUrl ?? null;
      }
      return {
        id: m.id as string,
        title: m.title as string,
        metric,
        threshold,
        current,
        imageUrl,
        reached: m.achieved_at != null || current >= threshold,
      };
    })
  );

  // Reached-but-unawarded first (celebrate the handoff); then the rest by nearest
  // to completion (highest fraction of the threshold reached).
  return milestones.sort((a, b) => {
    if (a.reached !== b.reached) return a.reached ? -1 : 1;
    return b.current / b.threshold - a.current / a.threshold;
  });
}
