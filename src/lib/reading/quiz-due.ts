/**
 * The weekly cadence for check-in quizzes: they're due every Friday. From Friday
 * through the end of the week (Sun) an unfinished quiz reads as "due now"; Mon–Thu
 * it's available but not yet pressing. `dayOfWeek` is JS getDay(): 0 = Sun … 6 = Sat.
 */
export function isQuizDueWindow(dayOfWeek: number): boolean {
  return dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0; // Fri, Sat, Sun
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
