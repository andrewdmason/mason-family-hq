"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
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
  reassignTask,
  renormalizeTaskOrder,
  restoreTask,
  setTaskBucket,
  setTaskProject,
  setTaskSortOrder,
  snoozeTask,
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
import { inOpenOverlay, isTypingTarget } from "@/lib/todos/keyboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toast, ToastViewport } from "@/components/ui/toast";
import { isImageFile, uploadTaskAttachment } from "@/lib/todos/attachment-upload";
import { withAs } from "@/lib/todos/member-context";
import type { TodoTaskAttachment } from "@/lib/todos/queries";
import { needsRenormalize, sortBetween } from "@/lib/todos/sort";
import type {
  TodoBucket,
  TodoMember,
  TodoProject,
  TodoTask,
  TodoView,
} from "@/lib/todos/types";

const COMPLETE_ANIMATION_MS = 600;
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

/**
 * Client state for a task list — sidebar views and project pages share this.
 * The server page passes the fresh task set; mutations update local state
 * instantly, fire the server action, then router.refresh() reconciles
 * (sidebar badge included). Rows drag-reorder within their group.
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
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  // Things' interaction model: click selects (shift extends a range,
  // cmd/ctrl toggles), double click opens, Delete asks then removes.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which expanded-editor menu is keyboard-summoned open (s / m / a).
  const [openMenu, setOpenMenu] = useState<TaskRowMenu | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The shift-range anchor: the last plain/cmd click.
  const anchorId = useRef<string | null>(null);
  const [undoTask, setUndoTask] = useState<TodoTask | null>(null);
  const [attachments, setAttachments] = useState(attachmentsByTask);
  const [uploadingByTask, setUploadingByTask] = useState<
    Record<string, UploadingAttachment[]>
  >({});
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Server refresh is the source of truth (post-action reconciliation).
  useEffect(() => setTasks(initialTasks), [initialTasks]);
  useEffect(() => setAttachments(attachmentsByTask), [attachmentsByTask]);

  const inProject = context.mode === "project";
  const view: TodoView | null = context.mode === "view" ? context.view : null;

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

  const run = async (action: Promise<unknown>) => {
    try {
      await action;
    } finally {
      router.refresh();
    }
  };

  // Stable React keys across the temp→real id swap, so the in-place editor
  // (and whatever the user is mid-typing) survives the server roundtrip.
  const keyAliases = useRef(new Map<string, string>());
  const stableKey = (taskId: string) => keyAliases.current.get(taskId) ?? taskId;

  // Things' "New": an untitled draft lands at the top of the list, opened for
  // editing in place. Emitted by the header button (inline-new-button.tsx).
  const handleInlineNew = () => {
    const bucket: TodoBucket =
      inProject || view === "snoozed" || view === "delegated" || view === "logbook"
        ? inProject
          ? "anytime"
          : "inbox"
        : (view as TodoBucket);
    // Inside a project the assignee must be a member; default to the viewed
    // person when they belong, else the project's first member.
    const project = inProject
      ? projects.find((p) => p.id === context.projectId)
      : undefined;
    const assigneeEmail =
      !project || project.memberEmails.includes(viewedEmail)
        ? viewedEmail
        : project.memberEmails[0];
    if (!assigneeEmail) return;

    const temp: TodoTask = {
      id: `temp-${crypto.randomUUID()}`,
      title: "",
      notesHtml: null,
      bucket,
      assigneeEmail,
      creatorEmail: selfEmail,
      projectId: inProject ? context.projectId : null,
      snoozedUntil: null,
      completedAt: null,
      completedByEmail: null,
      sortOrder: (tasks[0]?.sortOrder ?? 1) - 1,
      assigneeSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    setTasks((prev) => [temp, ...prev]);
    setSelectedIds(new Set([temp.id]));
    anchorId.current = temp.id;
    setExpandedId(temp.id);
    setOpenMenu(null);

    run(
      createTask({
        title: "",
        draft: true,
        position: "top",
        assigneeEmail,
        bucket,
        projectId: inProject ? context.projectId : null,
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

  const handlers: TaskRowHandlers = {
    onComplete: (task) => {
      if (completingIds.has(task.id)) return;
      setCompletingIds((prev) => new Set(prev).add(task.id));
      setTimeout(() => {
        removeLocally(task.id);
        setCompletingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        run(completeTask(task.id));
      }, COMPLETE_ANIMATION_MS);
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
      if (inProject && projectId !== context.projectId) removeLocally(task.id);
      else patchLocally(task.id, { projectId });
      run(setTaskProject(task.id, projectId));
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

      void Promise.allSettled(
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
      ).then(() => router.refresh());
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
  // selected task, e completes, s/m/a summon the snooze/project/assignee
  // menus, Delete/⌫/# asks then removes, w wakes a snoozed task, z undoes a
  // delete, ⌘A selects every task in the view, and Escape closes the open
  // task before clearing the selection. All of them stay quiet while typing
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
      case "s":
      case "m":
      case "a": {
        if (!single) return;
        e.preventDefault();
        setExpandedId(single.id);
        setOpenMenu(
          e.key === "s" ? "snooze" : e.key === "m" ? "project" : "assignee"
        );
        return;
      }
      case "w": {
        if (!single?.snoozedUntil) return;
        e.preventDefault();
        handlers.onWake(single);
        return;
      }
      case "z": {
        if (!undoTask) return;
        e.preventDefault();
        handleUndo();
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

  const handleDragEnd = (event: DragEndEvent, group: TodoTask[]) => {
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
    <div className="space-y-3">
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
                onDragEnd={(e) => handleDragEnd(e, group.tasks)}
              >
                <SortableContext
                  items={group.tasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-0.5">
                    {group.tasks.map((task) => (
                      <SortableTaskRow key={stableKey(task.id)} id={task.id}>
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
  children,
}: {
  id: string;
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
      className={isDragging ? "z-10 opacity-70" : undefined}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
