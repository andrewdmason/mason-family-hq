"use client";

/**
 * The window's size, as something to subscribe to.
 *
 * The reader's whole layout is a pure function of this plus the settings, so it
 * wants to be a store rather than state copied in by an effect. The difference
 * is a frame: derived during render, opening the chat panel repositions the book
 * in the same paint as the panel itself; copied in by an effect, the panel lands
 * first and the book catches up afterwards, which is what made opening a chat
 * look like the reader lagging behind it.
 *
 * Resizes are debounced here rather than at each call site. A drag fires dozens
 * of them and one can cost a re-fragmentation of the whole book.
 */

const RESIZE_DEBOUNCE_MS = 150;

export type ViewportSize = { width: number; height: number };

/** Also the server's answer: there is no window, so nothing can be measured. */
const UNMEASURED: ViewportSize = { width: 0, height: 0 };

let snapshot: ViewportSize = UNMEASURED;
const listeners = new Set<() => void>();

/** Returns true when the size actually changed, so we only notify on real moves. */
function read(): boolean {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width === snapshot.width && height === snapshot.height) return false;
  snapshot = { width, height };
  return true;
}

export function subscribeViewport(onChange: () => void): () => void {
  listeners.add(onChange);

  // The first subscriber takes the first measurement. Identity is stable
  // afterwards, so every later subscriber gets the same object with no work.
  if (listeners.size === 1 && read()) {
    for (const fn of listeners) fn();
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!read()) return;
      for (const fn of listeners) fn();
    }, RESIZE_DEBOUNCE_MS);
  };
  window.addEventListener("resize", onResize);
  // Phones change the visible height without a window resize when the browser
  // chrome slides away.
  window.visualViewport?.addEventListener("resize", onResize);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    if (timer) clearTimeout(timer);
  };
}

export function getViewportSize(): ViewportSize {
  return snapshot;
}

export function getServerViewportSize(): ViewportSize {
  return UNMEASURED;
}
