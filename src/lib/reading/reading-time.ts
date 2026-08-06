import { READING_WORDS_PER_MINUTE } from "@/lib/reading/constants";

/**
 * "How much longer?" — the reader's time-left readouts, from a word count and a
 * steady words-a-minute assumption.
 */

/** Minutes to read `words`, or null when we don't know the word count. */
export function minutesToRead(words: number | null): number | null {
  if (words == null || words <= 0) return null;
  return words / READING_WORDS_PER_MINUTE;
}

/**
 * Minutes as a plain length: "12 min", "3 hr 20 min". What the contents shows
 * against a chapter you haven't started, where "left" would be a lie.
 */
export function formatDuration(minutes: number | null): string | null {
  if (minutes == null) return null;
  const total = Math.round(minutes);
  if (total < 1) return "under a min";
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Minutes as a reading estimate: "12 min left", "3 hr 20 min left". Rounded
 * coarsely on purpose — the estimate isn't precise enough to justify a number
 * that ticks every few seconds. Null when there's nothing meaningful left.
 *
 * Built on formatDuration so the contents and the running head can't round the
 * same number two different ways.
 */
export function formatTimeLeft(minutes: number | null): string | null {
  const duration = formatDuration(minutes);
  return duration == null ? null : `${duration} left`;
}
