/**
 * The contract between the `g` chord handler (todos-shortcuts.tsx) and the
 * sidebar: hold `g` for a beat and the handler broadcasts true, the sidebar
 * decorates each view row with its chord's follow-up key as a reminder, and
 * a false broadcast (chord fired, fumbled, or expired) clears them. Same
 * window-event pattern as drop-targets.ts.
 */

const CHORD_HINTS_EVENT = "todos:chord-hints";

export function emitChordHints(active: boolean): void {
  window.dispatchEvent(new CustomEvent(CHORD_HINTS_EVENT, { detail: active }));
}

export function onChordHints(handler: (active: boolean) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<boolean>).detail);
  window.addEventListener(CHORD_HINTS_EVENT, listener);
  return () => window.removeEventListener(CHORD_HINTS_EVENT, listener);
}
