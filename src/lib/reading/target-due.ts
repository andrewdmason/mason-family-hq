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
