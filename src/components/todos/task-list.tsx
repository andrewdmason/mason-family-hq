"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, CircleDashed, Inbox, Layers, Moon, Send, Star } from "lucide-react";
import {
  completeTask,
  createTask,
  deleteTask,
  deleteTasks,
  deleteTaskAttachment,
  clearSnooze,
  moveTaskToInbox,
  reassignTask,
  renormalizeTaskOrder,
  restoreTask,
  setTaskBucket,
  setTaskProject,
  setTaskSortOrder,
  snoozeTask,
  uncompleteTask,
  updateTaskNotes,
  updateTaskTitle,
} from "@/app/(todos)/todos/actions";
import { onInlineNew } from "@/components/todos/inline-new-button";
import {
  TaskContextMenu,
  type TaskContextActions,
} from "@/components/todos/task-context-menu";
import {
  TaskRow,
  type TaskRowContext,
  type TaskRowHandlers,
  type TaskRowMenu,
} from "@/components/todos/task-row";
import type { UploadingAttachment } from "@/components/todos/task-attachments";
import { MiniCalendar, WhenMenu } from "@/components/todos/when-picker";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { inOpenOverlay, isTypingTarget } from "@/lib/todos/keyboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Toast, ToastViewport } from "@/components/ui/toast";
import { isImageFile, uploadTaskAttachment } from "@/lib/todos/attachment-upload";
import {
  dropTargetAtPoint,
  emitDropTarget,
  parseDropKey,
} from "@/lib/todos/drop-targets";
import { withAs } from "@/lib/todos/member-context";
import { useReconciler } from "@/lib/todos/reconcile";
import type { TodoTaskAttachment } from "@/lib/todos/queries";
import { snoozePresets } from "@/lib/todos/snooze";
import { needsRenormalize, sortBetween } from "@/lib/todos/sort";
import type {
  TodoBucket,
  TodoMember,
  TodoProject,
  TodoTask,
  TodoView,
} from "@/lib/todos/types";
import { cn } from "@/lib/utils";

const COMPLETE_ANIMATION_MS = 600;
// After the crossed-out beat, the row collapses and the list closes around
// it (see SortableTaskRow). Keep in sync with its duration-[250ms] classes.
const REMOVE_ANIMATION_MS = 250;
const UNDO_WINDOW_MS = 6_000;

const EMPTY_STATES: Record<string, { icon: typeof Star; text: string }> = {
  inbox: { icon: Inbox, text: "Inbox zero. New captures and tasks from others land here." },
  today: { icon: Star, text: "Nothing on the plate today. Enjoy it — or pull something in from Anytime." },
  anytime: { icon: Layers, text: "Nothing queued. Tasks you could do whenever live here." },
  someday: { icon: Archive, text: "No someday-maybes parked here yet." },
  snoozed: { icon: Moon, text: "Nothing snoozed. Snoozed tasks wait here, then pop into Today." },
  delegated: { icon: Send, text: "Nothing delegated. To-dos you create for someone else show up here until they're done." },
  project: { icon: CircleDashed, text: "No tasks here yet. Hit New to add the first one." },
};

type TaskGroup = {
  key: string;
  heading: string | null;
  href: string | null;
  tasks: TodoTask[];
};

const countLabel = (list: TodoTask[]) =>
  list.length === 1 ? "this to-do" : `${list.length} to-dos`;

/**
 * Client state for a task list — sidebar views and project pages share this.
 * The server page passes the fresh task set; mutations update local state
 * instantly, fire the server action, and one refresh reconciles (sidebar
 * badge included) once every in-flight action has settled — see
 * lib/todos/reconcile.ts. Rows drag-reorder within their group, or drop onto
 * sidebar items.
 */
