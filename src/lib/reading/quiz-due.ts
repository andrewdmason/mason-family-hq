import { addDays } from "@/lib/date-utils";

/**
 * The weekly cadence for check-in quizzes: they're due every Friday. From Friday
 * through the end of the week (Sun) an unfinished quiz reads as "due now"; Mon–Thu
 * it's available but not yet pressing. `dayOfWeek` is JS getDay(): 0 = Sun … 6 = Sat.
 */
export function isQuizDueWindow(dayOfWeek: number): boolean {
  return dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0; // Fri, Sat, Sun
}

/**
 * The Friday (local date key) that opened the current Fri–Sun due window, or null
 * when today is outside it (Mon–Thu). `today` is a YYYY-MM-DD local date key.
 */
export function dueWindowFriday(dayOfWeek: number, today: string): string | null {
  if (!isQuizDueWindow(dayOfWeek)) return null;
  const back = dayOfWeek === 0 ? 2 : dayOfWeek - 5; // Sun→2, Sat→1, Fri→0
  return addDays(today, -back);
}

/**
 * Whether an active check-in quiz reads as "due now". It's due inside the Fri–Sun
 * window — but only once its stretch began *before* this window's Friday, so a book
 * added (or a stretch started) during the window isn't nagged as due the same week.
 * `startedOn` is the stretch's start date key (the quiz's creation date); `today`
 * is a local date key.
 */
export function isQuizDue(
  dayOfWeek: number,
  startedOn: string,
  today: string
): boolean {
  const friday = dueWindowFriday(dayOfWeek, today);
  return friday != null && startedOn < friday;
}

/** The display state of an active (published, not-yet-passed) check-in quiz. */
export type ActiveQuizState = "ready" | "due" | "retake";

/**
 * What to surface for an active quiz. A failed attempt needs a retake (the most
 * pressing); an untouched quiz is "due" inside the Friday window, otherwise just
 * "ready" and waiting.
 */
export function activeQuizState(
  attempted: boolean,
  dueNow: boolean
): ActiveQuizState {
  if (attempted) return "retake";
  return dueNow ? "due" : "ready";
}
