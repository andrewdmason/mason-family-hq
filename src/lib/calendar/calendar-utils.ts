// Pure date helpers + display formatting for the calendar views. All date math
// works in local time (no timezone conversion). Adapted from KidCalendar, with
// the drive-time / ticket-terminal / kid_id concepts removed.

import type { CalendarEvent } from "./types";

const MEMBER_PALETTE = [
  "#2563eb", // blue
  "#db2777", // pink
  "#16a34a", // green
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
];

// Deterministic per-member color from a fixed palette (family_members has no
// color column). Stable for a given email so a member keeps the same hue.
export function memberColor(email: string | null): string {
  if (!email) return "#64748b"; // slate — family-level events
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) | 0;
  }
  return MEMBER_PALETTE[Math.abs(hash) % MEMBER_PALETTE.length];
}

export function getWeekBounds(anchor: Date): { start: Date; end: Date } {
  const d = new Date(anchor);
  const day = d.getDay();
  // Shift so Monday = 0
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function getWeekDays(anchor: Date): Date[] {
  const { start } = getWeekBounds(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function getMonthGrid(anchor: Date): Date[][] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay();
  const diff = startDay === 0 ? -6 : 1 - startDay;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() + diff);

  const rows: Date[][] = [];
  const cursor = new Date(gridStart);
  for (let week = 0; week < 6; week++) {
    const row: Date[] = [];
    for (let day = 0; day < 7; day++) {
      row.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.push(row);
  }
  return rows;
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ============================================================
// All-day events: the one place the wall-clock-date contract lives.
//
// An all-day event has no time and no timezone — it's a floating wall-clock
// date. Every storage path (ICS, Google, manual) pins it to MIDNIGHT UTC of
// that date (e.g. 2026-06-06T00:00:00Z) so the stored instant is identical for
// everyone. The catch: that instant must then be READ BACK IN UTC. Reading it
// in the viewer's local zone shifts midnight UTC onto the previous day west of
// UTC (Pacific), which is the recurring "tomorrow's all-day event shows today"
// bug. Timed events are real instants and are read in the viewer's local zone.
//
// Route ALL event-day logic through eventDayKey / allDayInstant so no call site
// can forget the rule again.
// ============================================================

// The wall-clock date (YYYY-MM-DD) of a Date read in UTC.
export function utcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The calendar day an event belongs to, as a YYYY-MM-DD key: all-day events in
// UTC (where they're anchored), timed events in the viewer's local zone. This is
// the canonical "what day is this event on?" used by every Calendar view.
export function eventDayKey(event: CalendarEvent): string {
  const d = new Date(event.start_time);
  return event.all_day ? utcDateKey(d) : toDateKey(d);
}

// A wall-clock date (YYYY-MM-DD) as the canonical all-day instant: midnight UTC.
// Every all-day event is stored this way so eventDayKey reads it back correctly.
export function allDayInstant(ymd: string): string {
  return `${ymd.slice(0, 10)}T00:00:00.000Z`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function googleMapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

export function groupEventsByDay(
  events: CalendarEvent[],
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = eventDayKey(event);
    const arr = map.get(key) ?? [];
    arr.push(event);
    map.set(key, arr);
  }
  return map;
}

export function formatDayLabel(date: Date): string {
  const today = new Date();
  if (isSameDay(date, today)) return "Today";
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (isSameDay(date, tomorrow)) return "Tomorrow";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// The long, human date for an event ("Saturday, June 6, 2026"). All-day events
// are read in UTC (where they're anchored); timed events in the viewer's zone.
export function formatEventDate(event: CalendarEvent): string {
  return new Date(event.start_time).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    ...(event.all_day ? { timeZone: "UTC" } : {}),
  });
}

export function formatTimeRange(
  startTime: string,
  endTime: string | null,
  allDay: boolean,
): string {
  if (allDay) return "All day";
  const start = new Date(startTime);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  if (!endTime) return fmt(start);
  const end = new Date(endTime);
  return `${fmt(start)} – ${fmt(end)}`;
}

export function formatWeekLabel(anchor: Date): string {
  const { start, end } = getWeekBounds(anchor);
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

export function formatMonthLabel(anchor: Date): string {
  return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function parseAnchorDate(dateStr: string | undefined): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr + "T12:00:00");
  return isNaN(d.getTime()) ? new Date() : d;
}

function stripEmoji(text: string): string {
  return text.replace(/\p{Emoji_Presentation}\s*/gu, "").trim();
}

/**
 * Extract the opposing team from titles like "Team A vs. Team B" or
 * "Team A @ Team B". Returns the side that does NOT contain `sourceName`, or
 * null if the pattern doesn't match.
 */
export function extractOpponent(
  title: string,
  sourceName: string,
): string | null {
  const prefixPattern = new RegExp(`^${sourceName}:\\s*`, "i");
  const stripped = title.replace(prefixPattern, "");

  for (const sep of [" vs. ", " vs ", " @ "]) {
    const idx = stripped.toLowerCase().indexOf(sep.toLowerCase());
    if (idx === -1) continue;
    const left = stripped.substring(0, idx).trim();
    const right = stripped.substring(idx + sep.length).trim();
    if (right.toLowerCase().includes(sourceName.toLowerCase()))
      return stripEmoji(left);
    if (left.toLowerCase().includes(sourceName.toLowerCase()))
      return stripEmoji(right);
  }
  return null;
}

export function formatDisplayTitle(
  event: CalendarEvent,
  sourceName: string | null | undefined,
): string {
  if (
    event.source_type === "teamsnap" &&
    event.teamsnap_is_game &&
    event.teamsnap_opponent
  ) {
    const prefix = sourceName ?? "Team";
    return `${prefix}: vs ${event.teamsnap_opponent}`;
  }

  if (sourceName) {
    const opponent = extractOpponent(event.title, sourceName);
    if (opponent) return opponent;

    if (event.title.toLowerCase().startsWith(sourceName.toLowerCase())) {
      return event.title;
    }
    return `${sourceName}: ${event.title}`;
  }

  return event.title;
}
