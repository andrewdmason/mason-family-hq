import { ArchiveBookTile } from "@/components/reading/archive-book-tile";
import { RATING_OPTIONS } from "@/components/reading/rating-picker";
import type { ReadingBookWithProgress, ReadingRating } from "@/lib/types";

/**
 * The archive shelf: books you're done with, as a cover-focused tile grid grouped
 * by your verdict. Sentiment ratings first (loved → didn't like), "didn't finish"
 * at the bottom, and anything unrated up top to nudge a rating. Each tile carries
 * the same hover affordances as the reading list: a Read badge when a file's been
 * uploaded, and an overflow menu to upload/replace the file or edit details.
 */

// Display order of the groups, top to bottom.
const GROUP_ORDER: (ReadingRating | "unrated")[] = [
  "unrated",
  "loved",
  "liked",
  "neutral",
  "disliked",
  "didnt_finish",
];

function groupHeading(group: ReadingRating | "unrated"): string {
  if (group === "unrated") return "Unrated";
  const option = RATING_OPTIONS.find((o) => o.value === group);
  const glyph = option?.emoji ?? option?.chip ?? "";
  return `${glyph}  ${option?.label ?? group}`;
}

export function ArchiveShelf({
  books,
  memberEmail = null,
  canRead = false,
}: {
  books: ReadingBookWithProgress[];
  memberEmail?: string | null;
  /** Reader only — Bookshelf has no e-reader. */
  canRead?: boolean;
}) {
  const byGroup = new Map<ReadingRating | "unrated", ReadingBookWithProgress[]>();
  for (const book of books) {
    const key = book.rating ?? "unrated";
    (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(book);
  }

  return (
    <div className="mt-5 flex flex-col gap-8">
      {GROUP_ORDER.map((group) => {
        const groupBooks = byGroup.get(group);
        if (!groupBooks || groupBooks.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
              <span>{groupHeading(group)}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                {groupBooks.length}
              </span>
            </h2>
            <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
              {groupBooks.map((book) => (
                <ArchiveBookTile
                  key={book.id}
                  book={book}
                  memberEmail={memberEmail}
                  canRead={canRead}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
