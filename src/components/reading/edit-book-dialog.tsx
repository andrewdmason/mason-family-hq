"use client";

import { useEffect, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  listChapterLocationOptions,
  removeBook,
  updateBook,
  type ChapterGoalOption,
} from "@/app/(reading)/reader/actions";
import {
  CurrentLocationField,
  LOCATION_NOT_STARTED,
  locationToPage,
  preselectLocation,
} from "@/components/reading/change-location-dialog";
import { RatingPicker } from "@/components/reading/rating-picker";
import { useShelfBooks } from "@/components/reading/shelf-books";
import { READING_STATUSES, readingStatusLabel } from "@/lib/reading/status";
import {
  READING_GENRES,
  genreLabel,
  type ReadingGenre,
} from "@/lib/reading/book-genres";
import { cn } from "@/lib/utils";
import type { ReadingBook, ReadingBookStatus, ReadingRating } from "@/lib/types";

/** The fiction switch, as three explicit states — "unclear" is a real answer. */
const FICTION_CHOICES: { value: "fiction" | "nonfiction" | "unclear"; label: string }[] = [
  { value: "fiction", label: "Fiction" },
  { value: "nonfiction", label: "Nonfiction" },
  { value: "unclear", label: "Unclear" },
];

function fictionChoice(fiction: boolean | null): "fiction" | "nonfiction" | "unclear" {
  return fiction === true ? "fiction" : fiction === false ? "nonfiction" : "unclear";
}

