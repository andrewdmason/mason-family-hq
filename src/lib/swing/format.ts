// Shared display formatting for the swing app.

/** "head_movement" → "Head movement" — issue keys double as compact labels. */
export function humanizeIssueKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** filmed_on is a plain YYYY-MM-DD — format from parts, never through UTC
 * (Date("YYYY-MM-DD") parses as UTC midnight and shifts a day west of it). */
export function formatDateOnly(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
