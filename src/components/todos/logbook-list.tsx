"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, CircleDashed } from "lucide-react";
import { uncompleteProject, uncompleteTask } from "@/app/(todos)/todos/actions";
import { TaskCheckbox } from "@/components/todos/task-row";
import type { LogbookProject } from "@/lib/todos/queries";
import type { TodoTask } from "@/lib/todos/types";

type LogbookItem =
  | { kind: "task"; id: string; title: string; completedAt: string }
  | { kind: "project"; id: string; title: string; completedAt: string };

/**
 * The Logbook: completed tasks and projects grouped by completion day, newest
 * first. Unchecking restores an item (a project comes back; its tasks stay
 * completed).
 */
export function LogbookList({
  initialTasks,
  initialProjects,
}: {
  initialTasks: TodoTask[];
  initialProjects: LogbookProject[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<LogbookItem[]>(() =>
    merge(initialTasks, initialProjects)
  );

  useEffect(
    () => setItems(merge(initialTasks, initialProjects)),
    [initialTasks, initialProjects]
  );

  const handleUncomplete = (item: LogbookItem) => {
    setItems((prev) => prev.filter((i) => !(i.kind === item.kind && i.id === item.id)));
    const action =
      item.kind === "task" ? uncompleteTask(item.id) : uncompleteProject(item.id);
    action.finally(() => router.refresh());
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <BookCheck className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing logged yet. Completed to-dos collect here.
        </p>
      </div>
    );
  }

  // Group by completion day in the browser's timezone.
  const groups: { label: string; items: LogbookItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.completedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-1.5 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </h2>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <div
                key={`${item.kind}:${item.id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2"
              >
                <TaskCheckbox checked onToggle={() => handleUncomplete(item)} />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through decoration-foreground/20">
                  {item.title}
                </span>
                {item.kind === "project" && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    <CircleDashed className="size-3 text-primary/70" />
                    Project
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground/70">
                  {timeLabel(item.completedAt)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function merge(tasks: TodoTask[], projects: LogbookProject[]): LogbookItem[] {
  const items: LogbookItem[] = [
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      completedAt: t.completedAt!,
    })),
    ...projects.map((p) => ({
      kind: "project" as const,
      id: p.id,
      title: p.name,
      completedAt: p.completedAt,
    })),
  ];
  return items.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

function dayLabel(iso: string): string {
  const when = new Date(iso);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d).setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfDay(today) - startOfDay(when)) / 86_400_000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return when.toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    ...(when.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
