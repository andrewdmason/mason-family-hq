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
 * How long the selection has to hold still before we displace the native menu.
 *
 * Much longer than the 120ms the toolbar waits, and for a different reason. The
 * toolbar only has to look settled; displacing takes the drag handles away, so
 * it has to be genuinely OVER. Chrome hands the page no "the selection gesture
 * ended" event — during a handle drag it just streams `selectionchange` — so a
 * stall in that stream is the only end-of-gesture signal there is, and a short
 * one would fire while a careful reader was still dragging. `touchend` below
 * covers the common case long before this ever runs; this is the backstop for
 * when the gesture is consumed and no touch event arrives at all.
 */
const DISPLACE_SETTLE_MS = 700;

/**
 * How long to disown `selectionchange` after displacing.
 *
 * Displacing drops the selection and immediately restores it, which is two more
 * `selectionchange` events, and Chrome delivers them asynchronously. Left alone
 * the first would read as "the reader deselected" and blink the toolbar out for
 * as long as it took the second to be noticed — a flash on an LCD, a full-page
 * repaint on e-ink. Nothing legitimate can land inside the window either: with
 * the handles gone, changing the selection needs a fresh long press, which takes
 * longer than this on its own.
 */
const SELF_CHANGE_MS = 250;

/**
 * Whether this browser's native selection menu is one the page can displace.
 *
 * Android only, and the asymmetry is real rather than caution. Chrome for
 * Android starts its selection action bar (Copy / Share / Select all / Web
 * search) from the GESTURE that made the selection, and tears it down when the
 * selection goes empty — so a page that drops the selection and puts it back
 * gets the text still selected with no action bar attached to it, because
 * nothing restarts a bar that no gesture asked for. iOS exposes no equivalent
 * lever: its callout is not tied to anything the page can reach, which is why
 * the touch toolbar sits along the bottom edge instead of competing for the
 * space beside the selection (see selection-toolbar.tsx).
 *
 * User-agent sniffing, deliberately. There is no feature to test for — the
 * thing being detected is a browser's own native UI, which reports nothing —
 * and guessing from touch support would wrongly rope in iOS, where this does
 * not work and where collapsing the selection is a live risk.
 */
function hasDisplaceableSelectionMenu(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** Whether two ranges cover exactly the same span. */
function sameRange(a: Range | null, b: Range): boolean {
  if (!a) return false;
  try {
    return (
      a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
      a.compareBoundaryPoints(Range.END_TO_END, b) === 0
    );
  } catch {
    // Ranges in different documents throw rather than compare. Treat it as a
    // new selection, which at worst displaces something already displaced.
    return false;
  }
}

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

    const displaceable = hasDisplaceableSelectionMenu();
    /** The span we have already taken the native menu away from. */
    let displaced: Range | null = null;
    /** Selection changes before this are our own doing — see SELF_CHANGE_MS. */
    let selfChangeUntil = 0;

    /**
     * Take Chrome's selection action bar off the reader's selection, leaving
     * our own toolbar as the only thing on offer.
     *
     * The move is to drop the selection and put the identical span straight
     * back. Both halves matter, and the obvious shortcut does not work: simply
     * re-stating the same span (`setBaseAndExtent` with the boundary points it
     * already has) changes nothing Android is watching, so the bar stays put and
     * the handles stay with it. Going through EMPTY is what does the work —
     * that's the transition that makes Chrome tear the action bar down — and
     * putting the span back afterwards doesn't bring it back, because the bar is
     * raised by the selection GESTURE and a page-made selection isn't one.
     *
     * Both halves land in the same task, so the selection is never painted in
     * its dropped state and the reader sees no flicker — which on e-ink is the
     * difference between this being free and it costing a full-page flash. The
     * `selectionchange` events it causes are disowned via `selfChangeUntil`;
     * see SELF_CHANGE_MS.
     *
     * The cost is the drag handles: after this the selection can no longer be
     * nudged wider by dragging its ends. That's the trade being made — a second
     * long press re-selects, and the reader asked for the native menu gone.
     */
    const displace = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const container = contentRef.current;
      if (
        !container ||
        !container.contains(range.startContainer) ||
        !container.contains(range.endContainer)
      ) {
        return;
      }
      if (sameRange(displaced, range)) return;
      // Two clones: one handed to the selection, one kept as the record of what
      // has already been displaced. Sharing a single Range would let the live
      // selection move ours out from under the comparison.
      const restore = range.cloneRange();
      displaced = range.cloneRange();
      selfChangeUntil = performance.now() + SELF_CHANGE_MS;
      sel.removeAllRanges();
      sel.addRange(restore);
    };

    // Settle before measuring. Mid-drag on a mouse the selection is still
    // moving and the popover would chase the cursor; on touch the OS adjusts the
    // range after the gesture ends, so reading it immediately gets a stale one.
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, delay);
    };

    // Kept on its own clock, because measuring and displacing want different
    // answers to "is the reader done?" — see DISPLACE_SETTLE_MS.
    let displaceTimer: number | undefined;
    const scheduleDisplace = (delay: number) => {
      if (!displaceable) return;
      window.clearTimeout(displaceTimer);
      displaceTimer = window.setTimeout(displace, delay);
    };

    const onPointerUp = () => schedule(0);
    // A lifted finger ends the gesture outright, so there is nothing left to
    // wait for. Listened to instead of `pointercancel`, which Chrome fires at
    // the START of a long press when it claims the gesture — acting on that
    // would pull the handles away before the drag had begun.
    const onTouchEnd = () => {
      schedule(0);
      scheduleDisplace(0);
    };
    const onSelectionChange = () => {
      // The drop-and-restore is not news, and reacting to its halves separately
      // would blink the toolbar off and back on — see SELF_CHANGE_MS.
      if (performance.now() < selfChangeUntil) return;
      const sel = window.getSelection();
      // Collapse is immediate — waiting to hide would let the toolbar linger
      // over text that is no longer selected.
      if (!sel || sel.isCollapsed) {
        window.clearTimeout(timer);
        window.clearTimeout(displaceTimer);
        // Forgotten, not remembered: re-selecting the same words is a new
        // selection and gets its own native menu to take away.
        displaced = null;
        setSpot(null);
        return;
      }
      schedule(120);
      scheduleDisplace(DISPLACE_SETTLE_MS);
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("selectionchange", onSelectionChange);
    // Scrolling on touch is constant and the bottom bar is fixed, so only the
    // position-dependent desktop popover cares; recomputing is cheap enough.
    window.addEventListener("scroll", onPointerUp, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(displaceTimer);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("touchend", onTouchEnd);
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
