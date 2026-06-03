"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  GraduationCap,
  Loader2,
  MoreHorizontal,
  Pencil,
  Upload,
} from "lucide-react";
import { BookCover } from "@/components/reading/book-cover";
import { MarkReachedButton } from "@/components/reading/mark-reached-button";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import { GenerateQuizDialog } from "@/components/reading/generate-quiz-dialog";
import { RatingControl } from "@/components/reading/rating-control";
import { StartReadingButton } from "@/components/reading/start-reading-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bookReaderHref } from "@/lib/reading/links";
import { useBookFileActions } from "@/lib/reading/use-book-file-actions";
import type { ActiveBookQuiz, ReadingBookWithProgress } from "@/lib/types";

export function BookCard({
  book,
  emphasizeCheckIn = false,
  memberEmail = null,
  isOwner = false,
  activeQuiz = null,
}: {
  book: ReadingBookWithProgress;
  emphasizeCheckIn?: boolean;
  memberEmail?: string | null;
  /** Owners get the "Generate quiz" action on books that have been uploaded. */
  isOwner?: boolean;
  /** A published, not-yet-passed quiz tied to this book's check-in, if any. */
  activeQuiz?: ActiveBookQuiz | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
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
  } = useBookFileActions(book, memberEmail);

  const inProgress = book.status === "in_progress";
  // Recommended by a real family member (AI picks carry a label but no email).
  const fromPerson = !!book.recommended_by_email && !!book.recommended_by_label;
  const pct =
    book.total_pages && book.total_pages > 0
      ? Math.min(100, Math.round((book.current_page / book.total_pages) * 100))
      : null;

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex items-start gap-3">
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

          {inProgress && book.target_page != null && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="text-foreground">
                Aim for page {book.target_page}
              </span>
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

        {/* Actions live on the same row as the overflow menu, to its left. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {inProgress && (
            <MarkReachedButton
              bookId={book.id}
              targetPage={book.target_page}
              hasActiveQuiz={!!activeQuiz}
              emphasize={emphasizeCheckIn}
              memberEmail={memberEmail}
            />
          )}
          {(book.status === "queued" || book.status === "paused") && (
            <StartReadingButton bookId={book.id} memberEmail={memberEmail} />
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label={`Actions for ${book.title}`}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-5 w-5" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-48">
              {/* Reading is uncommon for now, so it lives in the menu rather
                  than as a prominent button. Only shown once the file is ready. */}
              {isReady && (
                <DropdownMenuItem
                  render={<Link href={bookReaderHref(book.id, memberEmail)} />}
                >
                  <BookOpen />
                  {book.hasResumePoint ? "Continue reading" : "Read"}
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
              {/* Quizzes need the converted text, so only offer this once the
                  uploaded file is ready — and only to the account owner. */}
              {isOwner && isReady && (
                <DropdownMenuItem onClick={() => setQuizOpen(true)}>
                  <GraduationCap />
                  Generate quiz
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* File status: preparing, uploading, or a failed conversion to retry. */}
      {(busy || isProcessing || isFailed) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading and preparing your book…
            </span>
          ) : isProcessing ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Preparing your book…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              Couldn&apos;t prepare this book
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={retryConvert}
                disabled={retrying}
              >
                {retrying ? "Trying again…" : "Try again"}
              </Button>
            </span>
          )}
        </div>
      )}

      {uploadError && (
        <p className="mt-2 text-xs text-destructive">{uploadError}</p>
      )}

      <EditBookDialog
        book={book}
        memberEmail={memberEmail}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      {isOwner && (
        <GenerateQuizDialog
          book={book}
          memberEmail={memberEmail}
          defaultThroughPage={book.target_page}
          open={quizOpen}
          onOpenChange={setQuizOpen}
        />
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
    </div>
  );
}
