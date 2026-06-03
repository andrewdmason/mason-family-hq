import type { QuizQuestionDraft } from "@/lib/reading/quiz-generate";

/** A readable fallback title from a quiz's covered page range. */
export function defaultQuizTitle(
  fromPage: number | null,
  throughPage: number
): string {
  return fromPage != null && fromPage > 1
    ? `Pages ${fromPage}–${throughPage}`
    : `Through page ${throughPage}`;
}

/** Map generated question drafts to insertable reading_quiz_questions rows. */
export function questionRows(
  quizId: string,
  userId: string,
  drafts: QuizQuestionDraft[]
) {
  return drafts.map((q, i) => ({
    quiz_id: quizId,
    user_id: userId,
    position: i,
    type: q.type,
    prompt: q.prompt,
    options: q.type === "multiple_choice" ? q.options : null,
    correct_index: q.type === "multiple_choice" ? q.correctIndex : null,
    explanation: q.type === "multiple_choice" ? q.explanation : null,
    grading_rubric: q.type === "free_text" ? q.gradingRubric : null,
    sample_answer: q.type === "free_text" ? q.sampleAnswer : null,
  }));
}
