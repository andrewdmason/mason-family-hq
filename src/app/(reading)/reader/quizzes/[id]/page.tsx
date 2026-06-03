import { notFound } from "next/navigation";
import { QuizRunner } from "@/components/reading/quiz-runner";
import { getQuizForTaking } from "../actions";

export const dynamic = "force-dynamic";

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

  // Always takeable while published — submitting records a fresh attempt.
  const quiz = await getQuizForTaking(id, memberEmail);
  if (!quiz) notFound();

  return <QuizRunner quiz={quiz} memberEmail={memberEmail} />;
}
