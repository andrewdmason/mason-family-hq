"use client";

import { useEffect } from "react";
import { NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The shortcut that opens the annotations list.
 *
 * A bare letter, matching every other shortcut in this app — todos, the
 * metronome and practice all bail the moment any modifier is held, and only
 * search claims a chord (Cmd-K). Exported as a constant so rebinding is one
 * line.
 *
 * Not Cmd-\, which was the first instinct: that is 1Password's default fill
 * hotkey on macOS, registered by the desktop app or via chrome.commands. Both
 * dispatch ahead of page handlers, so the page cannot preventDefault it and the
 * shortcut would simply never fire for a 1Password user. Chrome, Safari and
 * macOS itself are all clear of ⌘\ — 1Password is the collision.
 */
export const ANNOTATIONS_SHORTCUT_KEY = "b";

/**
 * A permanently visible way into the annotations list.
 *
 * It cannot live in the reader header: that whole bar is opacity-0 and
 * pointer-events-none until you hover, tap, or scroll up (book-reader.tsx), so
 * a button inside it would be exactly as hidden as everything else there. This
 * sits in its own fixed container instead, low-contrast at rest so it reads as
 * a margin mark rather than chrome, and coming up to full contrast on hover.
 */
export function AnnotationsButton({
  onClick,
  active,
}: {
  onClick: () => void;
  active: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // Match the physical key, not the character: e.key varies by layout.
      if (e.code !== "KeyB") return;
      // Never fire out of a composer, a note field, or anything editable.
      const t = e.target as HTMLElement | null;
      if (
        t?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")
      ) {
        return;
      }
      e.preventDefault();
      onClick();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClick]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show highlights and notes"
      title={`Highlights and notes (${ANNOTATIONS_SHORTCUT_KEY})`}
      className={cn(
        "fixed top-3 right-3 z-40 flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground/50 hover:bg-muted hover:text-foreground"
      )}
    >
      <NotebookPen className="h-4 w-4" />
    </button>
  );
}
