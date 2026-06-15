import type { TodoView } from "@/lib/todos/types";

/**
 * The contract between navigation triggers (sidebar links, `g` chords) and the
 * views shell (todos-views.tsx): while the shell is mounted it registers a
 * switcher that flips destinations client-side — every view's and every
 * project's tasks are already in memory, so a switch is instant — and callers
 * fall back to a real navigation when no shell is around (/todos/browse,
 * settings). The switcher takes a bare path (no `?as=`); the shell stamps
 * impersonation centrally. A module singleton rather than a window event (cf.
 * chord-hints.ts) because callers need the synchronous "was it handled?" answer
 * to decide on the fallback.
 */

let switcher: ((path: string) => void) | null = null;

export function registerViewSwitcher(fn: (path: string) => void): () => void {
  switcher = fn;
  return () => {
    if (switcher === fn) switcher = null;
  };
}

/** Switch instantly if the shell is mounted; false = caller should navigate. */
function requestSwitch(path: string): boolean {
  if (!switcher) return false;
  switcher(path);
  return true;
}

/** Switch to a sidebar view (today, inbox, …). */
export function requestViewSwitch(view: TodoView): boolean {
  return requestSwitch(`/todos/${view}`);
}

/** Switch to a project's view. */
export function requestProjectSwitch(id: string): boolean {
  return requestSwitch(`/todos/project/${id}`);
}
