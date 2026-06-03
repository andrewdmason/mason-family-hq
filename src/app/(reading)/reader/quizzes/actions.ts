"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/members/auth";
import { resolveReadingScope } from "@/lib/reading/scope";
import { getTextForRange } from "@/lib/reading/extract-text";
import { generateQuiz } from "@/lib/reading/quiz-generate";
import { gradeFreeText, gradeMultipleChoice } from "@/lib/reading/quiz-grade";
import { readerAge } from "@/lib/reading/reader-age";
import { defaultQuizTitle, questionRows } from "@/lib/reading/quiz-build";
import { advanceStretch } from "@/lib/reading/advance";
import type {
  ActiveBookQuiz,
  OwnerQuizListItem,
  ReadingQuiz,
  ReadingQuizAnswer,
  ReadingQuizQuestion,
  ReadingQuizResult,
  ReadingQuizSubmission,
  ReadingQuizWithQuestions,
} from "@/lib/types";

const QUESTION_COLUMNS =
  "id, quiz_id, user_id, position, type, prompt, options, correct_index, explanation, grading_rubric, sample_answer, created_at";
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
  "Couldn't write questions from this book — try generating again.";

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
  const generated = await generateQuiz({
    bookTitle: book.title as string,
    author: (book.author as string) ?? null,
    fromPage,
    throughPage,
    text: slice.text,
    readerAge: age,
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
      generation_error: generated.questions.length ? null : GENERATION_FAILED_NOTE,
    })
    .select("id")
    .single();
  if (quizError) throw new Error(quizError.message);
  const quizId = quiz.id as string;

  if (generated.questions.length) {
    const { error: qError } = await client
      .from("reading_quiz_questions")
      .insert(questionRows(quizId, userId, generated.questions));
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
  const generated = await generateQuiz({
    bookTitle: book.title as string,
    author: (book.author as string) ?? null,
    fromPage,
    throughPage,
    text: slice.text,
    readerAge: age,
  });

  await client.from("reading_quiz_questions").delete().eq("quiz_id", quizId);
  if (generated.questions.length) {
    const { error: qError } = await client
      .from("reading_quiz_questions")
      .insert(questionRows(quizId, userId, generated.questions));
    if (qError) throw new Error(qError.message);
  }

  await client
    .from("reading_quizzes")
    .update({
      title: generated.title ?? defaultQuizTitle(fromPage, throughPage),
      generation_error: generated.questions.length ? null : GENERATION_FAILED_NOTE,
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
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!quiz) throw new Error("This quiz is already published.");

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
    .select("id, book_id, from_page, through_page")
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

  // Quizzes are newest-first; take the first unpassed one per book.
  const byBook: Record<string, ActiveBookQuiz> = {};
  for (const q of quizzes) {
    const bookId = q.book_id as string;
    if (byBook[bookId]) continue;
    const subs = subsByQuiz.get(q.id as string) ?? [];
    if (isPassed(subs)) continue;
    byBook[bookId] = {
      quizId: q.id as string,
      fromPage: (q.from_page as number | null) ?? null,
      throughPage: q.through_page as number,
      attempted: subs.length > 0,
    };
  }
  return byBook;
}

/**
 * A published quiz ready to take (or retake) — with answer keys stripped so
 * nothing is leaked to the browser. Returns null only if it's not published or
 * not found. Submitting always records a fresh attempt.
 */
export async function getQuizForTaking(
  quizId: string,
  memberEmail?: string | null
): Promise<ReadingQuizWithQuestions | null> {
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
    .select("id, quiz_id, user_id, position, type, prompt, options, created_at")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("position", { ascending: true });

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
    created_at: q.created_at as string,
  }));

  return { ...(quiz as ReadingQuiz), questions: stripped };
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

  // This attempt is the next number after any prior attempts on this quiz.
  const { data: prior } = await client
    .from("reading_quiz_submissions")
    .select("attempt_number")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const attemptNumber = ((prior?.attempt_number as number | undefined) ?? 0) + 1;

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

  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const age = await readerAge(email);

  // Grade everything (free-text calls run in parallel; each is independently
  // resilient inside gradeFreeText).
  const graded = await Promise.all(
    qs.map(async (q) => {
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
      };
    })
  );

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
      score_total: graded.length,
      grading_complete: gradingComplete,
    })
    .eq("id", submissionId)
    .eq("user_id", userId);

  // Passing (every question right) is the gate that advances the book's milestone
  // and pre-generates the next stretch's quiz. Only advance when this quiz covers
  // ground beyond the current page, so retaking an already-passed stretch is a no-op.
  let advanced = false;
  let finished = false;
  const passed = graded.length > 0 && scoreCorrect === graded.length;
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

