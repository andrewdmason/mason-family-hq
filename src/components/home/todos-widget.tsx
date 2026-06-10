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
const VISIBLE_LIMIT = 5;

type TabKey = "today" | "inbox";

/**
 * Home dashboard widget: a Todos header that links into the app, with Today
 * and the Inbox as two tabs below it (Today selected by default, Inbox
 * wearing a count badge), each completable right here, plus a "New"
 * affordance that summons the global quick-add modal (also on `c` from
 * anywhere).
 */
export function TodosWidget({ data }: { data: HomeTodos }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("today");
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

  return (
    <WidgetCard
      title="Todos"
      icon={ListTodo}
      href="/todos/today"
      action={<QuickAddButton label="New" />}
    >
      <div className="space-y-1.5">
        <div role="tablist" className="flex items-center gap-4">
          <TabButton
            label="Today"
            icon={<Star className="size-3 text-amber-500" />}
            selected={activeTab === "today"}
            onSelect={() => setActiveTab("today")}
          />
          <TabButton
            label="Inbox"
            icon={<Inbox className="size-3 text-sky-700" />}
            badge={inboxTasks.length}
            selected={activeTab === "inbox"}
            onSelect={() => setActiveTab("inbox")}
          />
        </div>
        {activeTab === "today" ? (
          <TaskList
            tasks={todayTasks}
            href="/todos/today"
            label="Today"
            emptyText="Today is clear."
            completingIds={completingIds}
            onComplete={handleComplete}
          />
        ) : (
          <TaskList
            tasks={inboxTasks}
            href="/todos/inbox"
            label="Inbox"
            emptyText="The Inbox is empty."
            completingIds={completingIds}
            onComplete={handleComplete}
          />
        )}
      </div>
    </WidgetCard>
  );
}

function TabButton({
  label,
  icon,
  badge,
  selected,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  badge?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm text-xs font-medium uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span className={cn("shrink-0", !selected && "opacity-60")}>{icon}</span>
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="rounded-full bg-foreground/10 px-1.5 py-px text-[10px] tabular-nums normal-case leading-3.5 text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}

function TaskList({
  tasks,
  href,
  label,
  emptyText,
  completingIds,
  onComplete,
}: {
  tasks: TodoTask[];
  href: string;
  label: string;
  emptyText: string;
  completingIds: Set<string>;
  onComplete: (taskId: string) => void;
}) {
  const visible = tasks.slice(0, VISIBLE_LIMIT);
  const overflow = tasks.length - visible.length;

  if (tasks.length === 0) {
    return <p className="py-0.5 text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
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
  );
}
