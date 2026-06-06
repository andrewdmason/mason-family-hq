import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button-variants";
import { QuizResultsAnswers } from "@/components/reading/quiz-results-answers";
import { QuizSuccessModal } from "@/components/reading/quiz-success-modal";
import { CloseQuizButton } from "@/components/reading/close-quiz-button";
import { getIsOwner } from "@/lib/members/auth";
import { addDays, getUserTimezone, localDate } from "@/lib/date-utils";
import {
  quizResultsHref,
  quizTakeHref,
  readingHomeHref,
} from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { cn } from "@/lib/utils";
import type { ReadingQuizAttemptSummary } from "@/lib/types";
import { getQuizResult } from "../../actions";

export const dynamic = "force-dynamic";

function nextFridayLabel(today: string): string {
  const dayOfWeek = new Date(`${today}T12:00:00`).getDay();
  const daysUntil = ((5 - dayOfWeek + 7) % 7) || 7;
  const due = addDays(today, daysUntil);
  return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default async function QuizResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ member?: string; submission?: string }>;
}) {
  const { id } = await params;
  const { member, submission: submissionParam } = await searchParams;
  const memberEmail = member?.trim().toLowerCase() || null;

  const [result, isOwner] = await Promise.all([
    getQuizResult(id, memberEmail, submissionParam ?? null),
    getIsOwner(),
  ]);
  if (!result) notFound();

  const {
    quiz,
    bookTitle,
    nextAssignment,
    questions,
    submission,
    answersByQuestionId,
    attempts,
    passed,
  } = result;

  // A parent override is recorded as a perfect submission flagged with their email.
  // It shouldn't read (or celebrate) as the kid acing the quiz.
  const closedByParent = submission.closed_by_email != null;
  const viewedPerfect =
    !closedByParent &&
    submission.score_total > 0 &&
    submission.score_correct === submission.score_total;
  const tz = await getUserTimezone();
  const dueDateLabel = nextFridayLabel(localDate(new Date(), tz));
  const readingHref = readingHomeHref(memberEmail);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      {viewedPerfect && (
        <QuizSuccessModal
          assignment={nextAssignment}
          dueDateLabel={dueDateLabel}
          readingHref={readingHref}
        />
      )}

      <h1 className="font-serif text-2xl tracking-tight text-foreground">
        {quiz.title || "Quiz results"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {bookTitle} · {quizRangeLabel(quiz.from_page, quiz.through_page)}
      </p>

      {attempts.length > 1 && (
        <AttemptHistory
          quizId={id}
          memberEmail={memberEmail}
          attempts={attempts}
          viewedId={submission.id}
        />
      )}

      <div
        className={cn(
          "mt-4 rounded-lg border px-4 py-3",
          viewedPerfect
            ? "border-emerald-600/30 bg-emerald-600/5"
            : "border-border bg-muted/40"
        )}
      >
        <p className="text-lg font-medium text-foreground">
          {closedByParent
            ? "Closed by a parent."
            : viewedPerfect
              ? "Passed — every question right."
              : `You got ${submission.score_correct} of ${submission.score_total} right`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {attempts.length > 1
            ? `Attempt ${submission.attempt_number} of ${attempts.length}`
            : "Your first attempt"}
          {closedByParent ? " · marked complete without passing" : ""}
          {!viewedPerfect && !closedByParent && passed
            ? " · you passed this quiz on another try"
            : ""}
          {!viewedPerfect && !closedByParent && !passed
            ? " · pass by getting every question right"
            : ""}
        </p>
        {!submission.grading_complete && (
          <p className="mt-1 text-xs text-muted-foreground">
            A couple of answers couldn&apos;t be graded automatically — they&apos;re
            marked below.
          </p>
        )}
      </div>

      <QuizResultsAnswers
        questions={questions}
        answersByQuestionId={answersByQuestionId}
        showByDefault={viewedPerfect}
        canReveal={isOwner}
      />

      <div className="mt-8 flex items-center gap-2">
        {!passed && (
          <Link
            href={quizTakeHref(id, memberEmail)}
            className={cn(buttonVariants({ variant: "default", size: "sm" }))}
          >
            Retake quiz
          </Link>
        )}
        <Link
          href={readingHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to reading
        </Link>
        {isOwner && !passed && (
          <CloseQuizButton quizId={id} memberEmail={memberEmail} />
        )}
      </div>
    </main>
  );
}

/** A row of clickable chips, one per attempt, so you can compare how each went. */
function AttemptHistory({
  quizId,
  memberEmail,
  attempts,
  viewedId,
}: {
  quizId: string;
  memberEmail: string | null;
  attempts: ReadingQuizAttemptSummary[];
  viewedId: string;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Attempts
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {attempts.map((a) => {
          const active = a.id === viewedId;
          return (
            <Link
              key={a.id}
              href={`${quizResultsHref(quizId, memberEmail)}${
                quizResultsHref(quizId, memberEmail).includes("?") ? "&" : "?"
              }submission=${a.id}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              Try {a.attemptNumber}: {a.scoreCorrect}/{a.scoreTotal}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
