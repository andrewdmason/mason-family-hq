import Link from "next/link";
import { Settings } from "lucide-react";
import { AddBookDialog } from "@/components/reading/add-book-dialog";
import { AppHeaderContent } from "@/components/layout/app-header";
import { ReaderShelf } from "@/components/reading/reader-shelf";
import {
  ReaderOverflowMenu,
  type CopyableBook,
} from "@/components/reading/reader-overflow-menu";
import { getReadingHome, listRecommendRecipients } from "../actions";
import { getDiscover } from "../discover/actions";
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
 * Your shelf: your books as cover art, the way a Kindle opens. Reader drops you
 * straight into your last book, so this is where you come to pick a different
 * one — always your own books, never anyone else's.
 */
export default async function ReaderLibraryPage() {
  const [recipients, home, discover] = await Promise.all([
    listRecommendRecipients(),
    getReadingHome(null),
    getDiscover(null),
  ]);

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

      <ReaderShelf
        books={home.books}
        recommendations={discover.recommendations}
        recsHasSignal={discover.hasSignal}
        recsGenres={discover.genres}
      />
    </main>
  );
}
