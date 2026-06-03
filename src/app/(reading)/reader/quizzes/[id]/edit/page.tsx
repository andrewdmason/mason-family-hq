import { notFound, redirect } from "next/navigation";
import { QuizDraftEditor } from "@/components/reading/quiz-draft-editor";
import { getIsOwner } from "@/lib/members/auth";
import { getQuizForEditing } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ member?: string }>;
}) {
  const { id } = await params;
  const { member } = await searchParams;

  // Authoring is owner-only; getQuizForEditing also enforces this server-side.
  if (!(await getIsOwner())) redirect("/reader");

  const memberEmail = member?.trim().toLowerCase() || null;
  const quiz = await getQuizForEditing(id, memberEmail);
  if (!quiz) notFound();

  return <QuizDraftEditor quiz={quiz} memberEmail={memberEmail} />;
}
