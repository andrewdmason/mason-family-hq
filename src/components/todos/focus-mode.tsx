"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, X } from "lucide-react";
import {
  clearSnooze,
  completeTask,
  setTaskBucket,
  snoozeTask,
  uncompleteTask,
  updateTaskNotes,
  updateTaskTitle,
} from "@/app/(todos)/todos/actions";
import { TaskAttachments } from "@/components/todos/task-attachments";
import { TodoNotesEditor } from "@/components/todos/todo-notes-editor";
import { WhenMenu } from "@/components/todos/when-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toast, ToastViewport } from "@/components/ui/toast";
import { inOpenOverlay, isTypingTarget } from "@/lib/keyboard";
import { setPendingSelection } from "@/lib/todos/pending-selection";
import type { TodoTaskAttachment } from "@/lib/todos/queries";
import { useReconciler } from "@/lib/todos/reconcile";
import { formatWake } from "@/lib/todos/snooze";
import type { TodoBucket, TodoProject, TodoTask } from "@/lib/todos/types";
import { requestViewSwitch } from "@/lib/todos/view-switch";

const UNDO_WINDOW_MS = 6_000;

/** The one reversible thing you just did, held for the toast's Undo. */
type Undoable = {
  task: TodoTask;
  message: string;
  /** Puts the task back the way it was. */
  restore: () => Promise<unknown>;
  /** Completions move the "n done" counter; parking a task doesn't. */
  counted: boolean;
};

