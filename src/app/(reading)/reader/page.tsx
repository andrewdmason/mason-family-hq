import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { AddBookDialog } from "@/components/reading/add-book-dialog";
import { MemberViewSwitcher } from "@/components/reading/member-view-switcher";
import { ReadingList } from "@/components/reading/reading-list";
import { listFamilyMembers } from "@/app/(journal)/settings/family/actions";
import { getIsOwner } from "@/lib/journal/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { quizzesHref } from "@/lib/reading/links";
import { getReadingHome, listRecommendRecipients } from "./actions";
import { getDiscover } from "./discover/actions";
import { getActiveQuizzesByBook } from "./quizzes/actions";

export const dynamic = "force-dynamic";

function firstName(name: string | null, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

export default async function ReadingPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member } = await searchParams;

  // Only the owner can view other members; resolve who we're looking at.
  const isOwner = await getIsOwner();
  const members = isOwner ? await listFamilyMembers() : [];
  const ownerEmail = members.find((m) => m.is_owner)?.email ?? "";
  // Viewable = the owner plus members who've signed in (so their data exists).
  const viewable = members.filter((m) => m.is_owner || m.user_id);

  const requested = isOwner ? member?.trim().toLowerCase() || null : null;
  const viewedMember =
    requested && requested !== ownerEmail
      ? viewable.find((m) => m.email === requested && !m.is_owner) ?? null
      : null;
  const viewingEmail = viewedMember?.email ?? null;

  const [home, discover] = await Promise.all([
    getReadingHome(viewingEmail),
    getDiscover(viewingEmail),
  ]);

  // Per-book check-in quizzes (published, not yet passed) — drive the
  // "check in & take quiz" CTA on each book card.
  const activeQuizzesByBook = await getActiveQuizzesByBook(
    home.books.map((b) => b.id),
    viewingEmail
  );

  // Recommend-to-someone is offered in self-view only (in view-as mode you're
  // already acting as that member).
  const recipients = viewingEmail ? [] : await listRecommendRecipients();

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const dayOfWeek = new Date(`${today}T12:00:00`).getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const urgent = isWeekend || !home.checkedInThisWeek;

  const heading = viewedMember
    ? `${firstName(viewedMember.name, "Their")}'s books`
    : "My books";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          {heading}
        </h1>
        <div className="flex items-center gap-2">
          {isOwner && (
            <Link
              href={quizzesHref(viewingEmail)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <GraduationCap className="h-4 w-4" />
              Quizzes
            </Link>
          )}
          {isOwner && viewable.length > 1 && (
            <MemberViewSwitcher
              members={viewable}
              ownerEmail={ownerEmail}
              currentEmail={viewingEmail ?? ownerEmail}
            />
          )}
          <AddBookDialog memberEmail={viewingEmail} recipients={recipients} />
        </div>
      </div>

      {viewedMember && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-xs text-muted-foreground">
          You&apos;re viewing{" "}
          <span className="font-medium text-foreground">
            {viewedMember.name ?? viewedMember.email}
          </span>
          &apos;s reading. Anything you add or check in is saved to their account.
        </p>
      )}

      <ReadingList
        books={home.books}
        emphasizeCheckIn={urgent}
        memberEmail={viewingEmail}
        isOwner={isOwner}
        activeQuizzesByBook={activeQuizzesByBook}
        recommendations={discover.recommendations}
        recsHasSignal={discover.hasSignal}
        recsGenres={discover.genres}
      />
    </main>
  );
}
