"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { resolveReadingScope } from "@/lib/reading/scope";
import { isQuizDue } from "@/lib/reading/quiz-due";
import { getTextForRange } from "@/lib/reading/extract-text";
import { generateEssayAssignment } from "@/lib/reading/quiz-generate";
import {
  gradeEssay,
  gradeFreeText,
  gradeMultipleChoice,
} from "@/lib/reading/quiz-grade";
import { readerAge } from "@/lib/reading/reader-age";
import { essayMinWords, loadReaderContext } from "@/lib/reading/reader-context";
import { defaultQuizTitle, essayQuestionRow } from "@/lib/reading/quiz-build";
import { advanceStretch } from "@/lib/reading/advance";
import { archiveOtherOpenQuizzes } from "@/lib/reading/supersede";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import type {
  ActiveBookQuiz,
  EssayRubric,
  EssayRubricScores,
  ReadingAdminAttempt,
  ReadingAdminBook,
  ReadingAdminMember,
  ReadingAdminQuiz,
  ReadingEssayFeedback,
  ReadingQuiz,
  ReadingQuizAnswer,
  ReadingQuizQuestion,
  ReadingQuizResult,
  ReadingQuizStatus,
  ReadingQuizSubmission,
  ReadingQuizWithQuestions,
} from "@/lib/types";

// Full columns, including the essay's grader-facing anchor — used where the owner
// edits a draft or the server grades a submission.
const QUESTION_COLUMNS =
  "id, quiz_id, user_id, position, type, prompt, options, correct_index, explanation, grading_rubric, sample_answer, anchor_summary, essay_rubric, min_words, created_at";
// Results view: same minus anchor_summary, which is grader-only and must not reach
// the reader's browser (it would hint at what the opening should say).
const RESULT_QUESTION_COLUMNS =
  "id, quiz_id, user_id, position, type, prompt, options, correct_index, explanation, grading_rubric, sample_answer, essay_rubric, min_words, created_at";
const ANSWER_COLUMNS =
  "id, submission_id, question_id, user_id, selected_index, response_text, is_correct, ai_notes, rubric_scores, created_at";
const QUIZ_COLUMNS =
  "id, user_id, book_id, from_page, through_page, status, title, created_by_email, source, generation_error, published_at, created_at, updated_at";

/** True once any of a quiz's attempts answered every question correctly. */
function isPassed(
  subs: { score_correct: number | null; score_total: number | null }[]
): boolean {
  return subs.some(
    (s) =>
      (s.score_total ?? 0) > 0 && (s.score_correct ?? 0) === (s.score_total ?? 0)
  );
}

const GENERATION_FAILED_NOTE =
  "Couldn't write an essay prompt from this book — try generating again.";

/** The signed-in caller's email (the owner authoring a quiz), from the session. */
async function callerEmail(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!email) throw new Error("Not authenticated");
  return email;
}

function revalidateQuizzes() {
  revalidatePath("/reader");
  revalidatePath("/reader/quizzes");
}

// ============================================================
// Authoring (owner; member mode when generating for a kid)
// ============================================================

/**
 * Generate a draft quiz for a book through a given page. Owner-only. Always
 * leaves a draft behind: if generation yields no usable questions, the draft is
 * saved with a generation_error so the editor can offer "Try again".
 */
