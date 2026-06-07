import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ChallengeEditor } from "@/components/reading/challenge-editor";
import { getIsParentOrOwner } from "@/lib/members/auth";
import { challengeHref, challengesHref } from "@/lib/reading/links";
import { getChallengeAdmin } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditChallengePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getIsParentOrOwner())) redirect("/reader");

  const { id } = await params;
  const challenge = await getChallengeAdmin(id);
  if (!challenge) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex items-center justify-between">
        <Link
          href={challengesHref()}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          All challenges
        </Link>
        <Link
          href={challengeHref(challenge.kid_email)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          View as reader
        </Link>
      </div>

      <h1 className="mt-4 mb-6 font-serif text-2xl tracking-tight text-foreground">
        Edit challenge
      </h1>

      <ChallengeEditor mode="edit" challenge={challenge} />
    </main>
  );
}
