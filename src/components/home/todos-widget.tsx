"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, ListTodo } from "lucide-react";
import { completeTask } from "@/app/(todos)/todos/actions";
import { QuickAddButton } from "@/components/todos/quick-add";
import { TaskCheckbox } from "@/components/todos/task-row";
import { WidgetCard } from "@/components/home/widget-card";
import type { HomeTodos } from "@/lib/home/todos";
import { cn } from "@/lib/utils";

const COMPLETE_ANIMATION_MS = 600;
const VISIBLE_TASKS = 6;

/**
 * Home dashboard widget: your Today list (check things off right here), the
 * Inbox triage count, and a "New" affordance that summons the global
 * quick-add modal (also on `q` from anywhere).
 */
export function TodosWidget({ data }: { data: HomeTodos }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(data.todayTasks);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  useEffect(() => setTasks(data.todayTasks), [data.todayTasks]);

  const handleComplete = (taskId: string) => {
    if (completingIds.has(taskId)) return;
    setCompletingIds((prev) => new Set(prev).add(taskId));
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      completeTask(taskId).finally(() => router.refresh());
    }, COMPLETE_ANIMATION_MS);
  };

  const visible = tasks.slice(0, VISIBLE_TASKS);
  const overflow = tasks.length - visible.length;

  return (
    <WidgetCard
      title="Todos"
      icon={ListTodo}
      href="/todos/today"
      action={<QuickAddButton label="New" />}
    >
      {visible.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">
          Today is clear.
          {data.inboxCount === 0 && " Inbox is empty too — nice."}
        </p>
      ) : (
        <div className="-mx-1.5">
          {visible.map((task) => {
            const completing = completingIds.has(task.id);
            return (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-opacity duration-500",
                  completing && "opacity-40"
                )}
              >
                <TaskCheckbox
                  checked={completing}
                  onToggle={() => handleComplete(task.id)}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm text-foreground",
                    completing && "text-muted-foreground line-through"
                  )}
                >
                  {task.title}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        {overflow > 0 && (
          <Link href="/todos/today" className="hover:text-foreground">
            +{overflow} more today
          </Link>
        )}
        <Link
          href="/todos/inbox"
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground",
            data.inboxCount > 0 && "text-primary"
          )}
        >
          <Inbox className="size-3.5" />
          {data.inboxCount > 0 ? `${data.inboxCount} in Inbox` : "Inbox zero"}
        </Link>
      </div>
    </WidgetCard>
  );
}
