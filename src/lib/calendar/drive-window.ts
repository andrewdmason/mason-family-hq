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

/** The window a duty blocks out — a round trip, unless the assigned parent is
 * also attending the event, in which case the trip is one-way (they stay at
 * the venue after drop-off / leave from it after pick-up). All arithmetic is
 * on stored timestamptz instants (ms), so it's DST-safe. */
export function driveBlockWindow(args: {
  duty: Duty;
  startTime: string;
  endTime: string | null;
  teamsnapArrivalTime: string | null;
  driveMinutes: number;
  bufferMinutes: number;
  attending?: boolean;
}): { start: string; end: string } {
  const { driveMinutes, bufferMinutes } = args;
  if (args.duty === "dropoff") {
    // Leave home, arrive bufferMin early; then either drive straight home or
    // (attending) stay — the block ends at the arrival anchor, where the
    // event takes over.
    const anchor = new Date(args.teamsnapArrivalTime ?? args.startTime).getTime();
    const start = new Date(
      anchor - (driveMinutes + bufferMinutes) * MIN_MS,
    ).toISOString();
    return {
      start,
      end: args.attending
        ? new Date(anchor).toISOString()
        : new Date(anchor - bufferMinutes * MIN_MS + driveMinutes * MIN_MS).toISOString(),
    };
  }
  // Pickup: arrive bufferMin before the end, kid out at the end, drive home —
  // or (attending) already at the venue, so just the drive home from the end.
  const anchor = new Date(args.endTime ?? args.startTime).getTime();
  return {
    start: args.attending
      ? new Date(anchor).toISOString()
      : new Date(anchor - (driveMinutes + bufferMinutes) * MIN_MS).toISOString(),
    end: new Date(anchor + driveMinutes * MIN_MS).toISOString(),
  };
}

/** "3pm" / "3:15pm" — a stop instant as it reads in a calendar title,
 * formatted in the family's home timezone (passed in explicitly so the server
 * reconciler and the client's ghost blocks render byte-identical titles). */
export function clockTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const minute = get("minute");
  return `${get("hour")}${minute === "00" ? "" : `:${minute}`}${get(
    "dayPeriod",
  ).toLowerCase()}`;
}

export function driveEventTitle(args: {
  duty: Duty | "combined";
  kidName: string;
  /** The stop instant — drop-off arrival anchor / pick-up at the event end. */
  anchor: string;
  timeZone: string;
  driveMinutes: number;
  isEstimate: boolean;
  /** The source event's own title. When the same parent runs BOTH legs the
   * block stands in for the whole outing, so it reads as the event itself —
   * "BJ lesson (~20 min drive)" — with the single one-way drive figure
   * covering it (no separate drive-home leg). */
  eventTitle?: string | null;
}): string {
  const est = args.isEstimate ? "~" : "";
  // A combined (same parent, both legs) block IS the event from the parent's
  // side — title it after the event, not the duty.
  if (args.duty === "combined" && args.eventTitle) {
    return `${args.eventTitle} (${est}${args.driveMinutes} min drive)`;
  }
  // "@ time" is the stop itself and the number is the ONE-WAY drive — the two
  // things you can't infer from the block itself (whose span is the round trip
  // plus the arrive-early buffer — or just the one-way leg when the parent is
  // attending — and whose position already says when to leave). "~" marks a
  // fallback estimate that hasn't been computed from the real route yet.
  const verb =
    args.duty === "dropoff"
      ? "Drop off"
      : args.duty === "pickup"
        ? "Pickup"
        : "Drop off + pickup";
  return `${verb} ${args.kidName} @ ${clockTime(
    args.anchor,
    args.timeZone,
  )} (${est}${args.driveMinutes} min drive)`;
}

// ---------------------------------------------------------------------------
// Cross-event merge. When the SAME parent has several same-direction blocks
// (drop-offs for two kids' practices, say) whose windows overlap or leave less
// than the combine gap at home between trips, reality is ONE multi-stop trip —
// home → stop → stop → home — not stacked round trips that read as a
// scheduling conflict. Cluster them; the earliest stop's assignment owns the
// single written block, the rest materialize nothing.
// ---------------------------------------------------------------------------

