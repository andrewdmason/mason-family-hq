"use client";

import { useEffect, useState } from "react";
import { MessageSquareQuote } from "lucide-react";

/**
 * Select a passage, get a small "ask about this" popover.
 *
 * Desktop only, and that's a design decision rather than a shortcut: the reader
 * deliberately does not hijack long-press so that native text selection keeps
 * working (see the touch handler in book-reader.tsx), and on iOS a selection
 * also summons the OS callout menu, which this would have to fight. Mobile can
 * still read and continue chats; starting one from a selection is a laptop move.
 */
export function SelectionToolbar({
  contentRef,
  onStart,
  disabled,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  onStart: (range: Range) => void;
  disabled: boolean;
}) {
  const [spot, setSpot] = useState<{ x: number; y: number; range: Range } | null>(
    null
  );

  useEffect(() => {
    if (disabled) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const evaluate = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSpot(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const container = contentRef.current;
      if (
        !container ||
        !container.contains(range.startContainer) ||
        !container.contains(range.endContainer) ||
        !range.toString().trim()
      ) {
        setSpot(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSpot(null);
        return;
      }
      setSpot({
        x: rect.left + rect.width / 2,
        y: rect.top,
        range: range.cloneRange(),
      });
    };

    // mouseup rather than selectionchange alone: mid-drag the selection is still
    // moving and the popover would chase the cursor.
    const onUp = () => window.setTimeout(evaluate, 0);
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSpot(null);
    };

    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", () => setSpot(null), { passive: true });
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [contentRef, disabled]);

  // Hidden rather than cleared while busy, so a stale position can't flash back.
  if (!spot || disabled) return null;

  return (
    <div
      className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
      style={{ left: spot.x, top: spot.y }}
    >
      <button
        type="button"
        // Keep the selection alive: a mousedown elsewhere would collapse it
        // before the click handler ever runs.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onStart(spot.range);
          setSpot(null);
          window.getSelection()?.removeAllRanges();
        }}
        className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-muted"
      >
        <MessageSquareQuote className="h-3.5 w-3.5" />
        Ask about this
      </button>
    </div>
  );
}
