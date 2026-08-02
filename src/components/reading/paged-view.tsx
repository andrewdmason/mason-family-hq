"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_PAD_TOP, type PageGeometry } from "@/lib/reading/paged-geometry";
import type { ReaderSettings } from "@/lib/reading/reader-settings";
import { cn } from "@/lib/utils";
import { BOOK_PROSE, BOOK_PROSE_PAGED, typographyStyle } from "./reader-prose";

/**
 * The book as pages: a fixed window onto a multi-column flow that runs off to
 * the right, moved one screenful at a time.
 *
 * Turning is forgiving on touch and precise with a mouse, because the two have
 * different competing gestures. A tap anywhere on the page turns it — left third
 * back, the rest forward — since a page turn is the overwhelmingly common action
 * and hunting for a hit zone is not reading. A mouse click doesn't: clicking in
 * the text is how you select a passage or dismiss a selection, and a page that
 * moved under either was the most jarring thing about reading here. With a
 * pointer the targets are the margin arrows themselves, plus the keyboard.
 *
 * E-ink mode is the one exception: the arrows aren't rendered there, because
 * the margins they sat in have gone back to the text, so a click turns the page
 * like a tap does. Selecting is unaffected — that path is guarded by the click
 * slop and the selection checks, not by which device is pointing.
 */

/** Anything that has its own job when clicked. */
const INTERACTIVE =
  'a, button, input, textarea, select, [role="menuitem"], [role="dialog"], [data-no-page-turn]';

/** Fraction of the width a tap goes back in. Asymmetric: forward is the common case. */
const BACK_ZONE = 0.3;

/**
 * iOS Safari turns a drag from the screen edge into a back-navigation, and it
 * cannot be reliably cancelled. Swipes that start in this band are left alone —
 * tapping still works there, so nothing is actually unreachable.
 */
const EDGE_SAFE_PX = 40;

const SWIPE_MIN_PX = 45;
const TAP_SLOP_PX = 10;
const CLICK_SLOP_PX = 6;
const TAP_MAX_MS = 500;

