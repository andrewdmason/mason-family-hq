"use client";

import { useTransition } from "react";
import { MoreHorizontal, Pencil, Check, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { setSessionCompleted } from "@/app/(workouts)/workouts/actions";
import { useSessionEditing } from "@/components/workouts/session-edit-context";

/**
 * The "⋯" menu next to a completed workout's title: Edit (toggles the editable
 * form in place, keeping the session completed) and Reopen (clears completion).
 * Renders nothing for an incomplete session — there's nothing to edit/reopen.
 */
export function SessionActionsMenu({
  sessionId,
  completed,
}: {
  sessionId: string;
  completed: boolean;
}) {
  const { editing, toggle } = useSessionEditing();
  const [pending, startTransition] = useTransition();
  if (!completed) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Workout actions"
            className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <MoreHorizontal className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => toggle()}>
          {editing ? <Check /> : <Pencil />}
          {editing ? "Done editing" : "Edit workout"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onClick={() =>
            startTransition(() => setSessionCompleted(sessionId, false))
          }
        >
          <RotateCcw />
          Reopen workout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
