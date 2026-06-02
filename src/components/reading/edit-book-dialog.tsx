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
import { removeBook, updateBook } from "@/app/(reading)/reader/actions";
import { RatingPicker } from "@/components/reading/rating-picker";
import { READING_STATUSES, readingStatusLabel } from "@/lib/reading/status";
import type { ReadingBook, ReadingBookStatus, ReadingRating } from "@/lib/types";

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
  const [status, setStatus] = useState<ReadingBookStatus>(book.status);
  const [rating, setRating] = useState<ReadingRating | null>(book.rating);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function syncFromBook() {
    setTitle(book.title);
    setAuthor(book.author ?? "");
    setTotalPages(book.total_pages ? String(book.total_pages) : "");
    setCurrentPage(String(book.current_page));
    setStatus(book.status);
    setRating(book.rating);
    setError(null);
  }

  // Reset the form to the book's current values each time the dialog opens —
  // works whether opened by the built-in trigger or controlled from outside.
  useEffect(() => {
    if (open) syncFromBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await updateBook(book.id, {
          title,
          author,
          totalPages: totalPages ? Number(totalPages) : null,
          currentPage: currentPage ? Number(currentPage) : 0,
          status,
          rating: status === "archive" ? rating : null,
          memberEmail,
        });
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save changes.");
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
    startTransition(async () => {
      try {
        await removeBook(book.id, memberEmail);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't remove the book.");
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
          </div>
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
