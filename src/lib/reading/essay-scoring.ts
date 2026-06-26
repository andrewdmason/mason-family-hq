// Essay scoring thresholds, shared by the grader (lib/reading/quiz-grade.ts), the
// Mason Bucks award (lib/bucks/earn.ts), and the reader-facing UI copy so the pass
// bar and the bonus can never drift apart. Client-safe: no "server-only" import.

import type { EssayRubricScores } from "@/lib/types";

/** Each of the three dimensions scores 1–4, so an essay totals out of 12. */
export const ESSAY_MAX_SCORE = 12;

/**
 * Pass bar: the three dimensions must SUM to at least this. A weak dimension can be
 * carried by a strong one (e.g. a 2 and a 4 still pass), so it's the total that
 * advances the book, not a floor on every part.
 */
export const ESSAY_PASS_MIN = 9;

/** A standout essay (this total or higher, out of 12) earns a one-time bonus. */
export const ESSAY_BONUS_MIN = 11;

/** Mason Bucks granted once for a standout essay. */
export const ESSAY_BONUS_BUCKS = 30;

/** Sum the three rubric dimensions, or null if any one isn't graded yet. */
export function essayTotalScore(scores: EssayRubricScores | null): number | null {
  if (!scores) return null;
  const c = scores.comprehension.score;
  const m = scores.mechanics.score;
  const t = scores.thinking.score;
  if (c == null || m == null || t == null) return null;
  return c + m + t;
}
