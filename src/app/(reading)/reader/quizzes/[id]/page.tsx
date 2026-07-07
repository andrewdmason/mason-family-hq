import { notFound } from "next/navigation";
import { QuizRunner } from "@/components/reading/quiz-runner";
import { CloseQuizButton } from "@/components/reading/close-quiz-button";
import { getIsOwner } from "@/lib/members/auth";
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
  const [result, isOwner] = await Promise.all([
    getQuizForTaking(id, memberEmail),
    getIsOwner(),
  ]);
  if (!result) notFound();

  return (
    <QuizRunner
      quiz={result.quiz}
      memberEmail={memberEmail}
      retake={result.retake}
      priorEssay={result.priorEssay}
      priorComprehension={result.priorComprehension}
      priorFeedback={result.priorFeedback}
      // The kid must type their essay. The owner/parent may paste so they can test —
      // and in local dev pasting is always allowed regardless of who's signed in.
      allowPaste={isOwner || process.env.NODE_ENV !== "production"}
      ownerSlot={
        isOwner ? (
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
