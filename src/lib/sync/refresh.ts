"use client";

/**
 * How a screen asks for fresh data — shared by every app.
 *
 * The app-shell service worker (public/sw.js) answers a page load with the last
 * HTML it saved and fetches a fresh copy only for the *next* load. So the data
 * baked into a document can be minutes or hours old by the time it paints, and
 * something on the page has to notice and re-read. Two ways to do that:
 *
 *  - In place: the mounted screen registers a refresher here that re-reads its
 *    own data through a server action and re-renders with the result. Nothing
 *    remounts, so an editor you're typing in survives. Todos and the reader's
 *    shelf work this way.
 *  - Route refresh: router.refresh() re-runs the server render. Fine for screens
 *    with no in-place reader, as long as it never lands under a cursor — which
 *    is why callers go through `whenNotTyping` first.
 *
 * A module singleton rather than context, so the freshness guard in the root
 * layout and a refresher registered three layouts down meet without threading a
 * provider through every app.
 */

let refresher: (() => void) | null = null;

/** The mounted screen's in-place re-read. Returns an unregister function. */
export function registerRefresher(fn: () => void): () => void {
  refresher = fn;
  return () => {
    if (refresher === fn) refresher = null;
  };
}

/** Re-read the mounted screen's data in place; false = nothing registered. */
export function requestRefresh(): boolean {
  if (!refresher) return false;
  refresher();
  return true;
}

/**
 * Is the user in a text field right now? A refresh that remounts or reloads
 * while this is true takes the cursor — and often the text — with it.
 */
export function isTyping(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    return !(
      t === "button" ||
      t === "checkbox" ||
      t === "radio" ||
      t === "submit" ||
      t === "range" ||
      t === "file"
    );
  }
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * Run `fn` now if the user isn't typing, otherwise the moment they stop —
 * when the field loses focus, or when the window goes to the background.
 * Returns a cancel function.
 */
export function whenNotTyping(fn: () => void): () => void {
  if (!isTyping()) {
    fn();
    return () => {};
  }
  let done = false;
  const finish = () => {
    if (done) return;
    // Focus is mid-flight during focusout; wait a beat and re-check, so a
    // Tab from one field to the next doesn't count as "stopped typing".
    setTimeout(() => {
      if (done) return;
      if (isTyping() && document.visibilityState === "visible") return;
      done = true;
      cleanup();
      fn();
    }, 50);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") finish();
  };
  const cleanup = () => {
    document.removeEventListener("focusout", finish);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  document.addEventListener("focusout", finish);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    done = true;
    cleanup();
  };
}

/**
 * Did this server action fail because the page is from a build the server no
 * longer has? Next's client throws an UnrecognizedActionError when the server
 * answers "action not found" — the signature of a document replayed from the
 * app-shell cache after a deploy, once Vercel's skew window has closed. Every
 * action from that page will fail the same way; the only fix is a reload.
 */
export function isStaleBuildError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === "UnrecognizedActionError") return true;
  return (
    typeof e.message === "string" &&
    /was not found on the server|older or newer deployment/i.test(e.message)
  );
}

let reloadPending = false;

/**
 * The page on screen belongs to a build the server has moved past: reload it,
 * but not out from under a cursor. Once per document — a second caller while
 * the first is waiting on a blur just joins the queue.
 */
export function reloadForNewBuild(): void {
  if (reloadPending) return;
  reloadPending = true;
  whenNotTyping(() => window.location.reload());
}
