"use client";

import { useEffect, useState } from "react";
import { useTodosRefresh } from "@/lib/todos/shell-refresh";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getProjectLogged, uncompleteTask } from "@/app/(todos)/todos/actions";
import { TaskCheckbox } from "@/components/todos/task-row";
import type { TodoTask } from "@/lib/todos/types";

/**
 * Things' "Show N logged items": a quiet toggle under a project's task list
 * that reveals its completed to-dos. The list is fetched lazily on first expand
 * (getProjectLogged) so the views shell never carries every project's history;
 * unchecking one restores it to the live list (the reconcile refresh slots it
 * back in). The count only shows once loaded — it isn't known up front.
 */
export function ProjectLogged({ projectId }: { projectId: string }) {
  const refresh = useTodosRefresh();
  const [tasks, setTasks] = useState<TodoTask[] | null>(null);
  const [shown, setShown] = useState(false);

  // A project switch (new id) drops any previously loaded history and collapses.
  useEffect(() => {
    setTasks(null);
    setShown(false);
  }, [projectId]);

  // Load on first expand; re-fetch on later expands so an uncomplete elsewhere
  // (or a freshly completed task) is reflected.
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    void getProjectLogged(projectId).then((rows) => {
      if (alive) setTasks(rows);
    });
    return () => {
      alive = false;
    };
  }, [shown, projectId]);

  const handleUncomplete = (task: TodoTask) => {
    setTasks((prev) => prev?.filter((t) => t.id !== task.id) ?? null);
    uncompleteTask(task.id).finally(() => refresh());
  };

  const Chevron = shown ? ChevronDown : ChevronRight;
  const loadedEmpty = shown && tasks !== null && tasks.length === 0;
  const label = !shown
    ? tasks === null
      ? "Show logged items"
      : `Show ${tasks.length} logged item${tasks.length === 1 ? "" : "s"}`
    : "Hide logged items";

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setShown((prev) => !prev)}
        className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Chevron className="size-3.5" />
        {label}
      </button>

      {loadedEmpty && (
        <p className="mt-1 px-2 text-xs text-muted-foreground/70">
          No logged items yet.
        </p>
      )}

      {shown && tasks && tasks.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2"
            >
              <TaskCheckbox checked onToggle={() => handleUncomplete(task)} />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through decoration-foreground/20">
                {task.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground/70">
                {completedLabel(task.completedAt!)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function completedLabel(iso: string): string {
  const when = new Date(iso);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d).setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfDay(today) - startOfDay(when)) / 86_400_000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(when.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}
