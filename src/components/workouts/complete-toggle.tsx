"use client";

import { useTransition } from "react";
import { Loader2, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { setSessionCompleted } from "@/app/(workouts)/workouts/actions";

/**
 * Marks a session done. While today's workout is incomplete the home widget keeps
 * it in focus; completing it shifts focus to the next scheduled workout.
 */
export function CompleteToggle({
  sessionId,
  completed,
}: {
  sessionId: string;
  completed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(() => setSessionCompleted(sessionId, !completed))
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
        completed
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : completed ? (
        <CheckCircle2 className="size-4" />
      ) : (
        <Circle className="size-4" />
      )}
      {completed ? "Completed" : "Mark done"}
    </button>
  );
}
