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
 * Turning is deliberately forgiving. Anywhere on the page is a target — left
 * third back, the rest forward — because a page turn is the overwhelmingly
 * common action and hunting for a hit zone is not reading. The chevrons that
 * appear on hover are feedback, not the target.
 */

/** Anything that has its own job when clicked. */
const INTERACTIVE =
  'a, button, input, textarea, select, [role="menuitem"], [role="dialog"], [data-no-page-turn]';

/** Fraction of the width that goes back. Asymmetric: forward is the common case. */
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

    const onDown = (e: PointerEvent) => {
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
      startTime = e.timeStamp;
      pointerType = e.pointerType;
      startedAtEdge =
        e.clientX <= EDGE_SAFE_PX || e.clientX >= window.innerWidth - EDGE_SAFE_PX;
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
        if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
          if (startedAtEdge) return;
          if (dx < 0) onNext();
          else onPrev();
          return;
        }
        if (moved > TAP_SLOP_PX || e.timeStamp - startTime > TAP_MAX_MS) return;
      } else if (moved > CLICK_SLOP_PX) {
        return;
      }

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
  }, [onNext, onPrev, viewport]);

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
          style={{
            left: geometry.offsetX,
            top: PAGE_PAD_TOP,
            width: geometry.contentW,
            height: geometry.pageH,
          }}
        >
          <div
            ref={flowRef}
            className={cn("font-serif text-foreground", BOOK_PROSE, BOOK_PROSE_PAGED)}
            style={{
              width: geometry.contentW,
              height: geometry.pageH,
              columnCount: geometry.cols,
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

      {children}

      {/* Feedback, not hit area: the page itself is the target. Pointer devices
          only — a touch device has no hover and would latch these on after a tap. */}
      <PageChevron side="left" disabled={isFirstPage} onClick={onPrev} />
      <PageChevron side="right" disabled={isLastPage} onClick={onNext} />
    </div>
  );
}

function PageChevron({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous page" : "Next page"}
      className={cn(
        "absolute top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity duration-150",
        "[@media(hover:hover)]:flex",
        "group-hover:opacity-60 hover:!opacity-100 hover:bg-muted",
        "disabled:pointer-events-none disabled:!opacity-0",
        side === "left" ? "left-1" : "right-1"
      )}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}
