"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdult, requireOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { resolveReadingScope } from "@/lib/reading/scope";
import { isQuizDue } from "@/lib/reading/quiz-due";
import { getTextForRange } from "@/lib/reading/extract-text";
import { generateEssayAssignments } from "@/lib/reading/quiz-generate";
import {
  gradeComprehension,
  gradeEssay,
  gradeFreeText,
  gradeMultipleChoice,
} from "@/lib/reading/quiz-grade";
import { readerAge } from "@/lib/reading/reader-age";
import { essayMinWords, loadReaderContext } from "@/lib/reading/reader-context";
import { defaultQuizTitle, essayQuestionRows } from "@/lib/reading/quiz-build";
import {
  regenerateSteeredCandidates,
  renderGeneratedForThread,
} from "@/lib/reading/quiz-steer";
import { advanceStretch } from "@/lib/reading/advance";
import { creditEssayBonus } from "@/lib/bucks/earn";
import { essayExceeded } from "@/lib/reading/essay-scoring";
import { archiveOtherOpenQuizzes } from "@/lib/reading/supersede";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import {
  chapterSpans,
  contentWordCount,
  coverageChapterLabel,
  wordsToPage,
} from "@/lib/reading/chapter-target";
import type {
  ActiveBookQuiz,
  EssayRubric,
  EssayRubricScores,
  ReadingAdminAttempt,
  ReadingAdminBook,
  ReadingAdminMember,
  ReadingAdminQuiz,
  ReadingBook,
  ReadingBookContentSummary,
  ReadingEssayFeedback,
  ReadingQuiz,
  ReadingQuizAnswer,
  ReadingQuizQuestion,
  ReadingQuizResult,
  ReadingQuizStatus,
  ReadingQuizSubmission,
  ReadingQuizWithQuestions,
  ReadingTocEntry,
} from "@/lib/types";

// Full columns, including the essay's grader-facing anchor — used where the owner
// edits a draft or the server grades a submission.
const QUESTION_COLUMNS =
  "id, quiz_id, user_id, position, type, prompt, comprehension_prompt, options, correct_index, explanation, grading_rubric, sample_answer, anchor_summary, essay_rubric, min_words, created_at";
// Results/taking view: same minus anchor_summary, which is grader-only and must not
// reach the reader's browser (it would hint at what Part 1 should say). Part 1's
// prompt (comprehension_prompt) IS shown to the reader.
const RESULT_QUESTION_COLUMNS =
  "id, quiz_id, user_id, position, type, prompt, comprehension_prompt, options, correct_index, explanation, grading_rubric, sample_answer, essay_rubric, min_words, created_at";
const ANSWER_COLUMNS =
  "id, submission_id, question_id, user_id, selected_index, response_text, comprehension_text, is_correct, ai_notes, rubric_scores, created_at";
const QUIZ_COLUMNS =
  "id, user_id, book_id, from_page, through_page, status, title, created_by_email, source, generation_error, chosen_question_id, comprehension_cleared_at, comprehension_text, published_at, created_at, updated_at";

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

/**
 * Whether the kid has started this quiz — the steering lock. Started means either the
 * comprehension gate has been cleared (the essay flow's first step) OR any submission
 * exists; from that point a parent can no longer swap/edit/regenerate the question out
 * from under them. Scoped by both quiz_id and the resolved kid userId (required on the
 * RLS-bypassing member-mode admin client).
 */
