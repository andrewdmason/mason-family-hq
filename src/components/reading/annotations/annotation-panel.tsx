"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CHAT_PANEL_DEFAULT_WIDTH } from "@/lib/reading/paged-geometry";
import { cn } from "@/lib/utils";

/** Narrower than this and a quote in the notepad is a ribbon. */
const MIN_PANEL_WIDTH = 320;
/** The book keeps at least half the window. */
const MAX_PANEL_FRACTION = 0.5;

function clampWidth(width: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, Math.round(window.innerWidth * MAX_PANEL_FRACTION));
  return Math.min(max, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

/** Arriving, and leaving. Leaving is quicker: the decision is already made. */
const ENTER_MS = 260;
const EXIT_MS = 180;
const ENTER_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const EXIT_EASE = "cubic-bezier(0.4, 0, 1, 1)";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/**
 * Desktop: a non-modal panel. Deliberately NOT a dialog — no backdrop, no focus
 * trap, and clicking in the book does not dismiss it. The whole point is to keep
 * reading and selecting text while the chat is open, so only Escape and the close
 * button dismiss.
 *
 * It FLOATS by default: an inset card over the page, with the book untouched
 * behind it. It used to always dock — a flush drawer with the reading column
 * shifted left by the same width — and on a 15" laptop that cost a whole column,
 * which read less as "a panel opened" than as "the window shrank and the book
 * didn't notice". Docking is still there for a screen wide enough to afford it,
 * behind the button in the panel's header, and then nothing is covered.
 *
 * The 12px reveal on three sides of the floating card is doing work: the page
 * visibly continues behind it, which is what says "on top of" rather than
 * "instead of".
 *
 * Mobile: the app's existing BottomSheet, which can be parked at half height to
 * peek at the text behind it.
 *
 * Docked, its left edge drags. While the pointer is down only the panel moves,
 * over the book; the book takes its new share once on release. A page that
 * re-lays under a drag is the same disorientation floating exists to avoid,
 * so it happens once, when the hand comes off. Double-click the edge to go
 * back to the width it opened at. Floating is not resizable: it covers
 * rather than takes, and a wider cover is just less book.
 *
 * It ARRIVES from the right edge rather than appearing there, and leaves the
 * same way — which is what makes a highlight landing in the notes legible: you
 * see the panel come in, and then the passage drop into it (notepad.tsx).
 * Leaving is quicker than arriving, the usual rule: you have already decided.
 *
 * The floating card fades as it slides, because it is a thing laid over the
 * page. The drawer only slides, because it is a thing the page made room for —
 * and a drawer that faded would read as a ghost rather than a panel. The book
 * gives up its width the instant the drawer opens, so for the length of the
 * slide there is a bare strip at the right where the page used to be. That is
 * the cost, and it is worth paying: a drawer that simply appears tells you
 * nothing about where it came from, which is the whole reason for animating
 * any of this.
 *
 * The panel stays mounted for the length of its exit, so what it holds keeps
 * its state until it is actually gone — closing a THREAD clears the thread on
 * the way out (that is what abandons an untouched draft), so for those 180ms
 * it is empty. Nothing animates for a reader who has asked their system for
 * less movement: they get it and lose it at once.
 */


export function AnnotationPanel({
  open,
  isMobile,
  docked,
  width = CHAT_PANEL_DEFAULT_WIDTH,
  onWidthChange,
  onClose,
  dismissOnOutsidePress = false,
  closeOnEscape = true,
  children,
}: {
  open: boolean;
  isMobile: boolean;
  /** Take width from the book instead of floating over it — see PanelDockToggle. */
  docked: boolean;
  /** The docked width; floating ignores it. Reported back through onWidthChange. */
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  /**
   * Off for the notepad, where Escape means "stop typing" rather than "go
   * away": it hands the keyboard back to the book — page turns and the letter
   * shortcuts — with the notes still open beside it.
   */
  closeOnEscape?: boolean;
  /**
   * True only while the chat is untouched. An unused draft behaves like a
   * popover and gets out of the way when you click back into the book; a chat
   * you've actually written in stays put, because reading and selecting while
   * it's open is the point.
   */
  dismissOnOutsidePress?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  // The sheet has its own way in and out; everything else moves. See above.
  const animated = !reduced && !isMobile;
  /** Shut, but still on screen: the exit, playing out after `open` went false. */
  const [closing, setClosing] = useState(false);
  /** In its resting place, as opposed to off the edge. */
  const [arrived, setArrived] = useState(false);

  // Read `open` as it changes rather than in an effect: the frame that mounts
  // the card has to be the frame that has it off the edge, and an effect would
  // be a frame late — the card would appear where it belongs and then not move.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setArrived(false);
    else setClosing(animated);
  }

  /** On screen at all. */
  const present = open || closing;
  /** Where it belongs, as opposed to off the edge on the way in or out. */
  const shown = open && (arrived || !animated);

  // Two frames: the first draws it off the edge, the second sets it moving.
  // One would be folded into the same style recalculation and it would simply
  // be there.
  useEffect(() => {
    if (!open || !animated || arrived) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [animated, arrived, open]);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setClosing(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [closing]);

  /** The width under the pointer mid-drag; null when the edge is at rest. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onEdgePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startWidth: width };
      setDragWidth(width);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );
  const onEdgePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setDragWidth(clampWidth(d.startWidth + (d.startX - e.clientX)));
  }, []);
  const onEdgePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const next = clampWidth(d.startWidth + (d.startX - e.clientX));
      setDragWidth(null);
      if (next !== width) onWidthChange?.(next);
    },
    [onWidthChange, width]
  );
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOnEscape, open, onClose]);

  useEffect(() => {
    if (!open || !dismissOnOutsidePress || isMobile) return;
    const onPointerDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && !panel.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, dismissOnOutsidePress, isMobile, onClose]);

  if (isMobile) {
    return (
      <BottomSheet open={open} onOpenChange={(next) => !next && onClose()}>
        <div className="h-full">{children}</div>
      </BottomSheet>
    );
  }

  // The panel only ever opens from a client interaction, so there is nothing
  // to portal during SSR; `present` outlasts `open` by the exit.
  if (!present || typeof document === "undefined") return null;

  const resizable = docked && !!onWidthChange;
  const shownWidth = docked ? (dragWidth ?? width) : CHAT_PANEL_DEFAULT_WIDTH;
  // Off the right edge — far enough that the floating card clears the 12px of
  // page showing beside it, and the drawer clears its own border.
  const away = docked ? "translateX(100%)" : "translateX(calc(100% + 0.75rem))";

  return createPortal(
    // z-50 clears the reader's hover header (z-40).
    <aside
      ref={panelRef}
      className={cn(
        "fixed right-0 z-50 flex flex-col bg-card",
        docked
          ? "inset-y-0 border-l border-border shadow-lg"
          : "top-3 bottom-3 right-3 overflow-hidden rounded-xl border border-border shadow-2xl"
      )}
      style={{
        width: shownWidth,
        transform: shown ? undefined : away,
        // The card is laid over the page and fades with the move; the drawer
        // is part of it and only slides.
        opacity: shown || docked ? undefined : 0,
        transition: !animated
          ? undefined
          : shown
            ? `transform ${ENTER_MS}ms ${ENTER_EASE}, opacity ${ENTER_MS}ms ${ENTER_EASE}`
            : `transform ${EXIT_MS}ms ${EXIT_EASE}, opacity ${EXIT_MS}ms ${EXIT_EASE}`,
      }}
      aria-label="Chat about this book"
    >
      {resizable && (
        // A 10px strip straddling the border. Invisible until the pointer is
        // on it, then the border thickens; solid while dragging.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the panel"
          title="Drag to resize · double-click to reset"
          onPointerDown={onEdgePointerDown}
          onPointerMove={onEdgePointerMove}
          onPointerUp={onEdgePointerUp}
          onPointerCancel={onEdgePointerUp}
          onDoubleClick={() => onWidthChange?.(CHAT_PANEL_DEFAULT_WIDTH)}
          className={cn(
            "group absolute inset-y-0 -left-[5px] z-10 w-[10px] cursor-col-resize touch-none",
            "before:absolute before:inset-y-0 before:left-[4px] before:w-[2px] before:transition-colors",
            dragWidth != null
              ? "before:bg-foreground/40"
              : "before:bg-transparent hover:before:bg-foreground/25"
          )}
        />
      )}
      {/* No floating close button: it would sit on top of whatever the panel
          content puts in its own top-right. The close control lives in the
          thread header instead, in the same row as the other actions. */}
      <div className="min-h-0 flex-1">{children}</div>
    </aside>,
    document.body
  );
}
