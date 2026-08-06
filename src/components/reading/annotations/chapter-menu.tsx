"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFinePointer } from "./use-selection-range";

/** Clear of the viewport edge, and of the heading itself. */
const MARGIN = 8;
const GAP = 6;

/**
 * What a chapter title offers when you tap it.
 *
 * Tapping used to write the recap outright, which made a heading a button that
 * looked exactly like a heading and did something irreversible — the wrong shape
 * for an action that costs a model call and replaces whatever was there before.
 * A menu turns the tap into a question, and gives the title somewhere to grow:
 * one option today, and the obvious place to put the next one.
 *
 * Positioned against the heading rather than the cursor, so it lands in the same
 * place whether you clicked, tapped, or came in from a keyboard — and so it can
 * be pushed above the title when there is no room beneath it.
 */
export function ChapterMenu({
  anchor,
  title,
  hasSummary,
  onSummarize,
  onDismiss,
}: {
  /** The heading element this belongs to; also the second "inside" for dismissal. */
  anchor: HTMLElement;
  /** What the menu is about, for anyone who can't see which title it sits under. */
  title: string | null;
  /** Whether this chapter has already been recapped. */
  hasSummary: boolean;
  onSummarize: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Measured rather than estimated: the menu is one line of text whose width
  // depends on the label, and a guess would put it off the edge of a phone.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const menu = el.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - menu.width / 2, MARGIN),
      window.innerWidth - menu.width - MARGIN
    );
    const below = rect.bottom + GAP;
    const top =
      below + menu.height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, rect.top - GAP - menu.height)
        : below;
    setAt({ left, top });
  }, [anchor, hasSummary]);

  // Only once it has somewhere to be: until then it is hidden, and a hidden
  // element cannot take focus. Focus is what makes Escape and Enter work for
  // anyone not using a pointer.
  useEffect(() => {
    if (at) itemRef.current?.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    // A press on the heading is NOT outside: it falls through to the click that
    // opened this, which toggles the menu shut. Handling it here as well would
    // close and immediately reopen.
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || anchor.contains(t))) return;
      onDismiss();
    };
    // Anything that moves the page moves the heading out from under this.
    const onMove = () => onDismiss();
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [anchor, onDismiss]);

  const finePointer = useFinePointer();

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title ?? "Chapter"}
      className="fixed z-50 rounded-md border border-border bg-background p-0.5 shadow-md"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        // Rendered to be measured, so it must not be seen in the corner first.
        visibility: at ? undefined : "hidden",
      }}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        onClick={onSummarize}
        className={cn(
          "flex w-full items-center gap-2 rounded font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted",
          finePointer ? "px-2.5 py-1.5 text-xs" : "px-3 py-2.5 text-sm"
        )}
      >
        <ScrollText className={finePointer ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {hasSummary ? "Open the chapter summary" : "Summarize this chapter"}
      </button>
    </div>
  );
}
