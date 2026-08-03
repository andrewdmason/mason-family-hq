"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  completeTask,
  uncompleteTask,
  updateTaskNotes,
} from "@/app/(todos)/todos/actions";
import { TaskAttachments } from "@/components/todos/task-attachments";
import { TodoNotesReadonly } from "@/components/todos/todo-notes-readonly";
import { Toast, ToastViewport } from "@/components/ui/toast";
import { inOpenOverlay, isTypingTarget } from "@/lib/todos/keyboard";
import { setPendingSelection } from "@/lib/todos/pending-selection";
import type { TodoTaskAttachment } from "@/lib/todos/queries";
import { useReconciler } from "@/lib/todos/reconcile";
import type { TodoProject, TodoTask } from "@/lib/todos/types";
import { requestViewSwitch } from "@/lib/todos/view-switch";

const UNDO_WINDOW_MS = 6_000;

/**
 * Focus mode: one Today task at a time, on an empty field.
 *
 * The split it draws is the whole point — Today's list is where you *plan*
 * (drag things into the order you'll do them), and this is where you *execute*
 * that plan. So the only mutations here are completing the task and ticking a
 * checkbox inside its notes. No skip, no snooze, no reschedule, no edit: if the
 * task in front of you is the wrong one, the fix is to leave and re-order the
 * list, and that's deliberately the only escape hatch — a frictionless skip
 * would turn this into a slower way of scrolling Today.
 *
 * The queue is live (whatever the shell derives this render), and the current
 * task is tracked by id rather than position, so a task appearing or vanishing
 * elsewhere can't shuffle the card under you.
 */
export function FocusMode({
  tasks,
  projects,
  attachmentsByTask,
}: {
  /** Today for the viewed member, in manual order — derived by the shell. */
  tasks: TodoTask[];
  projects: TodoProject[];
  attachmentsByTask: Record<string, TodoTaskAttachment[]>;
}) {
  const { run, idle } = useReconciler();
  const [currentId, setCurrentId] = useState<string | null>(
    () => tasks[0]?.id ?? null
  );
  const [doneCount, setDoneCount] = useState(0);
  const [undo, setUndo] = useState<TodoTask | null>(null);

  const index = tasks.findIndex((t) => t.id === currentId);
  // A task can leave Today some other way — reassigned, completed on another
  // device. Completing is the only way to advance in here, and completing takes
  // a task out of Today, so whatever's left at the head of the queue is always
  // the right place to land.
  const current =
    index >= 0 ? tasks[index] : currentId != null ? (tasks[0] ?? null) : null;

  const exit = () => {
    // Land on Today with this task selected, so the handoff between executing
    // and curating keeps its place.
    if (current) setPendingSelection(current.id);
    requestViewSwitch("today");
  };

  const complete = (task: TodoTask) => {
    // Resolve the successor *before* mutating: the completed task lingers in
    // the shell's set until the refresh lands, and reading the next id
    // afterwards would skip a place.
    const at = tasks.findIndex((t) => t.id === task.id);
    setCurrentId(tasks[at + 1]?.id ?? null);
    setDoneCount((n) => n + 1);
    setUndo(task);
    void run(completeTask(task.id));
  };

  const undoComplete = () => {
    if (!undo) return;
    const task = undo;
    setUndo(null);
    setDoneCount((n) => Math.max(0, n - 1));
    setCurrentId(task.id);
    void run(uncompleteTask(task.id));
  };

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  // Bubble phase, so the layout's capture-phase `g` chords still win (and can
  // still swallow a fumbled chord's second key before it reads as Done).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.repeat) return;
      // Escape parks on an open dialog — the cheat sheet or the image lightbox
      // closes itself first.
      if (isTypingTarget(e.target) || inOpenOverlay(e.target)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (!undo) return;
        e.preventDefault();
        undoComplete();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exit();
        return;
      }
      // Not Space: it scrolls, and toggles whichever checkbox has focus.
      if (e.key === "e" || e.key === "Enter") {
        if (!current) return;
        e.preventDefault();
        complete(current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const project = current
    ? (projects.find((p) => p.id === current.projectId) ?? null)
    : null;
  const attachments = current ? (attachmentsByTask[current.id] ?? []) : [];

  return (
    // The marker is the contract that keeps the layout-level `c` (quick add)
    // out of here — focus mode isn't a capture surface. See quick-add.tsx.
    <div data-focus-mode className="flex flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-3 sm:px-6">
        {/* Progress accumulates rather than counting down — a remaining-count
            turns the day into debt before you've started. Hidden at zero, so
            the first card isn't a scoreboard you're losing. */}
        <span className="text-xs text-muted-foreground">
          {doneCount > 0 ? `${doneCount} done` : ""}
        </span>
        <button
          type="button"
          onClick={exit}
          aria-label="Exit focus mode"
          className="-mr-2 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center px-6 py-8">
        <div className="mx-auto w-full max-w-2xl">
          {current ? (
            <div
              key={current.id}
              className="space-y-5 duration-200 animate-in fade-in-0 slide-in-from-bottom-1"
            >
              {project && (
                <p className="text-sm text-muted-foreground">{project.name}</p>
              )}
              <h1 className="font-serif text-2xl tracking-tight text-foreground sm:text-4xl">
                {current.title}
              </h1>

              {current.notesHtml && (
                <TodoNotesReadonly
                  html={current.notesHtml}
                  idle={idle}
                  onChange={(html) => run(updateTaskNotes(current.id, html))}
                  className="max-h-[45vh] overflow-y-auto text-foreground"
                />
              )}

              {attachments.length > 0 && (
                <TaskAttachments
                  attachments={attachments}
                  uploading={[]}
                  onAddFiles={() => {}}
                  onDelete={() => {}}
                  readOnly
                />
              )}
            </div>
          ) : (
            <div className="space-y-2 text-center">
              <h1 className="font-serif text-2xl tracking-tight text-foreground sm:text-3xl">
                {doneCount > 0 ? "That's Today." : "Nothing in Today."}
              </h1>
              <p className="text-sm text-muted-foreground">
                {doneCount > 0
                  ? `${doneCount} done.`
                  : "Add something, or pull a few in from Anytime."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-2xl">
          {current ? (
            <button
              type="button"
              onClick={() => complete(current)}
              className="w-full rounded-xl bg-primary px-6 py-3.5 text-base font-medium text-primary-foreground hover:bg-primary/90 sm:mx-auto sm:block sm:w-auto sm:min-w-48"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={exit}
              className="mx-auto block text-sm font-medium text-primary hover:underline"
            >
              Back to Today
            </button>
          )}
        </div>
      </div>

      {undo && (
        <ToastViewport>
          <Toast className="flex items-center justify-between gap-3">
            <span className="truncate text-muted-foreground">
              Completed “{undo.title}”
            </span>
            <button
              type="button"
              onClick={undoComplete}
              className="shrink-0 font-medium text-primary hover:underline"
            >
              Undo
            </button>
          </Toast>
        </ToastViewport>
      )}
    </div>
  );
}
