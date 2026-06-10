/**
 * Fractional indexing for manual ordering. A task's position is a float: new
 * items append at max+1, a drag drops the item at the midpoint of its new
 * neighbors. One UPDATE per move — no shifting of sibling rows — which keeps
 * optimistic drag-and-drop trivially consistent.
 *
 * Floats lose usable precision after ~50 consecutive midpoint inserts at the
 * same spot; when the gap closes below MIN_GAP the caller renormalizes the
 * visible list back to integers (family-scale lists, so a renormalize is a
 * handful of updates at worst).
 */

export const MIN_GAP = 1e-9;

/** Sort position between two neighbors (either side may be absent). */
export function sortBetween(
  prev: number | null | undefined,
  next: number | null | undefined
): number {
  if (prev == null && next == null) return 0;
  if (prev == null) return (next as number) - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

/** True when the neighbors are too close for a clean midpoint. */
export function needsRenormalize(
  prev: number | null | undefined,
  next: number | null | undefined
): boolean {
  if (prev == null || next == null) return false;
  return next - prev < MIN_GAP;
}
