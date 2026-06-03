import type { DatePrecision, TimelineEntry } from "@/lib/types";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Render a normalized date at its stored precision — never fabricating a day or
 * month the data doesn't have. "1986" stays 1986; "1999-06" reads "Jun 1999";
 * "2006-03-17" reads "Mar 17, 2006". `approximate` prefixes "circa".
 */
export function formatTimelineDate(
  date: string,
  precision: DatePrecision,
  approximate = false
): string {
  const [y, m, d] = date.split("-").map(Number);
  let label: string;
  if (precision === "year") label = String(y);
  else if (precision === "month") label = `${MONTH_ABBR[m - 1]} ${y}`;
  else label = `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
  return approximate ? `circa ${label}` : label;
}

type DatedEntry = Pick<
  TimelineEntry,
  "start_date" | "start_precision" | "end_date" | "end_precision" | "approximate"
>;

/**
 * A point event renders as its single date; a period renders as "start – end".
 * `approximate` applies to the start only (it's the uncertain anchor).
 */
export function formatTimelineRange(entry: DatedEntry): string {
  const start = formatTimelineDate(entry.start_date, entry.start_precision, entry.approximate);
  if (!entry.end_date || !entry.end_precision) return start;
  const end = formatTimelineDate(entry.end_date, entry.end_precision);
  return `${start} – ${end}`;
}

/** True when the event hasn't happened yet relative to `today` (YYYY-MM-DD). */
export function isUpcoming(entry: Pick<TimelineEntry, "start_date">, today: string): boolean {
  return entry.start_date > today;
}

/** The decade an entry sorts into, e.g. "1980s" — used for section headers. */
export function decadeOf(entry: Pick<TimelineEntry, "start_date">): string {
  const year = Number(entry.start_date.slice(0, 4));
  return `${Math.floor(year / 10) * 10}s`;
}