/**
 * Focus mode: one Today task at a time, on an empty field.
 *
 * The split it draws is the whole point — Today's list is where you *plan*
 * (drag things into the order you'll do them), and this is where you *work*.
 * So what's here is what working on a task needs: finish it, sharpen its
 * wording or tick off its checklist as you go, or admit it isn't happening
 * today and send it forward. What's deliberately absent is a skip — nothing
 * moves you past a task while leaving it in Today, because a frictionless
 * skip would turn this into a slower way of scrolling the list.
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
  const [undo, setUndo] = useState<Undoable | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const index = tasks.findIndex((t) => t.id === currentId);
  // A task can leave Today some other way — reassigned, completed on another
  // device. Every way to advance in here takes the task out of Today, so
  // whatever's left at the head of the queue is always the right place to land.
  const current =
    index >= 0 ? tasks[index] : currentId != null ? (tasks[0] ?? null) : null;

  const exit = () => {
    // Land on Today with this task selected, so the handoff between executing
    // and curating keeps its place.
    if (current) setPendingSelection(current.id);
    requestViewSwitch("today");
  };

  // Resolve the successor *before* mutating: the task lingers in the shell's
  // set until the refresh lands, and reading the next id afterwards would skip
  // a place.
  const advancePast = (task: TodoTask) => {
    const at = tasks.findIndex((t) => t.id === task.id);
    setCurrentId(tasks[at + 1]?.id ?? null);
    setSnoozeOpen(false);
  };

  const complete = (task: TodoTask) => {
    advancePast(task);
    setDoneCount((n) => n + 1);
    setUndo({
      task,
      message: `Completed “${task.title}”`,
      restore: () => uncompleteTask(task.id),
      counted: true,
    });
    void run(completeTask(task.id));
  };

  /** Not today: the task wakes back into Today at the chosen moment. */
  const snooze = (task: TodoTask, when: Date) => {
    advancePast(task);
    setUndo({
      task,
      message: `Snoozed “${task.title}” until ${formatWake(when.toISOString())}`,
      restore: () => clearSnooze(task.id),
      counted: false,
    });
    void run(snoozeTask(task.id, when.toISOString()));
  };

  /** Not today, no date either — the Anytime / Someday parks in the menu. */
  const park = (task: TodoTask, bucket: TodoBucket) => {
    advancePast(task);
    setUndo({
      task,
      message: `Moved “${task.title}” to ${bucket === "anytime" ? "Anytime" : "Someday"}`,
      restore: () => setTaskBucket(task.id, "today"),
      counted: false,
    });
    void run(setTaskBucket(task.id, bucket));
  };

  const undoLast = () => {
    if (!undo) return;
    const { task, restore, counted } = undo;
    setUndo(null);
    if (counted) setDoneCount((n) => Math.max(0, n - 1));
    setCurrentId(task.id);
    void run(restore());
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
      // Escape parks on an open dialog — the cheat sheet, the snooze menu, or
      // the image lightbox closes itself first.
      if (inOpenOverlay(e.target)) return;
      if (isTypingTarget(e.target)) {
        // Escape leaves the field, not the mode: the title and notes are
        // editable now, so the first press hands the keyboard back and the
        // second one is the one that walks out.
        if (e.key === "Escape" && e.target instanceof HTMLElement) {
          e.preventDefault();
          e.target.blur();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (!undo) return;
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exit();
        return;
      }
      // `s` drops the same When menu the list's `s` does.
      if (e.key === "s") {
        if (!current) return;
        e.preventDefault();
        setSnoozeOpen(true);
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
            // Keyed on the task: the title field and the notes editor both
            // seed from their task on mount, and unmounting flushes whatever
            // was still uncommitted.
            <div
              key={current.id}
              className="space-y-5 duration-200 animate-in fade-in-0 slide-in-from-bottom-1"
            >
              {project && (
                <p className="text-sm text-muted-foreground">{project.name}</p>
              )}

              <FocusTitle
                task={current}
                idle={idle}
                onCommit={(title) => run(updateTaskTitle(current.id, title))}
              />

              {/* The notes are always here, empty or not: a lot of tasks are a
                  thin title over a checklist, and the ones that aren't often
                  want a line adding once you're actually looking at them. */}
              <div className="max-h-[45vh] overflow-y-auto text-foreground">
                <TodoNotesEditor
                  initialHtml={current.notesHtml ?? ""}
                  onSave={(html) => run(updateTaskNotes(current.id, html))}
                />
              </div>

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
            <div className="flex items-center justify-center gap-2">
              {/* Not-today, the honest alternative to a skip: it costs a
                  decision about when instead, and the task leaves Today. */}
              <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      title="Snooze (s)"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-3.5 text-base font-medium text-muted-foreground ring-1 ring-foreground/10 hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <Moon className="size-4 text-indigo-500" />
                  Snooze
                </PopoverTrigger>
                <PopoverContent side="top" className="w-64 gap-0.5 p-1.5">
                  {/* Mounted only while open so the query/calendar reset on
                      every summon. */}
                  {snoozeOpen && (
                    <WhenMenu
                      bucket={current.bucket}
                      snoozedUntil={current.snoozedUntil}
                      onPickBucket={(bucket) => {
                        setSnoozeOpen(false);
                        // Today is where it already is — nothing to do but
                        // close, rather than pretend something moved.
                        if (bucket !== "today") park(current, bucket);
                      }}
                      onPickSnooze={(when) => snooze(current, when)}
                    />
                  )}
                </PopoverContent>
              </Popover>

              <button
                type="button"
                onClick={() => complete(current)}
                className="flex-1 rounded-xl bg-primary px-6 py-3.5 text-base font-medium text-primary-foreground hover:bg-primary/90 sm:flex-none sm:w-48"
              >
                Done
              </button>
            </div>
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
              {undo.message}
            </span>
            <button
              type="button"
              onClick={undoLast}
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

const TITLE_TEXT = "font-serif text-2xl tracking-tight sm:text-4xl";

/**
 * The task's headline, editable in place — the card's title *is* the field, so
 * there's no edit affordance to hunt for and nothing shifts when you start
 * typing. It grows with the text via a hidden replica in the same grid cell
 * (no measuring, so a long title never flashes at one line first).
 *
 * Local state owns the text: saves are debounced, and flushed on blur and on
 * unmount, so finishing or snoozing mid-word still keeps what you typed. A
 * server snapshot is only adopted while the field is *unfocused* — a refresh
 * landing between the debounce firing and the next keystroke would otherwise
 * rewind the words typed since. Unfocused is safe because blur already
 * flushed, so there's nothing local left to lose.
 *
 * An empty title never commits: the server rejects it, and a blank headline is
 * far more likely one keystroke away from being retyped than an actual intent.
 */
function FocusTitle({
  task,
  /** True while a mutation is in flight — server props are stale then. */
  idle,
  onCommit,
}: {
  task: TodoTask;
  idle: () => boolean;
  onCommit: (title: string) => void;
}) {
  const [value, setValue] = useState(task.title);
  const [editing, setEditing] = useState(false);
  const [adopted, setAdopted] = useState(task.title);
  if (task.title !== adopted && !editing && idle()) {
    setAdopted(task.title);
    setValue(task.title);
  }

  // Kept in refs so the debounce and the unmount flush below read the latest
  // text and commit closure without re-binding on every keystroke. Synced in
  // an effect that runs before the flush effect's cleanup on unmount.
  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  const savedRef = useRef(task.title);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    valueRef.current = value;
    onCommitRef.current = onCommit;
  });

  const flush = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const next = valueRef.current.trim();
    if (!next || next === savedRef.current) return;
    savedRef.current = next;
    onCommitRef.current(next);
  };

  // Bound once: `flush` only reads refs, so the mount-time closure is current.
  useEffect(() => () => flush(), []);

  return (
    <div className="grid">
      {/* The sizer: same type, same wrapping, invisible. The trailing space
          keeps a line break at the end of the text from collapsing. */}
      <span
        aria-hidden
        className={`${TITLE_TEXT} invisible col-start-1 row-start-1 whitespace-pre-wrap break-words`}
      >
        {value + " "}
      </span>
      <textarea
        rows={1}
        value={value}
        onChange={(e) => {
          // No newlines: the headline is one paragraph, and Enter means done
          // with it (see below).
          setValue(e.target.value.replace(/\n/g, ""));
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(flush, 1_000);
        }}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          flush();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder="New To-Do"
        aria-label="Task title"
        className={`${TITLE_TEXT} col-start-1 row-start-1 resize-none overflow-hidden bg-transparent text-foreground outline-none placeholder:text-muted-foreground/40`}
      />
    </div>
  );
}
