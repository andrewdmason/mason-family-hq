import { localDate } from "@/lib/date-utils";

/** The family's day. A session belongs to the day it's started on here, wherever the server is. */
export const WORDS_TZ = process.env.FAMILY_TIMEZONE || "America/Los_Angeles";

export function wordsToday(now: Date = new Date()): string {
  return localDate(now, WORDS_TZ);
}
