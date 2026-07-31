"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";

export const ANNOTATION_PANEL_WIDTH_CLASS = "w-[26rem]";

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
 */
export function AnnotationPanel({
  open,
  isMobile,
  docked,
  onClose,
  dismissOnOutsidePress = false,
  children,
}: {
  open: boolean;
  isMobile: boolean;
  /** Take width from the book instead of floating over it — see PanelDockToggle. */
  docked: boolean;
  onClose: () => void;
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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

  // No mounted-flag dance needed: the panel only ever opens from a client
  // interaction, so there is nothing to portal during SSR.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // z-50 clears the reader's hover header (z-40).
    <aside
      ref={panelRef}
      className={cn(
        "fixed right-0 z-50 flex flex-col bg-background",
        ANNOTATION_PANEL_WIDTH_CLASS,
        docked
          ? "inset-y-0 border-l border-border shadow-lg"
          : "top-3 bottom-3 right-3 overflow-hidden rounded-xl border border-border shadow-2xl"
      )}
      aria-label="Chat about this book"
    >
      {/* No floating close button: it would sit on top of whatever the panel
          content puts in its own top-right. The close control lives in the
          thread header instead, in the same row as the other actions. */}
      <div className="min-h-0 flex-1">{children}</div>
    </aside>,
    document.body
  );
}
