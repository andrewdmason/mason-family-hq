/**
 * A one-shot hand-off of "select this task when the list next renders".
 *
 * Leaving focus mode should land you on Today with the task you were looking at
 * highlighted, so the switch between executing and curating is continuous. The
 * task list owns `selectedIds` internally and doesn't remount across a view
 * switch, so there's no prop to pass — a module singleton (cf. view-switch.ts)
 * is the lightest contract that works, and it's consumed exactly once so a
 * later, unrelated switch back to Today doesn't re-select a stale row.
 */

let pendingId: string | null = null;

export function setPendingSelection(taskId: string): void {
  pendingId = taskId;
}

/** Read and clear — the id is good for the next render only. */
export function takePendingSelection(): string | null {
  const id = pendingId;
  pendingId = null;
  return id;
}
