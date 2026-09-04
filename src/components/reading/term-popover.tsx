"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PLAIN_TERM_ATTR, PLAIN_TERM_CLASS } from "@/lib/reading/plain/render";
import type { PlainTerm } from "@/lib/reading/plain/types";

/** Clear of the viewport edge, and of the word itself. */
const MARGIN = 8;
const GAP = 6;

/**
 * Owns the tap-to-define interaction for glossary terms.
 *
 * The state lives HERE and nowhere higher, and that is the whole point of this
 * component. React re-applies a `dangerouslySetInnerHTML` element's markup on
 * every re-render of the component that renders it — the book's own code notes
 * this in several places — so a piece of state in the reader that changed when
 * a term was tapped re-rendered the paged view, which rebuilt the page's DOM,
 * which detached the very span the popover was about to measure against. It
 * then measured nothing and landed in the corner. Kept down here, opening or
 * closing the definition re-renders this component and nothing else.
 *
 * Listens on the content container itself, the way the annotation layer does
 * for chat marks, because the term spans are the book's markup, not React's.
 */
export function TermPopoverController({
  contentRef,
  terms,
  enabled,
  layoutNonce,
  positionKey,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  terms: PlainTerm[];
  enabled: boolean;
  /** Bumped when the page is relaid — the word has moved. */
  layoutNonce: number;
  /** Changes when the reader turns a page — likewise. */
  positionKey: number;
}) {
  // Remembered with the page it was opened on: a relaid or turned page has
  // moved the word out from under the definition, so it simply stops showing.
  const [open, setOpen] = useState<{
    anchor: HTMLElement;
    term: PlainTerm;
    layoutNonce: number;
    positionKey: number;
  } | null>(null);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || !enabled) return;
    const onClick = (e: MouseEvent) => {
      const span = (e.target as HTMLElement | null)?.closest<HTMLElement>(`.${PLAIN_TERM_CLASS}`);
      if (!span) return;
      const name = span.getAttribute(PLAIN_TERM_ATTR);
      const term = terms.find((t) => t.term === name) ?? null;
      if (term) setOpen({ anchor: span, term, layoutNonce, positionKey });
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [contentRef, enabled, layoutNonce, positionKey, terms]);

  const current =
    open && open.layoutNonce === layoutNonce && open.positionKey === positionKey ? open : null;

  return (
    <TermPopover
      anchor={current?.anchor ?? null}
      term={current?.term ?? null}
      onDismiss={() => setOpen(null)}
    />
  );
}

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
