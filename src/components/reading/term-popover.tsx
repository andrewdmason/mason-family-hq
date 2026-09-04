"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PlainTerm } from "@/lib/reading/plain/types";

/** Clear of the viewport edge, and of the word itself. */
const MARGIN = 8;
const GAP = 6;

/**
 * A glossary term's definition, beside the word you tapped.
 *
 * Positioned by hand against the span, the way the chapter menu is against its
 * heading: measured after render, centred under the word, pushed above it when
 * there is no room beneath, and clamped to the window. The generic popover
 * primitive could not resolve an anchor living inside a translated column
 * strip, and landed in the corner instead.
 *
 * Dismissed by a press anywhere else, by Escape, and by anything that moves the
 * page — a relayout has moved the word out from under it.
 */
export function TermPopover({
  anchor,
  term,
  onDismiss,
}: {
  anchor: HTMLElement | null;
  term: PlainTerm | null;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const box = el.getBoundingClientRect();
    // The span may wrap across two lines; anchor to its first line box.
    const rects = anchor.getClientRects();
    const rect = rects[0] ?? anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - box.width / 2, MARGIN),
      window.innerWidth - box.width - MARGIN
    );
    const below = rect.bottom + GAP;
    const top =
      below + box.height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, rect.top - GAP - box.height)
        : below;
    setAt({ left, top });
  }, [anchor, term]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || anchor.contains(t))) return;
      onDismiss();
    };
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

  if (!anchor || !term) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={term.term}
      className="fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        // Rendered to be measured, so it must not be seen in the corner first.
        visibility: at ? undefined : "hidden",
      }}
    >
      <p className="font-serif italic">{term.term}</p>
      <p className="mt-1 font-sans text-[13px] leading-snug text-muted-foreground">
        {term.definition}
      </p>
    </div>
  );
}
