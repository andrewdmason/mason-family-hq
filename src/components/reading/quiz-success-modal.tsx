"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Send } from "lucide-react";
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
import { postEssayToFamilyJournal } from "@/app/(books)/books/quizzes/actions";
import { cn } from "@/lib/utils";
import { ESSAY_BONUS_BUCKS } from "@/lib/reading/essay-scoring";
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
  isEssay = false,
  essayPost = null,
  celebrateMilestone = null,
  earnedBonus = false,
  bonusShotHref = null,
}: {
  assignment: ReadingQuizNextAssignment;
  dueDateLabel: string;
  readingHref: string;
  /** True for the essay format — tunes the copy. */
  isEssay?: boolean;
  /** When present, offers a one-tap "post to the family journal" action. */
  essayPost?: { quizId: string; memberEmail: string | null } | null;
  /** Title of a reward milestone this pass just reached, celebrated up top. */
  celebrateMilestone?: string | null;
  /** True when this essay reached "exceeds" and earned the Mason Bucks bonus. */
  earnedBonus?: boolean;
  /** Essay: passed with "meets" and the single bonus shot is still open — the link to
   *  take that one optional shot at "exceeds". Null when there's no shot to offer. */
  bonusShotHref?: string | null;
}) {
  const router = useRouter();
  const [posting, startPosting] = useTransition();
  const [posted, setPosted] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  function handlePost() {
    setPostError(null);
    startPosting(async () => {
      try {
        const { entryId } = await postEssayToFamilyJournal(
          essayPost!.quizId,
          essayPost!.memberEmail
        );
        setPosted(true);
        router.push(`/journal/${entryId}`);
      } catch (err) {
        setPostError(
          err instanceof Error ? err.message : "Couldn't post to the journal."
        );
      }
    });
  }

  return (
    <Dialog defaultOpen>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-5" />
          </div>
          <DialogTitle>
            {!isEssay
              ? "Quiz passed"
              : earnedBonus
                ? "Standout essay!"
                : "Essay passed"}
          </DialogTitle>
          <DialogDescription>
            {!isEssay
              ? "Every answer is correct. Nice work."
              : earnedBonus
                ? "Your thinking went the extra mile. Really nice work."
                : bonusShotHref
                  ? "You met the bar — your book moves forward. Want one more shot at the bonus?"
                  : "You cleared the bar with a strong essay. Really nice work."}
          </DialogDescription>
        </DialogHeader>

        {earnedBonus && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            🪙 Standout essay — you earned {ESSAY_BONUS_BUCKS} Mason Bucks!
          </p>
        )}

        {!earnedBonus && bonusShotHref && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            🪙 Push your thinking further — reach{" "}
            <span className="font-medium">exceeds</span> and earn{" "}
            {ESSAY_BONUS_BUCKS} Mason Bucks. You get one more try.
          </p>
        )}

        {celebrateMilestone && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            🎉 You reached a reward milestone: {celebrateMilestone}!
          </p>
        )}

        <p className="rounded-lg border border-emerald-600/20 bg-emerald-600/5 px-3 py-2 text-sm text-foreground">
          {assignmentText(assignment, dueDateLabel)}
        </p>

        {essayPost && (
          <div className="grid gap-1.5">
            <Button
              type="button"
              variant="secondary"
              onClick={handlePost}
              disabled={posting || posted}
            >
              <Send className="size-4" />
              {posted
                ? "Posted to the family journal"
                : posting
                  ? "Posting…"
                  : "Post it to the family journal"}
            </Button>
            {postError && (
              <p className="text-xs text-destructive">{postError}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {isEssay ? "View feedback" : "View answers"}
          </DialogClose>
          {!earnedBonus && bonusShotHref ? (
            <Link
              href={bonusShotHref}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Try once more for the bonus
            </Link>
          ) : (
            <Link
              href={readingHref}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Back to Reader
            </Link>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
