"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markTargetReached } from "@/app/(reading)/reader/actions";
import { quizTakeHref } from "@/lib/reading/links";

/**
 * Binary "I reached my target" check-in. No page entry. For a book with a quiz it
 * routes into the stretch quiz (passing advances the milestone); otherwise it
 * advances directly. The kid never types a page number.
 */
export function MarkReachedButton({
  bookId,
  targetPage,
  hasActiveQuiz,
  emphasize = false,
  memberEmail = null,
}: {
  bookId: string;
  targetPage: number | null;
  /** True when a published, unpassed quiz is ready for this stretch. */
  hasActiveQuiz: boolean;
  emphasize?: boolean;
  memberEmail?: string | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = hasActiveQuiz
    ? "Reached it — take quiz"
    : targetPage != null
      ? `Reached page ${targetPage}`
      : "Mark reached";

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
      <Button
        type="button"
        variant={emphasize ? "default" : "outline"}
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
