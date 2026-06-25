import type { SupabaseClient } from "@supabase/supabase-js";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";
import type { MilestoneProgress } from "@/lib/types";

/** Which ledger sum a milestone thresholds against. */
export type MilestoneMetric = "bonus_pages" | "total_pages";

/** A reading_stretch_advances row, the substrate for every milestone sum. */
export type AdvanceLedgerRow = {
  bonus_pages: number;
  pages_advanced: number;
  advanced_on: string;
};

/** The reading_stretch_advances column each metric sums. */
function metricColumn(metric: MilestoneMetric): "bonus_pages" | "pages_advanced" {
  return metric === "bonus_pages" ? "bonus_pages" : "pages_advanced";
}

/**
 * The kid's full advance ledger, fetched once so many milestone sums can be
 * computed in memory rather than one query each. Small per kid (one row per
 * stretch advance). Must be called with an already-scoped client + userId.
 */
export async function loadAdvanceLedger(
  client: SupabaseClient,
  userId: string
): Promise<AdvanceLedgerRow[]> {
  const { data } = await client
    .from("reading_stretch_advances")
    .select("bonus_pages, pages_advanced, advanced_on")
    .eq("user_id", userId);
  return (data ?? []) as AdvanceLedgerRow[];
}

/** Sum a metric over already-loaded ledger rows, optionally from a start date. */
export function sumFromLedger(
  rows: AdvanceLedgerRow[],
  metric: MilestoneMetric,
  startOn: string | null
): number {
  const column = metricColumn(metric);
  return rows.reduce(
    (sum, row) =>
      startOn && row.advanced_on < startOn ? sum : sum + (row[column] ?? 0),
    0
  );
}

/** Sum one metric for a kid in a single query — for one-off counts (previews). */
export async function sumMetricSince(
  client: SupabaseClient,
  userId: string,
  metric: MilestoneMetric,
  startOn: string | null
): Promise<number> {
  const rows = await loadAdvanceLedger(client, userId);
  return sumFromLedger(rows, metric, startOn);
}

/** A short-lived signed URL for a milestone reward image, or null when none. */
export async function signedMilestoneImageUrl(
  client: SupabaseClient,
  imagePath: string | null
): Promise<string | null> {
  if (!imagePath) return null;
  const { data } = await client.storage
    .from(READING_MILESTONES_BUCKET)
    .createSignedUrl(imagePath, 60 * 60);
  return data?.signedUrl ?? null;
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
  const [{ data: rows }, ledger] = await Promise.all([
    client
      .from("reading_milestones")
      .select("id, title, metric, threshold, image_path, start_on, achieved_at")
      .eq("user_id", userId)
      .is("awarded_at", null),
    loadAdvanceLedger(client, userId),
  ]);
  if (!rows || rows.length === 0) return [];

  const milestones = await Promise.all(
    rows.map(async (m): Promise<MilestoneProgress> => {
      const metric = m.metric as MilestoneMetric;
      const threshold = m.threshold as number;
      const current = sumFromLedger(
        ledger,
        metric,
        (m.start_on as string | null) ?? null
      );
      return {
        id: m.id as string,
        title: m.title as string,
        metric,
        threshold,
        current,
        imageUrl: await signedMilestoneImageUrl(
          client,
          (m.image_path as string | null) ?? null
        ),
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
