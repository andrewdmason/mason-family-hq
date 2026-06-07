import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ChallengeCard } from "@/components/reading/challenge-card";
import { getIsOwner } from "@/lib/members/auth";
import { readingHomeHref } from "@/lib/reading/links";
import { getChallengeForKid } from "../challenges/actions";

export const dynamic = "force-dynamic";

export default async function ChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member } = await searchParams;

  // Only the owner can look at another member's challenge; otherwise it's your own.
  const isOwner = await getIsOwner();
  const viewingEmail = isOwner ? member?.trim().toLowerCase() || null : null;

  const challenge = await getChallengeForKid(viewingEmail);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href={readingHomeHref(viewingEmail)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to reading
      </Link>

      <div className="mt-6">
        {challenge ? (
          <ChallengeCard progress={challenge} showDescription />
        ) : (
          <p className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
            No reading challenge right now.
          </p>
        )}
      </div>
    </main>
  );
}
