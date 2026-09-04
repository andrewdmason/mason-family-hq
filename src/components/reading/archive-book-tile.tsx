"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { BookCover } from "@/components/reading/book-cover";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeBook } from "@/app/(reading)/reader/actions";
import { startBookReflection } from "@/app/(journal)/journal/actions";
import { bookReaderHref } from "@/lib/reading/links";
import { useBookFileActions } from "@/lib/reading/use-book-file-actions";
import { cn } from "@/lib/utils";
import type { ReadingBookWithProgress } from "@/lib/types";

/**
 * A single archive-shelf tile: a cover with the same file affordances as the
 * reading list. The overflow menu (upload/replace, edit) and the readable badge
 * stay out of the way until you hover the tile — the badge is a small icon that
 * expands into a Read button.
 */
export function ArchiveBookTile({
  book,
  memberEmail = null,
  canRead = false,
}: {
  book: ReadingBookWithProgress;
  memberEmail?: string | null;
  /** Reader only — Bookshelf has no e-reader. */
  canRead?: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [reflectError, setReflectError] = useState<string | null>(null);
  const [reflecting, startReflect] = useTransition();
  const {
    inputRef,
    openFilePicker,
    handleFile,
    busy,
    uploadError,
    uploadNotice,
    hasFile,
    isReady,
    isProcessing,
    isFailed,
  } = useBookFileActions(book, memberEmail);

  const preparing = busy || isProcessing;

  function handleDelete() {
    if (!window.confirm(`Delete "${book.title}" from your books?`)) return;
    setDeleteError(null);
    startDelete(async () => {
      try {
        await removeBook(book.id, memberEmail);
      } catch (err) {
        setDeleteError(
          err instanceof Error ? err.message : "Couldn't delete the book."
        );
      }
    });
  }

  function handleReflect() {
    setReflectError(null);
    startReflect(async () => {
      try {
        const entryId = await startBookReflection(book.id);
        router.push(`/journal/new?entry=${entryId}`);
      } catch (err) {
        setReflectError(
          err instanceof Error ? err.message : "Couldn't start a journal entry."
        );
      }
    });
  }

  return (
    <div className="group flex flex-col gap-1.5 text-left">
      <div className="relative transition-transform group-hover:-translate-y-0.5">
        <BookCover url={book.cover_image_url} title={book.title} size="lg" />

        {/* Readable: a small icon badge by default that grows into a Read button
            on hover. While preparing/failed, show the matching status badge. */}
        {canRead && isReady ? (
          <Link
            href={bookReaderHref(book.id, memberEmail)}
            aria-label={`Read ${book.title}`}
            className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1.5 rounded-full bg-foreground/85 p-1.5 text-xs font-medium text-background shadow-sm backdrop-blur transition-all group-hover:px-2.5"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden whitespace-nowrap group-hover:inline">
              {book.hasResumePoint ? "Continue" : "Read"}
            </span>
          </Link>
        ) : preparing ? (
          <span
            className="absolute bottom-1.5 left-1.5 inline-flex items-center justify-center rounded-full bg-foreground/85 p-1.5 text-background shadow-sm backdrop-blur"
            title="Preparing your book…"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : isFailed ? (
          <span
            className="absolute bottom-1.5 left-1.5 inline-flex items-center justify-center rounded-full bg-destructive/90 p-1.5 text-white shadow-sm backdrop-blur"
            title="Couldn't prepare this book — re-upload from the menu"
          >
            <AlertCircle className="h-3.5 w-3.5" />
          </span>
        ) : null}

        {/* Overflow menu, upper-right, revealed on hover (or while open/focused). */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={`Actions for ${book.title}`}
            disabled={busy || deleting || reflecting}
            className={cn(
              "absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50",
              menuOpen || busy || deleting || reflecting ? "opacity-100" : "opacity-0"
            )}
          >
            {busy || deleting || reflecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="w-48">
            {/* Self-view only — you journal in your own journal, not a member's. */}
            {!memberEmail && (
              <>
                <DropdownMenuItem onClick={handleReflect} disabled={reflecting}>
                  <NotebookPen />
                  Reflect in journal
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem disabled={busy} onClick={openFilePicker}>
              <Upload />
              {hasFile ? "Replace book file" : "Upload book file"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit details
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
      {book.author && (
        <span className="line-clamp-1 text-[11px] text-muted-foreground">
          {book.author}
        </span>
      )}
      {uploadError && (
        <span className="text-[11px] text-destructive">{uploadError}</span>
      )}
      {uploadNotice && (
        <span className="text-[11px] text-muted-foreground">{uploadNotice}</span>
      )}
      {deleteError && (
        <span className="text-[11px] text-destructive">{deleteError}</span>
      )}
      {reflectError && (
        <span className="text-[11px] text-destructive">{reflectError}</span>
      )}

      <EditBookDialog
        book={book}
        memberEmail={memberEmail}
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
