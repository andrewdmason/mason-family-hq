// Estimated one-rep-max — the normalization spine. Every loaded set collapses to
// one comparable number so a day of 5×5 and a day of 1RM sit on the same curve.
//
// We use Epley: e1RM = load × (1 + reps/30), with a 1-rep set equal to its load.
// The formulas drift for high-rep sets, so anything over ~12 reps is flagged
// "loose" (kept in the data, defaulted out of strength charts). e1RM is always
// stored in pounds so sets logged in kg stay comparable.

import type { WeightUnit } from "./types";

export const E1RM_LOOSE_REP_THRESHOLD = 12;
const KG_TO_LB = 2.2046226218;

function toPounds(load: number, unit: WeightUnit | null | undefined): number {
  return unit === "kg" ? load * KG_TO_LB : load;
}

/** Estimated 1RM (Epley) for a load × reps set, rounded to 0.1. Load assumed lb. */
export function epleyE1rm(load: number, reps: number): number {
  if (load <= 0 || reps <= 0) return 0;
  if (reps === 1) return round1(load);
  return round1(load * (1 + reps / 30));
}

/** Inverse Epley: the load that yields `e1rm` at `reps` reps, rounded to 0.1. */
export function inverseEpleyLoad(e1rm: number, reps: number): number {
  if (e1rm <= 0 || reps <= 0) return 0;
  if (reps === 1) return round1(e1rm);
  return round1(e1rm / (1 + reps / 30));
}

/** True when a rep count is high enough that the e1RM estimate is unreliable. */
export function isLooseReps(reps: number): boolean {
  return reps > E1RM_LOOSE_REP_THRESHOLD;
}

/**
 * Estimated 1RM in pounds for a logged set, or null when it isn't a meaningful
 * strength estimate (no load, no reps, or a non-loaded movement). Normalizes kg.
 */
export function computeSetE1rm(args: {
  load: number | null | undefined;
  reps: number | null | undefined;
  unit: WeightUnit | null | undefined;
  isLoadedMovement: boolean;
}): { e1rm: number; isLoose: boolean } | null {
  const { load, reps, unit, isLoadedMovement } = args;
  if (!isLoadedMovement) return null;
  if (!load || load <= 0 || !reps || reps <= 0) return null;
  const e1rm = epleyE1rm(toPounds(load, unit), reps);
  if (e1rm <= 0) return null;
  return { e1rm, isLoose: isLooseReps(reps) };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
