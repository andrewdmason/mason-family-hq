"use client";

import { useEffect, useState } from "react";

export type SelectionSpot = {
  /** Viewport coords of the selection's top-centre, for the desktop popover. */
  x: number;
  y: number;
  /**
   * A CLONE of the live selection range, captured the moment the selection
   * settled.
   *
   * Cloning is what makes the whole thing work on touch. Anything the reader
   * taps next — a button, the panel, the iOS callout — can collapse the visible
   * selection, and on iOS it usually does. The clone is independent of
   * window.getSelection(), so the anchor is still derivable afterwards.
   */
  range: Range;
};

/**
 * The current usable text selection inside the reader, or null.
 *
 * Deliberately not a mouse-only affair. The old version bailed on anything
 * without a fine pointer, which is why iPad had no way to annotate at all —
 * and why a portrait iPad, which reads as "desktop" on a width query, still got
 * nothing. Pointer capability is asked about separately from viewport size,
 * because they answer different questions and an iPad changes its answer to the
 * first one when you attach a keyboard.
 */
export function useSelectionRange(
  contentRef: React.RefObject<HTMLDivElement | null>,
  disabled: boolean
): { spot: SelectionSpot | null; clear: () => void } {
  const [spot, setSpot] = useState<SelectionSpot | null>(null);

  useEffect(() => {
    // No listeners while disabled. The value is masked below rather than
    // cleared here, so nothing writes state during the effect.
    if (disabled) return;

    const evaluate = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSpot(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const container = contentRef.current;
      if (
        !container ||
        !container.contains(range.startContainer) ||
        !container.contains(range.endContainer) ||
        !range.toString().trim()
      ) {
        setSpot(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSpot(null);
        return;
      }
      setSpot({
        x: rect.left + rect.width / 2,
        y: rect.top,
        range: range.cloneRange(),
      });
    };

    // Settle before measuring. Mid-drag on a mouse the selection is still
    // moving and the popover would chase the cursor; on touch the OS adjusts the
    // range after the gesture ends, so reading it immediately gets a stale one.
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, delay);
    };

    const onPointerUp = () => schedule(0);
    const onSelectionChange = () => {
      const sel = window.getSelection();
      // Collapse is immediate — waiting to hide would let the toolbar linger
      // over text that is no longer selected.
      if (!sel || sel.isCollapsed) {
        window.clearTimeout(timer);
        setSpot(null);
        return;
      }
      schedule(120);
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    // Scrolling on touch is constant and the bottom bar is fixed, so only the
    // position-dependent desktop popover cares; recomputing is cheap enough.
    window.addEventListener("scroll", onPointerUp, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", onPointerUp);
    };
  }, [contentRef, disabled]);

  return {
    // Masked rather than stored: a stale position must never flash back when
    // the layer stops being busy.
    spot: disabled ? null : spot,
    clear: () => {
      setSpot(null);
      window.getSelection()?.removeAllRanges();
    },
  };
}

/**
 * Whether this is a fine-pointer device right now — not whether the screen is
 * small. An iPad flips between coarse and fine when a Magic Keyboard is
 * attached mid-session, so this listens rather than sampling once.
 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fine;
}
