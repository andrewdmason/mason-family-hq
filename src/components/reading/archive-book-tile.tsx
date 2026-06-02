"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Upload,
} from "lucide-react";
import { BookCover } from "@/components/reading/book-cover";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
}: {
  book: ReadingBookWithProgress;
  memberEmail?: string | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    inputRef,
    openFilePicker,
    handleFile,
    busy,
    uploadError,
    hasFile,
    isReady,
    isProcessing,
    isFailed,
  } = useBookFileActions(book, memberEmail);

  const preparing = busy || isProcessing;

  return (
    <div className="group flex flex-col gap-1.5 text-left">
      <div className="relative transition-transform group-hover:-translate-y-0.5">
        <BookCover url={book.cover_image_url} title={book.title} size="lg" />

        {/* Readable: a small icon badge by default that grows into a Read button
            on hover. While preparing/failed, show the matching status badge. */}
        {isReady ? (
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
            disabled={busy}
            className={cn(
              "absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50",
              menuOpen || busy ? "opacity-100" : "opacity-0"
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="w-48">
            <DropdownMenuItem disabled={busy} onClick={openFilePicker}>
              <Upload />
              {hasFile ? "Replace book file" : "Upload book file"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit details
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
