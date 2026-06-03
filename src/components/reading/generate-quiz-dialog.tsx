"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
} from "@/components/ui/dialog";
import { generateQuizDraft } from "@/app/(reading)/reader/quizzes/actions";
import { quizEditHref } from "@/lib/reading/links";
import type { ReadingBook } from "@/lib/types";

/**
 * Owner-only: enter the page a kid was meant to read through, then generate a
 * draft quiz over the book from the start through that page. On success we route
 * to the draft editor to review/edit/publish.
 */
export function GenerateQuizDialog({
  book,
  memberEmail = null,
  defaultThroughPage = null,
  open,
  onOpenChange,
}: {
  book: ReadingBook;
  memberEmail?: string | null;
  /** This week's target page, used to prefill the range's end. */
  defaultThroughPage?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  // Default the range to "this week's stretch": from where they are now to the
  // week's target page (falling back to their current page).
  const fromDefault = book.current_page > 0 ? book.current_page : 1;
  const throughDefault = Math.max(
    fromDefault,
    defaultThroughPage ?? book.current_page ?? fromDefault
  );
  const [fromPage, setFromPage] = useState(String(fromDefault));
  const [throughPage, setThroughPage] = useState(String(throughDefault));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setFromPage(String(fromDefault));
      setThroughPage(String(throughDefault));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const through = Number(throughPage);
    const from = fromPage.trim() ? Number(fromPage) : null;
    if (!Number.isFinite(through) || through < 1) {
      setError("Enter the page the quiz should cover through.");
      return;
    }
    if (from != null && (!Number.isFinite(from) || from < 1 || from > through)) {
      setError("The start page must be at or before the end page.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const { quizId } = await generateQuizDraft({
          bookId: book.id,
          fromPage: from,
          throughPage: through,
          memberEmail,
        });
        onOpenChange(false);
        router.push(quizEditHref(quizId, memberEmail));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't generate the quiz."
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a quiz for {book.title}</DialogTitle>
          <DialogDescription>
            We&apos;ll write a comprehension quiz on the pages you set. Leave the
            start blank to cover the book from the beginning. You can review and
            edit it before it goes to {memberEmail ? "them" : "the reader"}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="quiz-from-page">From page (optional)</Label>
              <Input
                id="quiz-from-page"
                type="number"
                min={1}
                max={book.total_pages ?? undefined}
                placeholder="Start"
                value={fromPage}
                onChange={(e) => setFromPage(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="quiz-through-page">Through page</Label>
              <Input
                id="quiz-through-page"
                type="number"
                min={1}
                max={book.total_pages ?? undefined}
                value={throughPage}
                onChange={(e) => setThroughPage(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? "Generating…" : "Generate quiz"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
