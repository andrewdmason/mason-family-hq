// Cross-movement normalization within a family. When you have no recent data for
// a movement, we estimate it from a sibling you HAVE trained, using a ratio.
//
// Two ratio sources, personal preferred: a seed "typical" ratio ships in the DB
// (movement_family_ratios), and once you've logged both variants we compute your
// own ratio from your e1RMs. Estimates are always a RANGE with a basis label, so
// the UI can be honest that these are approximations, not measured maxes.

export type RatioBasis = "personal" | "typical";

export type Ratio = { low: number; high: number; basis: RatioBasis };

export type SiblingEstimate = {
  low: number;
  mid: number;
  high: number;
  basis: RatioBasis;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Apply a ratio range to a known e1RM, yielding an estimated range for the sibling. */
export function convertWithRatio(fromE1rm: number, ratio: Ratio): SiblingEstimate {
  const low = round1(fromE1rm * ratio.low);
  const high = round1(fromE1rm * ratio.high);
  return { low, high, mid: round1((low + high) / 2), basis: ratio.basis };
}

/**
 * Prefer the personalized ratio when present; fall back to the seed. Returns null
 * when we have neither (so the caller can simply show "no comparison yet").
 */
export function chooseRatio(
  personal: { low: number; high: number } | null,
  seed: { low: number; high: number } | null
): Ratio | null {
  if (personal) return { low: personal.low, high: personal.high, basis: "personal" };
  if (seed) return { low: seed.low, high: seed.high, basis: "typical" };
  return null;
}

/**
 * Your personal ratio between two variants, derived from logged e1RMs
 * (to/from). Null until both have data. A single point estimate; the UI widens
 * it to a small band when displaying.
 */
export function personalRatio(fromE1rm: number, toE1rm: number): number | null {
  if (!fromE1rm || fromE1rm <= 0 || !toE1rm || toE1rm <= 0) return null;
  return Math.round((toE1rm / fromE1rm) * 1000) / 1000;
}

/** Widen a single personal ratio into a ±band so estimates read as ranges. */
export function bandFromPersonalRatio(
  ratio: number,
  band = 0.05
): { low: number; high: number } {
  return {
    low: Math.round(ratio * (1 - band) * 1000) / 1000,
    high: Math.round(ratio * (1 + band) * 1000) / 1000,
  };
}
