"use client";

import { startTransition, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BookMarked,
  BookOpen,
  Check,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  PauseCircle,
  Pencil,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { removeDownload } from "@/lib/reading/offline/content-cache";
import { EditBookDialog } from "@/components/reading/edit-book-dialog";
import {
  RATING_OPTIONS,
  ratingGlyph,
} from "@/components/reading/rating-picker";
import { useShelfBooks } from "@/components/reading/shelf-books";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { assessBookIntoNote } from "@/app/(reading)/reader/discover/actions";
import { startBookReflection } from "@/app/(journal)/journal/actions";
import { bookReaderHref } from "@/lib/reading/links";
import { amazonHref, koboHref } from "@/lib/reading/store-links";
import { READING_STATUSES } from "@/lib/reading/status";
import type { useBookFileActions } from "@/lib/reading/use-book-file-actions";
import { cn } from "@/lib/utils";
import type {
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingRating,
} from "@/lib/types";

/** Where a book can live, in shelf order, each with the icon the tabs imply. */
const STATUS_ICONS: Record<ReadingBookStatus, typeof BookOpen> = {
  in_progress: BookOpen,
  queued: BookMarked,
  archive: Archive,
  paused: PauseCircle,
};

/**
 * Everything you can do to a book that isn't "open it": move it around the shelf,
 * attach its file, rate it, find it in a store, throw it away.
 *
 * One set of items, reachable two ways — the "…" button and a right-click on the
 * book itself. They're the same Base UI menu parts underneath, so only the root
 * and the trigger differ; the items are written once. Call the hook where the
 * book lives, then render the trigger where it belongs and wrap whatever should
 * answer a right-click.
 */
export function useBookMenu({
  book,
  memberEmail = null,
  file,
  onError,
}: {
  book: ReadingBookWithProgress;
  memberEmail?: string | null;
  /** The caller's own `useBookFileActions`. The cover reacts to the same state
   * (upload badge, click behaviour), and a second hook would mean two hidden
   * file inputs and two spinners disagreeing about whether an upload is live. */
  file: ReturnType<typeof useBookFileActions>;
  /** Where the caller wants failures shown — the row and the tile put them in
   * different places, and neither wants the menu reflowing its own layout. */
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const shelf = useShelfBooks();
  const [editOpen, setEditOpen] = useState(false);
  const [reflecting, startReflect] = useTransition();
  const [assessing, startAssess] = useTransition();

  const { busy, retrying, hasFile, isReady, isFailed, openFilePicker, retryConvert } =
    file;
  // Only the things you genuinely have to wait for. Rating a book, moving it and
  // deleting it all land on the shelf immediately (see shelf-books), so putting a
  // spinner over the menu for the length of those saves would be inventing a wait
  // that no longer exists. Asking whether you'll like a book is a real one — it's
  // a model reading the book, and there's nothing to draw until it answers.
  const pending = busy || reflecting || retrying || assessing;

  const rating = book.rating;

  /** A change that didn't stick. On the shelf the book may have moved out from
   * under this menu by now — to another tab, or off the shelf entirely — so the
   * shelf says so on its behalf. Elsewhere the caller's own slot still works. */
  function report(message: string) {
    if (shelf.managed) shelf.fail(message);
    else onError(message);
  }

  /** Tap the rating you already gave to clear it, mirroring the rating picker. */
  function handleRate(next: ReadingRating) {
    const resolved = rating === next ? null : next;
    onError(null);
    const undo = shelf.patchBook(book.id, { rating: resolved });
    startTransition(async () => {
      try {
        await rateBook(book.id, resolved, memberEmail);
      } catch {
        undo();
        report(`Couldn't save your rating for "${book.title}".`);
      }
    });
  }

  function handleMove(status: ReadingBookStatus) {
    if (status === book.status) return;
    onError(null);
    const undo = shelf.patchBook(book.id, { status });
    startTransition(async () => {
      try {
        await updateBook(book.id, { status, memberEmail });
      } catch (err) {
        undo();
        report(err instanceof Error ? err.message : "Couldn't move that book.");
      }
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${book.title}" from your books?`)) return;
    onError(null);
    const undo = shelf.dropBook(book.id);
    startTransition(async () => {
      try {
        await removeBook(book.id, memberEmail);
      } catch (err) {
        undo();
        report(err instanceof Error ? err.message : "Couldn't delete the book.");
        return;
      }
      // Only once the server agrees it's gone — a failed delete must not leave
      // the book on the shelf but no longer readable offline. A cache that won't
      // let go is nothing the reader needs to hear about: the book is deleted.
      await removeDownload(book.id).catch(() => {});
    });
  }

  function handleReflect() {
    onError(null);
    startReflect(async () => {
      try {
        const entryId = await startBookReflection(book.id);
        router.push(`/journal/new?entry=${entryId}`);
      } catch (err) {
        onError(
          err instanceof Error ? err.message : "Couldn't start a journal entry."
        );
      }
    });
  }

  /**
   * A fresh read on whether this book is for you, written straight into the
   * row's "why this book" line — the one place on the queue you'd look for it.
   * Overwrites what was there: a rationale you've outgrown, a friend's pitch you
   * can't evaluate, or the nothing most hand-added books arrive with.
   */
  function handleAssess() {
    onError(null);
    startAssess(async () => {
      try {
        const result = await assessBookIntoNote(book.id, memberEmail);
        if (!result) {
          onError("Couldn't get a read on that one — try again.");
        }
      } catch (err) {
        onError(
          err instanceof Error ? err.message : "Couldn't assess that book."
        );
      }
    });
  }

  const items = (
    <>
      {/* Only where the question is still live: a book you haven't started (or
          have set down) is one you're still deciding about. Once you're reading
          it, or it's on the archive shelf, you have your own answer. */}
      {(book.status === "queued" || book.status === "paused") && (
        <>
          <DropdownMenuItem onClick={handleAssess} disabled={assessing}>
            <Sparkles />
            Will I like this?
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      {isReady && (
        <DropdownMenuItem
          render={<Link href={bookReaderHref(book.id, memberEmail)} />}
        >
          <BookOpen />
          {book.hasResumePoint ? "Continue reading" : "Read"}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={handleReflect} disabled={reflecting}>
        <NotebookPen />
        Reflect in journal
      </DropdownMenuItem>
      <DropdownMenuSeparator />

      {/* Where the book lives. Every shelf in one submenu, rather than the single
          "Mark as finished" this used to be — Paused and Queue had no way in at
          all, so setting a book aside meant editing its details. */}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {(() => {
            const Icon = STATUS_ICONS[book.status];
            return <Icon />;
          })()}
          Status
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-40">
          {READING_STATUSES.map((option) => {
            const Icon = STATUS_ICONS[option.value];
            const current = option.value === book.status;
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => handleMove(option.value)}
                disabled={current}
              >
                <Icon />
                {option.label}
                {current && <Check className="ml-auto opacity-60" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      {/* Your verdict on a finished book: the thing the shelf groups by, and what
          "Copy books as markdown" pastes into a chatbot. A submenu rather than a
          row of emoji — a tile is too narrow to hold the picker. */}
      {book.status === "archive" && (
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
    </>
  );

  const dialog = (
    <EditBookDialog
      book={book}
      memberEmail={memberEmail}
      open={editOpen}
      onOpenChange={setEditOpen}
    />
  );

  return { items, dialog, pending, assessing, label: book.title };
}

export type BookMenu = ReturnType<typeof useBookMenu>;

/** The "…" button. Same items a right-click gives, for anyone not right-clicking. */
export function BookActionsMenu({
  menu,
  className,
  align = "end",
}: {
  menu: BookMenu;
  className?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={`Actions for ${menu.label}`}
        disabled={menu.pending}
        className={cn(className, (open || menu.pending) && "opacity-100")}
      >
        {menu.pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MoreHorizontal className="h-4 w-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side="bottom" className="w-48">
        {menu.items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Right-click anywhere on the book. The whole tile or row is the target, not just
 * the little button in its corner — on a shelf, the book is the thing you're
 * pointing at.
 */
export function BookContextMenu({
  menu,
  className,
  children,
}: {
  menu: BookMenu;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className={className}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">{menu.items}</ContextMenuContent>
    </ContextMenu>
  );
}
