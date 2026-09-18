"use client";

import {
  ArchiveIcon,
  CalendarArrowUpIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react";
import {
  archiveLeftover,
  archiveLeftovers,
  deleteLeftover,
  moveLeftoverToDate,
} from "@/app/practice/timer/task-actions";
import {
  emitOptimisticTask,
  emitOptimisticTaskDelete,
  emitOptimisticTaskRename,
  emitOptimisticTaskUpdate,
  rollbackOptimisticTask,
} from "@/lib/optimistic-task";
import { requestResumeDate } from "@/components/practice-table/resume-repeat-dialog";
import { scheduleRepeatOccurrence } from "@/lib/practice/schedule-occurrence";
import { nextOccurrenceDate } from "@/lib/practice/repeat";
import { addDays } from "@/lib/date-utils";
import type { TaskWithDetails } from "@/lib/types";

function fromLabel(date: string, today: string): string {
  if (date === addDays(today, -1)) return "from yesterday";
  const d = new Date(`${date}T12:00:00`);
  if (date >= addDays(today, -6)) {
    return `from ${d.toLocaleDateString("en-US", { weekday: "short" })}`;
  }
  return `from ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** A repeating item whose next slot has already gone by. */
function rhythmBroken(task: TaskWithDetails, today: string): boolean {
  return (
    task.repeat_interval_days !== null &&
    nextOccurrenceDate(task.date, task.repeat_interval_days, today) === null
  );
}

/**
 * Items left unfinished on earlier days, gathered at the top of today so they
 * get dealt with rather than scrolled past. This is a place to clear things up,
 * not to practice: each can be archived (done, or let go), brought onto today
 * to actually play, or deleted outright — the way to end a repeating item.
 */
export function LeftoversSection({
  tasks,
  olderCount,
  olderRepeatingCount,
  cutoff,
  today,
  onOlderArchived,
  track,
}: {
  tasks: TaskWithDetails[];
  olderCount: number;
  olderRepeatingCount: number;
  cutoff: string;
  today: string;
  onOlderArchived: () => void;
  /**
   * Hand each write to the log. Every action here updates the screen first and
   * never waits on the server, so the list can be flown through; the log holds
   * off on server snapshots until the writes land, then re-reads once.
   */
  track: (op: Promise<unknown>) => void;
}) {
  if (tasks.length === 0 && olderCount === 0) return null;

  const archiveOne = async (task: TaskWithDetails) => {
    const interval = task.repeat_interval_days;
    let nextDate: string | null = null;
    if (interval !== null) {
      nextDate =
        nextOccurrenceDate(task.date, interval, today) ??
        (await requestResumeDate({ pieceName: task.piece_name, count: 1 }));
      // Dismissed the question: leave the item where it is.
      if (nextDate === null) return;
    }
    emitOptimisticTaskUpdate(task.id, {
      completed: true,
      completed_at: new Date().toISOString(),
    });
    track(archiveLeftover(task.id));
    if (nextDate) {
      scheduleRepeatOccurrence({
        pieceId: task.piece_id,
        sectionId: task.section_id,
        date: nextDate,
        text: task.text,
        metronomeSpeed: task.metronome_speed,
        timerSeconds: task.timer_seconds,
        pieceName: task.piece_name,
        pieceComposer: task.piece_composer,
        pieceKind: task.piece_kind,
        sectionLabel: task.section_label,
        sectionStatus: task.section_status,
        sessionNumber: task.session_number,
        repeatIntervalDays: interval,
        repeatSourceTaskId: task.id,
      });
    }
  };

  const moveToToday = (task: TaskWithDetails) => {
    emitOptimisticTaskDelete(task.id);
    const tempId = emitOptimisticTask({
      pieceId: task.piece_id,
      sectionId: task.section_id,
      date: today,
      text: task.text,
      metronomeSpeed: task.metronome_speed,
      timerSeconds: task.timer_seconds,
      pieceName: task.piece_name,
      pieceComposer: task.piece_composer,
      pieceKind: task.piece_kind,
      sectionLabel: task.section_label,
      sectionStatus: task.section_status,
      sessionNumber: 1,
      repeatIntervalDays: task.repeat_interval_days,
      repeatSourceTaskId: task.repeat_source_task_id,
    });
    track(
      moveLeftoverToDate(task.id, today).then(
        () => emitOptimisticTaskRename(tempId, task.id),
        (err: unknown) => {
          rollbackOptimisticTask(tempId);
          throw err;
        },
      ),
    );
  };

  const remove = (task: TaskWithDetails) => {
    emitOptimisticTaskDelete(task.id);
    track(deleteLeftover(task.id));
  };

  const archiveAllRecent = async () => {
    const broken = tasks.filter((t) => rhythmBroken(t, today)).length;
    let resumeDate: string | null = null;
    if (broken > 0) {
      resumeDate = await requestResumeDate({
        pieceName:
          tasks.find((t) => rhythmBroken(t, today))?.piece_name ?? null,
        count: broken,
      });
      if (resumeDate === null) return;
    }
    const completedAt = new Date().toISOString();
    for (const t of tasks) {
      emitOptimisticTaskUpdate(t.id, {
        completed: true,
        completed_at: completedAt,
      });
    }
    track(
      archiveLeftovers({ ids: tasks.map((t) => t.id), today, resumeDate }),
    );
  };

  const archiveAllOlder = async () => {
    let resumeDate: string | null = null;
    if (olderRepeatingCount > 0) {
      resumeDate = await requestResumeDate({
        pieceName: null,
        count: olderRepeatingCount,
      });
      if (resumeDate === null) return;
    }
    onOlderArchived();
    track(archiveLeftovers({ before: cutoff, today, resumeDate }));
  };

  const actionClass =
    "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <section className="mb-8 rounded-lg border border-amber-200/70 bg-amber-50/40 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/5">
      <div className="mb-1.5 flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800/80 dark:text-amber-300/80">
          Unfinished from earlier
          {tasks.length > 0 && (
            <span className="ml-1.5 tabular-nums">· {tasks.length}</span>
          )}
        </h2>
        {tasks.length > 1 && (
          <button
            type="button"
            onClick={() => void archiveAllRecent()}
            className={`${actionClass} ml-auto`}
          >
            <ArchiveIcon className="size-3.5" />
            Archive all
          </button>
        )}
      </div>

      {tasks.length > 0 && (
        <ul className="divide-y divide-amber-200/50 dark:divide-amber-500/10">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="group/leftover flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
            >
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="shrink-0 text-sm font-medium text-foreground">
                  {task.piece_name ?? "General"}
                </span>
                {task.section_label && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {task.section_label}
                  </span>
                )}
                {task.text && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground/80">
                    {task.text}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {task.repeat_interval_days !== null && (
                  <RepeatIcon
                    className="size-3 text-muted-foreground/70"
                    aria-label="Repeats"
                  />
                )}
                <span className="mr-1 text-xs text-muted-foreground/70">
                  {fromLabel(task.date, today)}
                </span>
                <button
                  type="button"
                  onClick={() => void archiveOne(task)}
                  className={actionClass}
                  title={
                    task.repeat_interval_days !== null
                      ? "Archive — its next repeat is scheduled"
                      : "Archive"
                  }
                >
                  <ArchiveIcon className="size-3.5" />
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() => moveToToday(task)}
                  className={actionClass}
                  title="Move to today, to practice it"
                >
                  <CalendarArrowUpIcon className="size-3.5" />
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => remove(task)}
                  className={`${actionClass} hover:text-destructive`}
                  title="Delete — ends a repeating item"
                  aria-label="Delete"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {olderCount > 0 && (
        <div className="mt-1 flex items-center gap-3 border-t border-amber-200/50 pt-1.5 dark:border-amber-500/10">
          <span className="text-xs text-muted-foreground">
            {olderCount} {olderCount === 1 ? "item" : "items"} from more than
            two weeks ago
          </span>
          <button
            type="button"
            onClick={() => void archiveAllOlder()}
            className={`${actionClass} ml-auto`}
          >
            <ArchiveIcon className="size-3.5" />
            Archive all
          </button>
        </div>
      )}
    </section>
  );
}
