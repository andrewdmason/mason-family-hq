"use client";

import { Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "That bookmark is gone — unless you didn't mean it."
 *
 * Tapping a solid ribbon deletes outright, which is the fast thing to do and
 * also the easy thing to do by accident, on a control that sits one pixel from
 * the contents. This is what makes that trade safe: the row is already deleted,
 * the client still holds it, and Undo writes it straight back with its name.
 *
 * Sits in the same bottom strip as the other transient pills, on the same
 * clearance, and stacks with them rather than overlapping.
 */
export function BookmarkRemovedPill({
  bottom,
  onUndo,
  onDismiss,
}: {
  bottom: number;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom }}
    >
      <div
        role="status"
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border",
          "bg-popover/95 py-1.5 pr-1.5 pl-4 text-sm shadow-lg backdrop-blur"
        )}
      >
        <span className="min-w-0 truncate text-muted-foreground">Bookmark removed</span>
        <button
          type="button"
          onClick={onUndo}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Undo2 className="h-3 w-3" />
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
