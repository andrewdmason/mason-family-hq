const FRIDAY = 5;

function labelFromDayOfWeek(dayOfWeek: number): string {
  if (dayOfWeek === FRIDAY || dayOfWeek === 6 || dayOfWeek === 0) {
    return "Due now";
  }

  const daysUntil = FRIDAY - dayOfWeek;
  if (daysUntil === 1) return "Due tomorrow";
  return `Due in ${daysUntil} days`;
}

export function readingTargetDueLabelFromDateKey(today: string): string {
  return labelFromDayOfWeek(new Date(`${today}T12:00:00`).getDay());
}

export function readingTargetDueLabel(date: Date = new Date()): string {
  return labelFromDayOfWeek(date.getDay());
}

/** Local YYYY-MM-DD for a Date, using its calendar day (not UTC). */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The date (YYYY-MM-DD) a target set on `fromKey` is due: the first Friday
 * *strictly after* that day. A target set Mon–Thu is due that same Friday (the
 * existing weekly cadence); one set on Friday or the weekend rolls to the next
 * Friday — so finishing a stretch always grants a fresh week instead of reading
 * "Due now" the moment it's set.
 */
export function readingTargetDueDateKey(fromKey: string): string {
  const base = new Date(`${fromKey}T12:00:00`);
  const ahead = ((FRIDAY - base.getDay() + 6) % 7) + 1; // 1..7, always future
  base.setDate(base.getDate() + ahead);
  return toDateKey(base);
}

/** A "Due …" label comparing a stored due date to today (both YYYY-MM-DD). */
export function readingDueLabelFromKeys(dueKey: string, todayKey: string): string {
  const due = new Date(`${dueKey}T12:00:00`).getTime();
  const today = new Date(`${todayKey}T12:00:00`).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days <= 0) return "Due now";
  if (days === 1) return "Due tomorrow";
  if (days === 7) return "Due in a week";
  return `Due in ${days} days`;
}
