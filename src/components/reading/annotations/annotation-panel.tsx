"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "@/components/ui/bottom-sheet";

export const ANNOTATION_PANEL_WIDTH_CLASS = "w-[26rem]";

/**
 * Desktop: a non-modal right-edge drawer. Deliberately NOT a dialog — no
 * backdrop, no focus trap, and clicking in the book does not dismiss it. The
 * whole point is to keep reading and selecting text while the chat is open, so
 * only Escape and the close button dismiss. The reading column is shifted left
 * by the same width in book-reader.tsx, so nothing is ever covered.
 *
 * Mobile: the app's existing BottomSheet, which can be parked at half height to
 * peek at the text behind it.
 */
export function AnnotationPanel({
  open,
  isMobile,
  onClose,
  dismissOnOutsidePress = false,
  children,
}: {
  open: boolean;
  isMobile: boolean;
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
      className={`fixed inset-y-0 right-0 z-50 flex ${ANNOTATION_PANEL_WIDTH_CLASS} flex-col border-l border-border bg-background shadow-lg`}
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
