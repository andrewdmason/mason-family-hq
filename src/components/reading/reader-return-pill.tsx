"use client";

import { CornerUpLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "You came here from a link. Here's the way back."
 *
 * Following a mention drops you at somebody else's passage, which might be three
 * hundred pages from where you actually are. Browser back does not help — you
 * arrived here by navigation, and the book is one page as far as the browser is
 * concerned. So the way back is a thing on screen, and it stays until you use it
 * or refuse it.
 *
 * It is also more than an affordance: while this is up, the reader's saved
 * position is HELD. Nothing about visiting somebody else's mark should change
 * where your own book opens tomorrow. Dismissing it releases the hold, which is
 * the honest reading of "I'm staying" — and reading on past a couple of page
 * turns releases it too, because at that point you are not visiting any more.
 *
 * Sits in the same bottom strip as the other transient pills, and the
 * another-device bar is suppressed while it is up: two offers to go somewhere
 * else, in the same place, is a layout bug and a comprehension one.
 */
export function ReaderReturnPill({
  label,
  bottom,
  onBack,
  onDismiss,
}: {
  /** "p. 212", or a percentage when the book's pages are synthetic. */
  label: string;
  /** Clearance for whatever chrome is already along the bottom edge. */
  bottom: number;
  onBack: () => void;
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
        <span className="min-w-0 truncate text-muted-foreground">
          Visiting a shared passage
        </span>
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <CornerUpLeft className="h-3 w-3" />
          Back to {label}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Stay here"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
