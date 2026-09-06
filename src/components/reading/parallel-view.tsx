"use client";

import { useEffect, type ReactNode } from "react";
import type { ReaderSettings } from "@/lib/reading/reader-settings";
import { cn } from "@/lib/utils";
import { PageTurnZone } from "./paged-view";
import { BOOK_PROSE, PARALLEL_PROSE, typographyStyle } from "./reader-prose";
import type { ParallelGeometry } from "./use-parallel-pagination";

/**
 * The parallel-text spread: the book in the left column, its translation in
 * the right, level paragraph by paragraph, turned as one page.
 *
 * The chrome is the paged reader's — the same tap zones, the same swipe, the
 * same keys — so nothing about turning a page changes when the translation
 * comes alongside. Only the layout underneath differs: a grid that slides up,
 * not a column strip that slides sideways. See use-parallel-pagination.ts.
 */

const EDGE_SAFE_PX = 40;
const SWIPE_MIN_PX = 45;
const TAP_SLOP_PX = 10;
const CLICK_SLOP_PX = 6;
const TAP_MAX_MS = 500;
const BACK_ZONE = 0.33;
const INTERACTIVE =
  'a, button, [role="menuitem"], input, textarea, select, [data-reader-chat], [data-reader-plain], .reader-term';

export function ParallelView({
  html,
  viewport,
  onViewportRef,
  flowRef,
  geometry,
  pageHeight,
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
  /** Height of the current page — where its last whole line ends. */
  pageHeight: number;
  viewport: HTMLDivElement | null;
  onViewportRef: (el: HTMLDivElement | null) => void;
  flowRef: React.RefObject<HTMLDivElement | null>;
  geometry: ParallelGeometry | null;
  settings: ReaderSettings;
  isFirstPage: boolean;
  isLastPage: boolean;
  onNext: () => void;
  onPrev: () => void;
  onFirst: () => void;
  onLast: () => void;
  children?: ReactNode;
}) {
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
      } else if (pointerType === "mouse" && !settings.eink) {
        return;
      } else if (moved > CLICK_SLOP_PX) {
        return;
      }
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
      if (active?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
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

  return (
    <div
      ref={onViewportRef}
      className="fixed inset-0 overflow-hidden"
      style={{ touchAction: "pan-y" }}
    >
      {geometry && (
        <div
          className="absolute overflow-hidden"
          // As tall as the page's own last line, not the page: a row split on a
          // line boundary would otherwise show the top of the next line here
          // and again whole on the following page.
          style={{
            left: geometry.offsetX,
            top: geometry.top,
            width: geometry.width,
            height: Math.max(0, Math.min(geometry.pageH, pageHeight || geometry.pageH)),
          }}
        >
          <div
            ref={flowRef}
            className={cn("reader-parallel relative font-serif text-foreground", BOOK_PROSE, PARALLEL_PROSE)}
            style={{
              display: "grid",
              gridTemplateColumns: `${geometry.colW}px ${geometry.colW}px`,
              columnGap: `${geometry.gap}px`,
              rowGap: 0,
              alignItems: "start",
              width: geometry.width,
              // See paged-view: a plate has to fit the page, and this is the
              // only place the page's height is known.
              ["--reader-page-h" as string]: `${geometry.pageH}px`,
              ...typographyStyle(settings),
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}

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
            x={geometry.offsetX + geometry.width}
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
