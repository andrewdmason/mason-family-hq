import { notFound, redirect } from "next/navigation";
import { QuizRunner } from "@/components/reading/quiz-runner";
import { CloseQuizButton } from "@/components/reading/close-quiz-button";
import { getIsAdult } from "@/lib/members/auth";
import { quizResultsHref } from "@/lib/reading/links";
import { getQuizForTaking } from "../actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quiz",
};

export default async function TakeQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ member?: string }>;
}) {
  const { id } = await params;
  const { member } = await searchParams;
  const memberEmail = member?.trim().toLowerCase() || null;

  // Always takeable while published — submitting records a fresh attempt. After a
  // failed attempt, only the missed questions come back (retake: true).
  const [result, isAdult] = await Promise.all([
    getQuizForTaking(id, memberEmail),
    getIsAdult(),
  ]);
  if (!result) notFound();

  // The essay is finalized (exceeded, or the single post-pass bonus shot is spent) —
  // there's nothing left to write, so send them to the graded results instead.
  if (result.locked) {
    redirect(quizResultsHref(id, memberEmail));
  }

  return (
    <QuizRunner
      quiz={result.quiz}
      coverageLabel={result.coverageLabel}
      memberEmail={memberEmail}
      retake={result.retake}
      stage={result.stage}
      comprehensionPrompt={result.comprehensionPrompt}
      priorEssay={result.priorEssay}
      priorFeedback={result.priorFeedback}
      isBonusShot={result.isBonusShot}
      // The kid must type their essay. The owner/parent may paste so they can test —
      // and in local dev pasting is always allowed regardless of who's signed in.
      allowPaste={isAdult || process.env.NODE_ENV !== "production"}
      ownerSlot={
        isAdult ? (
          <CloseQuizButton
            quizId={id}
            memberEmail={memberEmail}
            variant="ghost"
            redirectTo={quizResultsHref(id, memberEmail)}
          />
        ) : null
      }
    />
  );
}