export async function generateQuizDraft(input: {
  bookId: string;
  fromPage?: number | null;
  throughPage: number;
  memberEmail?: string | null;
}): Promise<{ quizId: string }> {
  await requireOwner();
  const author = await callerEmail();
  const { client, userId, email } = await resolveReadingScope(input.memberEmail);

  const throughPage = Math.max(1, Math.floor(input.throughPage));
  const fromPage =
    input.fromPage != null && input.fromPage > 1
      ? Math.min(Math.floor(input.fromPage), throughPage)
      : null;

  const { data: book, error: bookError } = await client
    .from("reading_books")
    .select("title, author")
    .eq("id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (bookError) throw new Error(bookError.message);
  if (!book) throw new Error("Book not found.");

  const slice = await getTextForRange(
    client,
    userId,
    input.bookId,
    fromPage,
    throughPage
  );
  if (!slice) {
    throw new Error("This book hasn't finished uploading yet — try again once it's ready.");
  }

  const age = await readerAge(email);
  const [minWords, readerContext] = await Promise.all([
    essayMinWords(email, age),
    loadReaderContext(client, userId),
  ]);
  const generated = await generateEssayAssignment({
    bookTitle: book.title as string,
    author: (book.author as string) ?? null,
    fromPage,
    throughPage,
    text: slice.text,
    readerAge: age,
    readerContext,
    minWords,
  });

  const { data: quiz, error: quizError } = await client
    .from("reading_quizzes")
    .insert({
      user_id: userId,
      book_id: input.bookId,
      from_page: fromPage,
      through_page: throughPage,
      status: "draft",
      title: generated.title ?? defaultQuizTitle(fromPage, throughPage),
      created_by_email: author,
      source: "manual",
      generation_error: generated.prompt ? null : GENERATION_FAILED_NOTE,
    })
    .select("id")
    .single();
  if (quizError) throw new Error(quizError.message);
  const quizId = quiz.id as string;

  if (generated.prompt) {
    const { error: qError } = await client
      .from("reading_quiz_questions")
      .insert(essayQuestionRow(quizId, userId, generated));
    if (qError) throw new Error(qError.message);
  }

  revalidateQuizzes();
  return { quizId };
}

/** Regenerate a draft's questions in place (replaces them all). Owner-only. */
export async function regenerateQuizDraft(
  quizId: string,
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId, email } = await resolveReadingScope(memberEmail);

  const { data: quiz, error } = await client
    .from("reading_quizzes")
    .select("book_id, from_page, through_page, status")
    .eq("id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!quiz) throw new Error("Quiz not found.");
  if (quiz.status !== "draft") throw new Error("Only a draft can be regenerated.");

  const { data: book } = await client
    .from("reading_books")
    .select("title, author")
    .eq("id", quiz.book_id as string)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) throw new Error("Book not found.");

  const fromPage = (quiz.from_page as number | null) ?? null;
  const throughPage = quiz.through_page as number;
  const slice = await getTextForRange(
    client,
    userId,
    quiz.book_id as string,
    fromPage,
    throughPage
  );
  if (!slice) throw new Error("This book isn't ready for a quiz yet.");

  const age = await readerAge(email);
  const [minWords, readerContext] = await Promise.all([
    essayMinWords(email, age),
    loadReaderContext(client, userId),
  ]);
  const generated = await generateEssayAssignment({
    bookTitle: book.title as string,
    author: (book.author as string) ?? null,
    fromPage,
    throughPage,
    text: slice.text,
    readerAge: age,
    readerContext,
    minWords,
  });

  await client.from("reading_quiz_questions").delete().eq("quiz_id", quizId);
  if (generated.prompt) {
    const { error: qError } = await client
      .from("reading_quiz_questions")
      .insert(essayQuestionRow(quizId, userId, generated));
    if (qError) throw new Error(qError.message);
  }

  await client
    .from("reading_quizzes")
    .update({
      title: generated.title ?? defaultQuizTitle(fromPage, throughPage),
      generation_error: generated.prompt ? null : GENERATION_FAILED_NOTE,
    })
    .eq("id", quizId)
    .eq("user_id", userId);

  revalidateQuizzes();
}

/** Edit one draft question. Owner-only; rejects edits to a published quiz. */
export async function updateQuizQuestion(
  questionId: string,
  patch: {
    prompt?: string;
    options?: string[];
    correctIndex?: number;
    explanation?: string;
    gradingRubric?: string;
    sampleAnswer?: string;
    essayRubric?: EssayRubric;
    minWords?: number;
  },
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: question } = await client
    .from("reading_quiz_questions")
    .select("id, quiz_id, reading_quizzes!inner(status)")
    .eq("id", questionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!question) throw new Error("Question not found.");
  const status = (question.reading_quizzes as { status?: string } | null)?.status;
  if (status !== "draft") throw new Error("Only draft questions can be edited.");

  const update: Record<string, unknown> = {};
  if (patch.prompt !== undefined) update.prompt = patch.prompt;
  if (patch.options !== undefined) update.options = patch.options;
  if (patch.correctIndex !== undefined) update.correct_index = patch.correctIndex;
  if (patch.explanation !== undefined) update.explanation = patch.explanation;
  if (patch.gradingRubric !== undefined) update.grading_rubric = patch.gradingRubric;
  if (patch.sampleAnswer !== undefined) update.sample_answer = patch.sampleAnswer;
  if (patch.essayRubric !== undefined) update.essay_rubric = patch.essayRubric;
  if (patch.minWords !== undefined) update.min_words = patch.minWords;
  if (Object.keys(update).length === 0) return;

  const { error } = await client
    .from("reading_quiz_questions")
    .update(update)
    .eq("id", questionId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidateQuizzes();
}

/** Publish a draft to the kid. Owner-only; requires at least one question. */
export async function publishQuiz(
  quizId: string,
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { count } = await client
    .from("reading_quiz_questions")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  if (!count || count < 1) {
    throw new Error("Add at least one question before publishing.");
  }

  const { data: quiz, error } = await client
    .from("reading_quizzes")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", quizId)
    .eq("user_id", userId)
    .eq("status", "draft")
    .select("id, book_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!quiz) throw new Error("This quiz is already published.");

  // One live quiz per book: retire any other open quiz for this book.
  await archiveOtherOpenQuizzes(
    client,
    userId,
    quiz.book_id as string,
    quiz.id as string
  );

  revalidateQuizzes();
}

/** Delete a quiz (draft or published). Owner-only. Cascades to questions/results. */
export async function deleteQuiz(
  quizId: string,
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_quizzes")
    .delete()
    .eq("id", quizId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidateQuizzes();
}

// ============================================================
// Owner draft review
// ============================================================

/** Load a quiz with its full questions (answers included) for the draft editor. */
export async function getQuizForEditing(
  quizId: string,
  memberEmail?: string | null
): Promise<ReadingQuizWithQuestions | null> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select(QUIZ_COLUMNS)
    .eq("id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!quiz) return null;

  const { data: questions } = await client
    .from("reading_quiz_questions")
    .select(QUESTION_COLUMNS)
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true });

  return {
    ...(quiz as ReadingQuiz),
    questions: (questions ?? []) as ReadingQuizQuestion[],
  };
}

