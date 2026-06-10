import type { TodoView } from "@/lib/todos/types";

/**
 * The contract between view navigation triggers (sidebar links, `g` chords)
 * and the views shell (todos-views.tsx): while the shell is mounted it
 * registers a switcher that flips views client-side — every view's tasks are
 * already in memory, so a switch is instant — and callers fall back to a real
 * navigation when no shell is around (project pages, /todos/browse, settings).
 * A module singleton rather than a window event (cf. chord-hints.ts) because
 * callers need the synchronous "was it handled?" answer to decide on the
 * fallback.
 */

let switcher: ((view: TodoView) => void) | null = null;

export function registerViewSwitcher(fn: (view: TodoView) => void): () => void {
  switcher = fn;
  return () => {
    if (switcher === fn) switcher = null;
  };
}

/** Switch instantly if the shell is mounted; false = caller should navigate. */
export function requestViewSwitch(view: TodoView): boolean {
  if (!switcher) return false;
  switcher(view);
  return true;
}