async function quizIsLocked(
  client: ScopedClient,
  quizId: string,
  userId: string
): Promise<boolean> {
  const [{ count }, { data: quiz }] = await Promise.all([
    client
      .from("reading_quiz_submissions")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quizId)
      .eq("user_id", userId),
    client
      .from("reading_quizzes")
      .select("comprehension_cleared_at")
      .eq("id", quizId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  return (count ?? 0) > 0 || quiz?.comprehension_cleared_at != null;
}

/**
 * The essay-flow state for a quiz, derived from its attempts: whether it's been
 * passed / exceeded, and whether the reader may still write. The rule: keep revising
 * until you pass; on a "meets" pass you get exactly ONE more optional shot at
 * "exceeds" (the bonus); once that shot is spent — or you've exceeded — the essay is
 * finalized and read-only. A parent override (a closed submission with no answer)
 * counts as a pass but never as an "exceeds".
 */
type EssayQuizState = {
  hasPassed: boolean;
  hasExceeded: boolean;
  /** Attempts recorded after the first passing attempt (the bonus shot, once used). */
  attemptsAfterFirstPass: number;
  /** The reader may still turn in an essay (revising, or the single unused bonus shot). */
  canWrite: boolean;
  /** The next turn-in would be the single "try once more for the bonus" shot. */
  isBonusShot: boolean;
};

async function loadEssayQuizState(
  client: ScopedClient,
  userId: string,
  quizId: string
): Promise<EssayQuizState> {
  const { data: subs } = await client
    .from("reading_quiz_submissions")
    .select("id, attempt_number, score_correct, score_total, closed_by_email")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("attempt_number", { ascending: true });
  const rows = subs ?? [];
  if (rows.length === 0) {
    return {
      hasPassed: false,
      hasExceeded: false,
      attemptsAfterFirstPass: 0,
      canWrite: true,
      isBonusShot: false,
    };
  }
  // A parent override (close without passing) ends the essay flow — no bonus shot.
  const closedByParent = rows.some((s) => s.closed_by_email != null);

  const { data: ans } = await client
    .from("reading_quiz_answers")
    .select("submission_id, rubric_scores")
    .in(
      "submission_id",
      rows.map((s) => s.id as string)
    )
    .eq("user_id", userId);
  const scoresBySub = new Map<string, EssayRubricScores | null>();
  for (const a of ans ?? []) {
    scoresBySub.set(
      a.submission_id as string,
      (a.rubric_scores as EssayRubricScores | null) ?? null
    );
  }

  const passedRows = rows.filter(
    (s) =>
      (s.score_total ?? 0) > 0 && (s.score_correct ?? 0) === (s.score_total ?? 0)
  );
  const hasPassed = passedRows.length > 0;
  const firstPassAttempt = hasPassed
    ? Math.min(...passedRows.map((s) => s.attempt_number as number))
    : null;
  const attemptsAfterFirstPass =
    firstPassAttempt != null
      ? rows.filter((s) => (s.attempt_number as number) > firstPassAttempt).length
      : 0;
  const hasExceeded = rows.some((s) =>
    essayExceeded(scoresBySub.get(s.id as string) ?? null)
  );

  const canWrite =
    !closedByParent &&
    !hasExceeded &&
    (!hasPassed || attemptsAfterFirstPass === 0);
  const isBonusShot = canWrite && hasPassed && attemptsAfterFirstPass === 0;
  return { hasPassed, hasExceeded, attemptsAfterFirstPass, canWrite, isBonusShot };
}

/** Whether a passing attempt on this quiz exists other than the given submission —
 *  i.e. this quiz already advanced the book on an earlier try. Used to decide whether
 *  a later "exceeds" (the bonus shot) is owed the bonus. */
async function hasPriorPassOnQuiz(
  client: ScopedClient,
  userId: string,
  quizId: string,
  exceptSubmissionId: string
): Promise<boolean> {
  const { data } = await client
    .from("reading_quiz_submissions")
    .select("id, score_correct, score_total")
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  return (data ?? []).some(
    (s) =>
      s.id !== exceptSubmissionId &&
      (s.score_total ?? 0) > 0 &&
      (s.score_correct ?? 0) === (s.score_total ?? 0)
  );
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
  const generated = await generateEssayAssignments({
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
      generation_error: generated.options.length ? null : GENERATION_FAILED_NOTE,
    })
    .select("id")
    .single();
  if (quizError) throw new Error(quizError.message);
  const quizId = quiz.id as string;

  if (generated.options.length) {
    const { error: qError } = await client
      .from("reading_quiz_questions")
      .insert(essayQuestionRows(quizId, userId, generated));
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
  const generated = await generateEssayAssignments({
    bookTitle: book.title as string,
    author: (book.author as string) ?? null,
    fromPage,
    throughPage,
    text: slice.text,
    readerAge: age,
    readerContext,
    minWords,
  });

  // Replacing the questions; clear any commitment so the new prompts start fresh
  // (a draft is never chosen, but the FK would SET NULL anyway — be explicit).
  await client
    .from("reading_quizzes")
    .update({ chosen_question_id: null })
    .eq("id", quizId)
    .eq("user_id", userId);
  await client.from("reading_quiz_questions").delete().eq("quiz_id", quizId);
  if (generated.options.length) {
    const { error: qError } = await client
      .from("reading_quiz_questions")
      .insert(essayQuestionRows(quizId, userId, generated));
    if (qError) throw new Error(qError.message);
  }

  await client
    .from("reading_quizzes")
    .update({
      title: generated.title ?? defaultQuizTitle(fromPage, throughPage),
      generation_error: generated.options.length ? null : GENERATION_FAILED_NOTE,
    })
    .eq("id", quizId)
    .eq("user_id", userId);

  revalidateQuizzes();
}

/**
 * Edit one question. Adult-gated (owner or parent — a parent may curate a kid's
 * question). A draft is always editable; a published quiz is editable only until
 * the kid starts (no submission yet — the steering lock).
 */
export async function updateQuizQuestion(
  questionId: string,
  patch: {
    prompt?: string;
    comprehensionPrompt?: string;
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
  await requireAdult();
  const { client, userId } = await resolveReadingScope(memberEmail, {
    adultOk: true,
  });

  const { data: question } = await client
    .from("reading_quiz_questions")
    .select("id, quiz_id, reading_quizzes!inner(status)")
    .eq("id", questionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!question) throw new Error("Question not found.");
  const status = (question.reading_quizzes as { status?: string } | null)?.status;
  const quizId = question.quiz_id as string;
  if (status === "archived") throw new Error("This quiz is no longer editable.");
  if (status === "published" && (await quizIsLocked(client, quizId, userId))) {
    throw new Error("The reader has already started — this can no longer change.");
  }

  const update: Record<string, unknown> = {};
  if (patch.prompt !== undefined) update.prompt = patch.prompt;
  if (patch.comprehensionPrompt !== undefined)
    update.comprehension_prompt = patch.comprehensionPrompt;
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

  // Auto-default the kid's question to the first candidate so they're never blocked
  // and the chooser never appears. A parent's earlier pick (chosen already set) wins,
  // so only fill it when still null. Steering can swap it until the kid starts.
  const { data: firstQuestion } = await client
    .from("reading_quiz_questions")
    .select("id")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstQuestion) {
    await client
      .from("reading_quizzes")
      .update({ chosen_question_id: firstQuestion.id as string })
      .eq("id", quizId)
      .eq("user_id", userId)
      .is("chosen_question_id", null);
  }

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

/** Load a quiz with its full questions for the draft/steering editor. Adult-gated
 *  so a parent can curate a kid's essay question, not just the owner. */
export async function getQuizForEditing(
  quizId: string,
  memberEmail?: string | null
): Promise<ReadingQuizWithQuestions | null> {
  await requireAdult();
  const { client, userId } = await resolveReadingScope(memberEmail, {
    adultOk: true,
  });

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
  comprehension_text: string | null;
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
      "question_id, selected_index, response_text, comprehension_text, is_correct, ai_notes, rubric_scores"
    )
    .eq("submission_id", sub.id)
    .eq("user_id", userId);

  const answers = new Map<string, PriorAnswer>();
  for (const r of rows ?? []) {
    answers.set(r.question_id as string, {
      selected_index: (r.selected_index as number | null) ?? null,
      response_text: (r.response_text as string | null) ?? null,
      comprehension_text: (r.comprehension_text as string | null) ?? null,
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
/**
 * A book's chapters (title + 280-word end page) for labeling a quiz's covered
 * range by chapter. Empty for real-page books, articles, and books not yet
 * (re)converted — the caller then falls back to the page range.
 */
async function bookChapterList(
  client: ScopedClient,
  userId: string,
  bookId: string,
  totalPages: number | null
): Promise<{ title: string; endPage: number }[]> {
  const { data: content } = await client
    .from("reading_book_content")
    .select("status, has_real_pages, word_count, toc")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  const wordCount = (content?.word_count as number | null) ?? null;
  if (!content || content.status !== "ready" || content.has_real_pages || !wordCount) {
    return [];
  }
  const spans = chapterSpans((content.toc as ReadingTocEntry[]) ?? [], wordCount);
  if (spans.length === 0) return [];
  const contentWords = contentWordCount(spans, wordCount);
  const total = totalPages ?? wordsToPage(contentWords);
  return spans.map((s) => ({
    title: s.title,
    endPage: s.endWord >= contentWords ? total : wordsToPage(s.endWord),
  }));
}

export async function getQuizForTaking(
  quizId: string,
  memberEmail?: string | null
): Promise<{
  quiz: ReadingQuizWithQuestions;
  /** The covered range as a chapter label for chapter books; null for page books. */
  coverageLabel: string | null;
  retake: boolean;
  /** Essay: which step to show. "comprehension" = the Part 1 gate (until it's cleared);
   *  "essay" = the writing. Legacy MC/free-text is always "essay". */
  stage: "comprehension" | "essay";
  /** Essay Part 1 prompt, for the comprehension step. Null when there is no Part 1. */
  comprehensionPrompt: string | null;
  /** The reader's prior Part 2 essay text, so a revision pre-fills instead of retyping. */
  priorEssay: string | null;
  /** The prior attempt's grade + notes, kept on screen while they revise. */
  priorFeedback: ReadingEssayFeedback | null;
  /** Essay: this turn-in would be the single "try once more for the bonus" shot after
   *  a "meets" pass (so the writing screen can frame it as bonus-hunting). */
  isBonusShot: boolean;
  /** Essay: the essay is finalized (exceeded, or the bonus shot is spent) — the page
   *  should send the reader to the results view rather than let them write again. */
  locked: boolean;
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

  // Label a chapter book's covered range by chapter rather than a synthetic page.
  const coverageLabel = coverageChapterLabel(
    await bookChapterList(client, userId, (quiz as ReadingQuiz).book_id, null),
    (quiz as ReadingQuiz).from_page,
    (quiz as ReadingQuiz).through_page
  );

  const { data: questions } = await client
    .from("reading_quiz_questions")
    .select(
      "id, quiz_id, user_id, position, type, prompt, comprehension_prompt, options, min_words, created_at"
    )
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
    // Part 1 prompt IS shown to the reader; the grader-facing anchor is not.
    comprehension_prompt: (q.comprehension_prompt as string | null) ?? null,
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

  const latest = await latestAttempt(client, userId, quizId);

  // Build the prior-attempt revision context for one essay question (the draft to
  // pre-fill and last round of feedback to keep on screen while they rework it).
  const reviseContext = (essayQ: ReadingQuizQuestion | undefined) => {
    const priorAnswer = essayQ && latest ? latest.answers.get(essayQ.id) : null;
    const priorEssay = priorAnswer?.response_text ?? null;
    const priorFeedback: ReadingEssayFeedback | null =
      priorAnswer && (priorAnswer.rubric_scores || priorAnswer.ai_notes)
        ? {
            rubricScores: priorAnswer.rubric_scores,
            aiNotes: priorAnswer.ai_notes,
            passed: priorAnswer.is_correct === true,
            gradingComplete: priorAnswer.is_correct !== null,
          }
        : null;
    return { priorEssay, priorFeedback };
  };

  // Essay quiz: the kid writes exactly ONE question — the parent-curated / auto-default
  // chosen one (a parent steers the candidates down to it; publish defaults it to the
  // first). No kid-facing chooser. Fall back to the first candidate for any legacy
  // quiz that has no chosen id.
  if (stripped.length > 0 && stripped.every((q) => q.type === "essay")) {
    const q = quiz as ReadingQuiz;
    const chosen =
      (q.chosen_question_id
        ? stripped.find((c) => c.id === q.chosen_question_id)
        : undefined) ?? stripped[0];
    const { priorEssay, priorFeedback } = reviseContext(chosen);
    const essayState = await loadEssayQuizState(client, userId, quizId);
    // Part 1 comes first and is cleared once; after that (or when there's no Part 1
    // at all, e.g. a legacy single-part essay) the writing screen is shown.
    const hasPartOne = !!chosen.comprehension_prompt;
    const stage =
      hasPartOne && q.comprehension_cleared_at == null ? "comprehension" : "essay";
    return {
      quiz: { ...q, questions: [chosen] },
      coverageLabel,
      retake: false,
      stage,
      comprehensionPrompt: chosen.comprehension_prompt,
      priorEssay,
      priorFeedback,
      isBonusShot: essayState.isBonusShot,
      locked: !essayState.canWrite,
    };
  }

  // Legacy MC/free-text: on a failed retake, only re-ask what they missed last time.
  const { ask } = partitionForAttempt(stripped, latest);
  const retake = ask.length < stripped.length;
  const { priorEssay, priorFeedback } = reviseContext(
    stripped.find((q) => q.type === "essay")
  );

  return {
    quiz: { ...(quiz as ReadingQuiz), questions: ask },
    coverageLabel,
    retake,
    stage: "essay",
    comprehensionPrompt: null,
    priorEssay,
    priorFeedback,
    isBonusShot: false,
    locked: false,
  };
}

/**
 * The essay flow's first step: the reader clears the Part 1 comprehension gate before
 * the writing screen opens. Graded pass/fail on its own — a miss returns a hint and
 * costs nothing (no attempt is recorded, they just try again). A pass records the
 * cleared gate on the quiz (once), which also locks parent steering. Idempotent: once
 * cleared it stays cleared. Returns { met } as data (no throwing on a wrong answer).
 */
export async function submitComprehension(
  quizId: string,
  answer: string,
  memberEmail?: string | null
): Promise<{ met: boolean; note: string }> {
  const scope = await resolveReadingScope(memberEmail);
  const { client, userId, email } = scope;

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select("id, chosen_question_id, comprehension_cleared_at")
    .eq("id", quizId)
    .eq("user_id", userId)
    .eq("status", "published")
    .maybeSingle();
  if (!quiz) throw new Error("This quiz isn't available.");
  // Already cleared — the gate is a one-time step.
  if (quiz.comprehension_cleared_at != null) {
    return { met: true, note: "" };
  }

  const { data: questions } = await client
    .from("reading_quiz_questions")
    .select(QUESTION_COLUMNS)
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  const qs = (questions ?? []) as ReadingQuizQuestion[];
  const chosen =
    qs.find((q) => q.id === (quiz.chosen_question_id as string | null)) ?? qs[0];
  if (!chosen || chosen.type !== "essay" || !chosen.comprehension_prompt) {
    // No Part 1 to clear (legacy single-part essay) — mark cleared and move on.
    await client
      .from("reading_quizzes")
      .update({ comprehension_cleared_at: new Date().toISOString() })
      .eq("id", quizId)
      .eq("user_id", userId);
    revalidateQuizzes();
    return { met: true, note: "" };
  }

  const age = await readerAge(email);
  const grade = await gradeComprehension({
    prompt: chosen.comprehension_prompt,
    anchorSummary: chosen.anchor_summary ?? "",
    rubric: chosen.essay_rubric?.comprehension ?? null,
    answer,
    readerAge: age,
  });

  // A miss (or an ungradable API failure) leaves the gate uncleared so they can try
  // again — no attempt is spent. Only a clear pass advances them.
  if (grade.met !== true) {
    return {
      met: false,
      note:
        grade.note ||
        "Not quite yet — reread these pages and tell me what happens in a sentence or two.",
    };
  }

  await client
    .from("reading_quizzes")
    .update({
      comprehension_cleared_at: new Date().toISOString(),
      comprehension_text: answer.trim() || null,
    })
    .eq("id", quizId)
    .eq("user_id", userId);
  revalidateQuizzes();
  return { met: true, note: grade.note };
}

// ============================================================
// Parent steering (adult — owner or parent; member mode for a kid)
// ============================================================

/** One turn of a quiz's parent↔AI steering conversation. */
export type QuizSteeringMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  /** The parent who authored a 'user' turn; null on the AI's turns. */
  created_by_email: string | null;
};

/** The full steering surface for one quiz (candidates + thread + lock state). */
export type QuizSteeringState = {
  quizId: string;
  status: ReadingQuizStatus;
  /** True once the kid has started — steering is read-only from here. */
  locked: boolean;
  chosenQuestionId: string | null;
  candidates: ReadingQuizQuestion[];
  messages: QuizSteeringMessage[];
};

/**
 * A parent picks which candidate the kid writes — curation, replacing the retired
 * kid chooser. Adult-gated and allowed until the kid starts (the lock). Unlike the
 * old kid pick, re-picking IS allowed: a parent can change their mind before lock.
 */
export async function setChosenQuestion(
  quizId: string,
  questionId: string,
  memberEmail?: string | null
): Promise<{ chosenQuestionId: string }> {
  await requireAdult();
  const { client, userId } = await resolveReadingScope(memberEmail, {
    adultOk: true,
  });

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select("id")
    .eq("id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!quiz) throw new Error("This quiz isn't available.");
  if (await quizIsLocked(client, quizId, userId)) {
    throw new Error("The reader has already started — the question is locked.");
  }

  const { data: question } = await client
    .from("reading_quiz_questions")
    .select("id")
    .eq("id", questionId)
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .eq("type", "essay")
    .maybeSingle();
  if (!question) throw new Error("That prompt isn't part of this quiz.");

  const { error } = await client
    .from("reading_quizzes")
    .update({ chosen_question_id: questionId })
    .eq("id", quizId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidateQuizzes();
  return { chosenQuestionId: questionId };
}

/** The outcome of a steering round. */
export type SteerResult = {
  status: "regenerated" | "failed";
  chosenQuestionId: string | null;
};

/**
 * The parent sends guidance and the AI regenerates the three two-part candidates,
 * building on the whole steering conversation (not just the latest note). Adult-
 * gated and lock-checked. On a failed/empty regeneration the existing candidates
 * are KEPT (never blanked) and a retryable "failed" status is returned; the
 * parent's guidance turn is still recorded so the next round has it.
 */
export async function steerQuizQuestions(
  quizId: string,
  guidance: string,
  memberEmail?: string | null
): Promise<SteerResult> {
  await requireAdult();
  const author = await callerEmail();
  const { client, userId, email } = await resolveReadingScope(memberEmail, {
    adultOk: true,
  });

  const trimmed = guidance.trim();
  if (!trimmed) throw new Error("Add a note telling the AI what to change.");

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select("id, status, book_id, from_page, through_page")
    .eq("id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!quiz) throw new Error("This quiz isn't available.");
  if ((quiz.status as string) === "archived") {
    throw new Error("This quiz is no longer editable.");
  }
  if (await quizIsLocked(client, quizId, userId)) {
    throw new Error("The reader has already started — steering is locked.");
  }

  const { data: current } = await client
    .from("reading_quiz_questions")
    .select("id, position, comprehension_prompt, prompt")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  const currentCandidates = (current ?? []).map((q) => ({
    comprehensionPrompt: (q.comprehension_prompt as string | null) ?? null,
    prompt: q.prompt as string,
  }));

  const fromPage = (quiz.from_page as number | null) ?? null;
  const throughPage = quiz.through_page as number;
  const [book, slice, age] = await Promise.all([
    client
      .from("reading_books")
      .select("title, author")
      .eq("id", quiz.book_id as string)
      .eq("user_id", userId)
      .maybeSingle(),
    getTextForRange(client, userId, quiz.book_id as string, fromPage, throughPage),
    readerAge(email),
  ]);
  if (!book.data) throw new Error("Book not found.");
  if (!slice) throw new Error("This book isn't ready for a quiz yet.");
  const [minWords, readerContext] = await Promise.all([
    essayMinWords(email, age),
    loadReaderContext(client, userId),
  ]);

  const { data: priorMsgs } = await client
    .from("reading_quiz_steering_messages")
    .select("role, content")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const priorTurns = (priorMsgs ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content as string,
  }));

  // Record the parent's guidance turn first — kept even if regeneration fails.
  await client.from("reading_quiz_steering_messages").insert({
    quiz_id: quizId,
    user_id: userId,
    created_by_email: author,
    role: "user",
    content: trimmed,
  });

  const generated = await regenerateSteeredCandidates({
    bookTitle: book.data.title as string,
    author: (book.data.author as string) ?? null,
    fromPage,
    throughPage,
    text: slice.text,
    readerAge: age,
    readerContext,
    minWords,
    priorTurns,
    currentCandidates,
    guidance: trimmed,
  });

  // Keep the existing candidates on failure — never blank them.
  if (!generated.options.length) {
    revalidateQuizzes();
    return { status: "failed", chosenQuestionId: null };
  }

  // Replace the candidate rows and reset the default chosen to the new first one.
  await client
    .from("reading_quizzes")
    .update({ chosen_question_id: null })
    .eq("id", quizId)
    .eq("user_id", userId);
  await client
    .from("reading_quiz_questions")
    .delete()
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  const { data: inserted, error: insErr } = await client
    .from("reading_quiz_questions")
    .insert(essayQuestionRows(quizId, userId, generated))
    .select("id, position");
  if (insErr || !inserted?.length) {
    throw new Error(insErr?.message ?? "Couldn't save the new prompts.");
  }
  const first = inserted.find((q) => q.position === 0) ?? inserted[0];
  await client
    .from("reading_quizzes")
    .update({ chosen_question_id: first.id as string })
    .eq("id", quizId)
    .eq("user_id", userId);

  // Record the AI's regenerated candidates as the assistant turn.
  await client.from("reading_quiz_steering_messages").insert({
    quiz_id: quizId,
    user_id: userId,
    created_by_email: null,
    role: "assistant",
    content: renderGeneratedForThread(generated),
  });

  revalidateQuizzes();
  return { status: "regenerated", chosenQuestionId: first.id as string };
}

/** Load a quiz's steering surface for the parent panel. Adult-gated. */
export async function getQuizSteering(
  quizId: string,
  memberEmail?: string | null
): Promise<QuizSteeringState | null> {
  await requireAdult();
  const { client, userId } = await resolveReadingScope(memberEmail, {
    adultOk: true,
  });

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select(QUIZ_COLUMNS)
    .eq("id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!quiz) return null;

  const [questionsRes, messagesRes, locked] = await Promise.all([
    client
      .from("reading_quiz_questions")
      .select(QUESTION_COLUMNS)
      .eq("quiz_id", quizId)
      .eq("user_id", userId)
      .order("position", { ascending: true }),
    client
      .from("reading_quiz_steering_messages")
      .select("id, role, content, created_at, created_by_email")
      .eq("quiz_id", quizId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    quizIsLocked(client, quizId, userId),
  ]);

  return {
    quizId,
    status: (quiz as ReadingQuiz).status,
    locked,
    chosenQuestionId: (quiz as ReadingQuiz).chosen_question_id,
    candidates: (questionsRes.data ?? []) as ReadingQuizQuestion[],
    messages: (messagesRes.data ?? []).map((m) => ({
      id: m.id as string,
      role: m.role as "user" | "assistant",
      content: m.content as string,
      created_at: m.created_at as string,
      created_by_email: (m.created_by_email as string | null) ?? null,
    })),
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
  answers: {
    questionId: string;
    selectedIndex?: number | null;
    responseText?: string | null;
  }[],
  memberEmail?: string | null,
  options?: {
    /** Owner tools (resubmit/re-grade) skip the reader's write-lock enforcement. */
    bypassEssayLock?: boolean;
  }
): Promise<{
  submissionId: string;
  attemptNumber: number;
  /** True when this attempt met the bar — the gate for routing to the results/
   *  celebration view instead of keeping the reader in the editor to revise. */
  passed: boolean;
  /** Essay: true when the thinking reached "exceeds" — the standout bonus. */
  exceeded: boolean;
  advanced: boolean;
  finished: boolean;
  /** Title of a reward milestone this pass just reached, for a celebration. */
  reachedMilestone: string | null;
}> {
  const scope = await resolveReadingScope(memberEmail);
  const { client, userId, email } = scope;

  const { data: quiz } = await client
    .from("reading_quizzes")
    .select(
      "id, status, book_id, through_page, chosen_question_id, comprehension_cleared_at"
    )
    .eq("id", quizId)
    .eq("user_id", userId)
    .eq("status", "published")
    .maybeSingle();
  if (!quiz) throw new Error("This quiz isn't available.");

  const { data: questions } = await client
    .from("reading_quiz_questions")
    .select(QUESTION_COLUMNS)
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  const qs = (questions ?? []) as ReadingQuizQuestion[];

  // An essay quiz offers several candidate prompts, but only the one the reader
  // committed to is answered and graded — so it scores out of 1, exactly like the
  // old single-essay quiz did.
  const isEssayQuiz = qs.length > 0 && qs.every((q) => q.type === "essay");
  const chosen = isEssayQuiz
    ? qs.find((q) => q.id === (quiz.chosen_question_id as string | null)) ?? qs[0]
    : null;

  // Enforce the essay flow's write rules before recording an attempt: Part 1 must be
  // cleared first, and once the essay is finalized (exceeded, or the single post-pass
  // bonus shot spent) it's read-only. Owner tools bypass this.
  if (isEssayQuiz && !options?.bypassEssayLock) {
    if (chosen?.comprehension_prompt && quiz.comprehension_cleared_at == null) {
      throw new Error("Answer Part 1 first to unlock the essay.");
    }
    const state = await loadEssayQuizState(client, userId, quizId);
    if (!state.canWrite) {
      throw new Error("This essay is already finished — there's nothing left to turn in.");
    }
  }

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

  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const age = await readerAge(email);

  type GradedAnswerRow = {
    question_id: string;
    user_id: string;
    submission_id: string;
    selected_index: number | null;
    response_text: string | null;
    comprehension_text: string | null;
    is_correct: boolean | null;
    ai_notes: string | null;
    rubric_scores: EssayRubricScores | null;
  };

  let graded: GradedAnswerRow[];
  let scoreTotal: number;
  // The essay's graded scores, captured for the standout ("exceeds") bonus below.
  let essayScores: EssayRubricScores | null = null;

  if (isEssayQuiz && chosen) {
    const responseText =
      byId.get(chosen.id)?.responseText ?? answers[0]?.responseText ?? "";
    // A revision carries its prior draft + scores so the grader can credit
    // improvement instead of re-critiquing each attempt from scratch.
    const priorAnswer = prior?.answers.get(chosen.id) ?? null;
    const grade = await gradeEssay({
      prompt: chosen.prompt,
      rubric: chosen.essay_rubric ?? null,
      essay: responseText,
      readerAge: age,
      minWords: chosen.min_words ?? null,
      attemptNumber,
      priorEssay: priorAnswer?.response_text ?? null,
      priorScores: priorAnswer?.rubric_scores ?? null,
    });
    essayScores = grade.graded ? grade.scores : null;
    graded = [
      {
        question_id: chosen.id,
        user_id: userId,
        submission_id: submissionId,
        selected_index: null,
        response_text: responseText,
        // Comprehension is a quiz-level prerequisite now, not part of the essay answer.
        comprehension_text: null,
        // An ungraded essay (AI failed) stays null so the attempt saves without
        // counting as a pass; "meets standard" is the gate when it did grade.
        is_correct: grade.graded ? grade.meetsStandard : null,
        ai_notes: grade.notes || null,
        rubric_scores: grade.scores,
      },
    ];
    scoreTotal = 1;
  } else {
    // Legacy MC/free-text: after a failed attempt, only grade the questions being
    // re-asked; the ones already right carry their prior answer forward so the
    // submission stays a complete, comparable snapshot of the whole quiz.
    const { ask, carry } = partitionForAttempt(qs, prior);

    // Grade the re-asked questions (free-text calls run in parallel; each is
    // independently resilient inside gradeFreeText).
    const gradedAsk = await Promise.all(
      ask.map(async (q): Promise<GradedAnswerRow> => {
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
            comprehension_text: null,
            is_correct: isCorrect,
            ai_notes: null,
            rubric_scores: null,
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
          comprehension_text: null,
          is_correct: grade.correct,
          ai_notes: grade.notes || null,
          rubric_scores: null,
        };
      })
    );

    // Carry the previously-correct answers forward verbatim (prior is non-null
    // whenever carry is non-empty).
    const carried: GradedAnswerRow[] = carry.map((q) => {
      const previous = prior!.answers.get(q.id)!;
      return {
        question_id: q.id,
        user_id: userId,
        submission_id: submissionId,
        selected_index: previous.selected_index,
        response_text: previous.response_text,
        comprehension_text: previous.comprehension_text,
        is_correct: true,
        ai_notes: previous.ai_notes,
        rubric_scores: null,
      };
    });

    graded = [...gradedAsk, ...carried];
    scoreTotal = qs.length;
  }

  if (graded.length) {
    const { error: ansError } = await client
      .from("reading_quiz_answers")
      .insert(graded);
    if (ansError) throw new Error(ansError.message);
  }

  const scoreCorrect = graded.filter((g) => g.is_correct === true).length;
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

  // Passing is the gate that advances the book's milestone and pre-generates the next
  // stretch's quiz. Only advance when this quiz covers ground beyond the current page,
  // so retaking an already-passed stretch (e.g. the "try once more for the bonus" shot)
  // is a no-op that never moves the book.
  let advanced = false;
  let finished = false;
  let reachedMilestone: string | null = null;
  const passed = scoreTotal > 0 && scoreCorrect === scoreTotal;
  const exceeded = essayExceeded(essayScores);
  const throughPage = quiz.through_page as number | null;

  // Fetch the book once when we might need it — to advance on a pass, and (for essays)
  // to judge whether an "exceeds" bonus is legitimately owed on this stretch.
  let pageBeforeAdvance: number | null = null;
  if (passed || (isEssayQuiz && exceeded)) {
    const { data: book } = await client
      .from("reading_books")
      .select("id, current_page, target_page, total_pages")
      .eq("id", quiz.book_id as string)
      .eq("user_id", userId)
      .maybeSingle();
    if (book) {
      pageBeforeAdvance = book.current_page as number;
      if (passed && throughPage != null && throughPage > (book.current_page as number)) {
        const res = await advanceStretch(
          scope,
          {
            id: book.id as string,
            current_page: book.current_page as number,
            target_page: (book.target_page as number | null) ?? null,
            total_pages: (book.total_pages as number | null) ?? null,
          },
          throughPage,
          quizId
        );
        advanced = true;
        finished = res.finished;
        reachedMilestone = res.reachedMilestones[0] ?? null;
      }
    }
  }

  // A standout essay ("exceeds") earns a one-time 30-Buck bonus, keyed to the quiz so
  // it pays at most once per assignment. Legitimate only when this quiz actually moved
  // the book past its stretch — either now (advanced), or on an earlier passing attempt
  // (so the "meets now, come back and exceed" bonus shot still pays). Re-scoring an
  // already-read range this quiz never advanced can't farm it.
  if (isEssayQuiz && exceeded) {
    const stretchOwned =
      advanced ||
      (throughPage != null &&
        pageBeforeAdvance != null &&
        pageBeforeAdvance >= throughPage &&
        (await hasPriorPassOnQuiz(client, userId, quizId, submissionId)));
    if (stretchOwned) await creditEssayBonus(userId, quizId);
  }

  revalidateQuizzes();
  return {
    submissionId,
    attemptNumber,
    passed,
    exceeded,
    advanced,
    finished,
    reachedMilestone,
  };
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
    .select("id, book_id, from_page, through_page, chosen_question_id")
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

  // The essay prompt and the reader's written response on the prompt they chose
  // (falling back to the first essay question for a pre-existing one-prompt quiz).
  const chosenId = quiz.chosen_question_id as string | null;
  let essayQuery = client
    .from("reading_quiz_questions")
    .select("id, prompt")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .eq("type", "essay");
  essayQuery = chosenId
    ? essayQuery.eq("id", chosenId)
    : essayQuery.order("position", { ascending: true }).limit(1);
  const { data: essayQ } = await essayQuery.maybeSingle();
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
): Promise<
  | { ok: true; advanced: boolean; finished: boolean }
  | { ok: false; message: string }
> {
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
  if (!quiz) return { ok: false, message: "This quiz isn't available to close." };

  // Don't double-close: if any attempt already passed (a real pass or a prior
  // override), there's nothing to settle. This can legitimately race a parent
  // viewing a stale page — the reader may have passed for real since it loaded.
  const { data: existing } = await client
    .from("reading_quiz_submissions")
    .select("score_correct, score_total")
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  if (isPassed(existing ?? [])) {
    return { ok: false, message: "This quiz is already complete." };
  }

  const { count } = await client
    .from("reading_quiz_questions")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  const scoreTotal = count ?? 0;
  if (scoreTotal < 1) {
    return { ok: false, message: "This quiz has no questions to close." };
  }

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
      return { ok: false, message: "That didn't go through — please try again." };
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
      throughPage,
      quizId
    );
    advanced = true;
    finished = res.finished;
  }

  revalidateQuizzes();
  revalidatePath(`/reader/quizzes/${quizId}/results`);
  return { ok: true, advanced, finished };
}

/**
 * Delete one attempt at a quiz. Owner-only — a parent troubleshooting tool, so a
 * bad/duplicate try can be cleared and the quiz rerun. The submission's answer
 * rows cascade away with it. Does NOT regress the book if a passing attempt is
 * removed (advancing is a separate, deliberate step); it just clears the try.
 */
export async function deleteQuizAttempt(
  quizId: string,
  submissionId: string,
  memberEmail?: string | null
): Promise<void> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_quiz_submissions")
    .delete()
    .eq("id", submissionId)
    .eq("quiz_id", quizId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidateQuizzes();
  revalidatePath(`/reader/quizzes/${quizId}/results`);
}

/**
 * Re-grade the most recent attempt in place. Owner-only — a parent troubleshooting
 * tool for rerunning grading (e.g. after a rubric tweak) without piling up new
 * tries. Deletes the latest attempt, then re-grades its essay so the rerun lands
 * on the same attempt number, with the genuine previous draft as its revision
 * context — exactly as if the reader had turned in the same text again.
 */
export async function resubmitLatestAttempt(
  quizId: string,
  memberEmail?: string | null
): Promise<{ submissionId: string; attemptNumber: number }> {
  await requireOwner();
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: latestSub } = await client
    .from("reading_quiz_submissions")
    .select("id, attempt_number")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestSub) throw new Error("There's no attempt to resubmit yet.");

  const { data: rows } = await client
    .from("reading_quiz_answers")
    .select("question_id, selected_index, response_text")
    .eq("submission_id", latestSub.id)
    .eq("user_id", userId);
  const answers = (rows ?? []).map((r) => ({
    questionId: r.question_id as string,
    selectedIndex: (r.selected_index as number | null) ?? null,
    responseText: (r.response_text as string | null) ?? null,
  }));
  if (answers.length === 0) {
    throw new Error("That attempt has nothing to re-grade.");
  }

  // Drop the latest attempt first so the rerun reuses its attempt number and sees
  // the real prior draft (not itself) as the revision it's being judged against.
  const { error: delError } = await client
    .from("reading_quiz_submissions")
    .delete()
    .eq("id", latestSub.id)
    .eq("user_id", userId);
  if (delError) throw new Error(delError.message);

  const res = await submitQuiz(quizId, answers, memberEmail, {
    bypassEssayLock: true,
  });
  revalidatePath(`/reader/quizzes/${quizId}/results`);
  return { submissionId: res.submissionId, attemptNumber: res.attemptNumber };
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

  // Essay: whether they've hit "exceeds" and whether the single "meets → try once more
  // for the bonus" shot is still open, so the results view can offer it.
  const isEssay = ((questions ?? []) as ReadingQuizQuestion[]).some(
    (q) => q.type === "essay"
  );
  const essayState = isEssay
    ? await loadEssayQuizState(client, userId, quizId)
    : null;

  // Label a chapter book's covered range by chapter rather than a synthetic page.
  const chapters = await bookChapterList(
    client,
    userId,
    (quiz as ReadingQuiz).book_id,
    (book?.total_pages as number | null) ?? null
  );
  const coverageLabel = coverageChapterLabel(
    chapters,
    (quiz as ReadingQuiz).from_page,
    (quiz as ReadingQuiz).through_page
  );

  return {
    quiz: quiz as ReadingQuiz,
    bookTitle: (book?.title as string) ?? "this book",
    coverageLabel,
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
    exceeded: essayState?.hasExceeded ?? false,
    bonusShotAvailable: essayState?.isBonusShot ?? false,
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

  // Kids only — the admin console is for managing children's reading, not the
  // parents'/owner's own books.
  const { data: members } = await admin
    .from("family_members")
    .select("email, name, user_id")
    .eq("role", "kid")
    .not("user_id", "is", null);
  const memberRows = (members ?? []).filter((m) => m.user_id);
  const userIds = memberRows.map((m) => m.user_id as string);
  if (userIds.length === 0) return [];

  // Each kid's weekly page goal (reading_settings is keyed by email).
  const { data: goalRows } = await admin
    .from("reading_settings")
    .select("member_email, weekly_page_goal")
    .in("member_email", memberRows.map((m) => m.email as string));
  const goalByEmail = new Map<string, number>();
  for (const g of goalRows ?? []) {
    goalByEmail.set(g.member_email as string, (g.weekly_page_goal as number) ?? 0);
  }

  const [{ data: books }, { data: quizzes }] = await Promise.all([
    admin
      .from("reading_books")
      .select(
        "id, user_id, type, title, author, source_url, site_name, excerpt, word_count, total_pages, current_page, target_page, target_locked, target_due, target_chapter, status, cover_image_url, openlibrary_key, isbn, published_year, started_at, finished_at, rating, recommended_by_email, recommended_by_label, recommendation_note, created_at, updated_at"
      )
      .in("user_id", userIds),
    admin
      .from("reading_quizzes")
      .select("id, user_id, book_id, from_page, through_page, status, created_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false }),
  ]);

  // Uploaded-file state per book, for the admin's upload/replace control. The
  // toc + word count also let us label quiz ranges by chapter (below).
  const bookIds = (books ?? []).map((b) => b.id as string);
  const totalPagesById = new Map<string, number | null>(
    (books ?? []).map((b) => [b.id as string, (b.total_pages as number | null) ?? null])
  );
  const contentByBook = new Map<string, ReadingBookContentSummary>();
  const chaptersByBook = new Map<string, { title: string; endPage: number }[]>();
  if (bookIds.length > 0) {
    const { data: contentRows } = await admin
      .from("reading_book_content")
      .select("book_id, status, page_count, has_real_pages, word_count, toc, error_message")
      .in("book_id", bookIds);
    for (const c of contentRows ?? []) {
      const bookId = c.book_id as string;
      contentByBook.set(bookId, {
        status: c.status as ReadingBookContentSummary["status"],
        page_count: (c.page_count as number) ?? null,
        has_real_pages: (c.has_real_pages as boolean) ?? false,
        word_count: (c.word_count as number) ?? null,
        error_message: (c.error_message as string) ?? null,
      });
      // Chapter list (synthetic-page books only), mirroring the goal picker.
      const wordCount = (c.word_count as number | null) ?? null;
      if (c.status !== "ready" || c.has_real_pages || !wordCount) continue;
      const spans = chapterSpans((c.toc as ReadingTocEntry[]) ?? [], wordCount);
      if (spans.length === 0) continue;
      const contentWords = contentWordCount(spans, wordCount);
      const total = totalPagesById.get(bookId) ?? wordsToPage(contentWords);
      chaptersByBook.set(
        bookId,
        spans.map((s) => ({
          title: s.title,
          endPage: s.endWord >= contentWords ? total : wordsToPage(s.endWord),
        }))
      );
    }
  }

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
    // Only the active assignment: books currently being read. Paused/queued/
    // archived books (even ones with old quiz history) aren't administered here.
    if (status !== "in_progress") continue;

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
      book: b as unknown as ReadingBook,
      content: contentByBook.get(b.id as string) ?? null,
      chapters: chaptersByBook.get(b.id as string) ?? null,
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
      weeklyPageGoal: goalByEmail.get(m.email as string) ?? 0,
      books: list,
    });
  }
  result.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  return result;
}