// ============================================================
// Reader (kid; member mode when owner views as them)
// ============================================================

/**
 * The active check-in quiz for each of the given books, if any: the most recent
 * PUBLISHED quiz the reader hasn't PASSED yet. Drives the "check in & take quiz"
 * CTA on the reading home — it persists (even across failed attempts) until the
 * quiz is passed, then disappears. Keyed by book id.
 */
export async function getActiveQuizzesByBook(
  bookIds: string[],
  memberEmail?: string | null
): Promise<Record<string, ActiveBookQuiz>> {
  if (bookIds.length === 0) return {};
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: quizzes } = await client
    .from("reading_quizzes")
    .select("id, book_id, from_page, through_page, created_at")
    .eq("user_id", userId)
    .eq("status", "published")
    .in("book_id", bookIds)
    .order("created_at", { ascending: false });
  if (!quizzes || quizzes.length === 0) return {};

  const quizIds = quizzes.map((q) => q.id as string);
  const { data: submissions } = await client
    .from("reading_quiz_submissions")
    .select("quiz_id, score_correct, score_total")
    .eq("user_id", userId)
    .in("quiz_id", quizIds);

  const subsByQuiz = new Map<
    string,
    { score_correct: number | null; score_total: number | null }[]
  >();
  for (const s of submissions ?? []) {
    const id = s.quiz_id as string;
    const list = subsByQuiz.get(id) ?? [];
    list.push(s);
    subsByQuiz.set(id, list);
  }

  // The weekly quiz is due every Friday — but a stretch that began during this
  // Friday window isn't due until the next one, so a just-added book doesn't read
  // as "due now" the moment its quiz is prepared. Computed per quiz from its
  // creation date against the reader's local week.
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const dayOfWeek = new Date(`${today}T12:00:00`).getDay();

  // Quizzes are newest-first; take the first unpassed one per book.
  const byBook: Record<string, ActiveBookQuiz> = {};
  for (const q of quizzes) {
    const bookId = q.book_id as string;
    if (byBook[bookId]) continue;
    const subs = subsByQuiz.get(q.id as string) ?? [];
    if (isPassed(subs)) continue;
    const startedOn = localDate(new Date(q.created_at as string), tz);
    byBook[bookId] = {
      quizId: q.id as string,
      fromPage: (q.from_page as number | null) ?? null,
      throughPage: q.through_page as number,
      attempted: subs.length > 0,
      dueNow: isQuizDue(dayOfWeek, startedOn, today),
    };
  }
  return byBook;
}

type ScopedClient = Awaited<ReturnType<typeof resolveReadingScope>>["client"];

/** One question's graded outcome from a prior attempt, for carry-forward. */
type PriorAnswer = {
  selected_index: number | null;
  response_text: string | null;
  is_correct: boolean | null;
  ai_notes: string | null;
  rubric_scores: EssayRubricScores | null;
};

/**
 * The reader's most recent attempt at a quiz: its attempt number, whether it was
 * perfect, and each question's graded outcome. This is what lets a retake re-ask
 * only the questions they missed and carry their right answers forward. Null when
 * they haven't attempted the quiz yet.
 */
async function latestAttempt(
  client: ScopedClient,
  userId: string,
  quizId: string
): Promise<{
  attemptNumber: number;
  perfect: boolean;
  answers: Map<string, PriorAnswer>;
} | null> {
  const { data: sub } = await client
    .from("reading_quiz_submissions")
    .select("id, attempt_number, score_correct, score_total")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return null;

  const { data: rows } = await client
    .from("reading_quiz_answers")
    .select(
      "question_id, selected_index, response_text, is_correct, ai_notes, rubric_scores"
    )
    .eq("submission_id", sub.id)
    .eq("user_id", userId);

  const answers = new Map<string, PriorAnswer>();
  for (const r of rows ?? []) {
    answers.set(r.question_id as string, {
      selected_index: (r.selected_index as number | null) ?? null,
      response_text: (r.response_text as string | null) ?? null,
      is_correct: (r.is_correct as boolean | null) ?? null,
      ai_notes: (r.ai_notes as string | null) ?? null,
      rubric_scores: (r.rubric_scores as EssayRubricScores | null) ?? null,
    });
  }
  const total = (sub.score_total as number | null) ?? 0;
  const correct = (sub.score_correct as number | null) ?? 0;
  return {
    attemptNumber: sub.attempt_number as number,
    perfect: total > 0 && correct === total,
    answers,
  };
}

/**
 * Split a quiz's questions into the ones this attempt re-asks and the ones it
 * carries forward. A first attempt — or a full retake of an already-passed quiz —
 * asks them all. After a failed attempt, only the questions that weren't right last
 * time are re-asked; the rest carry their previous correct answer forward, so
 * "passed" still means a perfect set across the whole quiz.
 */
