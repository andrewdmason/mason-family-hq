"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { checkIn } from "@/app/(reading)/reading/actions";
import type { ReadingBook } from "@/lib/types";

export function CheckInDialog({
  book,
  emphasize = false,
  targetPage = null,
  memberEmail = null,
}: {
  book: ReadingBook;
  emphasize?: boolean;
  /** This week's target page, shown in the form so the goal is in context. */
  targetPage?: number | null;
  /** When set (owner view), the check-in is recorded for this member. */
  memberEmail?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(String(book.current_page));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await checkIn(book.id, Number(page), memberEmail);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save your check-in.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPage(String(book.current_page));
      }}
    >
      <DialogTrigger
        render={
          <Button variant={emphasize ? "default" : "outline"} size="sm">
            Check in
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check in on {book.title}</DialogTitle>
          <DialogDescription>
            What page are you on now?
            {book.total_pages ? ` This book has ${book.total_pages} pages.` : ""}
            {targetPage != null
              ? ` Your target is page ${targetPage} by Sunday.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="checkin-page">Current page</Label>
            <Input
              id="checkin-page"
              type="number"
              min={0}
              max={book.total_pages ?? undefined}
              value={page}
              onChange={(e) => setPage(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save check-in"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
