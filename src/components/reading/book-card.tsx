import { BookCover } from "@/components/reading/book-cover";
import { CheckInDialog } from "@/components/reading/check-in-dialog";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import { StartReadingButton } from "@/components/reading/start-reading-button";
import { readingStatusLabel } from "@/lib/reading/status";
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
  const pct =
    book.total_pages && book.total_pages > 0
      ? Math.min(100, Math.round((book.current_page / book.total_pages) * 100))
      : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-4 py-3">
      <BookCover url={book.cover_image_url} title={book.title} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-serif text-sm text-foreground">{book.title}</p>
          {!inProgress && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {readingStatusLabel(book.status)}
            </span>
          )}
        </div>
        {book.author && (
          <p className="truncate text-xs text-muted-foreground">{book.author}</p>
        )}

        {book.recommended_by_label && (
          <div className="mt-1.5">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              Recommended by {book.recommended_by_label}
            </span>
            {book.recommendation_note && (
              <p className="mt-1 text-xs italic text-muted-foreground">
                &ldquo;{book.recommendation_note}&rdquo;
              </p>
            )}
          </div>
        )}

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
