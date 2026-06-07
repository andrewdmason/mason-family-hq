"use client";

import { useTransition } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { openWorkoutEvent } from "@/app/(workouts)/workouts/actions";

/**
 * Taps a CFO calendar event open. The first tap runs the AI parse server-side
 * (parse-on-open) and redirects to the freshly materialized session, so the
 * button shows a "Reading workout…" pending state while that happens.
 */
export function OpenEventButton({
  eventId,
  label = "Open",
  className,
}: {
  eventId: string;
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => openWorkoutEvent(eventId))}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60",
        className
      )}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Reading workout…
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="size-4" />
        </>
      )}
    </button>
  );
}
