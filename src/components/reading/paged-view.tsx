"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  PAGE_PAD_TOP,
  pageWidth,
  type PageGeometry,
  type Pages,
} from "@/lib/reading/paged-geometry";
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
  pages,
  pageIndex,
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
  /** Where the pages fall on the strip — see Pages. */
  pages: Pages;
  pageIndex: number;
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
      className="fixed inset-0 overflow-hidden"
      // Vertical panning is meaningless here; letting the browser own horizontal
      // gestures is what keeps iOS's back-swipe working where we don't fight it.
      style={{ touchAction: "pan-y" }}
    >
      {geometry && (
        <div
          ref={clipRef}
          className="absolute overflow-hidden"
          // The window onto the strip. This is the element that knows how many
          // columns a page shows: it's as many columns wide as this page has, and
          // everything past its right edge is the rest of the book, clipped.
          //
          // Usually that's `cols` columns. On the page where a chapter ends it's
          // one, because the next chapter's opening column is sitting immediately
          // to the right and the whole point is that you turn the page to reach
          // it — see Pages. Narrowing the clip is what leaves the outer half of
          // the spread white; the text itself hasn't moved, and no chapter has
          // been re-fragmented to arrange it.
          style={{
            left: geometry.offsetX,
            top: PAGE_PAD_TOP,
            width: pageWidth(pageIndex, pages, geometry),
            height: geometry.pageH,
          }}
        >
          <div
            ref={flowRef}
            className={cn("font-serif text-foreground", BOOK_PROSE, BOOK_PROSE_PAGED)}
            // The measure is set here; how many columns of it the box holds is
            // set by usePagination, which is the only thing that knows how long
            // the book turned out to be (see fitFlowToStrip). The width below is
            // therefore the STARTING width — one column — and the hook widens it
            // to the whole strip as soon as it has measured one.
            //
            // Expressed as a column WIDTH rather than a count so that widening
            // the box adds columns instead of stretching them. That is what keeps
            // the fragmentation identical however wide the box is: the browser's
            // column breaking depends on the size of a column box and the gap
            // between boxes, and neither moves. Showing two columns instead of
            // one — which is what opening the chat panel changes — still costs
            // nothing, because it changes only the clip above.
            style={{
              width: geometry.colW,
              height: geometry.pageH,
              columnWidth: `${geometry.colW}px`,
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

          The margin is also what reveals them, which is why each one is wrapped
          in a band the width of its margin: an arrow that appeared whenever the
          cursor was anywhere in the book put two controls on screen for the whole
          time you were reading, which is two more than a page of a book should
          have. Now they answer the cursor arriving in the margin — the place they
          are, and the only place they can be clicked.

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
 * One margin's page-turn arrow: what you see is exactly what you can click, and
 * you only see it while the cursor is in that margin.
 *
 * The hit area used to be the whole margin, on the theory that a bigger target is
 * a kinder one. On a desktop it isn't — the margin is where the cursor sits while
 * reading, so every idle click in the white space turned a page, and the margin is
 * also where the chat markers and the "start a chat here" target live.
 *
 * The band around it is the hover region, and it is the whole margin: the arrow
 * is a 48px target that shouldn't have to be found before it can be aimed at, so
 * the cursor entering the margin at any height brings it up. Anywhere in the text
 * does not, which is the point — reading a book should not keep two controls lit.
 *
 * A tap anywhere still turns the page on touch, where there is no resting cursor
 * and no hover to reveal an arrow with; that rule is in the pointer handler
 * above, not here. The band is invisible and does nothing there.
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
    <div
      className="group/margin absolute inset-y-0"
      style={{ left: x, width }}
      // The band is a hover region, not a target. Presses in it still reach the
      // reading area's own pointer handler by bubbling, which is what keeps a tap
      // in the margin turning the page on a touch screen.
    >
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
        style={{ left: Math.round((width - size) / 2), width: size, height: size }}
        className={cn(
          "absolute top-1/2 hidden -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-opacity duration-150",
          "[@media(hover:hover)]:flex",
          "disabled:pointer-events-none",
          // Dim once the mouse is in this margin, solid once it's on the arrow —
          // so it says both "pages turn here" and "this click turns one".
          disabled
            ? "opacity-0"
            : "opacity-0 group-hover/margin:opacity-60 hover:bg-muted hover:opacity-100"
        )}
      >
        <Icon className="h-6 w-6" />
      </button>
    </div>
  );
}
