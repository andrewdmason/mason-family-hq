"use client";

import { Highlighter, MessageSquareQuote, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFinePointer, useSelectionRange } from "./use-selection-range";

export type SelectionIntent = "highlight" | "note" | "ask";

const ACTIONS: {
  intent: SelectionIntent;
  label: string;
  Icon: typeof Highlighter;
}[] = [
  { intent: "highlight", label: "Highlight", Icon: Highlighter },
  { intent: "note", label: "Note", Icon: StickyNote },
  { intent: "ask", label: "Ask", Icon: MessageSquareQuote },
];

/**
 * Select a passage, get three things to do with it.
 *
 * Two shells, same actions:
 *
 * - Fine pointer: a small popover floating above the selection, where the
 *   cursor already is.
 * - Touch: a fixed bar along the bottom edge. NOT a bottom sheet — that is a
 *   Base UI Dialog with a backdrop (see bottom-sheet.tsx), and opening one moves
 *   focus and dims the page, which on iOS collapses the selection you just made.
 *
 * The bottom edge is chosen because iOS puts its own callout menu (Copy, Look
 * Up, Share) adjacent to the selection, and no web API can suppress, extend or
 * move it. Rather than fight for that space we stay out of it, and long-press
 * selection stays entirely native — which is what the reader has always
 * deliberately protected.
 *
 * `-webkit-touch-callout: none` would be the wrong tool: it governs the
 * long-press callout on links and images, not the text-selection edit menu, and
 * applying it to the content would break normal link behaviour in articles.
 */
export function SelectionToolbar({
  contentRef,
  onAct,
  disabled,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  onAct: (range: Range, intent: SelectionIntent) => void;
  disabled: boolean;
}) {
  const { spot, clear } = useSelectionRange(contentRef, disabled);
  const finePointer = useFinePointer();

  // Hidden rather than cleared while busy, so a stale position can't flash back.
  if (!spot || disabled) return null;

  const act = (intent: SelectionIntent) => {
    onAct(spot.range, intent);
    clear();
  };

  const buttons = ACTIONS.map(({ intent, label, Icon }) => (
    <button
      key={intent}
      type="button"
      // Keep the selection alive: a pointerdown elsewhere would collapse it
      // before the click handler ever runs. pointerdown rather than mousedown,
      // because on touch the synthesized mousedown arrives far too late.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => act(intent)}
      className={cn(
        "flex items-center gap-1.5 rounded-md font-medium text-foreground transition-colors hover:bg-muted",
        finePointer
          ? "px-2.5 py-1.5 text-xs"
          : "flex-1 justify-center px-3 py-2.5 text-sm"
      )}
    >
      <Icon className={finePointer ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {label}
    </button>
  ));

  if (finePointer) {
    return (
      <div
        className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
        style={{ left: spot.x, top: spot.y }}
      >
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5 shadow-md">
          {buttons}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur"
      // Clear of the home indicator on iPhone; a no-op everywhere else.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md items-center gap-1 px-2 py-1.5">
        {buttons}
      </div>
    </div>
  );
}
