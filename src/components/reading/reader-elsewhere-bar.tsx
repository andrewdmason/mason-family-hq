"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Another device left off further on."
 *
 * An offer, never a jump. The whole reason position is one shared number is so a
 * book can be picked up anywhere — but the device you are holding is the one you
 * are actually reading, and moving its page out from under you because a phone in
 * another room saved something is a worse failure than showing the wrong place.
 * Every e-reader worth using asks this question rather than answering it.
 *
 * Nor is "elsewhere" necessarily ahead: someone who flips back a chapter on their
 * phone has genuinely left off there, so this says where, not how far, and the
 * words never promise forward motion.
 *
 * It sits above the running foot rather than over the text, and it takes itself
 * away once answered — a bar you have to dismiss twice is a bar that reads as
 * broken.
 */
export function ReaderElsewhereBar({
  chapterTitle,
  percent,
  bottom,
  onGo,
  onDismiss,
}: {
  chapterTitle: string | null;
  percent: number;
  /** Clearance for whatever chrome is already along the bottom edge. */
  bottom: number;
  onGo: () => void;
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
          Left off at{" "}
          <span className="font-medium text-foreground">
            {chapterTitle ?? `${percent}%`}
          </span>
          {chapterTitle && (
            <span className="tabular-nums"> · {percent}%</span>
          )}{" "}
          on another device
        </span>
        <button
          type="button"
          onClick={onGo}
          className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Go there
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
