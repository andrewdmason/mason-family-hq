import type { GeneratedEssaySet } from "@/lib/reading/quiz-generate";

/** A readable fallback title from a quiz's covered page range. */
export function defaultQuizTitle(
  fromPage: number | null,
  throughPage: number
): string {
  return fromPage != null && fromPage > 1
    ? `Pages ${fromPage}–${throughPage}`
    : `Through page ${throughPage}`;
}

/**
 * The insertable reading_quiz_questions rows for a generated essay assignment —
 * one per candidate prompt (positions 0, 1, 2…), each carrying its own anchor and
 * rubric so grading the chosen one can ground itself later. The reader commits to
 * one of these before writing.
 */
export function essayQuestionRows(
  quizId: string,
  userId: string,
  set: GeneratedEssaySet
) {
  return set.options.map((option, i) => ({
    quiz_id: quizId,
    user_id: userId,
    position: i,
    type: "essay" as const,
    prompt: option.prompt,
    anchor_summary: option.anchorSummary,
    essay_rubric: option.rubric,
    min_words: set.minWords,
  }));
}
