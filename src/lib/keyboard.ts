/**
 * Shared guards for the single-letter keyboard shortcuts across the apps —
 * to-dos' `c` and `g` chords and task-list keys, the reader's `c`. Letter
 * shortcuts only fire when the user isn't typing and no overlay owns the
 * keyboard.
 *
 * App-neutral on purpose: the same letter means different things in different
 * apps, but "am I allowed to act on a bare keystroke right now" is one question
 * with one answer, and two copies of it would eventually disagree.
 */

/** True when the key event originates from a text-entry surface. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * True while a dialog is open or the event comes from inside a popover/menu —
 * those surfaces handle their own keys (arrows, Escape, Enter).
 */
export function inOpenOverlay(target: EventTarget | null): boolean {
  if (document.querySelector('[data-slot="dialog-content"]')) return true;
  return (
    target instanceof HTMLElement &&
    !!target.closest(
      '[data-slot="popover-content"], [data-slot="dropdown-menu-content"], [role="dialog"]'
    )
  );
}
