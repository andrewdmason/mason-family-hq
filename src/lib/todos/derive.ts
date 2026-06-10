import type { TodoTask, TodoView } from "@/lib/todos/types";

/** The views the shell derives client-side (logbook is its own fetch). */
export type TodoListView = Exclude<TodoView, "logbook">;

/**
 * Client-side mirror of sweepElapsedSnoozes (queries.ts): a snoozed task
 * whose moment has passed shows in Today, not Snoozed. The server sweep runs
 * on every page load, so this only matters in a long-lived tab switching
 * views without touching the server — the next refresh persists the result.
 */
export function localSnoozeSweep(tasks: TodoTask[], nowIso: string): TodoTask[] {
  if (!tasks.some((t) => t.snoozedUntil && t.snoozedUntil <= nowIso)) {
    return tasks;
  }
  return tasks.map((t) =>
    t.snoozedUntil && t.snoozedUntil <= nowIso
      ? { ...t, bucket: "today" as const, snoozedUntil: null }
      : t
  );
}

/**
 * One member's view of the active task set — the same filters and orderings
 * as the per-view queries in queries.ts, applied in memory so view switches
 * never wait on the server. Expects a swept set (see localSnoozeSweep).
 */
export function deriveViewTasks(
  tasks: TodoTask[],
  view: TodoListView,
  viewedEmail: string
): TodoTask[] {
  switch (view) {
    case "snoozed":
      // Soonest wake first.
      return tasks
        .filter((t) => t.assigneeEmail === viewedEmail && t.snoozedUntil)
        .sort((a, b) => (a.snoozedUntil ?? "").localeCompare(b.snoozedUntil ?? ""));
    case "delegated":
      // By assignee so the view can group by person.
      return tasks
        .filter(
          (t) => t.creatorEmail === viewedEmail && t.assigneeEmail !== viewedEmail
        )
        .sort(
          (a, b) =>
            a.assigneeEmail.localeCompare(b.assigneeEmail) ||
            a.sortOrder - b.sortOrder
        );
    default:
      // The four buckets, in manual order.
      return tasks
        .filter(
          (t) =>
            t.assigneeEmail === viewedEmail &&
            t.bucket === view &&
            !t.snoozedUntil
        )
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
        );
  }
}
