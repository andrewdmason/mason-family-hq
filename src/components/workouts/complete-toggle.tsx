"use client";

import { useTransition } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { setSessionCompleted } from "@/app/(workouts)/workouts/actions";

/**
 * The primary "Mark done" CTA for an incomplete session. Completing it shifts the
 * home widget's focus to the next scheduled workout. Reopening a completed
 * session lives in the title's "⋯" menu (SessionActionsMenu), not here.
 */
export function CompleteToggle({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => setSessionCompleted(sessionId, true))}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <CheckCircle2 className="size-4" />
      )}
      Mark done
    </button>
  );
}
