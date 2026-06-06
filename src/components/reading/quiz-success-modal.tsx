"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import type { ReadingQuizNextAssignment } from "@/lib/types";

function assignmentText(
  assignment: ReadingQuizNextAssignment,
  dueDateLabel: string
): string {
  if (assignment.finished) {
    return `You're finished with ${assignment.bookTitle}. Head back to Reader when you're ready to pick what comes next.`;
  }

  if (assignment.targetPage != null) {
    const total = assignment.totalPages ? ` of ${assignment.totalPages}` : "";
    const startPage = Math.max(1, assignment.currentPage + 1);
    const range =
      startPage <= assignment.targetPage
        ? `from page ${startPage} through page ${assignment.targetPage}${total}`
        : `through page ${assignment.targetPage}${total}`;
    return `Next assignment: read ${assignment.bookTitle} ${range} by ${dueDateLabel}.`;
  }

  return `Head back to Reader to see your next assignment for ${assignment.bookTitle}.`;
}

export function QuizSuccessModal({
  assignment,
  dueDateLabel,
  readingHref,
}: {
  assignment: ReadingQuizNextAssignment;
  dueDateLabel: string;
  readingHref: string;
}) {
  return (
    <Dialog defaultOpen>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-5" />
          </div>
          <DialogTitle>Quiz passed</DialogTitle>
          <DialogDescription>
            Every answer is correct. Nice work.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-lg border border-emerald-600/20 bg-emerald-600/5 px-3 py-2 text-sm text-foreground">
          {assignmentText(assignment, dueDateLabel)}
        </p>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            View answers
          </DialogClose>
          <Link
            href={readingHref}
            className={cn(buttonVariants({ variant: "default" }))}
          >
            Back to Reader
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
