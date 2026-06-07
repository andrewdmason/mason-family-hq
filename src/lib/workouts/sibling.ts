// Sibling surfacing: when a loaded movement has no strength history of its own,
// estimate it from a family-mate you HAVE trained, using a seed ratio. E.g. no
// recent push press → estimate it from your strict press. Estimates are ranges
// labeled by basis, and only produced when a direct family ratio connects the two
// movements (so we never invent a number across unrelated lifts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { convertWithRatio } from "./families";
import type { SiblingEstimate } from "./families";

export type SiblingHint = {
  fromName: string;
  estimate: SiblingEstimate;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * For each target movement that lacks its own strict e1RM, return an estimate
 * derived from a trained sibling (or nothing, if none connects). One round of
 * queries regardless of how many targets.
 */
export async function getSiblingHints(
  supabase: SupabaseClient,
  targetMovementIds: string[]
): Promise<Map<string, SiblingHint>> {
  const hints = new Map<string, SiblingHint>();
  if (targetMovementIds.length === 0) return hints;

  // Targets' families (and names, for "no data" context).
  const { data: targets } = await supabase
    .from("movements")
    .select("id, family, canonical_name")
    .in("id", targetMovementIds);
  const targetById = new Map<string, { family: string; name: string }>();
  for (const t of (targets ?? []) as any[]) {
    targetById.set(t.id, { family: t.family, name: t.canonical_name });
  }

  // The user's strength bests by movement (strict, non-loose), with family/name.
  const { data: bests } = await supabase
    .from("workout_movement_e1rm_best")
    .select(
      "movement_id, best_e1rm_strict, movements!inner ( family, canonical_name )"
    )
    .eq("context", "strength")
    .not("best_e1rm_strict", "is", null);
  const bestByMovement = new Map<
    string,
    { family: string; name: string; best: number }
  >();
  for (const b of (bests ?? []) as any[]) {
    bestByMovement.set(b.movement_id, {
      family: b.movements?.family,
      name: b.movements?.canonical_name,
      best: b.best_e1rm_strict,
    });
  }

  // All seed ratios (global, small table).
  const { data: ratios } = await supabase
    .from("movement_family_ratios")
    .select("from_movement, to_movement, ratio_low, ratio_high");
  type R = { from: string; to: string; low: number; high: number };
  const ratioList: R[] = ((ratios ?? []) as any[]).map((r) => ({
    from: r.from_movement,
    to: r.to_movement,
    low: Number(r.ratio_low),
    high: Number(r.ratio_high),
  }));

  for (const targetId of targetMovementIds) {
    if (bestByMovement.has(targetId)) continue; // has its own data
    const target = targetById.get(targetId);
    if (!target) continue;

    let chosen: { fromName: string; best: number; low: number; high: number } | null =
      null;
    for (const [sibId, sib] of bestByMovement) {
      if (sib.family !== target.family || sibId === targetId) continue;
      // Direct ratio sibling→target, or invert target→sibling.
      const direct = ratioList.find((r) => r.from === sibId && r.to === targetId);
      const inverse = ratioList.find((r) => r.from === targetId && r.to === sibId);
      let low: number | null = null;
      let high: number | null = null;
      if (direct) {
        low = direct.low;
        high = direct.high;
      } else if (inverse) {
        // sibling = target × inverse → target = sibling ÷ inverse.
        low = 1 / inverse.high;
        high = 1 / inverse.low;
      }
      if (low == null || high == null) continue;
      if (!chosen || sib.best > chosen.best) {
        chosen = { fromName: sib.name, best: sib.best, low, high };
      }
    }

    if (chosen) {
      hints.set(targetId, {
        fromName: chosen.fromName,
        estimate: convertWithRatio(chosen.best, {
          low: chosen.low,
          high: chosen.high,
          basis: "typical",
        }),
      });
    }
  }

  return hints;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