function partitionForAttempt<Q extends { id: string }>(
  questions: Q[],
  latest: { perfect: boolean; answers: Map<string, PriorAnswer> } | null
): { ask: Q[]; carry: Q[] } {
  if (!latest || latest.perfect) return { ask: questions, carry: [] };
  const ask: Q[] = [];
  const carry: Q[] = [];
  for (const q of questions) {
    if (latest.answers.get(q.id)?.is_correct === true) carry.push(q);
    else ask.push(q);
  }
  // Defensive: never present an empty quiz — fall back to asking everything.
  if (ask.length === 0) return { ask: questions, carry: [] };
  return { ask, carry };
}

/**
 * A published quiz ready to take (or retake) — with answer keys stripped so
 * nothing is leaked to the browser. After a failed attempt only the missed
 * questions are returned (`retake: true`); a first attempt or a full replay
 * returns them all. Returns null only if it's not published or not found.
 */
export async function getQuizForTaking(
  quizId: string,
  memberEmail?: string | null
): Promise<{
  quiz: ReadingQuizWithQuestions;
  retake: boolean;
  /** The reader's prior essay text, so a revision pre-fills instead of retyping. */
  priorEssay: string | null;
  /** The prior attempt's grade + notes, kept on screen while they revise. */
  priorFeedback: ReadingEssayFeedback | null;
} | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select(QUIZ_COLUMNS)
    .eq("id", quizId)
    .eq("user_id", userId)
    .eq("status", "published")
    .maybeSingle();
  if (!quiz) return null;

  const { data: questions } = await client
    .from("reading_quiz_questions")
    .select("id, quiz_id, user_id, position, type, prompt, options, min_words, created_at")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true });

  // Strip everything grader-facing before this reaches the browser: the MC key,
  // explanations, rubrics, and the essay's anchor. The reader keeps only what they
  // need to write — the prompt, MC options, and the essay's word floor.
  const stripped: ReadingQuizQuestion[] = (questions ?? []).map((q) => ({
    id: q.id as string,
    quiz_id: q.quiz_id as string,
    user_id: q.user_id as string,
    position: q.position as number,
    type: q.type as ReadingQuizQuestion["type"],
    prompt: q.prompt as string,
    options: (q.options as string[] | null) ?? null,
    correct_index: null,
    explanation: null,
    grading_rubric: null,
    sample_answer: null,
    anchor_summary: null,
    essay_rubric: null,
    min_words: (q.min_words as number | null) ?? null,
    created_at: q.created_at as string,
  }));

  // On a failed retake, only re-ask what they missed last time.
  const latest = await latestAttempt(client, userId, quizId);
  const { ask } = partitionForAttempt(stripped, latest);
  const retake = ask.length < stripped.length;

  // For a single-essay quiz nothing carries forward, so `retake` stays false; a
  // re-attempt is signalled instead by handing back the prior draft to revise.
  const essayQ = stripped.find((q) => q.type === "essay");
  const priorAnswer = essayQ && latest ? latest.answers.get(essayQ.id) : null;
  const priorEssay = priorAnswer?.response_text ?? null;
  // Keep the last round of feedback to show while they revise (only once graded).
  const priorFeedback: ReadingEssayFeedback | null =
    priorAnswer && (priorAnswer.rubric_scores || priorAnswer.ai_notes)
      ? {
          rubricScores: priorAnswer.rubric_scores,
          aiNotes: priorAnswer.ai_notes,
          passed: priorAnswer.is_correct === true,
          gradingComplete: priorAnswer.is_correct !== null,
        }
      : null;

  return {
    quiz: { ...(quiz as ReadingQuiz), questions: ask },
    retake,
    priorEssay,
    priorFeedback,
  };
}

/**
 * Submit and auto-grade a quiz attempt: MC deterministically, each free-text
 * answer by an independent AI call. A single failed AI grade is isolated (that
 * answer is left ungraded; grading_complete becomes false) — the attempt still
 * saves. Each submission is a numbered attempt, so kids can retake and we keep
 * every outcome.
 */
