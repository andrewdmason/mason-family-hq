"use client";

import { useTransition } from "react";
import { Repeat, Loader2 } from "lucide-react";
import { swapEntryMovement } from "@/app/(workouts)/workouts/actions";

/**
 * Suggests the user's preferred substitute for a movement in a WOD and swaps it
 * in with one tap (repointing the logged entry to the substitute).
 */
export function SwapSuggestion({
  entryId,
  sessionId,
  substitute,
}: {
  entryId: string;
  sessionId: string;
  substitute: { id: string; name: string };
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Repeat className="size-3.5" />
      <span>
        You sub this with{" "}
        <span className="font-medium text-foreground">{substitute.name}</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(() =>
            swapEntryMovement(entryId, sessionId, substitute.id)
          )
        }
        className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Repeat className="size-3.5" />
        )}
        Swap in
      </button>
    </div>
  );
}
