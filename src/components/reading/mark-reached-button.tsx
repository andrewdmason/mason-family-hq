"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markTargetReached } from "@/app/(reading)/reader/actions";
import { quizTakeHref } from "@/lib/reading/links";
import { activeQuizState } from "@/lib/reading/quiz-due";
import type { ActiveBookQuiz } from "@/lib/types";

/**
 * Binary "I reached my target" check-in. No page entry. For a book with a quiz it
 * routes into the stretch quiz (passing advances the milestone); otherwise it
 * advances directly. The kid never types a page number here — changing the target
 * for bonus reading is the separate "Change" control next to the goal. When the
 * quiz is due this week or a failed attempt needs a retake, the button says so.
 */
export function MarkReachedButton({
  bookId,
  targetPage,
  activeQuiz,
  emphasize = false,
  memberEmail = null,
}: {
  bookId: string;
  targetPage: number | null;
  /** A published, unpassed quiz for this stretch, if any. */
  activeQuiz: ActiveBookQuiz | null;
  emphasize?: boolean;
  memberEmail?: string | null;
}) {
  const router = useRouter();
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

  // A pressing quiz (due now or awaiting a retake) gets the filled button.
  const emphasizeButton = emphasize || state === "due" || state === "retake";

  function go() {
    setNote(null);
    startTransition(async () => {
      try {
        const res = await markTargetReached(bookId, memberEmail);
        if (res.outcome === "quiz") {
          router.push(quizTakeHref(res.quizId, memberEmail));
        } else if (res.outcome === "quiz_pending") {
          setNote("Your quiz is still being prepared — try again in a moment.");
          router.refresh();
        } else {
          router.refresh();
        }
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't update your target.");
      }
    });
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
        onClick={go}
        disabled={pending}
      >
        {pending ? "Saving…" : label}
      </Button>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