export async function submitQuiz(
  quizId: string,
  answers: { questionId: string; selectedIndex?: number | null; responseText?: string | null }[],
  memberEmail?: string | null
): Promise<{
  submissionId: string;
  attemptNumber: number;
  advanced: boolean;
  finished: boolean;
}> {
  const scope = await resolveReadingScope(memberEmail);
  const { client, userId, email } = scope;

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select("id, status, book_id, through_page")
    .eq("id", quizId)
    .eq("user_id", userId)
    .eq("status", "published")
    .maybeSingle();
  if (!quiz) throw new Error("This quiz isn't available.");

  // The prior attempt drives both this attempt's number and which questions a
  // failed retake re-asks (the rest carry their right answers forward).
  const prior = await latestAttempt(client, userId, quizId);
  const attemptNumber = (prior?.attemptNumber ?? 0) + 1;

  const { data: submission, error: subError } = await client
    .from("reading_quiz_submissions")
    .insert({
      quiz_id: quizId,
      user_id: userId,
      attempt_number: attemptNumber,
      score_total: 0,
    })
    .select("id")
    .single();
  if (subError) {
    // A concurrent submit grabbed this attempt number — ask them to retry.
    if (subError.code === "23505") {
      throw new Error("That didn't go through — please try submitting again.");
    }
    throw new Error(subError.message);
  }
  const submissionId = submission.id as string;

  const { data: questions } = await client
    .from("reading_quiz_questions")
    .select(QUESTION_COLUMNS)
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  const qs = (questions ?? []) as ReadingQuizQuestion[];

  // After a failed attempt, only grade the questions being re-asked; the ones
  // they already got right carry their prior answer into this attempt so the
  // submission stays a complete, comparable snapshot of the whole quiz.
  const { ask, carry } = partitionForAttempt(qs, prior);
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const age = await readerAge(email);

  // Grade the re-asked questions (free-text calls run in parallel; each is
  // independently resilient inside gradeFreeText).
  const gradedAsk = await Promise.all(
    ask.map(async (q) => {
      const submitted = byId.get(q.id);
      if (q.type === "multiple_choice") {
        const selectedIndex = submitted?.selectedIndex ?? null;
        const isCorrect = gradeMultipleChoice(selectedIndex, q.correct_index ?? -1);
        return {
          question_id: q.id,
          user_id: userId,
          submission_id: submissionId,
          selected_index: selectedIndex,
          response_text: null,
          is_correct: isCorrect,
          ai_notes: null,
          rubric_scores: null as EssayRubricScores | null,
        };
      }
      if (q.type === "essay") {
        const responseText = submitted?.responseText ?? "";
        const grade = await gradeEssay({
          prompt: q.prompt,
          anchorSummary: q.anchor_summary ?? "",
          rubric: q.essay_rubric ?? null,
          essay: responseText,
          readerAge: age,
          minWords: q.min_words ?? null,
        });
        return {
          question_id: q.id,
          user_id: userId,
          submission_id: submissionId,
          selected_index: null,
          response_text: responseText,
          // An ungraded essay (AI failed) stays null so the attempt saves without
          // counting as a pass; "meets standard" is the gate when it did grade.
          is_correct: grade.graded ? grade.meetsStandard : null,
          ai_notes: grade.notes || null,
          rubric_scores: grade.scores,
        };
      }
      const responseText = submitted?.responseText ?? "";
      const grade = await gradeFreeText({
        question: q.prompt,
        rubric: q.grading_rubric ?? "",
        sampleAnswer: q.sample_answer ?? "",
        answer: responseText,
        readerAge: age,
      });
      return {
        question_id: q.id,
        user_id: userId,
        submission_id: submissionId,
        selected_index: null,
        response_text: responseText,
        is_correct: grade.correct,
        ai_notes: grade.notes || null,
        rubric_scores: null as EssayRubricScores | null,
      };
    })
  );

  // Carry the previously-correct answers forward verbatim (prior is non-null
  // whenever carry is non-empty).
  const carried = carry.map((q) => {
    const previous = prior!.answers.get(q.id)!;
    return {
      question_id: q.id,
      user_id: userId,
      submission_id: submissionId,
      selected_index: previous.selected_index,
      response_text: previous.response_text,
      is_correct: true as boolean | null,
      ai_notes: previous.ai_notes,
      rubric_scores: null as EssayRubricScores | null,
    };
  });

  const graded = [...gradedAsk, ...carried];

  if (graded.length) {
    const { error: ansError } = await client
      .from("reading_quiz_answers")
      .insert(graded);
    if (ansError) throw new Error(ansError.message);
  }

  const scoreCorrect = graded.filter((g) => g.is_correct === true).length;
  const scoreTotal = qs.length;
  const gradingComplete = graded.every((g) => g.is_correct !== null);

  await client
    .from("reading_quiz_submissions")
    .update({
      score_correct: scoreCorrect,
      score_total: scoreTotal,
      grading_complete: gradingComplete,
    })
    .eq("id", submissionId)
    .eq("user_id", userId);

  // Passing (every question right) is the gate that advances the book's milestone
  // and pre-generates the next stretch's quiz. Only advance when this quiz covers
  // ground beyond the current page, so retaking an already-passed stretch is a no-op.
  let advanced = false;
  let finished = false;
  const passed = scoreTotal > 0 && scoreCorrect === scoreTotal;
  if (passed) {
    const throughPage = quiz.through_page as number | null;
    const { data: book } = await client
      .from("reading_books")
      .select("id, current_page, target_page, total_pages")
      .eq("id", quiz.book_id as string)
      .eq("user_id", userId)
      .maybeSingle();
    if (book && throughPage != null && throughPage > (book.current_page as number)) {
      const res = await advanceStretch(
        scope,
        {
          id: book.id as string,
          current_page: book.current_page as number,
          target_page: (book.target_page as number | null) ?? null,
          total_pages: (book.total_pages as number | null) ?? null,
        },
        throughPage
      );
      advanced = true;
      finished = res.finished;
    }
  }

  revalidateQuizzes();
  return { submissionId, attemptNumber, advanced, finished };
}

