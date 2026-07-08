// Essay scoring, shared by the grader (lib/reading/quiz-grade.ts), the Mason Bucks
// award (lib/bucks/earn.ts), and the reader-facing UI copy so the pass bar and the
// bonus can never drift apart. Client-safe: no "server-only" import.
//
// The essay is graded on ONE dimension — Quality of Thinking, on a below/meets/exceeds
// band — behind two pass/fail gates:
//   • Comprehension (Part 1) — a separate first step, cleared once per quiz before the
//     essay screen even opens (see ReadingQuiz.comprehension_cleared_at). By the time
//     an essay is graded it's already been cleared, so it isn't part of the grade here.
//   • Grammar/writing — a readability gate on the essay itself (readable sentences,
//     spelling, punctuation, paragraphs — never style). A failed gate blocks the pass.
//
// "meets" passes (advances the book); "exceeds" additionally earns the standout bonus.

import type { EssayRubricScores, ThinkingBand } from "@/lib/types";

/** Mason Bucks granted once (per quiz) for a standout — an "exceeds" essay. */
export const ESSAY_BONUS_BUCKS = 30;

/** Did the grammar gate pass? null = not graded yet. */
export function essayGrammarMet(scores: EssayRubricScores | null): boolean | null {
  return scores ? scores.grammar.met : null;
}

/** The thinking band, or null if not graded yet. */
export function essayThinkingBand(
  scores: EssayRubricScores | null
): ThinkingBand | null {
  return scores?.thinking.band ?? null;
}

/** Passed = grammar gate met AND the thinking reaches at least "meets". (The
 *  comprehension gate is a prerequisite cleared before the essay, so it isn't
 *  re-checked here.) */
export function essayPassed(scores: EssayRubricScores | null): boolean {
  const band = essayThinkingBand(scores);
  return (
    essayGrammarMet(scores) === true && (band === "meets" || band === "exceeds")
  );
}

/** Exceeded = grammar gate met AND the thinking reaches "exceeds" — the bonus bar. */
export function essayExceeded(scores: EssayRubricScores | null): boolean {
  return essayGrammarMet(scores) === true && essayThinkingBand(scores) === "exceeds";
}