const SUBMISSION_COLUMNS =
  "id, quiz_id, user_id, attempt_number, submitted_at, score_correct, score_total, grading_complete, created_at";

/**
 * A graded attempt with full feedback (correct answers + AI notes), plus a
 * summary of every attempt. Shows the latest attempt by default, or a specific
 * one when `submissionId` is given (and belongs to this reader's quiz).
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
  if (all.length === 0) return null;

  // The viewed attempt: the requested one if valid, else the most recent.
  const viewed =
    (submissionId && all.find((s) => s.id === submissionId)) ||
    all[all.length - 1];

  const [{ data: questions }, { data: answers }, { data: book }] =
    await Promise.all([
      client
        .from("reading_quiz_questions")
        .select(QUESTION_COLUMNS)
        .eq("quiz_id", quizId)
        .eq("user_id", userId)
        .order("position", { ascending: true }),
      client
        .from("reading_quiz_answers")
        .select(
          "id, submission_id, question_id, user_id, selected_index, response_text, is_correct, ai_notes, created_at"
        )
        .eq("submission_id", viewed.id)
        .eq("user_id", userId),
      client
        .from("reading_books")
        .select("title")
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
// Owner cross-kid list
// ============================================================

/** Every quiz across all signed-in family members, with results. Owner-only. */
export async function listAllQuizzes(): Promise<OwnerQuizListItem[]> {
  await requireOwner();
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("family_members")
    .select("email, name, user_id")
    .not("user_id", "is", null);
  const memberByUser = new Map(
    (members ?? []).map((m) => [
      m.user_id as string,
      { email: m.email as string, name: (m.name as string | null) ?? null },
    ])
  );
  const userIds = [...memberByUser.keys()];
  if (userIds.length === 0) return [];

  const { data: quizzes } = await admin
    .from("reading_quizzes")
    .select("id, user_id, book_id, from_page, through_page, status, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });
  if (!quizzes || quizzes.length === 0) return [];

  const quizIds = quizzes.map((q) => q.id as string);
  const bookIds = [...new Set(quizzes.map((q) => q.book_id as string))];

  const [{ data: books }, { data: submissions }] = await Promise.all([
    admin.from("reading_books").select("id, title").in("id", bookIds),
    admin
      .from("reading_quiz_submissions")
      .select(
        "quiz_id, attempt_number, submitted_at, score_correct, score_total, grading_complete"
      )
      .in("quiz_id", quizIds)
      .order("attempt_number", { ascending: true }),
  ]);

  const titleByBook = new Map(
    (books ?? []).map((b) => [b.id as string, b.title as string])
  );
  // Collect attempts per quiz (already ordered by attempt_number ascending).
  const attemptsByQuiz = new Map<string, typeof submissions>();
  for (const s of submissions ?? []) {
    const id = s.quiz_id as string;
    const list = attemptsByQuiz.get(id) ?? [];
    list.push(s);
    attemptsByQuiz.set(id, list);
  }

  return quizzes.map((q) => {
    const member = memberByUser.get(q.user_id as string);
    const attempts = attemptsByQuiz.get(q.id as string) ?? [];
    const last = attempts[attempts.length - 1];
    return {
      id: q.id as string,
      status: q.status as OwnerQuizListItem["status"],
      fromPage: (q.from_page as number | null) ?? null,
      throughPage: q.through_page as number,
      createdAt: q.created_at as string,
      bookTitle: titleByBook.get(q.book_id as string) ?? "Unknown book",
      memberEmail: member?.email ?? "",
      memberName: member?.name ?? null,
      attemptCount: attempts.length,
      passed: isPassed(attempts),
      latest: last
        ? {
            attemptNumber: last.attempt_number as number,
            submittedAt: last.submitted_at as string,
            scoreCorrect: last.score_correct as number,
            scoreTotal: last.score_total as number,
            gradingComplete: last.grading_complete as boolean,
          }
        : null,
    };
  });
}
