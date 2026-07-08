import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button-variants";
import { QuizResultsAnswers } from "@/components/reading/quiz-results-answers";
import {
  EssayFeedback,
  EssayGradeCard,
} from "@/components/reading/quiz-essay-feedback";
import { QuizSuccessModal } from "@/components/reading/quiz-success-modal";
import { PostEssayToJournalButton } from "@/components/reading/post-essay-journal-button";
import { CloseQuizButton } from "@/components/reading/close-quiz-button";
import { AttemptAdminControls } from "@/components/reading/quiz-attempt-admin";
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

export const metadata = {
  title: "Quiz Results",
};

export default async function QuizResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    member?: string;
    submission?: string;
    celebrate?: string;
  }>;
}) {
  const { id } = await params;
  const {
    member,
    submission: submissionParam,
    celebrate,
  } = await searchParams;
  const memberEmail = member?.trim().toLowerCase() || null;
  const celebrateMilestone = celebrate?.trim() || null;

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
    exceeded,
    bonusShotAvailable,
  } = result;

  // A parent override is recorded as a perfect submission flagged with their email.
  // It shouldn't read (or celebrate) as the kid acing the quiz.
  const closedByParent = submission?.closed_by_email != null;
  const isEssay = questions.some((q) => q.type === "essay");
  const viewedPerfect =
    !!submission &&
    !closedByParent &&
    submission.score_total > 0 &&
    submission.score_correct === submission.score_total;
  const tz = await getUserTimezone();
  const dueDateLabel = nextFridayLabel(localDate(new Date(), tz));
  const readingHref = readingHomeHref(memberEmail);
  const rangeLabel = quizRangeLabel(quiz.from_page, quiz.through_page);

  // The essay format gets the doc-style feedback view — a continuation of the
  // writing surface — rather than the per-question results cards.
  if (isEssay) {
    // Show the prompt the reader committed to (the only one with an answer); fall
    // back to the first essay for a pre-existing one-prompt quiz.
    const essayQ =
      questions.find((q) => q.id === quiz.chosen_question_id) ??
      questions.find((q) => q.type === "essay") ??
      questions[0];
    const answer = essayQ ? answersByQuestionId[essayQ.id] : undefined;
    // Before the reader commits, every candidate prompt is still on the table —
    // show them all (rather than presenting the first as if it were decided).
    const essayPrompts = questions.filter((q) => q.type === "essay");
    const showingChoices = !quiz.chosen_question_id && essayPrompts.length > 1;
    const eyebrow = !submission
      ? "Not started"
      : closedByParent
        ? "Closed by a parent"
        : viewedPerfect
          ? exceeded
            ? "Exceeds expectations"
            : "Meets expectations"
          : passed
            ? "Passed on another try"
            : "Keep going";
    const attemptLine =
      submission && attempts.length > 1
        ? ` · attempt ${submission.attempt_number} of ${attempts.length}`
        : "";

    // With a graded attempt to show, the page becomes two columns so the tutor's
    // notes can ride alongside the essay as an anchored, scrollable rail (matching
    // the writing page). Before a first attempt, while choosing a prompt, or after
    // a parent override there's no card, so it stays a single centered column.
    const hasSidebar = !!submission && !closedByParent && !showingChoices;

    return (
      <main
        className={cn(
          "mx-auto flex w-full flex-1 px-6 pb-28 pt-12",
          hasSidebar
            ? "max-w-6xl flex-col gap-10 lg:flex-row lg:items-start lg:gap-12"
            : "max-w-2xl flex-col"
        )}
      >
        {hasSidebar && (
          <aside className="order-first w-full shrink-0 lg:order-last lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:w-80 lg:overflow-y-auto lg:overscroll-contain xl:w-96">
            <EssayGradeCard
              feedback={{
                rubricScores: answer?.rubric_scores ?? null,
                aiNotes: answer?.ai_notes ?? null,
                passed: viewedPerfect,
                gradingComplete: submission?.grading_complete ?? true,
              }}
            />
          </aside>
        )}

        <div
          className={cn(
            "flex w-full flex-1 flex-col",
            hasSidebar && "lg:max-w-2xl"
          )}
        >
          <header className="mb-8">
            <p className="font-serif text-sm text-muted-foreground">
              {eyebrow}
              {attemptLine}
            </p>
            <h1 className="mt-1 font-serif text-3xl tracking-tight text-foreground">
              {quiz.title || `On ${rangeLabel}`}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {bookTitle} · {rangeLabel}
            </p>
          </header>

          {submission && attempts.length > 1 && (
            <AttemptHistory
              quizId={id}
              memberEmail={memberEmail}
              attempts={attempts}
              viewedId={submission.id}
            />
          )}

          {isOwner && attempts.length > 0 && (
            <AttemptAdminControls
              quizId={id}
              memberEmail={memberEmail}
              isEssay={isEssay}
              attempts={attempts.map((a) => ({
                id: a.id,
                attemptNumber: a.attemptNumber,
              }))}
            />
          )}

          <div className="mt-6 flex flex-1 flex-col">
            {showingChoices ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Three prompts to choose from — they read all three and pick one
                  to write about when they start.
                </p>
                {essayPrompts.map((q, i) => (
                  <div
                    key={q.id}
                    className="rounded-lg border border-border px-5 py-4"
                  >
                    <p className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
                      Prompt {i + 1}
                    </p>
                    <p className="mt-2 font-serif text-lg italic leading-relaxed text-foreground">
                      {q.prompt}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EssayFeedback
                prompt={essayQ?.prompt ?? ""}
                essay={answer?.response_text ?? null}
                rubricScores={answer?.rubric_scores ?? null}
                aiNotes={answer?.ai_notes ?? null}
                attempted={!!submission}
                closedByParent={closedByParent}
                viewedPassed={viewedPerfect}
                gradingComplete={submission?.grading_complete ?? true}
                // The grade card now lives in the sidebar above.
                showCard={!hasSidebar}
              />
            )}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
            {!passed && (
              <Link
                href={quizTakeHref(id, memberEmail)}
                className={cn(buttonVariants({ variant: "default", size: "sm" }))}
              >
                {submission
                  ? "Revise essay"
                  : showingChoices
                    ? "Pick a prompt & start"
                    : "Start essay"}
              </Link>
            )}
            {/* Passed with "meets" and the single bonus shot still open — offer it. */}
            {passed && bonusShotAvailable && (
              <Link
                href={quizTakeHref(id, memberEmail)}
                className={cn(buttonVariants({ variant: "default", size: "sm" }))}
              >
                Try once more for the bonus
              </Link>
            )}
            {/* Passed with a written essay — share it to the family journal. */}
            {passed && !closedByParent && (
              <PostEssayToJournalButton quizId={id} memberEmail={memberEmail} />
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
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      {viewedPerfect && (
        <QuizSuccessModal
          assignment={nextAssignment}
          dueDateLabel={dueDateLabel}
          readingHref={readingHref}
          isEssay={isEssay}
          essayPost={isEssay ? { quizId: id, memberEmail } : null}
          celebrateMilestone={celebrateMilestone}
        />
      )}

      <h1 className="font-serif text-2xl tracking-tight text-foreground">
        {quiz.title || "Quiz results"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {bookTitle} · {quizRangeLabel(quiz.from_page, quiz.through_page)}
      </p>

      {submission && attempts.length > 1 && (
        <AttemptHistory
          quizId={id}
          memberEmail={memberEmail}
          attempts={attempts}
          viewedId={submission.id}
        />
      )}

      {isOwner && attempts.length > 0 && (
        <AttemptAdminControls
          quizId={id}
          memberEmail={memberEmail}
          isEssay={isEssay}
          attempts={attempts.map((a) => ({
            id: a.id,
            attemptNumber: a.attemptNumber,
          }))}
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
          {!submission
            ? "Not attempted yet."
            : closedByParent
              ? "Closed by a parent."
              : viewedPerfect
                ? "Passed — every question right."
                : `You got ${submission.score_correct} of ${submission.score_total} right`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {!submission
            ? "No attempts yet — this quiz is waiting to be taken."
            : attempts.length > 1
              ? `Attempt ${submission.attempt_number} of ${attempts.length}`
              : "First attempt"}
          {submission && closedByParent ? " · marked complete without passing" : ""}
          {submission && !viewedPerfect && !closedByParent && passed
            ? " · you passed this quiz on another try"
            : ""}
          {submission && !viewedPerfect && !closedByParent && !passed
            ? " · pass by getting every question right"
            : ""}
        </p>
        {submission && !submission.grading_complete && (
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
        attempted={!!submission}
      />

      <div className="mt-8 flex items-center gap-2">
        {!passed && (
          <Link
            href={quizTakeHref(id, memberEmail)}
            className={cn(buttonVariants({ variant: "default", size: "sm" }))}
          >
            {submission ? "Retake quiz" : "Take quiz"}
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
