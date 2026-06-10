"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, ListTodo, Star } from "lucide-react";
import { completeTask } from "@/app/(todos)/todos/actions";
import { QuickAddButton } from "@/components/todos/quick-add";
import { TaskCheckbox } from "@/components/todos/task-row";
import { WidgetCard } from "@/components/home/widget-card";
import type { HomeTodos } from "@/lib/home/todos";
import type { TodoTask } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

const COMPLETE_ANIMATION_MS = 600;
const VISIBLE_PER_SECTION = 5;

/**
 * Home dashboard widget: your Today list and the Inbox tasks awaiting triage,
 * both completable right here, plus a "New" affordance that summons the
 * global quick-add modal (also on `c` from anywhere).
 */
export function TodosWidget({ data }: { data: HomeTodos }) {
  const router = useRouter();
  const [todayTasks, setTodayTasks] = useState(data.todayTasks);
  const [inboxTasks, setInboxTasks] = useState(data.inboxTasks);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  useEffect(() => setTodayTasks(data.todayTasks), [data.todayTasks]);
  useEffect(() => setInboxTasks(data.inboxTasks), [data.inboxTasks]);

  const handleComplete = (taskId: string) => {
    if (completingIds.has(taskId)) return;
    setCompletingIds((prev) => new Set(prev).add(taskId));
    setTimeout(() => {
      setTodayTasks((prev) => prev.filter((t) => t.id !== taskId));
      setInboxTasks((prev) => prev.filter((t) => t.id !== taskId));
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      completeTask(taskId).finally(() => router.refresh());
    }, COMPLETE_ANIMATION_MS);
  };

  const allClear = todayTasks.length === 0 && inboxTasks.length === 0;

  return (
    <WidgetCard
      title="Todos"
      icon={ListTodo}
      href="/todos/today"
      action={<QuickAddButton label="New" />}
    >
      {allClear ? (
        <p className="py-1 text-sm text-muted-foreground">
          Today is clear and the Inbox is empty — nice.
        </p>
      ) : (
        <div className="space-y-3">
          <TaskSection
            label="Today"
            icon={<Star className="size-3 text-amber-500" />}
            href="/todos/today"
            tasks={todayTasks}
            emptyText="Today is clear."
            completingIds={completingIds}
            onComplete={handleComplete}
          />
          {inboxTasks.length > 0 && (
            <TaskSection
              label="Inbox"
              icon={<Inbox className="size-3 text-sky-700" />}
              href="/todos/inbox"
              tasks={inboxTasks}
              emptyText=""
              completingIds={completingIds}
              onComplete={handleComplete}
            />
          )}
        </div>
      )}
    </WidgetCard>
  );
}

function TaskSection({
  label,
  icon,
  href,
  tasks,
  emptyText,
  completingIds,
  onComplete,
}: {
  label: string;
  icon: React.ReactNode;
  href: string;
  tasks: TodoTask[];
  emptyText: string;
  completingIds: Set<string>;
  onComplete: (taskId: string) => void;
}) {
  const visible = tasks.slice(0, VISIBLE_PER_SECTION);
  const overflow = tasks.length - visible.length;

  if (tasks.length === 0 && !emptyText) return null;

  return (
    <section>
      <Link
        href={href}
        className="mb-0.5 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {icon}
        {label}
      </Link>
      {tasks.length === 0 ? (
        <p className="py-0.5 text-sm text-muted-foreground">{emptyText}</p>
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
                  onToggle={() => onComplete(task.id)}
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
          {overflow > 0 && (
            <Link
              href={href}
              className="block px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              +{overflow} more in {label}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
