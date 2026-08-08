import { AddBookDialog } from "@/components/reading/add-book-dialog";
import { ReaderShelf } from "@/components/reading/reader-shelf";
import { getReadingHome, listRecommendRecipients } from "../actions";
import { getDiscover } from "../discover/actions";

export const dynamic = "force-dynamic";

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
          app switcher, left of the bell) rather than a page heading row. The
          shelf publishes them, because the shelf tabs sit in the same strip and
          the header takes one node per app. Add-a-book comes from here because it
          needs the list of people you can pass a book to; the settings link and
          the markdown copy the shelf renders itself, the latter because what it
          copies is the shelf's own live list. */}
      <ReaderShelf
        books={home.books}
        recommendations={discover.recommendations}
        recsHasSignal={discover.hasSignal}
        recsGenres={discover.genres}
        actions={
          <AddBookDialog
            triggerVariant="default"
            memberEmail={null}
            recipients={recipients}
          />
        }
      />
    </main>
  );
}