/** One assignment's would-be block, the clustering input. Shared between the
 * server reconciler (key = assignment id) and the client's ghost synthesis
 * (key = `${eventId}:${duty}`). */
export interface PlannedDriveBlock {
  key: string;
  assignee: string;
  /** Combined (↔) blocks never cross-merge — that parent is staying at the
   * venue for the whole event, not running an errand loop. */
  duty: Duty | "combined";
  /** One-way block for a parent attending the event. Never cross-merges
   * either: the trip starts or ends at the venue, not at home, so the merged
   * window's home-between-trips math doesn't apply. */
  attending?: boolean;
  kidName: string;
  location: string | null;
  window: { start: string; end: string };
  /** The block's own solo title — the cluster title when it stays alone. */
  title: string;
  /** The stop instant (drop-off arrival anchor / pick-up end), for the merged
   * block's stop-list description. */
  anchor: string;
  isEstimate: boolean;
}

export interface DriveCluster {
  /** In stop order (earliest window first); members[0] owns the written block. */
  members: PlannedDriveBlock[];
  window: { start: string; end: string };
  title: string;
  /** The first stop — what fits in a location field; the rest go in the
   * description. */
  location: string | null;
  isEstimate: boolean;
}

function toCluster(
  members: PlannedDriveBlock[],
  timeZone: string,
): DriveCluster {
  if (members.length === 1) {
    const m = members[0];
    return {
      members,
      window: m.window,
      title: m.title,
      location: m.location,
      isEstimate: m.isEstimate,
    };
  }
  // Merged title keeps the first stop's time but drops the minutes: the
  // one-way number describes a single round trip, and the union window is only
  // an approximation of the real multi-stop route (it ignores the venue→venue
  // leg) — hence estimate.
  const verb = members[0].duty === "dropoff" ? "Drop off" : "Pickup";
  const names = [...new Set(members.map((m) => m.kidName))];
  const end = members.reduce(
    (max, m) => (m.window.end > max ? m.window.end : max),
    members[0].window.end,
  );
  return {
    members,
    window: { start: members[0].window.start, end },
    title: `${verb} ${names.join(" + ")} @ ${clockTime(
      members[0].anchor,
      timeZone,
    )}`,
    location: members[0].location,
    isEstimate: true,
  };
}

/** Cluster blocks by (assignee, duty): sort by start, then chain any block
 * that begins less than COMBINE_GAP_MINUTES after the running cluster ends —
 * the same "no real time at home between trips" rule as the per-event ↔
 * combine. Every input block lands in exactly one cluster (solos included),
 * so callers can treat the output uniformly. */
export function clusterDriveBlocks(
  blocks: PlannedDriveBlock[],
  timeZone: string,
): DriveCluster[] {
  const groups = new Map<string, PlannedDriveBlock[]>();
  const clusters: DriveCluster[] = [];
  for (const b of blocks) {
    if (b.duty === "combined" || b.attending) {
      clusters.push(toCluster([b], timeZone));
      continue;
    }
    const k = `${b.assignee}:${b.duty}`;
    const list = groups.get(k);
    if (list) list.push(b);
    else groups.set(k, [b]);
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        a.window.start.localeCompare(b.window.start) ||
        a.key.localeCompare(b.key),
    );
    let run: PlannedDriveBlock[] = [];
    let runEnd = 0;
    for (const b of list) {
      const start = new Date(b.window.start).getTime();
      if (run.length && start - runEnd >= COMBINE_GAP_MINUTES * MIN_MS) {
        clusters.push(toCluster(run, timeZone));
        run = [];
      }
      run.push(b);
      runEnd = Math.max(runEnd, new Date(b.window.end).getTime());
    }
    if (run.length) clusters.push(toCluster(run, timeZone));
  }
  return clusters;
}
