import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ChallengeEditor } from "@/components/reading/challenge-editor";
import { getIsParentOrOwner } from "@/lib/members/auth";
import { challengesHref } from "@/lib/reading/links";
import { listKidOptions } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewChallengePage() {
  if (!(await getIsParentOrOwner())) redirect("/reader");

  const kids = await listKidOptions();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href={challengesHref()}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All challenges
      </Link>

      <h1 className="mt-4 mb-6 font-serif text-2xl tracking-tight text-foreground">
        New challenge
      </h1>

      {kids.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No kids set up yet. Add a family member with the &ldquo;kid&rdquo; role first.
        </p>
      ) : (
        <ChallengeEditor mode="create" kids={kids} />
      )}
    </main>
  );
}
