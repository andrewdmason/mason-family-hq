import { addDays, localDate } from "@/lib/date-utils";

/**
 * Cadences offered in the row menu. Rolling, not calendar-anchored: "every 3
 * days" means three days after the last time the item was archived.
 */
export const REPEAT_INTERVAL_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

export function repeatIntervalLabel(days: number): string {
  if (days === 1) return "Every day";
  if (days === 7) return "Every week";
  return `Every ${days} days`;
}

/**
 * When the next occurrence should land. Anchored on the later of the item's own
 * day and today, so archiving a stale row from last Monday schedules forward
 * from now rather than into the past.
 */
export function nextOccurrenceDate(
  taskDate: string,
  intervalDays: number,
  today: string = localDate()
): string {
  const anchor = taskDate > today ? taskDate : today;
  return addDays(anchor, intervalDays);
}

/**
 * Whether a scheduled occurrence is still untouched, and so can be withdrawn
 * when its source is un-archived. Once it has been started, timed or archived
 * in its own right it belongs to its day and is left alone.
 */
export function isUntouchedOccurrence(row: {
  completed: boolean;
  started_at: string | null;
  timer_seconds: number;
  timer_remaining_seconds: number;
}): boolean {
  return (
    !row.completed &&
    row.started_at === null &&
    row.timer_remaining_seconds >= row.timer_seconds
  );
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/**
 * How a future day reads in a sentence: "tomorrow", "the day after", a weekday
 * name inside the coming week, and a plain date beyond that.
 */
export function relativeDayPhrase(
  targetDate: string,
  fromDate: string = localDate()
): string {
  if (targetDate === addDays(fromDate, 1)) return "tomorrow";
  if (targetDate === addDays(fromDate, 2)) return "the day after";
  const d = new Date(`${targetDate}T12:00:00`);
  const diff = Math.round(
    (d.getTime() - new Date(`${fromDate}T12:00:00`).getTime()) / 86_400_000
  );
  if (diff > 0 && diff <= 7) return WEEKDAY_FORMAT.format(d);
  return SHORT_DATE_FORMAT.format(d);
}

/** Capitalised standalone form of the same phrase, for buttons and chips. */
export function relativeDayLabel(
  targetDate: string,
  fromDate: string = localDate()
): string {
  const phrase = relativeDayPhrase(targetDate, fromDate);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