export function PagedView({
  html,
  viewport,
  onViewportRef,
  flowRef,
  geometry,
  settings,
  isFirstPage,
  isLastPage,
  onNext,
  onPrev,
  onFirst,
  onLast,
  children,
}: {
  html: string;
  /** The reading area, once mounted. State, not a ref — see usePagination. */
  viewport: HTMLDivElement | null;
  onViewportRef: (el: HTMLDivElement | null) => void;
  flowRef: React.RefObject<HTMLDivElement | null>;
  geometry: PageGeometry | null;
  settings: ReaderSettings;
  isFirstPage: boolean;
  isLastPage: boolean;
  onNext: () => void;
  onPrev: () => void;
  onFirst: () => void;
  onLast: () => void;
  /** Chat markers and overlays, positioned against the viewport. */
  children?: ReactNode;
}) {
  const clipRef = useRef<HTMLDivElement>(null);

  // Pointer: one handler for mouse and touch, so a tap can't also fire a click
  // and turn two pages.
  useEffect(() => {
    if (!viewport) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let pointerType = "mouse";
    let startedAtEdge = false;
    let tracking = false;
    let dismissedSelection = false;

    const onDown = (e: PointerEvent) => {
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
      startTime = e.timeStamp;
      pointerType = e.pointerType;
      startedAtEdge =
        e.clientX <= EDGE_SAFE_PX || e.clientX >= window.innerWidth - EDGE_SAFE_PX;
      // A press that clears a selection is a dismissal, not a page turn. Down is
      // the only place to notice: the browser has collapsed the selection long
      // before the matching up arrives.
      const selection = window.getSelection();
      dismissedSelection = !!selection && !selection.isCollapsed;
    };

    const onCancel = () => {
      tracking = false;
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;

      const target = e.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE)) return;
      // Finishing a selection shouldn't also turn the page.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const moved = Math.hypot(dx, dy);

      if (pointerType === "touch") {
        // A swipe says what it means even if it happened to clear a selection on
        // the way — so it's settled before the dismissal check below.
        if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
          if (startedAtEdge) return;
          if (dx < 0) onNext();
          else onPrev();
          return;
        }
        if (moved > TAP_SLOP_PX || e.timeStamp - startTime > TAP_MAX_MS) return;
      } else if (pointerType === "mouse" && !settings.eink) {
        // Only the margin arrows and the keyboard turn pages with a mouse: a
        // click in the text belongs to the text.
        //
        // E-ink is the exception, and has to be: the arrows are gone there (the
        // margins they lived in were the width we just gave back to the text),
        // so a click would have nothing left to hit. Selecting still works —
        // dragging exceeds the slop below, and a click that clears a selection
        // is caught by dismissedSelection.
        return;
      } else if (moved > CLICK_SLOP_PX) {
        return;
      }

      // The tap that got rid of a selection did its job already.
      if (dismissedSelection) return;

      const rect = viewport.getBoundingClientRect();
      const across = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (across < BACK_ZONE) onPrev();
      else onNext();
    };

    viewport.addEventListener("pointerdown", onDown);
    viewport.addEventListener("pointerup", onUp);
    viewport.addEventListener("pointercancel", onCancel);
    return () => {
      viewport.removeEventListener("pointerdown", onDown);
      viewport.removeEventListener("pointerup", onUp);
      viewport.removeEventListener("pointercancel", onCancel);
    };
  }, [onNext, onPrev, settings.eink, viewport]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
      ) {
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
          onNext();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          onPrev();
          break;
        case " ":
          if (e.shiftKey) onPrev();
          else onNext();
          break;
        case "Home":
          onFirst();
          break;
        case "End":
          onLast();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFirst, onLast, onNext, onPrev]);

  // The clip has overflow:hidden, but the browser still scrolls it behind our
  // back when something inside takes focus or a selection drags past the edge —
  // which slides the text sideways while pageIndex says otherwise. The transform
  // is the only thing allowed to move the page.
  useEffect(() => {
    const clip = clipRef.current;
    if (!clip) return;
    const reset = () => {
      if (clip.scrollLeft !== 0) clip.scrollLeft = 0;
      if (clip.scrollTop !== 0) clip.scrollTop = 0;
    };
    clip.addEventListener("scroll", reset, { passive: true });
    return () => clip.removeEventListener("scroll", reset);
  }, [geometry]);

  return (
    <div
      ref={onViewportRef}
      className="group fixed inset-0 overflow-hidden"
      // Vertical panning is meaningless here; letting the browser own horizontal
      // gestures is what keeps iOS's back-swipe working where we don't fight it.
      style={{ touchAction: "pan-y" }}
    >
      {geometry && (
        <div
          ref={clipRef}
          className="absolute overflow-hidden"
          // The window onto the strip. This is the element that knows how many
          // columns a page shows: it's `cols` columns wide, and everything past
          // its right edge is the rest of the book, clipped.
          style={{
            left: geometry.offsetX,
            top: PAGE_PAD_TOP,
            width: geometry.viewW,
            height: geometry.pageH,
          }}
        >
          <div
            ref={flowRef}
            className={cn("font-serif text-foreground", BOOK_PROSE, BOOK_PROSE_PAGED)}
            // The flow is ALWAYS exactly one column wide, whatever the page is
            // showing. The book overflows into further columns to the right at a
            // constant stride, and a page turn slides the whole strip.
            //
            // This is what makes showing two columns instead of one — which is
            // what opening the chat panel changes — cost nothing: the browser's
            // column breaking depends on the size of a column box and the gap
            // between boxes, and none of those move. Only the clip above does.
            // Verified identical to the pixel, in Chromium and WebKit, over a
            // 3,500-block book.
            style={{
              width: geometry.colW,
              height: geometry.pageH,
              columnCount: 1,
              columnGap: `${geometry.gap}px`,
              // Without this, engines balance the columns and the whole
              // fragmentation model falls apart.
              columnFill: "auto",
              ...typographyStyle(settings),
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}

      {/* Before {children}, so the annotation markers and the "start a chat
          here" target — which share these margins — are painted over the arrows
          rather than under them. Pointer devices only: a touch device has no
          hover and would latch the arrows on after a tap.

          Not at all in e-ink mode: there is no margin left to put them in, and
          nothing to point with. Tapping the page is the whole interface, which
          is what a Kindle does and what these arrows were always standing in
          for on a machine that had a mouse. */}
      {geometry && !settings.eink && (
        <>
          <PageTurnZone
            side="left"
            x={0}
            width={geometry.offsetX}
            disabled={isFirstPage}
            onClick={onPrev}
          />
          <PageTurnZone
            side="right"
            x={geometry.offsetX + geometry.viewW}
            // Mirrored rather than "everything to the right": the chat panel owns
            // the far side of the screen when it's open. A floating panel covers
            // this arrow outright, which is allowed — the keyboard, the left
            // arrow and a swipe all still turn the page, and a reader who wants
            // to page with the mouse while chatting docks the panel.
            width={geometry.offsetX}
            disabled={isLastPage}
            onClick={onNext}
          />
        </>
      )}

      {children}
    </div>
  );
}

/** The arrow, and therefore the hit area. Clamped so it can't reach the text. */
const ARROW_SIZE = 48;

/**
 * One margin's page-turn arrow: what you see is exactly what you can click.
 *
 * It used to be the whole margin, on the theory that a bigger target is a kinder
 * one. On a desktop it isn't — the margin is where the cursor sits while reading,
 * so every idle click in the white space turned a page, and the margin is also
 * where the chat markers and the "start a chat here" target live. A tap anywhere
 * still turns the page on touch, where there is no resting cursor and no hover to
 * reveal an arrow with; that rule is in the pointer handler above, not here.
 */
function PageTurnZone({
  side,
  x,
  width,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  /** Left edge and width of the margin, in viewport coordinates. */
  x: number;
  width: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  // Same rule as the page itself: a click that clears a selection only clears it.
  // Read on down, because by the time the click lands the selection is gone.
  const dismissedSelection = useRef(false);
  // Centred in the margin, and never wider than it: a narrow window has less than
  // 48px to spare, and an arrow overhanging the column would put a page turn on
  // the first word of every line.
  const size = Math.max(0, Math.min(ARROW_SIZE, width));
  return (
    <button
      type="button"
      onPointerDown={() => {
        const selection = window.getSelection();
        dismissedSelection.current = !!selection && !selection.isCollapsed;
      }}
      onClick={() => {
        const dismissed = dismissedSelection.current;
        dismissedSelection.current = false;
        if (!dismissed) onClick();
      }}
      disabled={disabled}
      aria-label={side === "left" ? "Previous page" : "Next page"}
      style={{ left: x + Math.round((width - size) / 2), width: size, height: size }}
      className={cn(
        "absolute top-1/2 hidden -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-opacity duration-150",
        "[@media(hover:hover)]:flex",
        "disabled:pointer-events-none",
        // Dim once the mouse is anywhere in the book, solid once it's on the
        // arrow — so it says both "pages turn here" and "this click turns one".
        disabled
          ? "opacity-0"
          : "opacity-0 group-hover:opacity-60 hover:bg-muted hover:opacity-100"
      )}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}
