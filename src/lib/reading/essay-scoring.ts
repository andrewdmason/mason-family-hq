// Essay scoring thresholds, shared by the grader (lib/reading/quiz-grade.ts), the
// Mason Bucks award (lib/bucks/earn.ts), and the reader-facing UI copy so the pass
// bar and the bonus can never drift apart. Client-safe: no "server-only" import.
//
// Two-part model: Part 1 (comprehension) is a pass/fail GATE — did the kid prove
// they read the pages? — and carries no points. The earned grade comes entirely
// from Part 2's two dimensions (thinking + mechanics), each 1–4, so it totals out
// of 8. A quiz passes only when the gate is met AND the earned score clears the bar,
// so a strong Part 2 is never dragged down by a terse Part 1, and a kid who plainly
// didn't read can't pass on Part 2 alone.

import type { EssayRubricScores } from "@/lib/types";

/** Part 2's two dimensions (thinking + mechanics) each score 1–4, out of 8. */
export const ESSAY_EARNED_MAX = 8;

/** Pass bar on the earned (Part 2) score, once the comprehension gate is met. */
export const ESSAY_PASS_MIN = 5;

/** A standout essay (earned score at or above this, gate met) earns a one-time bonus. */
export const ESSAY_BONUS_MIN = 7;

/** Mason Bucks granted once for a standout essay. */
export const ESSAY_BONUS_BUCKS = 30;

/** Did the short Part 1 prove the kid read the pages? null = not graded yet. */
export function essayComprehensionMet(
  scores: EssayRubricScores | null
): boolean | null {
  return scores ? scores.comprehension.met : null;
}

/** The earned Part 2 score: thinking + mechanics (out of 8), or null if either
 *  dimension isn't graded yet. */
export function essayEarnedScore(
  scores: EssayRubricScores | null
): number | null {
  if (!scores) return null;
  const m = scores.mechanics.score;
  const t = scores.thinking.score;
  if (m == null || t == null) return null;
  return m + t;
}

/** Passed = comprehension gate met AND the earned score clears the pass bar. */
export function essayPassed(scores: EssayRubricScores | null): boolean {
  const earned = essayEarnedScore(scores);
  return (
    essayComprehensionMet(scores) === true &&
    earned != null &&
    earned >= ESSAY_PASS_MIN
  );
}

/** Standout = gate met AND the earned score reaches the bonus bar. */
export function essayEarnedBonus(scores: EssayRubricScores | null): boolean {
  const earned = essayEarnedScore(scores);
  return (
    essayComprehensionMet(scores) === true &&
    earned != null &&
    earned >= ESSAY_BONUS_MIN
  );
}
