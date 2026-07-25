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
 * Minutes as a reading estimate: "12 min left", "3 hr 20 min left". Rounded
 * coarsely on purpose — the estimate isn't precise enough to justify a number
 * that ticks every few seconds. Null when there's nothing meaningful left.
 */
export function formatTimeLeft(minutes: number | null): string | null {
  if (minutes == null) return null;
  const total = Math.round(minutes);
  if (total < 1) return "under a min left";
  if (total < 60) return `${total} min left`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} hr left` : `${hours} hr ${rest} min left`;
}
