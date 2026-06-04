"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startTimelineReflection } from "@/app/(journal)/journal/actions";

/**
 * Starts a journal entry pre-bound to a timeline event and jumps to the picker,
 * where the three opening questions are all about this event. Finishing the entry
 * links it back (the entry already carries the event id).
 */
export function ReflectOnEventButton({
  timelineEntryId,
  label = "Reflect on this",
}: {
  timelineEntryId: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    start(async () => {
      try {
        const entryId = await startTimelineReflection(timelineEntryId);
        router.push(`/journal/new?entry=${entryId}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't start a journal entry."
        );
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <Button onClick={handleClick} disabled={pending} size="sm">
        <PenLine className="mr-1.5 h-4 w-4" />
        {pending ? "Starting…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
