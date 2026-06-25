"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markTargetReached } from "@/app/(reading)/reader/actions";
import { quizTakeHref } from "@/lib/reading/links";
import { activeQuizState } from "@/lib/reading/quiz-due";
import type { ActiveBookQuiz } from "@/lib/types";

/**
 * "I reached my target" check-in. When the book is a paginated stretch, clicking
 * opens a short dialog where the reader confirms — or pushes past — the page they
 * reached (bonus pages). Declaring a higher page regenerates the quiz to the wider
 * range. For a book with a quiz it routes into that quiz (passing advances the
 * milestone and banks any bonus); otherwise it advances directly.
 */
export function MarkReachedButton({
  bookId,
  targetPage,
  currentPage,
  totalPages,
  activeQuiz,
  emphasize = false,
  memberEmail = null,
}: {
  bookId: string;
  targetPage: number | null;
  currentPage: number;
  totalPages: number | null;
  /** A published, unpassed quiz for this stretch, if any. */
  activeQuiz: ActiveBookQuiz | null;
  emphasize?: boolean;
  memberEmail?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(String(targetPage ?? currentPage + 1));
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const state = activeQuiz
    ? activeQuizState(activeQuiz.attempted, activeQuiz.dueNow)
    : null;

  const label =
    state === "retake"
      ? "Retake quiz"
      : activeQuiz
        ? "Reached it — take quiz"
        : targetPage != null
          ? `Reached page ${targetPage}`
          : "Mark reached";

  const emphasizeButton = emphasize || state === "due" || state === "retake";

  // The reader declares a page only when there's a target to push past. A retake
  // (the prompt's already committed) skips the dialog and goes straight back in.
  const canDeclare = targetPage != null && state !== "retake";

  function submit(reachedPage?: number | null) {
    setNote(null);
    startTransition(async () => {
      try {
        const res = await markTargetReached(bookId, memberEmail, reachedPage);
        if (res.outcome === "quiz") {
          router.push(quizTakeHref(res.quizId, memberEmail));
        } else if (res.outcome === "quiz_pending") {
          setNote("Your quiz is still being prepared — try again in a moment.");
          setOpen(false);
          router.refresh();
        } else {
          setOpen(false);
          router.refresh();
        }
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't update your target.");
      }
    });
  }

  function onClick() {
    if (canDeclare) {
      setPage(String(targetPage ?? currentPage + 1));
      setNote(null);
      setOpen(true);
    } else {
      submit();
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {state === "due" && (
        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.7rem] font-medium text-amber-700 dark:text-amber-400">
          Due now
        </span>
      )}
      {state === "retake" && (
        <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[0.7rem] font-medium text-destructive">
          Needs retake
        </span>
      )}
      <Button
        type="button"
        variant={emphasizeButton ? "default" : "outline"}
        size="sm"
        onClick={onClick}
        disabled={pending}
      >
        {pending ? "Saving…" : label}
      </Button>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>How far did you get?</DialogTitle>
            <DialogDescription>
              You can push past your goal of page {targetPage} for bonus pages —
              read further and your quiz will cover the extra.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reached-page">Page reached</Label>
            <Input
              id="reached-page"
              type="number"
              min={currentPage + 1}
              max={totalPages ?? undefined}
              value={page}
              onChange={(e) => setPage(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Lowest is your weekly goal
              {totalPages ? `; the book ends at page ${totalPages}` : ""}.
            </p>
          </div>
          {note && <p className="text-xs text-destructive">{note}</p>}
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                const n = Number(page);
                submit(Number.isFinite(n) ? Math.floor(n) : (targetPage ?? null));
              }}
              disabled={pending}
            >
              {pending ? "Building your quiz…" : "Take quiz"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
