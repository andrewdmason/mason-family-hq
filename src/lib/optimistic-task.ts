import { createTask } from "@/app/practice/timer/task-actions";
import type { PieceKind, SectionStatus, TaskWithDetails } from "@/lib/types";

export type OptimisticTaskDetail = {
  tempId: string;
  pieceId: string | null;
  sectionId: string | null;
  date: string;
  text?: string;
  metronomeSpeed: number | null;
  timerSeconds?: number;
  pieceName: string | null;
  pieceComposer: string | null;
  pieceKind: PieceKind | null;
  sectionLabel: string | null;
  sectionStatus: SectionStatus | null;
  afterTaskId?: string | null;
  sessionNumber?: number;
  repeatIntervalDays?: number | null;
  repeatSourceTaskId?: string | null;
};

export type OptimisticTaskRollback = { tempId: string };

export function emitOptimisticTask(
  input: Omit<OptimisticTaskDetail, "tempId">
): string {
  const tempId = `temp-${crypto.randomUUID()}`;
  window.dispatchEvent(
    new CustomEvent<OptimisticTaskDetail>("task-created-optimistic", {
      detail: { ...input, tempId },
    })
  );
  return tempId;
}

export function rollbackOptimisticTask(tempId: string): void {
  window.dispatchEvent(
    new CustomEvent<OptimisticTaskRollback>("task-created-rollback", {
      detail: { tempId },
    })
  );
}

export type FocusTaskNotesDetail = { taskId: string; selectAll: boolean };

export function emitFocusTaskNotes(taskId: string, selectAll: boolean): void {
  window.dispatchEvent(
    new CustomEvent<FocusTaskNotesDetail>("task-focus-notes", {
      detail: { taskId, selectAll },
    })
  );
}

export type OptimisticTaskRename = { tempId: string; realId: string };

// Stable React keys for tasks created optimistically. Once the server returns
// the real id and we rename the row in state, we still want React to treat the
// row as the same component instance — otherwise the unmount/remount would
// drop focus, in-progress text edits, etc. Look up via getStableTaskKey().
const taskKeyAliases = new Map<string, string>();

export function getStableTaskKey(taskId: string): string {
  return taskKeyAliases.get(taskId) ?? taskId;
}

if (typeof window !== "undefined") {
  window.addEventListener("task-rename-optimistic", (e: Event) => {
    const { tempId, realId } = (e as CustomEvent<OptimisticTaskRename>).detail;
    taskKeyAliases.set(realId, tempId);
  });
  window.addEventListener("task-deleted-optimistic", (e: Event) => {
    const { taskId } = (e as CustomEvent<OptimisticTaskDelete>).detail;
    taskKeyAliases.delete(taskId);
    pendingRealIds.delete(taskId);
  });
}

export function emitOptimisticTaskRename(
  tempId: string,
  realId: string
): void {
  window.dispatchEvent(
    new CustomEvent<OptimisticTaskRename>("task-rename-optimistic", {
      detail: { tempId, realId },
    })
  );
}

// Temp id → the real id the server will hand back. Anything that shows UI for
// a row the instant it's created (the repeat toast, and the sheet behind it)
// can act on the temp id and only wait here at the moment it needs to write.
const pendingRealIds = new Map<string, Promise<string>>();

/**
 * The server-side id for a row that may still be optimistic. Resolves straight
 * through for rows that already exist.
 */
export function resolveRealTaskId(taskId: string): Promise<string> {
  return pendingRealIds.get(taskId) ?? Promise.resolve(taskId);
}

export async function createTaskOptimistic(
  input: Omit<OptimisticTaskDetail, "tempId"> & {
    autoFocusNotes?: { selectAll: boolean };
    /**
     * Adopt a row the caller already placed optimistically instead of adding a
     * second one. Lets a caller paint the row (and anything keyed to it) before
     * deciding to persist it.
     */
    existingTempId?: string;
  }
): Promise<{
  id: string;
  timer_seconds: number;
  timer_remaining_seconds: number;
}> {
  const { autoFocusNotes, existingTempId, ...detail } = input;
  const tempId = existingTempId ?? emitOptimisticTask(detail);
  if (autoFocusNotes) {
    const selectAll = autoFocusNotes.selectAll;
    requestAnimationFrame(() => {
      emitFocusTaskNotes(tempId, selectAll);
    });
  }
  const pending = createTask(
    detail.pieceId,
    detail.sectionId,
    detail.metronomeSpeed,
    detail.date,
    detail.afterTaskId ?? null,
    detail.sessionNumber,
    detail.text,
    detail.timerSeconds,
    {
      intervalDays: detail.repeatIntervalDays,
      sourceTaskId: detail.repeatSourceTaskId,
    }
  );
  pendingRealIds.set(
    tempId,
    pending.then((r) => r.id)
  );
  try {
    const result = await pending;
    emitOptimisticTaskRename(tempId, result.id);
    return result;
  } catch (err) {
    // A row that never made it to the server has no id to resolve to; leaving
    // the entry would make later lookups hang on a rejected promise.
    pendingRealIds.delete(tempId);
    rollbackOptimisticTask(tempId);
    throw err;
  }
}

export type OptimisticTaskUpdate = {
  taskId: string;
  updates: Partial<TaskWithDetails>;
};

export function emitOptimisticTaskUpdate(
  taskId: string,
  updates: Partial<TaskWithDetails>
): void {
  window.dispatchEvent(
    new CustomEvent<OptimisticTaskUpdate>("task-updated-optimistic", {
      detail: { taskId, updates },
    })
  );
}

export type OptimisticTaskDelete = { taskId: string };

export function emitOptimisticTaskDelete(taskId: string): void {
  window.dispatchEvent(
    new CustomEvent<OptimisticTaskDelete>("task-deleted-optimistic", {
      detail: { taskId },
    })
  );
}
