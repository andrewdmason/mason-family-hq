import "server-only";
import { revalidatePath } from "next/cache";
import type { ReadingScope } from "@/lib/reading/scope";
import { getTextForRange } from "@/lib/reading/extract-text";
import { generateQuiz } from "@/lib/reading/quiz-generate";
import { readerAge } from "@/lib/reading/reader-age";
import { defaultQuizTitle, questionRows } from "@/lib/reading/quiz-build";

export type EnsureStretchResult = {
  quizId: string | null;
  status: "created" | "exists" | "no_content" | "error";
};

/**
 * Ensure a published quiz exists for a book's page stretch, generating one if
 * needed. Unlike the owner-only generateQuizDraft, this runs in whatever scope it
 * is handed (a kid in self mode, or the owner on a kid's behalf) and publishes
 * immediately with source='checkin' — it's the engine behind the auto-quiz
 * progression: a kid passing a quiz triggers generation of the next stretch's.
 *
 * Idempotent: if a published check-in quiz already covers this exact range, it's
 * returned as-is, so overlapping triggers (book started, file converted, milestone
 * passed) never produce duplicates. Callers MUST pass an already-resolved scope;
 * every query filters by scope.userId.
 */
export async function ensureStretchQuiz(
  scope: ReadingScope,
  bookId: string,
  fromPage: number | null,
  throughPage: number
): Promise<EnsureStretchResult> {
  const { client, userId, email } = scope;

  // Idempotency: an existing published check-in quiz for this exact range wins.
  let existingQuery = client
    .from("reading_quizzes")
    .select("id")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .eq("source", "checkin")
    .eq("status", "published")
    .eq("through_page", throughPage);
  existingQuery =
    fromPage == null
      ? existingQuery.is("from_page", null)
      : existingQuery.eq("from_page", fromPage);
  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) return { quizId: existing.id as string, status: "exists" };

  const { data: book } = await client
    .from("reading_books")
    .select("title, author")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return { quizId: null, status: "error" };

  const slice = await getTextForRange(client, userId, bookId, fromPage, throughPage);
  if (!slice) return { quizId: null, status: "no_content" };

  const age = await readerAge(email);
  const generated = await generateQuiz({
    bookTitle: book.title as string,
    author: (book.author as string) ?? null,
    fromPage,
    throughPage,
    text: slice.text,
    readerAge: age,
  });
  // Don't publish an empty quiz — the caller surfaces "still preparing / retry".
  if (!generated.questions.length) return { quizId: null, status: "error" };

  const { data: quiz, error } = await client
    .from("reading_quizzes")
    .insert({
      user_id: userId,
      book_id: bookId,
      from_page: fromPage,
      through_page: throughPage,
      status: "published",
      published_at: new Date().toISOString(),
      title: generated.title ?? defaultQuizTitle(fromPage, throughPage),
      created_by_email: email ?? "system",
      source: "checkin",
    })
    .select("id")
    .single();
  if (error || !quiz) return { quizId: null, status: "error" };
  const quizId = quiz.id as string;

  const { error: qError } = await client
    .from("reading_quiz_questions")
    .insert(questionRows(quizId, userId, generated.questions));
  if (qError) return { quizId: null, status: "error" };

  revalidatePath("/reader");
  return { quizId, status: "created" };
}