/**
 * Post a passed essay to the family journal — the one-tap "share it" from the
 * success screen, opt-in. Creates a closed, family-visible STANDARD entry authored
 * by the reader and bound to the book, with the essay prompt stored as the entry's
 * opening question (and shown as the journal's italic question prompt) followed by
 * the essay as the reader's written answer — so it reads exactly like a journal
 * entry the kid wrote in response to a prompt, and the family can comment on it.
 * Idempotent on (reader, book, title): tapping twice returns the same entry.
 */
export async function postEssayToFamilyJournal(
  quizId: string,
  memberEmail?: string | null
): Promise<{ entryId: string }> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select("id, book_id, from_page, through_page")
    .eq("id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!quiz) throw new Error("This quiz isn't available.");

  // Only a passed essay can be shared.
  const { data: subs } = await client
    .from("reading_quiz_submissions")
    .select("score_correct, score_total")
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  if (!isPassed(subs ?? [])) throw new Error("Pass the essay before sharing it.");

  // The essay prompt and the reader's written response on the (single) essay question.
  const { data: essayQ } = await client
    .from("reading_quiz_questions")
    .select("id, prompt")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .eq("type", "essay")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!essayQ) throw new Error("This quiz has no essay to share.");
  const prompt = (essayQ.prompt as string | null)?.trim() || "Reading essay";

  const { data: answer } = await client
    .from("reading_quiz_answers")
    .select("response_text")
    .eq("question_id", essayQ.id as string)
    .eq("user_id", userId)
    .not("response_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const essay = (answer?.response_text as string | null)?.trim();
  if (!essay) throw new Error("There's no written essay to share yet.");

  const { data: book } = await client
    .from("reading_books")
    .select("title")
    .eq("id", quiz.book_id as string)
    .eq("user_id", userId)
    .maybeSingle();
  const bookTitle = (book?.title as string) ?? "this book";
  const rangeLabel = quizRangeLabel(
    (quiz.from_page as number | null) ?? null,
    quiz.through_page as number
  );
  const title = `On ${bookTitle} (${rangeLabel})`;

  // Idempotency: don't post the same essay twice.
  const { data: existing } = await client
    .from("journal_entries")
    .select("id")
    .eq("user_id", userId)
    .eq("reading_book_id", quiz.book_id as string)
    .eq("entry_type", "standard")
    .eq("title", title)
    .maybeSingle();
  if (existing) return { entryId: existing.id as string };

  const tz = await getUserTimezone();
  const { data: entry, error } = await client
    .from("journal_entries")
    .insert({
      entry_date: localDate(new Date(), tz),
      user_id: userId,
      entry_type: "standard",
      // The prompt rides along as the entry's opening question so the journal shows
      // it the same way it shows any question the writer answered.
      opening_question: prompt,
      question_mode: true,
      title,
      summary: `An essay on ${bookTitle}, ${rangeLabel}.`,
      visibility: "family",
      status: "closed",
      closed_at: new Date().toISOString(),
      reading_book_id: quiz.book_id as string,
    })
    .select("id")
    .single();
  if (error || !entry) {
    throw new Error(error?.message ?? "Couldn't post to the journal.");
  }
  const entryId = entry.id as string;

  // The transcript: the prompt as the interviewer's question, then the essay as the
  // reader's answer. Explicit, ordered timestamps so the question always renders first.
  const now = Date.now();
  const { error: msgError } = await client.from("journal_messages").insert([
    {
      entry_id: entryId,
      user_id: userId,
      role: "assistant",
      content: prompt,
      created_at: new Date(now).toISOString(),
    },
    {
      entry_id: entryId,
      user_id: userId,
      role: "user",
      content: essay,
      created_at: new Date(now + 1000).toISOString(),
    },
  ]);
  if (msgError) throw new Error(msgError.message);

  revalidatePath("/journal");
  revalidatePath("/family");
  return { entryId };
}

const SUBMISSION_COLUMNS =
  "id, quiz_id, user_id, attempt_number, submitted_at, score_correct, score_total, grading_complete, closed_by_email, created_at";

/**
 * Close a published quiz without the kid passing it (a parent override). Owner-only.
 *
 * Records a synthetic, perfect submission flagged with the parent's email, so every
 * "is it passed?" check, badge, and the active-quiz filter treat the stretch as done —
 * then advances the book exactly like a real pass (only when the quiz covers ground
 * beyond the current page, so closing a stale quiz settles it without regressing). No
 * answer rows are written: the kid never answered, and the results view labels it
 * "Closed by a parent" rather than showing a fabricated perfect score.
 */
