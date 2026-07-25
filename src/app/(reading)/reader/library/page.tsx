import Link from "next/link";
import { Settings } from "lucide-react";
import { AddBookDialog } from "@/components/reading/add-book-dialog";
import { AppHeaderContent } from "@/components/layout/app-header";
import { ReadingList } from "@/components/reading/reading-list";
import { ReadingProgressHeader } from "@/components/reading/reading-progress-header";
import {
  ReaderOverflowMenu,
  type CopyableBook,
} from "@/components/reading/reader-overflow-menu";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getReadingHome, listRecommendRecipients } from "../actions";
import { getDiscover } from "../discover/actions";
import { getActiveQuizzesByBook } from "@/app/(books)/books/quizzes/actions";
import type { ReadingHome } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The archived shelf, trimmed to what "Copy books as markdown" needs — the
 * header is a client component, so this is what crosses the wire. Articles are
 * left out: the copied list is about book taste. */
function copyableArchive(home: ReadingHome): CopyableBook[] {
  return home.books
    .filter((b) => b.status === "archive" && (b.type ?? "book") === "book")
    .map((b) => ({
      title: b.title,
      author: b.author,
      rating: b.rating,
      published_year: b.published_year,
    }));
}

/**
 * Your shelf: everything you're reading, queued and done with, plus saved
 * articles. Reader opens straight into your last book, so this is where you
 * come to pick a different one — always your own books, never anyone else's.
 */
export default async function ReaderLibraryPage() {
  const [recipients, home] = await Promise.all([
    listRecommendRecipients(),
    getReadingHome(null),
  ]);

  const [discover, activeQuizzesByBook, tz] = await Promise.all([
    getDiscover(null),
    getActiveQuizzesByBook(
      home.books.map((b) => b.id),
      null
    ),
    getUserTimezone(),
  ]);

  const dayOfWeek = new Date(`${localDate(new Date(), tz)}T12:00:00`).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

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
          <ReaderOverflowMenu
            books={copyableArchive(home)}
            title="Books I've read"
          />
          <AddBookDialog
            triggerVariant="default"
            memberEmail={null}
            recipients={recipients}
          />
        </div>
      </AppHeaderContent>

      <ReadingProgressHeader
        bonusPagesTotal={home.bonusPagesTotal}
        memberEmail={null}
      />

      <ReadingList
        books={home.books}
        emphasizeCheckIn={isWeekend || !home.checkedInThisWeek}
        memberEmail={null}
        isAdult
        canRead
        activeQuizzesByBook={activeQuizzesByBook}
        recommendations={discover.recommendations}
        recsHasSignal={discover.hasSignal}
        recsGenres={discover.genres}
      />
    </main>
  );
}
