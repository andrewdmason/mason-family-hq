import { AddBookDialog } from "@/components/reading/add-book-dialog";
import { MemberViewSwitcher } from "@/components/reading/member-view-switcher";
import { ReadingList } from "@/components/reading/reading-list";
import { WeeklyGoalBanner } from "@/components/reading/weekly-goal-banner";
import { listFamilyMembers } from "@/app/(journal)/settings/family/actions";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getReadingHome, listRecommendRecipients } from "./actions";
import { getDiscover } from "./discover/actions";

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
  const ownerEmail = members.find((m) => m.role === "owner")?.email ?? "";
  // Viewable = the owner plus members who've signed in (so their data exists).
  const viewable = members.filter((m) => m.role === "owner" || m.user_id);

  const requested = isOwner ? member?.trim().toLowerCase() || null : null;
  const viewedMember =
    requested && requested !== ownerEmail
      ? viewable.find((m) => m.email === requested && m.role !== "owner") ?? null
      : null;
  const viewingEmail = viewedMember?.email ?? null;

  const [home, discover] = await Promise.all([
    getReadingHome(viewingEmail),
    getDiscover(viewingEmail),
  ]);

  // Recommend-to-someone is offered in self-view only (in view-as mode you're
  // already acting as that member).
  const recipients = viewingEmail ? [] : await listRecommendRecipients();

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const dayOfWeek = new Date(`${today}T12:00:00`).getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const urgent = isWeekend || !home.checkedInThisWeek;
  // Days from today through the week's end (Sunday). 0 = due today.
  const daysRemaining = (7 - dayOfWeek) % 7;

  // When a member has exactly one active book, the per-person goal maps cleanly
  // to a single "be on page N by Sunday" target.
  const inProgress = home.books.filter((b) => b.status === "in_progress");
  const soleBook = inProgress.length === 1 ? inProgress[0] : null;
  const soleBookTargetPage =
    soleBook && home.weeklyPageGoal > 0
      ? soleBook.current_page - soleBook.pagesReadThisWeek + home.weeklyPageGoal
      : null;

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

      <div className="mt-5">
        <WeeklyGoalBanner
          weeklyPageGoal={home.weeklyPageGoal}
          targetPage={soleBookTargetPage}
          currentPage={soleBook?.current_page ?? null}
          daysRemaining={daysRemaining}
          checkInBook={soleBook ?? null}
          memberEmail={viewingEmail}
        />
      </div>

      <ReadingList
        books={home.books}
        soleBookId={soleBook?.id ?? null}
        soleBookTargetPage={soleBookTargetPage}
        emphasizeCheckIn={urgent}
        memberEmail={viewingEmail}
        recommendations={discover.recommendations}
        recsHasSignal={discover.hasSignal}
        recsGenres={discover.genres}
      />
    </main>
  );
}
