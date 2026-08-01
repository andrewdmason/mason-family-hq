/**
 * Which project sections are folded away, per browser.
 *
 * Collapsing is a *reading* gesture — you fold the part of the project you
 * aren't working on right now — so it belongs to the screen you're on, not to
 * your identity. Keeping it in localStorage (rather than a per-member table)
 * also keeps it out of the reconcile loop entirely: no action, no refresh, no
 * optimistic state. A section folded on the laptop stays open on the phone,
 * which is the behaviour you want.
 */

const STORAGE_KEY = "todos:collapsed-sections";

export function readCollapsedSections(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsedSections(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Private mode / quota — folding just won't persist.
  }
}
