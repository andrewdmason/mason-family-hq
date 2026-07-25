import Link from "next/link";
import { AddBookDialog } from "@/components/reading/add-book-dialog";
import { AppHeaderContent } from "@/components/layout/app-header";
import { ReadingAdminPanel } from "@/components/reading/reading-admin";
import { ReadingList } from "@/components/reading/reading-list";
import { ReadingProgressHeader } from "@/components/reading/reading-progress-header";
import { listFamilyMembers } from "@/app/(journal)/settings/family/actions";
import { getIsAdult } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { bookshelfHref } from "@/lib/reading/links";
import { cn } from "@/lib/utils";
import { getReadingHome } from "@/app/(reading)/reader/actions";
import { getDiscover } from "@/app/(reading)/reader/discover/actions";
import {
  getActiveQuizzesByBook,
  getReadingAdmin,
} from "./quizzes/actions";
import type { ReadingHome } from "@/lib/types";

export const dynamic = "force-dynamic";

function firstName(name: string | null, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

/**
 * Bookshelf — the kids' reading program. A kid lands on their own shelf; a
 * parent lands on a tab per kid and administers that child's goal, queue and
 * quizzes. Parents' own books deliberately don't appear here: those live in
 * Reader, which is the e-reader and nothing else.
 */
export default async function BookshelfPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member } = await searchParams;
  const isAdult = await getIsAdult();

  if (!isAdult) return <KidShelf />;

  // Parents administer kids only — never each other, and never themselves.
  const members = await listFamilyMembers();
  const kids = members.filter((m) => m.role === "kid" && m.user_id);
  if (kids.length === 0) return <NoKids />;

  const requested = member?.trim().toLowerCase() || null;
  const viewedKid = kids.find((k) => k.email === requested) ?? kids[0];

  const [home, adminMembers] = await Promise.all([
    getReadingHome(viewedKid.email),
    getReadingAdmin(),
  ]);
  const adminMember = adminMembers.find((m) => m.email === viewedKid.email) ?? {
    email: viewedKid.email,
    name: viewedKid.name,
    weeklyPageGoal: 0,
    books: [],
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <AppHeaderContent>
        <div className="ml-auto flex items-center gap-2">
          <AddBookDialog
            triggerVariant="default"
            memberEmail={viewedKid.email}
            recipients={[]}
          />
        </div>
      </AppHeaderContent>

      {kids.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
          {kids.map((k) => (
            <KidTab
              key={k.email}
              href={bookshelfHref(k.email)}
              active={viewedKid.email === k.email}
            >
              {firstName(k.name, k.email)}
            </KidTab>
          ))}
        </div>
      )}

      <ReadingAdminPanel
        member={adminMember}
        queuedBooks={home.books.filter((b) => b.status === "queued")}
        archivedBooks={home.books.filter((b) => b.status === "archive")}
        isAdult
      />
    </main>
  );
}

/** A kid's own shelf: weekly progress, then their books with check-in and quiz
 * CTAs. Same surface they had on the old reading home, minus everything that
 * was really for the adults. */
async function KidShelf() {
  const home: ReadingHome = await getReadingHome(null);
  const [discover, activeQuizzesByBook, tz] = await Promise.all([
    getDiscover(null),
    getActiveQuizzesByBook(
      home.books.map((b) => b.id),
      null
    ),
    getUserTimezone(),
  ]);

  // Check-ins are nudged harder on weekends and once the week's check-in is
  // still outstanding — the reading week ends Sunday.
  const dayOfWeek = new Date(`${localDate(new Date(), tz)}T12:00:00`).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <AppHeaderContent>
        <div className="ml-auto flex items-center gap-2">
          <AddBookDialog triggerVariant="default" memberEmail={null} recipients={[]} />
        </div>
      </AppHeaderContent>

      <ReadingProgressHeader bonusPagesTotal={home.bonusPagesTotal} memberEmail={null} />

      <ReadingList
        books={home.books}
        emphasizeCheckIn={isWeekend || !home.checkedInThisWeek}
        memberEmail={null}
        activeQuizzesByBook={activeQuizzesByBook}
        recommendations={discover.recommendations}
        recsHasSignal={discover.hasSignal}
        recsGenres={discover.genres}
      />
    </main>
  );
}

function NoKids() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <p className="text-sm text-muted-foreground">
        Bookshelf tracks the kids&apos; reading. Once a child signs in, their
        books and quizzes show up here. Your own reading lives in{" "}
        <Link href="/reader" className="underline underline-offset-4">
          Reader
        </Link>
        .
      </p>
    </main>
  );
}

/** A single kid's tab in the Bookshelf strip. */
function KidTab({
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
