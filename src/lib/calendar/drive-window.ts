// Pure drive-block math, shared by the server reconciler (drive-events.ts)
// and the calendar client (which synthesizes ghost blocks from optimistic
// duty state so a tap shows its block instantly). No server dependencies —
// keep it that way.

export type Duty = "dropoff" | "pickup";

/** Fallback drive time (each way) when no real one has been computed — the
 * block still lands on the calendar, marked as an estimate ("~"). */
export const FALLBACK_DRIVE_MINUTES = 20;

// When the SAME parent has both duties and driving home between them would
// leave less than this at home, they're realistically staying for the whole
// thing — one combined block (leave → return) instead of two overlapping ones.
export const COMBINE_GAP_MINUTES = 30;

const MIN_MS = 60_000;

/** The round-trip window a duty blocks out. All arithmetic is on stored
 * timestamptz instants (ms), so it's DST-safe. */
export function driveBlockWindow(args: {
  duty: Duty;
  startTime: string;
  endTime: string | null;
  teamsnapArrivalTime: string | null;
  driveMinutes: number;
  bufferMinutes: number;
}): { start: string; end: string } {
  const { driveMinutes, bufferMinutes } = args;
  if (args.duty === "dropoff") {
    // Leave home, arrive bufferMin early, drive straight home.
    const anchor = new Date(args.teamsnapArrivalTime ?? args.startTime).getTime();
    return {
      start: new Date(anchor - (driveMinutes + bufferMinutes) * MIN_MS).toISOString(),
      end: new Date(anchor - bufferMinutes * MIN_MS + driveMinutes * MIN_MS).toISOString(),
    };
  }
  // Pickup: arrive bufferMin before the end, kid out at the end, drive home.
  const anchor = new Date(args.endTime ?? args.startTime).getTime();
  return {
    start: new Date(anchor - (driveMinutes + bufferMinutes) * MIN_MS).toISOString(),
    end: new Date(anchor + driveMinutes * MIN_MS).toISOString(),
  };
}

export function driveEventTitle(args: {
  duty: Duty | "combined";
  kidName: string;
  driveMinutes: number;
  isEstimate: boolean;
}): string {
  // The number is the ONE-WAY drive — the thing you can't infer from the
  // block itself (whose span is the round trip plus the arrive-early buffer,
  // and whose position already says when to leave). "~" marks a fallback
  // estimate that hasn't been computed from the real route yet.
  const arrow =
    args.duty === "dropoff" ? "→" : args.duty === "pickup" ? "←" : "↔";
  return `🚗 ${arrow} ${args.kidName} ${args.isEstimate ? "~" : ""}${args.driveMinutes} min`;
}