export async function closeQuizWithoutPassing(
  quizId: string,
  memberEmail?: string | null
): Promise<{ advanced: boolean; finished: boolean }> {
  await requireOwner();
  const closedBy = await callerEmail();
  const scope = await resolveReadingScope(memberEmail);
  const { client, userId } = scope;

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select("id, status, book_id, through_page")
    .eq("id", quizId)
    .eq("user_id", userId)
    .eq("status", "published")
    .maybeSingle();
  if (!quiz) throw new Error("This quiz isn't available to close.");

  // Don't double-close: if any attempt already passed (a real pass or a prior
  // override), there's nothing to settle.
  const { data: existing } = await client
    .from("reading_quiz_submissions")
    .select("score_correct, score_total")
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  if (isPassed(existing ?? [])) {
    throw new Error("This quiz is already complete.");
  }

  const { count } = await client
    .from("reading_quiz_questions")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  const scoreTotal = count ?? 0;
  if (scoreTotal < 1) throw new Error("This quiz has no questions to close.");

  const prior = await latestAttempt(client, userId, quizId);
  const attemptNumber = (prior?.attemptNumber ?? 0) + 1;

  const { error: subError } = await client
    .from("reading_quiz_submissions")
    .insert({
      quiz_id: quizId,
      user_id: userId,
      attempt_number: attemptNumber,
      score_correct: scoreTotal,
      score_total: scoreTotal,
      grading_complete: true,
      closed_by_email: closedBy,
    });
  if (subError) {
    if (subError.code === "23505") {
      throw new Error("That didn't go through — please try again.");
    }
    throw new Error(subError.message);
  }

  // Advance the book just as a real pass would — but only when the quiz reaches
  // beyond the current page, so closing a stale quiz never moves it backward.
  let advanced = false;
  let finished = false;
  const throughPage = quiz.through_page as number | null;
  const { data: book } = await client
    .from("reading_books")
    .select("id, current_page, target_page, total_pages")
    .eq("id", quiz.book_id as string)
    .eq("user_id", userId)
    .maybeSingle();
  if (book && throughPage != null && throughPage > (book.current_page as number)) {
    const res = await advanceStretch(
      scope,
      {
        id: book.id as string,
        current_page: book.current_page as number,
        target_page: (book.target_page as number | null) ?? null,
        total_pages: (book.total_pages as number | null) ?? null,
      },
      throughPage
    );
    advanced = true;
    finished = res.finished;
  }

  revalidateQuizzes();
  revalidatePath(`/reader/quizzes/${quizId}/results`);
  return { advanced, finished };
}

/**
 * A quiz's detail view: its questions, every attempt, and (when attempted) the
 * graded answers with full feedback for the viewed attempt — the latest by
 * default, or a specific one when `submissionId` is given. Works before any
 * attempt too, so the owner can open a published quiz to view it (and close it
 * without passing). Returns null only when the quiz itself isn't found.
 */
