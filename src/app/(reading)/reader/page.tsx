import Link from "next/link";
import { Settings } from "lucide-react";
import { AddBookDialog } from "@/components/reading/add-book-dialog";
import { AppHeaderContent } from "@/components/layout/app-header";
import { ReadingAdminPanel } from "@/components/reading/reading-admin";
import { ReadingList } from "@/components/reading/reading-list";
import { ReadingProgressHeader } from "@/components/reading/reading-progress-header";
import { listFamilyMembers } from "@/app/(journal)/settings/family/actions";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { readingHomeHref } from "@/lib/reading/links";
import { cn } from "@/lib/utils";
import { getReadingHome, listRecommendRecipients } from "./actions";
import { getDiscover } from "./discover/actions";
import { getActiveQuizzesByBook, getReadingAdmin } from "./quizzes/actions";

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
  // Kids get their own admin tab (signed-in kids only, so their data exists).
  const kids = members.filter((m) => m.role === "kid" && m.user_id);

  const requested = isOwner ? member?.trim().toLowerCase() || null : null;
  // A kid tab shows the parent-admin view for that child; anything else is the
  // owner's own "My books".
  const viewedKid =
    requested && requested !== ownerEmail
      ? kids.find((m) => m.email === requested) ?? null
      : null;
  const viewingEmail = viewedKid?.email ?? null;

  // Recommend-to-someone is offered in self-view only (a kid tab administers
  // that child, it doesn't recommend on their behalf).
  const recipients = viewedKid ? [] : await listRecommendRecipients();

  // The tab strip (owner with signed-in kids only): self plus one per kid.
  const tabs =
    isOwner && kids.length > 0 ? (
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        <ReadingTab href={readingHomeHref(null)} active={!viewedKid}>
          You
        </ReadingTab>
        {kids.map((k) => (
          <ReadingTab
            key={k.email}
            href={readingHomeHref(k.email)}
            active={viewedKid?.email === k.email}
          >
            {firstName(k.name, k.email)}
          </ReadingTab>
        ))}
      </div>
    ) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      {/* Reader settings + Add-a-book live in the global toolbar (right of the
          app switcher, left of the bell) rather than a page heading row. */}
      <AppHeaderContent>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/reader/settings"
            aria-label="Reader settings"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <AddBookDialog
            triggerVariant="default"
            memberEmail={viewingEmail}
            recipients={recipients}
          />
        </div>
      </AppHeaderContent>

      {tabs}

      {viewedKid ? (
        <KidAdminTab
          email={viewedKid.email}
          name={viewedKid.name}
          isOwner={isOwner}
        />
      ) : (
        <SelfReadingTab isOwner={isOwner} />
      )}
    </main>
  );
}

/** A single tab in the reading-home strip. Full navigation (server-rendered
 * content differs per tab), styled to match the old admin pills. */
function ReadingTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-muted/70 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}

/** The owner's (or any reader's) own book list — progress header plus books. */
async function SelfReadingTab({ isOwner }: { isOwner: boolean }) {
  const [home, discover] = await Promise.all([
    getReadingHome(null),
    getDiscover(null),
  ]);

  // Per-book check-in quizzes (published, not yet passed) — drive the
  // "check in & take quiz" CTA on each book card.
  const activeQuizzesByBook = await getActiveQuizzesByBook(
    home.books.map((b) => b.id),
    null
  );
  const recommendations = discover.recommendations;

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const dayOfWeek = new Date(`${today}T12:00:00`).getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const urgent = isWeekend || !home.checkedInThisWeek;

  return (
    <>
      <ReadingProgressHeader
        bonusPagesTotal={home.bonusPagesTotal}
        memberEmail={null}
      />

      <ReadingList
        books={home.books}
        emphasizeCheckIn={urgent}
        memberEmail={null}
        isOwner={isOwner}
        activeQuizzesByBook={activeQuizzesByBook}
        recommendations={recommendations}
        recsHasSignal={discover.hasSignal}
        recsGenres={discover.genres}
      />
    </>
  );
}

/** A kid's parent-admin panel: their weekly goal and in-progress books/quizzes,
 * plus their queue and archived shelf (from the reading home, scoped to them). */
async function KidAdminTab({
  email,
  name,
  isOwner,
}: {
  email: string;
  name: string | null;
  isOwner: boolean;
}) {
  const [adminMembers, home] = await Promise.all([
    getReadingAdmin(),
    getReadingHome(email),
  ]);
  const adminMember = adminMembers.find((m) => m.email === email) ?? {
    email,
    name,
    weeklyPageGoal: 0,
    books: [],
  };
  const queuedBooks = home.books.filter((b) => b.status === "queued");
  const archivedBooks = home.books.filter((b) => b.status === "archive");
  return (
    <ReadingAdminPanel
      member={adminMember}
      queuedBooks={queuedBooks}
      archivedBooks={archivedBooks}
      isOwner={isOwner}
    />
  );
}
