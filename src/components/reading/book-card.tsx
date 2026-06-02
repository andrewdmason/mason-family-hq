import { BookCover } from "@/components/reading/book-cover";
import { CheckInDialog } from "@/components/reading/check-in-dialog";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import { RatingControl } from "@/components/reading/rating-control";
import { StartReadingButton } from "@/components/reading/start-reading-button";
import type { ReadingBookWithProgress } from "@/lib/types";

export function BookCard({
  book,
  targetPage,
  emphasizeCheckIn = false,
  memberEmail = null,
}: {
  book: ReadingBookWithProgress;
  /** This week's target page, shown when it's this member's only active book. */
  targetPage?: number | null;
  emphasizeCheckIn?: boolean;
  memberEmail?: string | null;
}) {
  const inProgress = book.status === "in_progress";
  // Recommended by a real family member (AI picks carry a label but no email).
  const fromPerson = !!book.recommended_by_email && !!book.recommended_by_label;
  const pct =
    book.total_pages && book.total_pages > 0
      ? Math.min(100, Math.round((book.current_page / book.total_pages) * 100))
      : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-4 py-3">
      <BookCover url={book.cover_image_url} title={book.title} />

      <div className="min-w-0 flex-1">
        <p className="font-serif text-sm text-foreground">{book.title}</p>
        {book.author && (
          <p className="truncate text-xs text-muted-foreground">{book.author}</p>
        )}

        {/* The "Recommended by" badge is for real people only — an AI pick
            (no recommender email) just shows its rationale, which speaks for itself. */}
        {(fromPerson || book.recommendation_note) && (
          <div className="mt-1.5">
            {fromPerson && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                Recommended by {book.recommended_by_label}
              </span>
            )}
            {book.recommendation_note && (
              <p className={`text-xs italic text-muted-foreground${fromPerson ? " mt-1" : ""}`}>
                &ldquo;{book.recommendation_note}&rdquo;
              </p>
            )}
          </div>
        )}

        {/* Queued books haven't been opened — page/progress would just read 0. */}
        {book.status !== "queued" && (
          <>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                Page {book.current_page}
                {book.total_pages ? ` of ${book.total_pages}` : ""}
              </span>
              {pct != null && <span aria-hidden>· {pct}%</span>}
            </div>

            {pct != null && (
              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </>
        )}

        {inProgress && (
          <p className="mt-2 text-xs text-muted-foreground">
            {book.pagesReadThisWeek > 0
              ? `${book.pagesReadThisWeek} page${book.pagesReadThisWeek === 1 ? "" : "s"} this week`
              : "No pages logged this week yet"}
            {targetPage != null && (
              <span className="text-foreground">
                {" · "}aim for page {targetPage} by Sunday
              </span>
            )}
          </p>
        )}

        {book.status === "archive" && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {book.rating ? "Your rating" : "Rate it"}
            </span>
            <RatingControl
              bookId={book.id}
              rating={book.rating}
              memberEmail={memberEmail}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {inProgress && (
          <CheckInDialog
            book={book}
            emphasize={emphasizeCheckIn}
            targetPage={targetPage}
            memberEmail={memberEmail}
          />
        )}
        {(book.status === "queued" || book.status === "paused") && (
          <StartReadingButton bookId={book.id} memberEmail={memberEmail} />
        )}
        <EditBookDialog book={book} memberEmail={memberEmail} />
      </div>
    </div>
  );
}