export async function getQuizResult(
  quizId: string,
  memberEmail?: string | null,
  submissionId?: string | null
): Promise<ReadingQuizResult | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select(QUIZ_COLUMNS)
    .eq("id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!quiz) return null;

  const { data: submissions } = await client
    .from("reading_quiz_submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("attempt_number", { ascending: true });
  const all = (submissions ?? []) as ReadingQuizSubmission[];

  // The viewed attempt: the requested one if valid, else the most recent. Null
  // until the quiz has been attempted (or closed) at least once.
  const viewed =
    (submissionId && all.find((s) => s.id === submissionId)) ||
    all[all.length - 1] ||
    null;

  const [{ data: questions }, { data: answers }, { data: book }] =
    await Promise.all([
      client
        .from("reading_quiz_questions")
        .select(RESULT_QUESTION_COLUMNS)
        .eq("quiz_id", quizId)
        .eq("user_id", userId)
        .order("position", { ascending: true }),
      viewed
        ? client
            .from("reading_quiz_answers")
            .select(ANSWER_COLUMNS)
            .eq("submission_id", viewed.id)
            .eq("user_id", userId)
        : Promise.resolve({ data: [] as ReadingQuizAnswer[] }),
      client
        .from("reading_books")
        .select("title, current_page, target_page, total_pages, status")
        .eq("id", (quiz as ReadingQuiz).book_id)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  const answersByQuestionId: Record<string, ReadingQuizAnswer> = {};
  for (const a of (answers ?? []) as ReadingQuizAnswer[]) {
    answersByQuestionId[a.question_id] = a;
  }

  return {
    quiz: quiz as ReadingQuiz,
    bookTitle: (book?.title as string) ?? "this book",
    nextAssignment: {
      bookTitle: (book?.title as string) ?? "this book",
      currentPage: (book?.current_page as number | null) ?? 0,
      targetPage: (book?.target_page as number | null) ?? null,
      totalPages: (book?.total_pages as number | null) ?? null,
      finished: book?.status === "archive",
    },
    questions: (questions ?? []) as ReadingQuizQuestion[],
    submission: viewed,
    answersByQuestionId,
    attempts: all.map((s) => ({
      id: s.id,
      attemptNumber: s.attempt_number,
      submittedAt: s.submitted_at,
      scoreCorrect: s.score_correct,
      scoreTotal: s.score_total,
      gradingComplete: s.grading_complete,
    })),
    passed: isPassed(all),
  };
}

// ============================================================
// Parent Admin (owner cross-kid console)
// ============================================================

type AdminSubmissionRow = {
  id: string;
  quiz_id: string;
  attempt_number: number;
  submitted_at: string | null;
  score_correct: number | null;
  score_total: number | null;
  grading_complete: boolean | null;
  closed_by_email: string | null;
};

/** Shape a quiz row + its attempts into the admin view model. */
function toAdminQuiz(
  q: {
    id: string;
    status: string;
    from_page: number | null;
    through_page: number;
    created_at: string;
  },
  subs: AdminSubmissionRow[]
): ReadingAdminQuiz {
  const attempts: ReadingAdminAttempt[] = subs.map((s) => ({
    id: s.id,
    attemptNumber: s.attempt_number,
    submittedAt: s.submitted_at,
    scoreCorrect: s.score_correct,
    scoreTotal: s.score_total,
    gradingComplete: s.grading_complete ?? true,
    closedByParent: s.closed_by_email != null,
  }));
  return {
    id: q.id,
    status: q.status as ReadingQuizStatus,
    fromPage: q.from_page,
    throughPage: q.through_page,
    createdAt: q.created_at,
    passed: isPassed(
      subs.map((s) => ({
        score_correct: s.score_correct,
        score_total: s.score_total,
      }))
    ),
    closedByParent: subs.some((s) => s.closed_by_email != null),
    attempts,
  };
}

/**
 * The Parent Admin console: every kid with reading, each of their relevant books
 * (in progress, or with quiz history), the single live quiz + any draft, and the
 * passed/archived quizzes as history. Owner-only. Drives /reader/quizzes.
 */
export async function getReadingAdmin(): Promise<ReadingAdminMember[]> {
  await requireOwner();
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("family_members")
    .select("email, name, user_id")
    .not("user_id", "is", null);
  const memberRows = (members ?? []).filter((m) => m.user_id);
  const userIds = memberRows.map((m) => m.user_id as string);
  if (userIds.length === 0) return [];

  const [{ data: books }, { data: quizzes }] = await Promise.all([
    admin
      .from("reading_books")
      .select(
        "id, user_id, title, author, current_page, target_page, target_due, total_pages, status, updated_at"
      )
      .in("user_id", userIds),
    admin
      .from("reading_quizzes")
      .select("id, user_id, book_id, from_page, through_page, status, created_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false }),
  ]);

  const quizIds = (quizzes ?? []).map((q) => q.id as string);
  const { data: submissions } = quizIds.length
    ? await admin
        .from("reading_quiz_submissions")
        .select(
          "id, quiz_id, attempt_number, submitted_at, score_correct, score_total, grading_complete, closed_by_email"
        )
        .in("quiz_id", quizIds)
        .order("attempt_number", { ascending: true })
    : { data: [] as AdminSubmissionRow[] };

  const subsByQuiz = new Map<string, AdminSubmissionRow[]>();
  for (const s of (submissions ?? []) as AdminSubmissionRow[]) {
    const list = subsByQuiz.get(s.quiz_id) ?? [];
    list.push(s);
    subsByQuiz.set(s.quiz_id, list);
  }

  // Quizzes per book, newest first (the source order is created_at desc).
  const quizzesByBook = new Map<string, ReadingAdminQuiz[]>();
  for (const q of quizzes ?? []) {
    const bookId = q.book_id as string;
    const list = quizzesByBook.get(bookId) ?? [];
    list.push(
      toAdminQuiz(
        {
          id: q.id as string,
          status: q.status as string,
          from_page: (q.from_page as number | null) ?? null,
          through_page: q.through_page as number,
          created_at: q.created_at as string,
        },
        subsByQuiz.get(q.id as string) ?? []
      )
    );
    quizzesByBook.set(bookId, list);
  }

  const booksByUser = new Map<string, ReadingAdminBook[]>();
  for (const b of books ?? []) {
    const bookQuizzes = quizzesByBook.get(b.id as string) ?? [];
    const status = b.status as string;
    // Show in-progress books (the active assignment) and any book that carries
    // quiz history; skip queued/archived books with nothing to administer.
    if (status !== "in_progress" && bookQuizzes.length === 0) continue;

    const activeQuiz =
      bookQuizzes.find((q) => q.status === "published" && !q.passed) ?? null;
    const draftQuiz = bookQuizzes.find((q) => q.status === "draft") ?? null;
    const history = bookQuizzes.filter(
      (q) => q !== activeQuiz && q !== draftQuiz
    );

    const adminBook: ReadingAdminBook = {
      bookId: b.id as string,
      title: b.title as string,
      author: (b.author as string | null) ?? null,
      currentPage: (b.current_page as number | null) ?? 0,
      targetPage: (b.target_page as number | null) ?? null,
      targetDue: (b.target_due as string | null) ?? null,
      totalPages: (b.total_pages as number | null) ?? null,
      status,
      activeQuiz,
      draftQuiz,
      history,
    };
    const list = booksByUser.get(b.user_id as string) ?? [];
    list.push(adminBook);
    booksByUser.set(b.user_id as string, list);
  }

  const result: ReadingAdminMember[] = [];
  for (const m of memberRows) {
    const list = booksByUser.get(m.user_id as string);
    if (!list || list.length === 0) continue;
    // In-progress books first, then most-recently-updated.
    list.sort((a, b) => {
      const ai = a.status === "in_progress" ? 0 : 1;
      const bi = b.status === "in_progress" ? 0 : 1;
      return ai - bi;
    });
    result.push({
      email: m.email as string,
      name: (m.name as string | null) ?? null,
      books: list,
    });
  }
  result.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  return result;
}
