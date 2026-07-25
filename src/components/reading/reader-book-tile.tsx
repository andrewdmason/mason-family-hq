"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  BookOpen,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  RotateCcw,
  ShoppingBag,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { BookCover } from "@/components/reading/book-cover";
import { removeDownload } from "@/lib/reading/offline/content-cache";
import { useIsDownloaded } from "@/lib/reading/offline/use-is-downloaded";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import {
  RATING_OPTIONS,
  ratingGlyph,
} from "@/components/reading/rating-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { rateBook, removeBook, updateBook } from "@/app/(reading)/reader/actions";
import { startBookReflection } from "@/app/(journal)/journal/actions";
import { bookReaderHref } from "@/lib/reading/links";
import { amazonHref, koboHref } from "@/lib/reading/store-links";
import { useBookFileActions } from "@/lib/reading/use-book-file-actions";
import { cn } from "@/lib/utils";
import type {
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingRating,
} from "@/lib/types";

/**
 * How far through the book you are, 0–100. The e-reader's own position wins;
 * a book you've only tracked by hand falls back to its page count. Null when
 * there's nothing to report yet — a queued book would only ever read 0%.
 */
function readerProgressPercent(
  book: ReadingBookWithProgress
): number | null {
  if (book.readerPercent != null) return book.readerPercent;
  if (!book.total_pages || book.current_page <= 0) return null;
  return Math.min(100, Math.round((book.current_page / book.total_pages) * 100));
}

/**
 * One book on the Reader shelf: cover art, title, and how far through it you
 * are. Clicking the cover opens the book — the whole point of the app — so
 * everything else (moving it around the shelf, the file, the store links) is
 * tucked into the overflow menu in the corner. Nothing here is about the kids'
 * reading program: no goals, no check-ins, no quizzes.
 */
