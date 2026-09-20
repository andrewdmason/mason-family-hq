import { daysBetween } from "@/lib/date-utils";
import type { Piece } from "@/lib/types";

/**
 * How long a maintenance task runs by default. Flat rather than per-piece: the
 * point of the rotation is that nothing has to be configured, and the goal is
 * still editable on the row like any other task.
 */
export const MAINTENANCE_GOAL_SECONDS = 20 * 60;

export type MaintenancePick = {
  piece: Piece;
  /** Whole days since real practice, or null if it has never been practiced. */
  daysSince: number | null;
};

/**
 * Whichever maintenance piece has gone longest without real practice, skipping
 * anything already asking for attention.
 *
 * Never-practiced pieces come first — they are the most overdue thing there is.
 * Ties break on name so repeated renders name the same piece and the label
 * doesn't flicker between them.
 *
 * `excluded` carries the pieces already on the day being looked at and the ones
 * sitting in the unfinished pile. It is supplied by the caller (rather than
 * derived here) because the log knows about optimistic rows the server hasn't
 * seen yet: that is what lets two taps in a row offer two different pieces
 * without a round trip.
 */
export function pickMaintenancePiece({
  pieces,
  lastPracticedByPiece,
  excluded,
  asOf,
}: {
  pieces: Piece[];
  lastPracticedByPiece: Record<string, string>;
  excluded: ReadonlySet<string>;
  asOf: string;
}): MaintenancePick | null {
  let best: MaintenancePick | null = null;
  let bestRank = -Infinity;

  for (const piece of pieces) {
    if (!piece.maintenance || excluded.has(piece.id)) continue;
    const last = lastPracticedByPiece[piece.id];
    const daysSince = last ? daysBetween(last, asOf) : null;
    const rank = daysSince ?? Infinity;
    if (
      rank > bestRank ||
      (rank === bestRank && best !== null && piece.name.localeCompare(best.piece.name) < 0)
    ) {
      best = { piece, daysSince };
      bestRank = rank;
    }
  }

  return best;
}

/** How a days-since count reads in a tight space: "12d", or "new" for never. */
export function daysSinceLabel(daysSince: number | null): string {
  return daysSince === null ? "new" : `${daysSince}d`;
}

/** The rotation button's label — it names its piece before you commit to it. */
export function maintenanceLabel(pick: MaintenancePick): string {
  return `Maintenance — ${pick.piece.name} · ${daysSinceLabel(pick.daysSince)}`;
}
