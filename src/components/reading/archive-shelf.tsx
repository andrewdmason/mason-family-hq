import { BookCover } from "@/components/reading/book-cover";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import { RATING_OPTIONS } from "@/components/reading/rating-picker";
import type { ReadingBookWithProgress, ReadingRating } from "@/lib/types";

/**
 * The archive shelf: books you're done with, as a cover-focused tile grid grouped
 * by your verdict. Sentiment ratings first (loved → didn't like), "didn't finish"
 * at the bottom, and anything unrated up top to nudge a rating. Tapping a tile
 * opens its editor (where the rating, including DNF, can be set or changed).
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
}: {
  books: ReadingBookWithProgress[];
  memberEmail?: string | null;
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
                <EditBookDialog
                  key={book.id}
                  book={book}
                  memberEmail={memberEmail}
                  triggerClassName="group flex flex-col gap-1.5 text-left outline-none"
                  trigger={
                    <>
                      <span className="transition-transform group-hover:-translate-y-0.5">
                        <BookCover
                          url={book.cover_image_url}
                          title={book.title}
                          size="lg"
                        />
                      </span>
                      <span className="line-clamp-2 font-serif text-xs leading-tight text-foreground">
                        {book.title}
                      </span>
                      {book.author && (
                        <span className="line-clamp-1 text-[11px] text-muted-foreground">
                          {book.author}
                        </span>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
