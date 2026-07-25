import { notFound, redirect } from "next/navigation";
import { QuizDraftEditor } from "@/components/reading/quiz-draft-editor";
import { getIsAdult } from "@/lib/members/auth";
import { getQuizForEditing, getQuizSteering } from "../../actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit Quiz",
};

export default async function EditQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ member?: string }>;
}) {
  const { id } = await params;
  const { member } = await searchParams;

  // Curation is adult-only (owner or parent); the actions enforce this server-side.
  if (!(await getIsAdult())) redirect("/books");

  const memberEmail = member?.trim().toLowerCase() || null;
  const [quiz, steering] = await Promise.all([
    getQuizForEditing(id, memberEmail),
    getQuizSteering(id, memberEmail),
  ]);
  if (!quiz) notFound();

  return (
    <QuizDraftEditor
      quiz={quiz}
      memberEmail={memberEmail}
      steeringMessages={steering?.messages ?? []}
      locked={steering?.locked ?? false}
    />
  );
}
