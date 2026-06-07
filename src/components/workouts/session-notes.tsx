"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { saveSessionNotes } from "@/app/(workouts)/workouts/actions";
import { Textarea } from "@/components/ui/textarea";

/** Session-level freeform notes, autosaved on blur. */
export function SessionNotes({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: string | null;
}) {
  const [notes, setNotes] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Notes
        </span>
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : saved ? (
          <Check className="size-3.5 text-primary" />
        ) : null}
      </div>
      <Textarea
        value={notes}
        placeholder="How did the whole session feel?"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() =>
          startTransition(async () => {
            await saveSessionNotes(sessionId, notes);
            setSaved(true);
            setTimeout(() => setSaved(false), 1200);
          })
        }
        className="min-h-[70px]"
      />
    </div>
  );
}