export function ReaderBookTile({ book }: { book: ReadingBookWithProgress }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<ReadingRating | null>(book.rating);
  const [moving, startMove] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [reflecting, startReflect] = useTransition();
  const [savingRating, startRate] = useTransition();
  const {
    inputRef,
    openFilePicker,
    handleFile,
    retryConvert,
    busy,
    uploadError,
    retrying,
    hasFile,
    isReady,
    isProcessing,
    isFailed,
  } = useBookFileActions(book, null);

  const pending = busy || deleting || moving || reflecting || retrying || savingRating;
  const percent = readerProgressPercent(book);
  const downloaded = useIsDownloaded(book.id);

  /** Tap the rating you already gave to clear it, mirroring the rating picker. */
  function handleRate(next: ReadingRating) {
    const resolved = rating === next ? null : next;
    const previous = rating;
    setRating(resolved);
    setError(null);
    startRate(async () => {
      try {
        await rateBook(book.id, resolved, null);
      } catch {
        setRating(previous);
      }
    });
  }

  function handleMove(status: ReadingBookStatus) {
    setError(null);
    startMove(async () => {
      try {
        await updateBook(book.id, { status, memberEmail: null });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't move that book.");
      }
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${book.title}" from your books?`)) return;
    setError(null);
    startDelete(async () => {
      try {
        await removeBook(book.id, null);
        // Only after the server agrees it's gone — a failed delete must not
        // leave the book on the shelf but no longer readable offline.
        await removeDownload(book.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete the book.");
      }
    });
  }

  function handleReflect() {
    setError(null);
    startReflect(async () => {
      try {
        const entryId = await startBookReflection(book.id);
        router.push(`/journal/new?entry=${entryId}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't start a journal entry."
        );
      }
    });
  }

  // The cover is the click target. A book that's ready opens in the reader; one
  // without a file asks for it, since attaching the file is the only thing that
  // stands between you and reading it.
  const coverInner = (
    <>
      <BookCover url={book.cover_image_url} title={book.title} size="lg" />

      {/* Kindle-style progress: a hairline along the foot of the cover. Black
          track, white fill, so it reads over any cover art. A finished book
          doesn't need one — it's finished. */}
      {percent != null && percent > 0 && book.status !== "archive" && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
          <div className="h-full bg-white/95" style={{ width: `${percent}%` }} />
        </div>
      )}

      {isProcessing || busy ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center justify-center rounded-full bg-foreground/85 p-1.5 text-background shadow-sm backdrop-blur">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      ) : isFailed ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center justify-center rounded-full bg-destructive/90 p-1.5 text-white shadow-sm backdrop-blur">
          <AlertCircle className="h-3.5 w-3.5" />
        </span>
      ) : !hasFile ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center justify-center rounded-full bg-background/85 p-1.5 text-muted-foreground shadow-sm backdrop-blur">
          <Upload className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </>
  );

  const coverClass =
    "relative block w-full overflow-hidden rounded shadow-sm ring-1 ring-foreground/10";

  return (
    <div className="group flex flex-col gap-1.5 text-left">
      {/* Cover and its menu lift together on hover, the way a book comes off a
          shelf when you reach for it. */}
      <div className="relative transition-transform duration-150 group-hover:-translate-y-1">
        {isReady ? (
          <Link
            href={bookReaderHref(book.id)}
            aria-label={`${book.hasResumePoint ? "Continue" : "Read"} ${book.title}`}
            className={coverClass}
          >
            {coverInner}
          </Link>
        ) : (
          <button
            type="button"
            onClick={isFailed ? retryConvert : openFilePicker}
            disabled={busy || isProcessing || retrying}
            aria-label={
              isFailed
                ? `Try preparing ${book.title} again`
                : isProcessing
                  ? `${book.title} is still being prepared`
                  : `Add a file for ${book.title}`
            }
            className={cn(coverClass, "disabled:cursor-default")}
          >
            {coverInner}
          </button>
        )}

        {/* Overflow menu, upper-right. Always there on touch; on a pointer it
            fades in with the tile so the shelf stays quiet. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={`Actions for ${book.title}`}
            disabled={pending}
            className={cn(
              "absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
              (menuOpen || pending) && "opacity-100 sm:opacity-100"
            )}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="w-48">
            {isReady && (
              <DropdownMenuItem render={<Link href={bookReaderHref(book.id)} />}>
                <BookOpen />
                {book.hasResumePoint ? "Continue reading" : "Read"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleReflect} disabled={reflecting}>
              <NotebookPen />
              Reflect in journal
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Finishing a book is the one bit of shelf-keeping left: it's what
                moves a book out of the grid and into Finished, which is what
                "Copy books as markdown" and the ratings are built on. */}
            {book.status === "archive" ? (
              <>
                {/* Your verdict on a finished book: the thing the shelf groups
                    by, and what "Copy books as markdown" pastes into a chatbot.
                    A submenu rather than a row of emoji — a tile is too narrow
                    to hold the picker. */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Star />
                    {rating ? `Rated ${ratingGlyph(rating)}` : "Rate it"}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {RATING_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => handleRate(option.value)}
                        disabled={savingRating}
                      >
                        <span aria-hidden className="w-4 text-center">
                          {option.emoji ?? "—"}
                        </span>
                        {option.label}
                        {rating === option.value && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            Clear
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  onClick={() => handleMove("in_progress")}
                  disabled={moving}
                >
                  <RotateCcw />
                  Back on the shelf
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                onClick={() => handleMove("archive")}
                disabled={moving}
              >
                <Archive />
                Mark as finished
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {isFailed && (
              <DropdownMenuItem onClick={retryConvert} disabled={retrying}>
                <RotateCcw />
                Try preparing again
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={busy} onClick={openFilePicker}>
              <Upload />
              {hasFile ? "Replace book file" : "Upload book file"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit details
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <a href={amazonHref(book)} target="_blank" rel="noopener noreferrer" />
              }
            >
              <ShoppingBag />
              Find on Amazon
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <a href={koboHref(book)} target="_blank" rel="noopener noreferrer" />
              }
            >
              <ShoppingBag />
              Find on Kobo
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              <Trash2 />
              Delete book
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <span className="line-clamp-2 font-serif text-xs leading-tight text-foreground">
        {book.title}
      </span>

      {/* How far through you are — the one number worth carrying on the shelf.
          Where there's no progress to report, the file's state is the more
          useful thing to say; a finished book shows the verdict instead. */}
      <span
        className={cn(
          "text-[11px] tabular-nums text-muted-foreground",
          isFailed && "text-destructive"
        )}
      >
        {busy || isProcessing
          ? "Preparing…"
          : isFailed
            ? "Couldn't prepare"
            : book.status === "archive"
              ? "Finished"
              : percent != null
                ? `${percent}%`
                : hasFile
                  ? "Not started"
                  : "No file yet"}
        {/* Quiet on purpose: it matters exactly once, when you're deciding what
            to take on a plane, and never while you're just picking a book. */}
        {downloaded && !isFailed && !isProcessing && (
          <span className="text-muted-foreground/60"> · Offline</span>
        )}
      </span>

      {(error || uploadError) && (
        <span className="text-[11px] text-destructive">{error ?? uploadError}</span>
      )}

      <EditBookDialog
        book={book}
        memberEmail={null}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
