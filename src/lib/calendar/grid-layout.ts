import type { CalendarEvent } from "./types";

// Shared time-grid vocabulary for the axis views (day, week): minute math,
// lane packing, drive-arrow shapes, and the wash that renders other people's
// time as context rather than focus.

export const FAMILY_KEY = "__family__";
// Warm taupe-gray for shared/family events (the prototype's #8a8a80), so "ours"
// reads neutral-but-warm against the cream ground rather than a cool slate.
export const FAMILY_COLOR = "#8a8a80";

// A light wash of a member color — the textless silhouette blocks. Solid fills
// in thin columns drown out the focused content, so other members' time renders
// as context (washed) rather than focus (solid). Mixed with the page background,
// NOT transparent: a see-through block lets grid lines bleed through and reads
// as tentative/unaccepted.
export const wash = (color: string) =>
  `color-mix(in srgb, ${color} 30%, var(--background))`;

// Drive blocks render as arrows, not cards: a solid block in the color of the
// kid being driven whose pointed end is the direction of travel — rightward
// for drop-offs (out to the event), leftward for pick-ups (back home), both
// for a combined out-and-back. The point is cut by clip-path, so it spans the
// block's full extent and stays legible even on the shortest drives. The same
// polygon works for vertical blocks (day view) and horizontal bars (week view):
// the points sit on the left/right edges either way.
export const driveArrowClip = (
  duty: "dropoff" | "pickup" | "combined",
  depthPx: number,
) => {
  const p = `${depthPx}px`;
  if (duty === "combined")
    return `polygon(${p} 0, calc(100% - ${p}) 0, 100% 50%, calc(100% - ${p}) 100%, ${p} 100%, 0 50%)`;
  if (duty === "pickup")
    return `polygon(${p} 0, 100% 0, 100% 100%, ${p} 100%, 0 50%)`;
  return `polygon(0 0, calc(100% - ${p}) 0, 100% 50%, calc(100% - ${p}) 100%, 0 100%)`;
};

// The arrow's direction for a drive block. A combined (out-and-back) block is
// stored under the dropoff duty, so it's told apart by its title.
export const driveDutyOf = (
  e: CalendarEvent,
): "dropoff" | "pickup" | "combined" =>
  e.title.startsWith("Drop off + pickup")
    ? "combined"
    : e.drive_duty === "pickup"
      ? "pickup"
      : "dropoff";

export const localMin = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
export const startMin = (e: CalendarEvent) => localMin(e.start_time);
export const endMin = (e: CalendarEvent) => {
  const s = startMin(e);
  if (!e.end_time) return s + 30; // give a point-in-time event a visible block
  const em = localMin(e.end_time);
  return em <= s ? 24 * 60 : Math.max(em, s + 15); // clamp events crossing midnight
};
export const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  a.start_time.localeCompare(b.start_time) || endMin(a) - endMin(b);

export type Placed = { event: CalendarEvent; lane: number; lanes: number };

// Interval-partition a column's events into side-by-side lanes: chained overlaps
// form a cluster, and within it each event takes the first lane free at its start
// time. Every event in a cluster shares the cluster's lane count so their widths
// line up.
export function pack(events: CalendarEvent[]): Placed[] {
  const sorted = [...events].sort(byStart);
  const out: Placed[] = [];
  let cluster: { event: CalendarEvent; end: number; lane: number }[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = cluster.reduce((m, c) => Math.max(m, c.lane + 1), 0);
    for (const c of cluster) out.push({ event: c.event, lane: c.lane, lanes });
    cluster = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    const s = startMin(event);
    if (cluster.length && s >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const c of cluster)
      laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -1, c.end);
    let lane = 0;
    while (laneEnds[lane] != null && laneEnds[lane] > s) lane++;
    const e = endMin(event);
    cluster.push({ event, end: e, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

export const hourLabel = (h: number) => {
  const hr = h % 24;
  if (hr === 0) return "12a";
  if (hr < 12) return `${hr}a`;
  if (hr === 12) return "12p";
  return `${hr - 12}p`;
};

// A view's hour window: the default civil spine, widened (never shrunk) to
// swallow any event that runs earlier or later so nothing falls off the axis.
// Computed once per view from ALL its timed events, so every day shares one
// scale — different scales per day would break the across-days comparison.
export function timeWindow(
  timed: CalendarEvent[],
  defaults: { startH: number; endH: number },
): { minH: number; maxH: number } {
  let minH = defaults.startH;
  let maxH = defaults.endH;
  for (const e of timed) {
    minH = Math.min(minH, Math.floor(startMin(e) / 60));
    maxH = Math.max(maxH, Math.ceil(endMin(e) / 60));
  }
  return { minH: Math.max(0, minH), maxH: Math.min(24, maxH) };
}
