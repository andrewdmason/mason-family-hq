"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { reimportSession } from "@/app/(workouts)/workouts/actions";

/** Re-run the AI import for a session (used by the unparsed-state fallback). */
export function ReparseButton({
  sessionId,
  label = "Reimport",
}: {
  sessionId: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => reimportSession(sessionId))}
      className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {pending ? "Re-parsing…" : label}
    </button>
  );
}
