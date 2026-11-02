"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, Moon } from "lucide-react";
import { deriveWeekSnoozedTasks } from "@/lib/todos/derive";
import { setPendingSelection } from "@/lib/todos/pending-selection";
import { formatWake } from "@/lib/todos/snooze";
import type { TodoTask } from "@/lib/todos/types";
import { requestViewSwitch } from "@/lib/todos/view-switch";

const subscribeNever = () => () => {};

/**
 * A quiet toggle under the This Week list that reveals what's snoozed to wake
 * before Monday, so planning the week can account for it. Look, don't touch:
 * these still wake into Today, and a click opens the task in Snoozed, where all
 * its actions live. Client-only because the week ends at the browser's midnight,
 * which the server can't know — its render would disagree on Sunday evenings.
 */
export function WeekSnoozed({
  tasks,
  viewedEmail,
}: {
  tasks: TodoTask[];
  viewedEmail: string;
}) {
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
  const [shown, setShown] = useState(false);
  const snoozed = useMemo(
    () =>
      mounted ? deriveWeekSnoozedTasks(tasks, viewedEmail, new Date()) : [],
    [mounted, tasks, viewedEmail]
  );

  if (snoozed.length === 0) return null;

  const Chevron = shown ? ChevronDown : ChevronRight;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setShown((prev) => !prev)}
        className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Chevron className="size-3.5" />
        {shown ? "Hide snoozed" : `${snoozed.length} snoozed waking this week`}
      </button>

      {shown && (
        <div className="mt-1 space-y-0.5">
          {snoozed.map((task) => (
            <button
              key={task.id}
              type="button"
              title="Open in Snoozed"
              onClick={() => {
                setPendingSelection(task.id);
                requestViewSwitch("snoozed");
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-accent/40"
            >
              <Moon className="size-4 shrink-0 text-indigo-500/60" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {task.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground/70">
                {formatWake(task.snoozedUntil!)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
