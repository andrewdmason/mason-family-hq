"use client";

import { useEffect } from "react";
import { MessageSquare, MessageSquarePlus, NotebookPen } from "lucide-react";
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

const BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full transition-colors";

/**
 * The two reader controls that live in the top margin: start a conversation
 * about where you are, and open everything you've marked.
 *
 * They cannot live in the reader header: that whole bar is opacity-0 and
 * pointer-events-none until you hover, tap, or scroll up (book-reader.tsx), so
 * a button inside it would be exactly as hidden as everything else there. This
 * sits in its own fixed container instead, low-contrast at rest so it reads as
 * margin furniture rather than chrome, and coming up to full contrast on hover.
 *
 * Kept as one container rather than two so the pair can never drift apart or
 * disagree about whether they're visible — which is the failure the old
 * hover-between-paragraphs affordance had in the other direction, being present
 * on a laptop and absent on every device without a pointer.
 */
export function ReaderMarginControls({
  onAsk,
  askActive,
  hasChatHere,
  onOpenList,
  listActive,
}: {
  /** Start (or reopen) the conversation about the visible page. */
  onAsk: () => void;
  askActive: boolean;
  /** Whether the page already carries a conversation — see reader chat marks. */
  hasChatHere: boolean;
  onOpenList: () => void;
  listActive: boolean;
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
      onOpenList();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenList]);

  // Solid once this page has a conversation on it, so reading past a place you
  // have already talked about says so before you tap anything.
  const AskIcon = hasChatHere ? MessageSquare : MessageSquarePlus;

  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-0.5">
      <button
        type="button"
        onClick={onAsk}
        aria-label={hasChatHere ? "Open the conversation about this page" : "Ask about this page"}
        title={hasChatHere ? "Open the conversation about this page" : "Ask about this page"}
        className={cn(
          BUTTON_CLASS,
          askActive
            ? "bg-foreground text-background"
            : hasChatHere
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground/50 hover:bg-muted hover:text-foreground"
        )}
      >
        <AskIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onOpenList}
        aria-label="Show highlights and notes"
        title={`Highlights and notes (${ANNOTATIONS_SHORTCUT_KEY})`}
        className={cn(
          BUTTON_CLASS,
          listActive
            ? "bg-foreground text-background"
            : "text-muted-foreground/50 hover:bg-muted hover:text-foreground"
        )}
      >
        <NotebookPen className="h-4 w-4" />
      </button>
    </div>
  );
}
