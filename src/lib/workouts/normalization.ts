// Turn a stored best-e1RM into the two things the gym-time detail view shows next
// to today's prescription: a suggested load for the prescribed rep scheme, and
// what percent of your max a prescribed load represents.

import { inverseEpleyLoad } from "./e1rm";

/** The load (lb) that should match your best e1RM at `reps` reps. */
export function suggestedLoad(bestE1rm: number, reps: number): number {
  if (!bestE1rm || bestE1rm <= 0 || !reps || reps <= 0) return 0;
  return inverseEpleyLoad(bestE1rm, reps);
}

/** What percent of your best e1RM a prescribed load is, or null if no e1RM yet. */
export function percentOfE1rm(load: number, bestE1rm: number): number | null {
  if (!bestE1rm || bestE1rm <= 0 || !load || load <= 0) return null;
  return Math.round((load / bestE1rm) * 100);
}

/** Rep schemes we show suggested loads for on a strength movement's history card. */
export const COMMON_REP_SCHEMES = [1, 3, 5, 8, 10];

export type SuggestedLoadRow = { reps: number; load: number };

/** A small table of suggested loads across common rep schemes. */
export function suggestedLoadTable(
  bestE1rm: number,
  schemes: number[] = COMMON_REP_SCHEMES
): SuggestedLoadRow[] {
  return schemes.map((reps) => ({ reps, load: suggestedLoad(bestE1rm, reps) }));
}