export function TaskList({
  context,
  initialTasks,
  members,
  projects,
  attachmentsByTask = {},
  viewedEmail,
  selfEmail,
}: {
  context: TaskRowContext;
  initialTasks: TodoTask[];
  members: TodoMember[];
  projects: TodoProject[];
  attachmentsByTask?: Record<string, TodoTaskAttachment[]>;
  viewedEmail: string;
  selfEmail: string;
}) {
  const { run, idle } = useReconciler();
  const [tasks, setTasks] = useState(initialTasks);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  // Completed rows mid-collapse (phase two of the check-off animation).
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  // Things' interaction model: click selects (shift extends a range,
  // cmd/ctrl toggles), double click opens, Delete asks then removes.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which expanded-editor menu is keyboard-summoned open (m / a).
  const [openMenu, setOpenMenu] = useState<TaskRowMenu | null>(null);
  // The keyboard `s` snooze popover: the When menu anchored to the selected
  // row (no editor open), so scheduling never has to expand the task.
  const [snoozeTarget, setSnoozeTarget] = useState<{
    task: TodoTask;
    anchor: HTMLElement;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The shift-range anchor: the last plain/cmd click.
  const anchorId = useRef<string | null>(null);
  const [undoTask, setUndoTask] = useState<TodoTask | null>(null);
  const [attachments, setAttachments] = useState(attachmentsByTask);
  const [uploadingByTask, setUploadingByTask] = useState<
    Record<string, UploadingAttachment[]>
  >({});
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ⌘Z history for check-offs: every completion pushes the task here, ⌘Z pops
  // (one task at a time, most recent first) and ⇧⌘Z replays. A completion
  // still riding its two-beat animation hasn't hit the server yet, so its
  // timers live here too — undoing one just cancels them.
  const completeUndoStack = useRef<TodoTask[]>([]);
  const completeRedoStack = useRef<TodoTask[]>([]);
  const pendingCompleteTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>[]>()
  );

  // Drag-to-sidebar: the tasks riding the active drag (the whole selection
  // when the dragged row belongs to it), the valid sidebar target under the
  // pointer, and the follow-on dialogue a drop opens (Snoozed and Delegated
  // ask a question before acting; Logbook confirms).
  const draggingTasksRef = useRef<TodoTask[]>([]);
  const dropTargetRef = useRef<{ key: string; el: HTMLElement } | null>(null);
  // The real pointer position during a drag. dnd-kit's delta folds auto-scroll
  // compensation in, so activator + delta drifts once the page scrolls —
  // hit-testing the sidebar needs the native event's coordinates.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [dragCount, setDragCount] = useState(0);
  const [pendingDrop, setPendingDrop] = useState<
    | { kind: "snooze"; tasks: TodoTask[]; anchor: HTMLElement }
    | { kind: "assign"; tasks: TodoTask[]; anchor: HTMLElement }
    | { kind: "complete"; tasks: TodoTask[] }
    | null
  >(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Merge an incoming task set in, keeping the open editor's draft fields —
  // the user may still be mid-typing when it lands (a snapshot) or when the
  // list re-targets (an instant view switch carries the open draft along).
  const withEditingCarried = (prev: TodoTask[], next: TodoTask[]) => {
    const editing = expandedId ? prev.find((t) => t.id === expandedId) : undefined;
    if (!editing) return next;
    return next.some((t) => t.id === editing.id)
      ? next.map((t) =>
          t.id === editing.id
            ? { ...t, title: editing.title, notesHtml: editing.notesHtml }
            : t
        )
      : [editing, ...next];
  };

  // Instant view switches re-target this same mounted list (the views shell
  // swaps context + initialTasks in one render). Reset during render — not in
  // an effect — so the new view never paints a frame of the old view's rows,
  // and unconditionally: unlike snapshot adoption below, waiting for idle()
  // here would leave the wrong view on screen.
  const contextKey = context.mode === "view" ? context.view : context.projectId;
  const [renderedContextKey, setRenderedContextKey] = useState(contextKey);
  if (renderedContextKey !== contextKey) {
    setRenderedContextKey(contextKey);
    setTasks((prev) => withEditingCarried(prev, initialTasks));
    setSelectedIds(new Set());
    anchorId.current = null;
  }

  // Server snapshots are the source of truth, but only between mutations
  // (idle): a snapshot rendered before a later optimistic change committed
  // would resurrect its old row — the drain refresh re-syncs afterwards.
  useEffect(() => {
    if (!idle()) return;
    setTasks((prev) => withEditingCarried(prev, initialTasks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTasks]);
  useEffect(() => {
    if (idle()) setAttachments(attachmentsByTask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentsByTask]);

  const inProject = context.mode === "project";
  const view: TodoView | null = context.mode === "view" ? context.view : null;
  // Mirrors the header button split (see [view]/page.tsx): bucket views and
  // project pages create in place; the status lenses (Snoozed, Delegated)
  // keep the global capture modal — including for the `c` key.
  const canInlineNew = inProject || view === "inbox" || view === "today" || view === "anytime" || view === "someday";

  const removeLocally = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setExpandedId((prev) => (prev === taskId ? null : prev));
    if (expandedId === taskId) setOpenMenu(null);
    setSelectedIds((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  const patchLocally = (taskId: string, patch: Partial<TodoTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
    );
  };

  // Stable React keys across the temp→real id swap, so the in-place editor
  // (and whatever the user is mid-typing) survives the server roundtrip.
  const keyAliases = useRef(new Map<string, string>());
  const stableKey = (taskId: string) => keyAliases.current.get(taskId) ?? taskId;

  // Things discards an untitled to-do when it's closed: once the open editor
  // moves off a draft that's still empty (no title, no notes), drop it.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const prevExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevExpandedRef.current;
    prevExpandedRef.current = expandedId;
    if (!prev || prev === expandedId) return;
    const task = tasksRef.current.find((t) => t.id === prev);
    if (!task) return;
    const notesEmpty = (task.notesHtml ?? "").replace(/<[^>]*>/g, "").trim() === "";
    if (task.title.trim() === "" && notesEmpty) {
      removeLocally(task.id);
      if (!task.id.startsWith("temp-")) run(deleteTask(task.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId]);

  const completeWithAnimation = (task: TodoTask) => {
    if (completingIds.has(task.id)) return;
    completeUndoStack.current.push(task);
    // Like Things, in two beats: the row sits crossed-out for a moment,
    // then collapses while the list closes up around it.
    setCompletingIds((prev) => new Set(prev).add(task.id));
    const crossOut = setTimeout(() => {
      const collapse = setTimeout(() => {
        pendingCompleteTimers.current.delete(task.id);
        removeLocally(task.id);
        setCompletingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        run(completeTask(task.id));
      }, REMOVE_ANIMATION_MS);
      pendingCompleteTimers.current.set(task.id, [collapse]);
      setRemovingIds((prev) => new Set(prev).add(task.id));
    }, COMPLETE_ANIMATION_MS);
    pendingCompleteTimers.current.set(task.id, [crossOut]);
  };

  const handlers: TaskRowHandlers = {
    onComplete: (task) => {
      // A fresh completion starts a new history; ⇧⌘Z only replays undos.
      completeRedoStack.current = [];
      completeWithAnimation(task);
    },
    onDelete: (task) => {
      removeLocally(task.id);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoTask(task);
      undoTimer.current = setTimeout(() => setUndoTask(null), UNDO_WINDOW_MS);
      run(deleteTask(task.id));
    },
    onSnooze: (task, when) => {
      // Views that show snoozed tasks in place just update the chip; bucket
      // views drop the row (it hides until it wakes).
      if (inProject || view === "snoozed" || view === "delegated") {
        patchLocally(task.id, { snoozedUntil: when.toISOString() });
        if (view === "snoozed") {
          setTasks((prev) =>
            [...prev].sort((a, b) =>
              (a.snoozedUntil ?? "").localeCompare(b.snoozedUntil ?? "")
            )
          );
        }
      } else {
        removeLocally(task.id);
      }
      run(snoozeTask(task.id, when.toISOString()));
    },
    onWake: (task) => {
      if (inProject || view === "delegated") {
        patchLocally(task.id, { snoozedUntil: null, bucket: "today" });
      } else {
        removeLocally(task.id);
      }
      run(clearSnooze(task.id));
    },
    onSetBucket: (task, bucket) => {
      // Delegated tracks the task wherever it sits in their system.
      if (inProject || view === "delegated") {
        patchLocally(task.id, { bucket, snoozedUntil: null });
      } else if (view === "snoozed" || bucket !== view) {
        removeLocally(task.id);
      }
      run(setTaskBucket(task.id, bucket));
    },
    onReassign: (task, email) => {
      if (view === "delegated") {
        // Taking it back (or it landing on the viewer) ends the delegation.
        if (email === viewedEmail) removeLocally(task.id);
        else patchLocally(task.id, { assigneeEmail: email });
      } else if (inProject) {
        patchLocally(task.id, { assigneeEmail: email });
      } else if (email !== viewedEmail) {
        removeLocally(task.id);
      } else {
        patchLocally(task.id, { assigneeEmail: email });
      }
      run(reassignTask(task.id, email));
    },
    onTitleChange: (task, title) => {
      patchLocally(task.id, { title });
    },
    onRenameTitle: (task, title) => {
      const trimmed = title.trim();
      // Empty titles stay local: an empty draft is discarded on close, and a
      // blanked-out existing title just isn't committed.
      if (!trimmed) return;
      patchLocally(task.id, { title: trimmed });
      // A draft still waiting on its server id syncs via the create handler.
      if (!task.id.startsWith("temp-")) run(updateTaskTitle(task.id, trimmed));
    },
    onSetProject: (task, projectId) => {
      if (inProject && projectId !== context.projectId) {
        removeLocally(task.id);
      } else {
        // Filing an Inbox task into a project triages it (mirrors the server).
        const autoTriage = !!projectId && task.bucket === "inbox";
        patchLocally(task.id, {
          projectId,
          ...(autoTriage ? { bucket: "anytime" as const } : {}),
        });
        if (autoTriage && view === "inbox") removeLocally(task.id);
      }
      run(setTaskProject(task.id, projectId));
    },
    onMoveToInbox: (task) => {
      // Un-triage: leaves projects and every view except the Inbox itself
      // (and Delegated, where it stays theirs-to-do).
      if (inProject || (view && view !== "inbox" && view !== "delegated")) {
        removeLocally(task.id);
      } else {
        patchLocally(task.id, {
          bucket: "inbox",
          projectId: null,
          snoozedUntil: null,
        });
      }
      run(moveTaskToInbox(task.id));
    },
    onSaveNotes: (task, html) => {
      patchLocally(task.id, { notesHtml: html });
      if (!task.id.startsWith("temp-")) run(updateTaskNotes(task.id, html));
    },
    onAddFiles: (task, files) => {
      if (files.length === 0) return;
      const placeholders = files.map((file) => ({
        key: crypto.randomUUID(),
        name: file.name,
        objectUrl: isImageFile(file) ? URL.createObjectURL(file) : null,
        file,
      }));
      setUploadingByTask((prev) => ({
        ...prev,
        [task.id]: [...(prev[task.id] ?? []), ...placeholders],
      }));
      setExpandedId(task.id);

      // The whole batch rides one pending slot: the drain refresh picks up
      // the stored attachments' signed URLs once every upload settles.
      run(
        Promise.allSettled(
          placeholders.map(async (placeholder) => {
            try {
              await uploadTaskAttachment(task.id, placeholder.file);
            } finally {
              setUploadingByTask((prev) => ({
                ...prev,
                [task.id]: (prev[task.id] ?? []).filter(
                  (u) => u.key !== placeholder.key
                ),
              }));
              if (placeholder.objectUrl) URL.revokeObjectURL(placeholder.objectUrl);
            }
          })
        )
      );
    },
    onDeleteAttachment: (task, attachment) => {
      setAttachments((prev) => ({
        ...prev,
        [task.id]: (prev[task.id] ?? []).filter((a) => a.id !== attachment.id),
      }));
      run(deleteTaskAttachment(attachment.id));
    },
  };

  const handleUndo = () => {
    if (!undoTask) return;
    const task = undoTask;
    setUndoTask(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setTasks((prev) => [...prev, task].sort((a, b) => a.sortOrder - b.sortOrder));
    run(restoreTask(task.id));
  };

  // ⌘Z: bring back the last checked-off task. Caught mid-animation it never
  // reached the server — cancel the timers and un-cross the row; otherwise
  // restore the row and uncomplete it server-side. Selects what came back.
  const handleUndoComplete = () => {
    const task = completeUndoStack.current.pop();
    if (!task) return;
    completeRedoStack.current.push(task);
    const timers = pendingCompleteTimers.current.get(task.id);
    if (timers) {
      timers.forEach(clearTimeout);
      pendingCompleteTimers.current.delete(task.id);
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    } else {
      setTasks((prev) =>
        prev.some((t) => t.id === task.id)
          ? prev
          : [...prev, task].sort((a, b) => a.sortOrder - b.sortOrder)
      );
      run(uncompleteTask(task.id));
    }
    setSelectedIds(new Set([task.id]));
    anchorId.current = task.id;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-task-id="${task.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  // ⇧⌘Z: re-complete the last ⌘Z'd task. If a reconcile swept the row out of
  // this view meanwhile, skip the animation and just tell the server.
  const handleRedoComplete = () => {
    const task = completeRedoStack.current.pop();
    if (!task) return;
    if (tasksRef.current.some((t) => t.id === task.id)) {
      completeWithAnimation(task);
    } else {
      completeUndoStack.current.push(task);
      run(completeTask(task.id));
    }
  };

  // Anytime and Someday group by project (loose tasks first), like Things;
  // Delegated groups by who holds the task.
  const grouped = view === "anytime" || view === "someday";
  const groups = useMemo<TaskGroup[]>(() => {
    if (view === "delegated") {
      return members
        .map((member) => ({
          key: member.email,
          heading:
            member.name?.trim().split(/\s+/)[0] ?? member.email.split("@")[0],
          // The heading jumps into that person's lists.
          href: withAs("/todos/today", member.email, selfEmail),
          tasks: tasks.filter((t) => t.assigneeEmail === member.email),
        }))
        .filter((group) => group.tasks.length > 0);
    }
    if (!grouped) return [{ key: "all", heading: null, href: null, tasks }];
    const loose = tasks.filter((t) => !t.projectId);
    const result: TaskGroup[] =
      loose.length > 0 ? [{ key: "loose", heading: null, href: null, tasks: loose }] : [];
    for (const project of projects) {
      const projectTasks = tasks.filter((t) => t.projectId === project.id);
      if (projectTasks.length === 0) continue;
      result.push({
        key: project.id,
        heading: project.name,
        href: withAs(`/todos/project/${project.id}`, viewedEmail, selfEmail),
        tasks: projectTasks,
      });
    }
    // Tasks in completed/deleted projects would vanish from a grouped view;
    // keep them visible as loose ones (their project chip still names it).
    const known = new Set(result.flatMap((g) => g.tasks.map((t) => t.id)));
    const orphans = tasks.filter((t) => !known.has(t.id));
    if (orphans.length > 0 && result[0]?.key === "loose") {
      result[0] = { ...result[0], tasks: [...result[0].tasks, ...orphans] };
    } else if (orphans.length > 0) {
      result.unshift({ key: "loose", heading: null, href: null, tasks: orphans });
    }
    return result;
  }, [grouped, view, tasks, members, projects, viewedEmail, selfEmail]);

  // Selection. Plain click selects one; shift extends a range from the last
  // anchor through the visible order; cmd/ctrl toggles membership.
  const visibleOrder = useMemo(
    () => groups.flatMap((g) => g.tasks.map((t) => t.id)),
    [groups]
  );

  // Things' "New": an untitled draft opens for editing in place — at the top
  // of the list, or on the line below `after` (the selected row) when given.
  // Emitted by the header button (inline-new-button.tsx) and the `c` key.
  const handleInlineNew = (after?: TodoTask) => {
    const bucket: TodoBucket =
      inProject || view === "snoozed" || view === "delegated" || view === "logbook"
        ? inProject
          ? "anytime"
          : "inbox"
        : (view as TodoBucket);
    // The draft joins the group it lands in: the project page's project, or —
    // in the project-grouped views — the selected row's project (loose
    // otherwise, so the draft renders where it was summoned).
    const projectId = inProject
      ? context.projectId
      : grouped
        ? (after?.projectId ?? null)
        : null;
    // Inside a project the assignee must be a member; default to the viewed
    // person when they belong, else the project's first member.
    const project = projectId
      ? projects.find((p) => p.id === projectId)
      : undefined;
    const assigneeEmail =
      !project || project.memberEmails.includes(viewedEmail)
        ? viewedEmail
        : project.memberEmails[0];
    if (!assigneeEmail) return;

    // Below a selected row: the midpoint between it and its in-group
    // neighbor — renormalizing first (like drag) if midpoints there ran dry.
    const group = after
      ? groups.find((g) => g.tasks.some((t) => t.id === after.id))
      : undefined;
    const afterIdx = group
      ? group.tasks.findIndex((t) => t.id === after!.id)
      : -1;
    let sortOrder = (tasks[0]?.sortOrder ?? 1) - 1;
    if (group && afterIdx >= 0) {
      const next = group.tasks[afterIdx + 1];
      if (needsRenormalize(after!.sortOrder, next?.sortOrder)) {
        group.tasks.forEach((t, i) => patchLocally(t.id, { sortOrder: i + 1 }));
        run(renormalizeTaskOrder(group.tasks.map((t) => t.id)));
        sortOrder = afterIdx + 1.5;
      } else {
        sortOrder = sortBetween(after!.sortOrder, next?.sortOrder ?? null);
      }
    }

    const temp: TodoTask = {
      id: `temp-${crypto.randomUUID()}`,
      title: "",
      notesHtml: null,
      bucket,
      assigneeEmail,
      creatorEmail: selfEmail,
      projectId,
      snoozedUntil: null,
      completedAt: null,
      completedByEmail: null,
      sortOrder,
      assigneeSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    // Render order follows array order, so slot the draft right after its row.
    setTasks((prev) => {
      const i = after ? prev.findIndex((t) => t.id === after.id) : -1;
      return i < 0
        ? [temp, ...prev]
        : [...prev.slice(0, i + 1), temp, ...prev.slice(i + 1)];
    });
    setSelectedIds(new Set([temp.id]));
    anchorId.current = temp.id;
    setExpandedId(temp.id);
    setOpenMenu(null);

    run(
      createTask({
        title: "",
        draft: true,
        ...(after ? { sortOrder } : { position: "top" as const }),
        assigneeEmail,
        bucket,
        projectId,
      })
        .then((created) => {
          keyAliases.current.set(created.id, temp.id);
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== temp.id) return t;
              // Keep anything typed while the roundtrip was in flight, and
              // sync it up if it already diverged from the (empty) draft.
              if (t.title.trim()) void updateTaskTitle(created.id, t.title);
              if (t.notesHtml) void updateTaskNotes(created.id, t.notesHtml);
              return { ...created, title: t.title, notesHtml: t.notesHtml };
            })
          );
          setExpandedId((prev) => (prev === temp.id ? created.id : prev));
          setSelectedIds((prev) =>
            prev.has(temp.id)
              ? new Set([...prev].map((id) => (id === temp.id ? created.id : id)))
              : prev
          );
          if (anchorId.current === temp.id) anchorId.current = created.id;
        })
        .catch(() => removeLocally(temp.id))
    );
  };
  const inlineNewRef = useRef(handleInlineNew);
  inlineNewRef.current = handleInlineNew;
  useEffect(() => onInlineNew(() => inlineNewRef.current()), []);

  const handleRowClick = (task: TodoTask, e: React.MouseEvent) => {
    if (e.shiftKey && anchorId.current) {
      const a = visibleOrder.indexOf(anchorId.current);
      const b = visibleOrder.indexOf(task.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds(new Set(visibleOrder.slice(lo, hi + 1)));
      } else {
        setSelectedIds(new Set([task.id]));
        anchorId.current = task.id;
      }
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(task.id)) next.delete(task.id);
        else next.add(task.id);
        return next;
      });
      anchorId.current = task.id;
    } else {
      setSelectedIds(new Set([task.id]));
      anchorId.current = task.id;
    }
    // Clicking rows closes whatever is open.
    setExpandedId(null);
    setOpenMenu(null);
  };

  // The first unselected row after (else before) the selection — where the
  // highlight lands after the selection completes or deletes away.
  const nextSurvivor = (): string | null => {
    const indexes = visibleOrder.flatMap((id, i) =>
      selectedIds.has(id) ? [i] : []
    );
    if (indexes.length === 0) return null;
    for (let i = indexes[indexes.length - 1] + 1; i < visibleOrder.length; i++) {
      if (!selectedIds.has(visibleOrder[i])) return visibleOrder[i];
    }
    for (let i = indexes[0] - 1; i >= 0; i--) {
      if (!selectedIds.has(visibleOrder[i])) return visibleOrder[i];
    }
    return null;
  };

  const deleteSelected = () => {
    const ids = [...selectedIds];
    const landing = nextSurvivor();
    setConfirmDelete(false);
    setSelectedIds(landing ? new Set([landing]) : new Set());
    if (landing) anchorId.current = landing;
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
    setExpandedId((prev) => (prev && ids.includes(prev) ? null : prev));
    run(deleteTasks(ids));
  };

  // Clicking the background (anything that isn't a task row or a floating
  // surface — menus, popovers, dialogs, toasts) clears the selection and
  // closes any open task, like Things.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          '[data-task-row], [data-slot], [role="menu"], [role="dialog"], [role="status"]'
        )
      ) {
        return;
      }
      setSelectedIds(new Set());
      setExpandedId(null);
      setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Gmail-style list keys: j/k (or arrows) walk the list, enter/o opens the
  // selected task, e completes, c creates an inline draft below the
  // selection, s drops the snooze/When menu from the row (without opening the
  // editor; ⇧⌘S summons it even mid-typing), m/a summon the project/assignee
  // menus, t pulls the selection into Today, y moves it to Anytime,
  // Delete/⌫/# asks then removes, w wakes a snoozed task, z undoes a
  // delete, ⌘Z/⇧⌘Z undo/redo check-offs, ⌘A selects every task in the view,
  // and Escape closes the open task before clearing the selection. All of them stay quiet while typing
  // or while a menu/dialog is open; the ref keeps one stable window listener
  // over fresh state.
  const onListKeyDown = (e: KeyboardEvent) => {
    // ⌘A / Ctrl+A: select all — unless typing, where native select-all wins.
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "a"
    ) {
      if (isTypingTarget(e.target) || inOpenOverlay(e.target) || expandedId)
        return;
      if (visibleOrder.length === 0) return;
      e.preventDefault();
      setSelectedIds(new Set(visibleOrder));
      anchorId.current = visibleOrder[0];
      return;
    }
    // ⌘Z / ⇧⌘Z: undo / redo the last check-off — unless typing (or a task is
    // open for editing), where native text undo wins.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
      if (isTypingTarget(e.target) || inOpenOverlay(e.target) || expandedId)
        return;
      e.preventDefault();
      if (e.shiftKey) handleRedoComplete();
      else handleUndoComplete();
      return;
    }
    // ⇧⌘S: jump to the When type-ahead. Unlike the plain `s` below it works
    // mid-typing, so editing a title can flow straight into scheduling.
    if (
      (e.metaKey || e.ctrlKey) &&
      e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === "s"
    ) {
      if (inOpenOverlay(e.target)) return;
      const targetId =
        expandedId ?? (selectedIds.size === 1 ? [...selectedIds][0] : null);
      if (!targetId) return;
      e.preventDefault();
      setExpandedId(targetId);
      setOpenMenu("snooze");
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape") {
      if (inOpenOverlay(e.target)) return; // the dialog/menu closes itself
      if (expandedId) {
        setExpandedId(null);
        setOpenMenu(null);
      } else if (!isTypingTarget(e.target) && selectedIds.size > 0) {
        setSelectedIds(new Set());
      }
      return;
    }
    if (isTypingTarget(e.target) || inOpenOverlay(e.target) || expandedId) return;

    const selectOnly = (taskId: string) => {
      setSelectedIds(new Set([taskId]));
      anchorId.current = taskId;
      setExpandedId(null);
      setOpenMenu(null);
      // After the move paints, keep the row in view.
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-task-id="${taskId}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    };
    const single =
      selectedIds.size === 1
        ? (tasks.find((t) => selectedIds.has(t.id)) ?? null)
        : null;

    switch (e.key) {
      case "j":
      case "ArrowDown":
      case "k":
      case "ArrowUp": {
        if (visibleOrder.length === 0) return;
        e.preventDefault();
        const down = e.key === "j" || e.key === "ArrowDown";
        // Walk from the anchor (the last clicked/keyed row), else from the
        // first selected row; no selection starts at the list's edge.
        const fromId =
          anchorId.current && selectedIds.has(anchorId.current)
            ? anchorId.current
            : (visibleOrder.find((id) => selectedIds.has(id)) ?? null);
        const idx = fromId ? visibleOrder.indexOf(fromId) : -1;
        const next =
          idx < 0
            ? visibleOrder[down ? 0 : visibleOrder.length - 1]
            : visibleOrder[
                Math.min(
                  visibleOrder.length - 1,
                  Math.max(0, idx + (down ? 1 : -1))
                )
              ];
        selectOnly(next);
        return;
      }
      case "o":
      case "Enter": {
        if (!single) return;
        // Leave Enter alone when it's aimed at a focused button or link.
        if (
          e.key === "Enter" &&
          e.target instanceof HTMLElement &&
          e.target.closest("button, a")
        ) {
          return;
        }
        e.preventDefault();
        setExpandedId(single.id);
        return;
      }
      case "e": {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        const landing = nextSurvivor();
        tasks
          .filter((t) => selectedIds.has(t.id))
          .forEach((t) => handlers.onComplete(t));
        if (landing) selectOnly(landing);
        return;
      }
      case "#":
      case "Delete":
      case "Backspace": {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        setConfirmDelete(true);
        return;
      }
      case "s": {
        // Snooze without opening the editor: the When menu drops from the
        // row itself, so scheduling never has to expand the task.
        if (!single) return;
        e.preventDefault();
        const anchor = document.querySelector(`[data-task-id="${single.id}"]`);
        if (anchor instanceof HTMLElement) {
          setExpandedId(null);
          setOpenMenu(null);
          setSnoozeTarget({ task: single, anchor });
        }
        return;
      }
      case "m":
      case "a": {
        if (!single) return;
        e.preventDefault();
        setExpandedId(single.id);
        setOpenMenu(e.key === "m" ? "project" : "assignee");
        return;
      }
      case "t": {
        // Pull the selection into Today (clearing any snooze). Skips tasks
        // already there so it can't no-op churn.
        const affected = tasks.filter(
          (t) =>
            selectedIds.has(t.id) && (t.bucket !== "today" || t.snoozedUntil)
        );
        if (affected.length === 0) return;
        e.preventDefault();
        // Rows leave bucket/status views but stay (patched) in project,
        // delegated, and Today views — only move the highlight when they go.
        const staysPut = inProject || view === "delegated" || view === "today";
        const landing = staysPut ? null : nextSurvivor();
        affected.forEach((t) => handlers.onSetBucket(t, "today"));
        if (landing) selectOnly(landing);
        return;
      }
      case "w": {
        if (!single?.snoozedUntil) return;
        e.preventDefault();
        handlers.onWake(single);
        return;
      }
      case "y": {
        // Clear any scheduling — Today/Someday bucket or a snooze — back to
        // plain Anytime. Skips tasks already there so it can't no-op churn.
        const affected = tasks.filter(
          (t) =>
            selectedIds.has(t.id) && (t.bucket !== "anytime" || t.snoozedUntil)
        );
        if (affected.length === 0) return;
        e.preventDefault();
        // Rows leave bucket/status views but stay (patched) in project,
        // delegated, and Anytime views — only move the highlight when they go.
        const staysPut =
          inProject || view === "delegated" || view === "anytime";
        const landing = staysPut ? null : nextSurvivor();
        affected.forEach((t) => handlers.onSetBucket(t, "anytime"));
        if (landing) selectOnly(landing);
        return;
      }
      case "z": {
        if (!undoTask) return;
        e.preventDefault();
        handleUndo();
        return;
      }
      case "c": {
        // In-place views own `c` (the quick-add host defers to the
        // data-inline-new marker below); status lenses keep the modal.
        if (!canInlineNew || e.repeat) return;
        e.preventDefault();
        // Below the bottom-most selected row, like Things; with nothing
        // selected the draft opens at the top, same as the header New.
        const afterId = [...visibleOrder]
          .reverse()
          .find((id) => selectedIds.has(id));
        handleInlineNew(
          afterId ? tasks.find((t) => t.id === afterId) : undefined
        );
        return;
      }
    }
  };
  const listKeyDownRef = useRef(onListKeyDown);
  listKeyDownRef.current = onListKeyDown;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => listKeyDownRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Right-click context menu (selection-aware): right-clicking outside the
  // current selection pulls the selection onto that row first, so the menu
  // always acts on what's highlighted.
  const handleContextTarget = (task: TodoTask) => {
    if (!selectedIds.has(task.id)) {
      setSelectedIds(new Set([task.id]));
      anchorId.current = task.id;
      setExpandedId(null);
      setOpenMenu(null);
    }
  };

  const menuActions: TaskContextActions = {
    open: (task) => {
      setSelectedIds(new Set([task.id]));
      anchorId.current = task.id;
      setExpandedId(task.id);
    },
    complete: (list) => {
      const landing = nextSurvivor();
      list.forEach((t) => handlers.onComplete(t));
      if (landing) {
        setSelectedIds(new Set([landing]));
        anchorId.current = landing;
      }
    },
    setBucket: (list, bucket) => list.forEach((t) => handlers.onSetBucket(t, bucket)),
    snooze: (list, when) => list.forEach((t) => handlers.onSnooze(t, when)),
    wake: (list) =>
      list.filter((t) => t.snoozedUntil).forEach((t) => handlers.onWake(t)),
    setProject: (list, projectId) =>
      list.forEach((t) => handlers.onSetProject(t, projectId)),
    moveToInbox: (list) => list.forEach((t) => handlers.onMoveToInbox(t)),
    assign: (list, email) => list.forEach((t) => handlers.onReassign(t, email)),
    duplicate: (list) => {
      run(
        Promise.all(
          list.map((t) =>
            createTask({
              title: t.title,
              assigneeEmail: t.assigneeEmail,
              bucket: t.bucket,
              projectId: t.projectId,
              notesHtml: t.notesHtml ?? undefined,
            })
          )
        )
      );
    },
    requestDelete: (list) => {
      setSelectedIds(new Set(list.map((t) => t.id)));
      setConfirmDelete(true);
    },
  };

  // ============================================================
  // Drag: reorder within the group, or drop onto a sidebar item
  // ============================================================

  // Members a drop on Delegated could hand the tasks to — the membership
  // rule across the whole drag set (same as the context menu's Assign-to).
  const eligibleAssignees = (dragTasks: TodoTask[]) =>
    members.filter((m) =>
      dragTasks.every((t) => {
        if (!t.projectId) return true;
        const project = projects.find((p) => p.id === t.projectId);
        return !project || project.memberEmails.includes(m.email);
      })
    );

  // Whether this drag set may drop on this sidebar item. Projects honor the
  // membership rule; a bucket view's own item is a no-op target (Snoozed and
  // Delegated stay live in their own views — re-snooze / re-delegate).
  const dropEligible = (key: string, dragTasks: TodoTask[]): boolean => {
    const target = parseDropKey(key);
    if (target.kind === "project") {
      const project = projects.find((p) => p.id === target.projectId);
      return (
        !!project &&
        dragTasks.every((t) => project.memberEmails.includes(t.assigneeEmail))
      );
    }
    if (target.view === view && view !== "snoozed" && view !== "delegated") {
      return false;
    }
    if (target.view === "delegated") {
      return eligibleAssignees(dragTasks).length > 0;
    }
    return true;
  };

  // While a drag is live, mirror the pointer so handleDragMove (which also
  // fires for auto-scroll) always hit-tests against where the pointer truly is.
  useEffect(() => {
    if (dragCount === 0) return;
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [dragCount]);

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const activator = event.activatorEvent as Partial<PointerEvent>;
    pointerRef.current =
      typeof activator.clientX === "number" &&
      typeof activator.clientY === "number"
        ? { x: activator.clientX, y: activator.clientY }
        : null;
    // Dragging a row inside the selection carries the whole selection;
    // dragging an unselected row pulls the selection onto it first (like the
    // context menu).
    const inSelection = selectedIds.has(id);
    draggingTasksRef.current = inSelection
      ? tasks.filter((t) => selectedIds.has(t.id))
      : [task];
    if (!inSelection) {
      setSelectedIds(new Set([id]));
      anchorId.current = id;
    }
    setExpandedId(null);
    setOpenMenu(null);
    setDragCount(draggingTasksRef.current.length);
  };

  const handleDragMove = (_event: DragMoveEvent) => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    const hit = dropTargetAtPoint(pointer.x, pointer.y);
    const valid =
      hit && dropEligible(hit.key, draggingTasksRef.current) ? hit : null;
    if (dropTargetRef.current?.key !== valid?.key) {
      emitDropTarget(valid?.key ?? null);
    }
    dropTargetRef.current = valid;
  };

  /** Close out the drag state; returns what was live for the drop check. */
  const settleDrag = () => {
    const target = dropTargetRef.current;
    const dragTasks = draggingTasksRef.current;
    dropTargetRef.current = null;
    draggingTasksRef.current = [];
    setDragCount(0);
    emitDropTarget(null);
    return { target, dragTasks };
  };

  // A drop on the sidebar, routed by target. Buckets and projects act
  // immediately through the optimistic handlers; Snoozed and Delegated open
  // a picker anchored at the item, Logbook asks for confirmation.
  const performSidebarDrop = (
    target: { key: string; el: HTMLElement },
    dragTasks: TodoTask[]
  ) => {
    const parsed = parseDropKey(target.key);
    if (parsed.kind === "project") {
      dragTasks.forEach((t) => handlers.onSetProject(t, parsed.projectId));
      return;
    }
    switch (parsed.view) {
      case "inbox":
        dragTasks.forEach((t) => handlers.onMoveToInbox(t));
        return;
      case "today":
      case "anytime":
      case "someday": {
        const bucket = parsed.view;
        dragTasks.forEach((t) => handlers.onSetBucket(t, bucket));
        return;
      }
      case "snoozed":
        setPendingDrop({ kind: "snooze", tasks: dragTasks, anchor: target.el });
        return;
      case "delegated":
        setPendingDrop({ kind: "assign", tasks: dragTasks, anchor: target.el });
        return;
      case "logbook":
        setPendingDrop({ kind: "complete", tasks: dragTasks });
        return;
    }
  };

  const handleDragEnd = (event: DragEndEvent, group: TodoTask[]) => {
    const { target, dragTasks } = settleDrag();
    if (target && dragTasks.length > 0) {
      performSidebarDrop(target, dragTasks);
      return;
    }
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = group.findIndex((t) => t.id === active.id);
    const newIndex = group.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(group, oldIndex, newIndex);
    const prevOrder = next[newIndex - 1]?.sortOrder ?? null;
    const nextOrder = next[newIndex + 1]?.sortOrder ?? null;
    if (needsRenormalize(prevOrder, nextOrder)) {
      next.forEach((t, i) => patchLocally(t.id, { sortOrder: i + 1 }));
      setTasks((prev) => [...prev].sort((a, b) => a.sortOrder - b.sortOrder));
      run(renormalizeTaskOrder(next.map((t) => t.id)));
      return;
    }
    const sortOrder = sortBetween(prevOrder, nextOrder);
    patchLocally(String(active.id), { sortOrder });
    setTasks((prev) => [...prev].sort((a, b) => a.sortOrder - b.sortOrder));
    run(setTaskSortOrder(String(active.id), sortOrder));
  };

  const emptyKey = inProject ? "project" : (view as string);
  const empty = EMPTY_STATES[emptyKey] ?? EMPTY_STATES.project;
  const EmptyIcon = empty.icon;

  return (
    // data-inline-new tells the global quick-add host that `c` is taken
    // here (quick-add.tsx checks for it before opening the modal).
    <div className="space-y-3" data-inline-new={canInlineNew ? "" : undefined}>
      {tasks.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <EmptyIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{empty.text}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key}>
              {group.heading && (
                <Link
                  href={group.href!}
                  className="mb-1 flex items-center gap-1.5 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                >
                  <CircleDashed className="size-3.5 text-primary/70" />
                  {group.heading}
                </Link>
              )}
              <DndContext
                id={`todos-tasks-${group.key}`}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragCancel={() => void settleDrag()}
                onDragEnd={(e) => handleDragEnd(e, group.tasks)}
              >
                <SortableContext
                  items={group.tasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-0.5">
                    {group.tasks.map((task) => (
                      <SortableTaskRow
                        key={stableKey(task.id)}
                        id={task.id}
                        dragCount={dragCount}
                        removing={removingIds.has(task.id)}
                      >
                        <TaskContextMenu
                          task={task}
                          effectiveTasks={
                            selectedIds.has(task.id)
                              ? tasks.filter((t) => selectedIds.has(t.id))
                              : [task]
                          }
                          members={members}
                          projects={projects}
                          onTargetTask={handleContextTarget}
                          actions={menuActions}
                        >
                          <TaskRow
                            task={task}
                            context={context}
                            members={members}
                            projects={projects}
                            attachments={attachments[task.id] ?? []}
                            uploading={uploadingByTask[task.id] ?? []}
                            viewedEmail={viewedEmail}
                            completing={completingIds.has(task.id)}
                            selected={selectedIds.has(task.id)}
                            expanded={expandedId === task.id}
                            openMenu={expandedId === task.id ? openMenu : null}
                            onMenuOpenChange={(menu, open) =>
                              setOpenMenu(open ? menu : null)
                            }
                            onSelect={(e) => handleRowClick(task, e)}
                            onOpen={() => {
                              setSelectedIds(new Set([task.id]));
                              anchorId.current = task.id;
                              setExpandedId(task.id);
                              setOpenMenu(null);
                            }}
                            onClose={() => {
                              setExpandedId(null);
                              setOpenMenu(null);
                            }}
                            handlers={handlers}
                          />
                        </TaskContextMenu>
                      </SortableTaskRow>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </section>
          ))}
        </div>
      )}

      {/* Delete-key confirmation for the current selection */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIds.size === 1 ? "this to-do" : `${selectedIds.size} to-dos`}?
            </DialogTitle>
            <DialogDescription>This can’t be undone from the app.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Keyboard `s`: the When menu, anchored to the selected row so
          scheduling never opens the editor. */}
      {snoozeTarget && (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) setSnoozeTarget(null);
          }}
        >
          <PopoverContent
            anchor={snoozeTarget.anchor}
            align="start"
            className="w-64 gap-0.5 p-1.5"
          >
            <WhenMenu
              bucket={snoozeTarget.task.bucket}
              snoozedUntil={snoozeTarget.task.snoozedUntil}
              onPickBucket={(bucket) => {
                handlers.onSetBucket(snoozeTarget.task, bucket);
                setSnoozeTarget(null);
              }}
              onPickSnooze={(when) => {
                handlers.onSnooze(snoozeTarget.task, when);
                setSnoozeTarget(null);
              }}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* Drop on Snoozed: pick the wake moment, anchored at the sidebar item */}
      {pendingDrop?.kind === "snooze" && (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) setPendingDrop(null);
          }}
        >
          <PopoverContent
            anchor={pendingDrop.anchor}
            side="right"
            align="start"
            className="w-64 gap-0.5 p-1.5"
          >
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Snooze {countLabel(pendingDrop.tasks)} until…
            </p>
            {snoozePresets().map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  pendingDrop.tasks.forEach((t) =>
                    handlers.onSnooze(t, preset.when)
                  );
                  setPendingDrop(null);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
              >
                <span className="flex-1 text-left">{preset.label}</span>
                <span className="text-xs text-muted-foreground">{preset.hint}</span>
              </button>
            ))}
            <div className="-mx-1 my-1 h-px bg-border" />
            <MiniCalendar
              onPick={(when) => {
                pendingDrop.tasks.forEach((t) => handlers.onSnooze(t, when));
                setPendingDrop(null);
              }}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* Drop on Delegated: pick who gets them */}
      {pendingDrop?.kind === "assign" && (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) setPendingDrop(null);
          }}
        >
          <PopoverContent
            anchor={pendingDrop.anchor}
            side="right"
            align="start"
            className="w-56 gap-0.5 p-1.5"
          >
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Delegate {countLabel(pendingDrop.tasks)} to…
            </p>
            {eligibleAssignees(pendingDrop.tasks).map((member) => (
              <button
                key={member.email}
                type="button"
                onClick={() => {
                  pendingDrop.tasks
                    .filter((t) => t.assigneeEmail !== member.email)
                    .forEach((t) => handlers.onReassign(t, member.email));
                  setPendingDrop(null);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
              >
                <MemberAvatar name={member.name} size="xs" />
                <span className="flex-1 truncate text-left">
                  {member.name ?? member.email}
                </span>
                {member.email === selfEmail && (
                  <span className="text-xs text-muted-foreground">you</span>
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {/* Drop on Logbook: confirm completion */}
      <Dialog
        open={pendingDrop?.kind === "complete"}
        onOpenChange={(open) => {
          if (!open) setPendingDrop(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Complete{" "}
              {pendingDrop?.kind === "complete"
                ? countLabel(pendingDrop.tasks)
                : "to-dos"}
              ?
            </DialogTitle>
            <DialogDescription>
              {pendingDrop?.kind === "complete" && pendingDrop.tasks.length > 1
                ? "They’ll be marked done and filed in the Logbook."
                : "It’ll be marked done and filed in the Logbook."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingDrop(null)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (pendingDrop?.kind === "complete") {
                  pendingDrop.tasks.forEach((t) => handlers.onComplete(t));
                }
                setPendingDrop(null);
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Complete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {undoTask && (
        <ToastViewport>
          <Toast className="flex items-center justify-between gap-3">
            <span className="truncate text-muted-foreground">
              Deleted “{undoTask.title}”
            </span>
            <button
              type="button"
              onClick={handleUndo}
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

function SortableTaskRow({
  id,
  dragCount,
  removing = false,
  children,
}: {
  id: string;
  /** Size of the drag set — badges the floating row when > 1. */
  dragCount: number;
  /** Phase two of check-off: collapse the row so the list closes around it. */
  removing?: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      // Anchor for the keyboard selection's scrollIntoView.
      data-task-id={id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-70")}
      {...attributes}
      {...listeners}
    >
      {/* The 1fr→0fr grid row animates the collapse without measuring. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-[250ms] ease-in",
          removing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"
        )}
      >
        <div className={cn("min-h-0", removing && "pointer-events-none overflow-hidden")}>
          {children}
        </div>
      </div>
      {isDragging && dragCount > 1 && (
        <span className="pointer-events-none absolute -top-2 -right-2 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium tabular-nums text-primary-foreground shadow-sm">
          {dragCount}
        </span>
      )}
    </div>
  );
}
