"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, Upload } from "lucide-react";
import {
  BookActionsMenu,
  BookContextMenu,
  useBookMenu,
} from "@/components/reading/book-actions-menu";
import { BookCover } from "@/components/reading/book-cover";
import { useIsDownloaded } from "@/lib/reading/offline/use-is-downloaded";
import { bookNotesHref, bookReaderHref } from "@/lib/reading/links";
import { useBookFileActions } from "@/lib/reading/use-book-file-actions";
import { cn } from "@/lib/utils";
import type { ReadingBookWithProgress } from "@/lib/types";

/**
 * How far through the book you are, 0–100. The e-reader's own position wins;
 * a book you've only tracked by hand falls back to its page count. Null when
 * there's nothing to report yet — a queued book would only ever read 0%.
 */
export function readerProgressPercent(
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
  const [error, setError] = useState<string | null>(null);
  const file = useBookFileActions(book, null);
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
  } = file;

  const menu = useBookMenu({ book, file, onError: setError });
  const percent = readerProgressPercent(book);
  const downloaded = useIsDownloaded(book.id);

  // How much you marked this one up. Withheld while the file is being prepared
  // or has failed, for the same reason Offline is: those captions are saying
  // something you need to act on, and a count would only crowd them out.
  const showNotes =
    book.annotationCount > 0 && isReady && !busy && !isProcessing && !isFailed;

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
    // Right-click lands anywhere on the tile — cover, title, caption. On a shelf
    // the book is what you're pointing at, not the button in its corner.
    <BookContextMenu menu={menu} className="group flex flex-col gap-1.5 text-left">
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
        <BookActionsMenu
          menu={menu}
          className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        />
      </div>

      <span className="line-clamp-2 font-serif text-xs leading-tight text-foreground">
        {book.title}
      </span>

      {/* How far through you are, and how much you marked up — the two numbers
          worth carrying on the shelf. Where there's no progress to report, the
          file's state is the more useful thing to say; a finished book shows the
          verdict instead. */}
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
        {/* A finished book's caption used to be the word "Finished" and nothing
            else — a slot doing no work, under a Finished heading, inside an
            Archive tab. This is what belongs there. It's a link rather than a
            label because the count is only interesting as a way back into what
            you actually wrote. */}
        {showNotes && (
          <>
            {" · "}
            <Link
              href={bookNotesHref(book.id)}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {book.annotationCount}{" "}
              {book.annotationCount === 1 ? "note" : "notes"}
            </Link>
          </>
        )}
        {/* Quiet on purpose: it matters exactly once, when you're deciding what
            to take on a plane, and never while you're just picking a book. */}
        {downloaded && !isFailed && !isProcessing && (
          <span className="text-muted-foreground/60"> · Offline</span>
        )}
      </span>

      {(error || uploadError) && (
        <span className="text-[11px] text-destructive">{error ?? uploadError}</span>
      )}

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

      {menu.dialog}
    </BookContextMenu>
  );
}
