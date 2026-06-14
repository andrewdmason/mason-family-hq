import type { GeneratedEssay } from "@/lib/reading/quiz-generate";

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
 * The single insertable reading_quiz_questions row for a generated essay
 * assignment. An essay quiz is always exactly one question (position 0); the
 * anchor and rubric ride along so grading can ground itself later.
 */
export function essayQuestionRow(
  quizId: string,
  userId: string,
  essay: GeneratedEssay
) {
  return {
    quiz_id: quizId,
    user_id: userId,
    position: 0,
    type: "essay" as const,
    prompt: essay.prompt ?? "",
    anchor_summary: essay.anchorSummary,
    essay_rubric: essay.rubric,
    min_words: essay.minWords,
  };
}
