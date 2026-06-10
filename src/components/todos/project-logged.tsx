"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { uncompleteTask } from "@/app/(todos)/todos/actions";
import { TaskCheckbox } from "@/components/todos/task-row";
import type { TodoTask } from "@/lib/todos/types";

/**
 * Things' "Show N logged items": a quiet toggle under a project's task list
 * that reveals its completed to-dos. Unchecking one restores it to the live
 * list (the page refresh slots it back in).
 */
export function ProjectLogged({ initialTasks }: { initialTasks: TodoTask[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [shown, setShown] = useState(false);

  useEffect(() => setTasks(initialTasks), [initialTasks]);

  if (tasks.length === 0) return null;

  const handleUncomplete = (task: TodoTask) => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    uncompleteTask(task.id).finally(() => router.refresh());
  };

  const Chevron = shown ? ChevronDown : ChevronRight;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setShown((prev) => !prev)}
        className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Chevron className="size-3.5" />
        {shown
          ? "Hide logged items"
          : `Show ${tasks.length} logged item${tasks.length === 1 ? "" : "s"}`}
      </button>

      {shown && (
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