export function EditBookDialog({
  book,
  memberEmail = null,
  trigger,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  book: ReadingBook;
  /** When set (owner view), edits/removal apply to this member's book. */
  memberEmail?: string | null;
  /** Custom trigger content (e.g. a cover tile). Defaults to a pencil button. */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  /** Controlled open state — when provided, no built-in trigger is rendered. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [totalPages, setTotalPages] = useState(
    book.total_pages ? String(book.total_pages) : ""
  );
  const [currentPage, setCurrentPage] = useState(String(book.current_page));
  // Chapter books track "current location" by chapter (page numbers are synthetic).
  // Null = a page-numbered book (or article) that keeps the plain page input.
  const [chapterOptions, setChapterOptions] = useState<
    ChapterGoalOption[] | null
  >(null);
  const [locationValue, setLocationValue] = useState(LOCATION_NOT_STARTED);
  const [initialLocation, setInitialLocation] = useState(LOCATION_NOT_STARTED);
  const [targetPage, setTargetPage] = useState(
    book.target_page != null ? String(book.target_page) : ""
  );
  const [status, setStatus] = useState<ReadingBookStatus>(book.status);
  const [rating, setRating] = useState<ReadingRating | null>(book.rating);
  const [fiction, setFiction] = useState(fictionChoice(book.fiction));
  const [genre, setGenre] = useState<ReadingGenre | "">(book.genre ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shelf = useShelfBooks();

  function syncFromBook() {
    setTitle(book.title);
    setAuthor(book.author ?? "");
    setTotalPages(book.total_pages ? String(book.total_pages) : "");
    setCurrentPage(String(book.current_page));
    setTargetPage(book.target_page != null ? String(book.target_page) : "");
    setStatus(book.status);
    setRating(book.rating);
    setFiction(fictionChoice(book.fiction));
    setGenre(book.genre ?? "");
    setError(null);
  }

  // Reset the form to the book's current values each time the dialog opens —
  // works whether opened by the built-in trigger or controlled from outside.
  // Lazily load the chapter list too: chapter books swap the "current page" input
  // for a chapter picker; page books (null result) keep the page input.
  useEffect(() => {
    if (!open) return;
    syncFromBook();
    setChapterOptions(null);
    listChapterLocationOptions(book.id, memberEmail)
      .then((loaded) => {
        if (loaded && loaded.options.length > 0) {
          const pre = preselectLocation(loaded.options);
          setChapterOptions(loaded.options);
          setLocationValue(pre);
          setInitialLocation(pre);
        } else {
          setChapterOptions(null);
        }
      })
      .catch(() => setChapterOptions(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Only send targetPage when the owner actually changed it — sending it always
    // would lock the target (blocking auto-tracking) on every unrelated edit.
    const targetNum = targetPage.trim() ? Number(targetPage) : null;
    const targetChanged = targetNum !== (book.target_page ?? null);
    // Chapter books: only send current_page when the picker actually moved — the
    // preselected chapter's end page can sit behind a reader who's mid-chapter, so
    // sending it on an unrelated edit would quietly rewind them.
    const categoryChanged =
      fiction !== fictionChoice(book.fiction) || genre !== (book.genre ?? "");
    const currentPagePatch = chapterOptions
      ? locationValue !== initialLocation
        ? { currentPage: locationToPage(chapterOptions, locationValue) }
        : {}
      : { currentPage: currentPage ? Number(currentPage) : 0 };
    const resolvedRating = status === "archive" ? rating : null;
    const parsedTotal = totalPages ? Number(totalPages) : null;
    const resolvedTotal = parsedTotal && parsedTotal > 0 ? parsedTotal : null;
    const resolvedCategory = {
      fiction:
        fiction === "fiction" ? true : fiction === "nonfiction" ? false : null,
      genre: genre || null,
    };

    // On the shelf the edits are already drawn behind this dialog, so it shuts
    // on the way out rather than holding you there while the save round-trips.
    // Elsewhere — the kids' program — the server's render is the only copy, so
    // the dialog still waits and reports its own failure.
    //
    // The category goes in the same breath as the rest, because the shelf can be
    // grouped and filtered by genre: retagging a book and watching it sit in the
    // old group would be the wait this was meant to remove, in the one place it
    // now shows most. Only the fields whose saved value is knowable from here,
    // though — the page you're on isn't one, since archiving a book quietly moves
    // it to the back cover, and a guess that never matches never settles.
    const undo = shelf.patchBook(book.id, {
      title: title.trim(),
      author: author.trim() || null,
      total_pages: resolvedTotal,
      status,
      rating: resolvedRating,
      ...(categoryChanged ? resolvedCategory : {}),
    });
    if (shelf.managed) setOpen(false);

    startTransition(async () => {
      try {
        await updateBook(book.id, {
          title,
          author,
          totalPages: resolvedTotal,
          ...currentPagePatch,
          ...(status === "in_progress" && targetChanged
            ? { targetPage: targetNum }
            : {}),
          status,
          rating: resolvedRating,
          // Only sent when actually changed: sending them on an unrelated edit
          // would stamp the book as hand-classified and freeze out the backfill.
          ...(categoryChanged ? resolvedCategory : {}),
          memberEmail,
        });
        setOpen(false);
      } catch (err) {
        undo();
        const message =
          err instanceof Error ? err.message : "Couldn't save changes.";
        if (shelf.managed) shelf.fail(message);
        else setError(message);
      }
    });
  }

  function handleRemove() {
    if (
      !window.confirm(`Remove "${book.title}" from your reading list?`)
    ) {
      return;
    }
    setError(null);
    const undo = shelf.dropBook(book.id);
    if (shelf.managed) setOpen(false);
    startTransition(async () => {
      try {
        await removeBook(book.id, memberEmail);
        setOpen(false);
      } catch (err) {
        undo();
        const message =
          err instanceof Error ? err.message : "Couldn't remove the book.";
        if (shelf.managed) shelf.fail(message);
        else setError(message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger
          render={
            <button
              type="button"
              aria-label={`Edit ${book.title}`}
              className={
                triggerClassName ??
                "text-muted-foreground transition-colors hover:text-foreground"
              }
            />
          }
        >
          {trigger ?? <Pencil className="h-4 w-4" />}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit book</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-book-title">Title</Label>
            <Input
              id="edit-book-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-book-author">Author</Label>
            <Input
              id="edit-book-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-book-total">Total pages</Label>
              <Input
                id="edit-book-total"
                type="number"
                min={1}
                value={totalPages}
                onChange={(e) => setTotalPages(e.target.value)}
              />
            </div>
            {chapterOptions ? (
              <CurrentLocationField
                id="edit-book-current"
                label="Current chapter"
                options={chapterOptions}
                value={locationValue}
                onChange={setLocationValue}
              />
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="edit-book-current">Current page</Label>
                <Input
                  id="edit-book-current"
                  type="number"
                  min={0}
                  value={currentPage}
                  onChange={(e) => setCurrentPage(e.target.value)}
                />
              </div>
            )}
          </div>
          {status === "in_progress" && (
            <div className="grid gap-1.5">
              <Label htmlFor="edit-book-target">This week&apos;s target page</Label>
              <Input
                id="edit-book-target"
                type="number"
                min={1}
                value={targetPage}
                placeholder="Auto (current page + weekly pages)"
                onChange={(e) => setTargetPage(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to track automatically from the current page.
              </p>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="edit-book-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ReadingBookStatus)}
            >
              <SelectTrigger id="edit-book-status" className="w-full">
                <SelectValue>{readingStatusLabel(status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {READING_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Kind</Label>
              <div className="inline-flex h-9 items-center rounded-lg bg-muted/60 p-0.5">
                {FICTION_CHOICES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setFiction(c.value)}
                    aria-pressed={fiction === c.value}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      fiction === c.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-book-genre">Genre</Label>
              <Select
                value={genre || "none"}
                onValueChange={(v) => setGenre(v === "none" ? "" : (v as ReadingGenre))}
              >
                <SelectTrigger id="edit-book-genre" className="w-full">
                  <SelectValue>
                    {genre ? genreLabel(genre) : "Uncategorized"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {READING_GENRES.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {status === "archive" && (
            <div className="grid gap-1.5">
              <Label>Your rating</Label>
              <RatingPicker
                value={rating}
                onSelect={(r) => setRating((prev) => (prev === r ? null : r))}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              Remove
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
