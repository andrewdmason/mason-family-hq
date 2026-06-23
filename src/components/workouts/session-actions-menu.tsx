"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Check, RotateCcw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  setSessionCompleted,
  deleteSession,
} from "@/app/(workouts)/workouts/actions";
import { useSessionEditing } from "@/components/workouts/session-edit-context";

/**
 * The "⋯" menu next to a workout's title. Delete is always offered; Edit and
 * Reopen appear only for a completed session (there's nothing to edit/reopen on
 * an open one). Delete confirms first — for a calendar workout it discards only
 * the logged session, since the event is still scheduled and reappears under
 * Upcoming.
 */
export function SessionActionsMenu({
  sessionId,
  completed,
  source,
}: {
  sessionId: string;
  completed: boolean;
  source?: string;
}) {
  const { editing, toggle } = useSessionEditing();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isCalendar = source === "calendar";

  return (
    <>
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
          {completed && (
            <>
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
            </>
          )}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 />
            Delete workout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this workout?</DialogTitle>
            <DialogDescription>
              {isCalendar
                ? "This clears the logged sets and effort. The workout is still scheduled on your calendar, so it'll show again under Upcoming."
                : "This permanently removes the workout and everything logged for it. This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(() => deleteSession(sessionId))
              }
            >
              {pending ? "Deleting…" : "Delete workout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
