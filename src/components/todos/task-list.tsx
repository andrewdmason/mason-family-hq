"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
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
  createSection,
  createTask,
  deleteSection,
  deleteTask,
  deleteTasks,
  deleteTaskAttachment,
  clearSnooze,
  moveTaskToInbox,
  reassignTask,
  renameSection,
  renormalizeSectionOrder,
  renormalizeTaskOrder,
  restoreSection,
  restoreTask,
  setSectionSortOrder,
  setTaskBucket,
  setTaskProject,
  setTaskSection,
  setTaskSortOrder,
  snoozeTask,
  uncompleteTask,
  updateTaskNotes,
  updateTaskTitle,
} from "@/app/(todos)/todos/actions";
import {
  onInlineNew,
  onInlineNewSection,
} from "@/components/todos/inline-new-button";
import {
  SectionHeader,
  type SectionDragHandle,
} from "@/components/todos/section-header";
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
  sectionDropKey,
} from "@/lib/todos/drop-targets";
import { withAs } from "@/lib/todos/member-context";
import { useReconciler } from "@/lib/todos/reconcile";
import type { TodoTaskAttachment } from "@/lib/todos/queries";
import {
  readCollapsedSections,
  writeCollapsedSections,
} from "@/lib/todos/section-collapse";
import { snoozePresets } from "@/lib/todos/snooze";
import { needsRenormalize, sortBetween } from "@/lib/todos/sort";
import type {
  TodoBucket,
  TodoMember,
  TodoProject,
  TodoSection,
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
  /** Set on a project page's section groups — those render a SectionHeader
   * (foldable, renameable, a drop target) instead of the plain link heading,
   * and unlike every other group they show even when empty. */
  section?: TodoSection;
  tasks: TodoTask[];
};

const countLabel = (list: TodoTask[]) =>
  list.length === 1 ? "this to-do" : `${list.length} to-dos`;

/** The drag overlay's row is a picture, not a control. */
const NOOP = () => {};

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
  initialSections = [],
  members,
  projects,
  attachmentsByTask = {},
  viewedEmail,
  selfEmail,
}: {
  context: TaskRowContext;
  initialTasks: TodoTask[];
  /** Every live project's sections — the project page groups by its own, and
   * the context menu's Project submenu offers the rest as move targets. */
  initialSections?: TodoSection[];
  members: TodoMember[];
  projects: TodoProject[];
  attachmentsByTask?: Record<string, TodoTaskAttachment[]>;
  viewedEmail: string;
  selfEmail: string;
}) {
  const { run, idle } = useReconciler();
  const [tasks, setTasks] = useState(initialTasks);
  const [sections, setSections] = useState(initialSections);
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
  // The undo toast, for the two soft deletes that don't confirm first: a
  // single to-do, and a section (whose to-dos merged upward and come back
  // with it).
  const [undo, setUndo] = useState<
    | { kind: "task"; label: string; task: TodoTask }
    | { kind: "section"; label: string; section: TodoSection; taskIds: string[] }
    | null
  >(null);
  // Which section heading is in its rename/name-me state (a `temp-` id is a
  // brand-new one, not yet on the server).
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set()
  );
  // localStorage only exists after hydration; read it once on mount so SSR and
  // the first client render agree.
  useEffect(() => setCollapsedSections(readCollapsedSections()), []);
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
  // The row riding the pointer, drawn in a DragOverlay on project pages. Once
  // a drag can move a row into another section, the row's own translate stops
  // tracking the pointer — dnd-kit measures it from where the row *started*,
  // and crossing sections changes where it actually sits. The overlay is
  // positioned from the pointer instead, so it can't drift.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // Mirrors dropTargetRef for rendering — the section heading under the
  // pointer highlights itself.
  const [hoverDropKey, setHoverDropKey] = useState<string | null>(null);
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

  // A brand-new section lives only in local state until its name is committed
  // (an untitled heading is never persisted), so snapshots must not sweep it
  // away — same idea as withEditingCarried for an open task draft.
  const withDraftSectionsCarried = (
    prev: TodoSection[],
    next: TodoSection[]
  ) => {
    const drafts = prev.filter((s) => s.id.startsWith("temp-"));
    return drafts.length > 0 ? [...next, ...drafts] : next;
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
    setSections(initialSections);
    setEditingSectionId(null);
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
  useEffect(() => {
    if (idle()) setSections((prev) => withDraftSectionsCarried(prev, initialSections));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSections]);

  const inProject = context.mode === "project";
  const activeProjectId = context.mode === "project" ? context.projectId : null;
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

  const patchSection = (sectionId: string, patch: Partial<TodoSection>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, ...patch } : s))
    );
  };

  // This project's sections, in order — the grouping axis for the page.
  const projectSections = useMemo(
    () =>
      context.mode === "project"
        ? sections
            .filter((s) => s.projectId === context.projectId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context.mode, contextKey, sections]
  );

  /** Bottom of the list a to-do lands in when filed into a section — what the
   * "drop it on that heading" gesture means (mirrors setTaskSection). */
  const sectionBottomOrder = (
    projectId: string,
    sectionId: string | null
  ): number => {
    const siblings = tasks.filter(
      (t) => t.projectId === projectId && (t.sectionId ?? null) === sectionId
    );
    return siblings.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1;
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
      setUndo({ kind: "task", label: `Deleted “${task.title}”`, task });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
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
          // A project move always lands in the top area — the old section
          // belonged to the old project, and re-filing into the project it's
          // already in is the "out of its section" gesture.
          sectionId: null,
          ...(autoTriage ? { bucket: "anytime" as const } : {}),
        });
        if (autoTriage && view === "inbox") removeLocally(task.id);
      }
      run(setTaskProject(task.id, projectId));
    },
    onSetSection: (task, sectionId) => {
      const section = sectionId
        ? (sections.find((s) => s.id === sectionId) ?? null)
        : null;
      // A section carries its project, so this doubles as a project move.
      const projectId = section ? section.projectId : task.projectId;
      if (inProject && projectId !== context.projectId) {
        removeLocally(task.id);
      } else if (projectId) {
        const autoTriage = !!section && task.bucket === "inbox";
        patchLocally(task.id, {
          projectId,
          sectionId: section?.id ?? null,
          // Only the project page holds the whole project's tasks, so only it
          // can predict where the bottom of the destination is; elsewhere the
          // drain refresh carries the server's answer.
          ...(inProject
            ? { sortOrder: sectionBottomOrder(projectId, section?.id ?? null) }
            : {}),
          ...(autoTriage ? { bucket: "anytime" as const } : {}),
        });
        if (inProject) {
          setTasks((prev) => [...prev].sort((a, b) => a.sortOrder - b.sortOrder));
        }
        if (autoTriage && view === "inbox") removeLocally(task.id);
      }
      run(setTaskSection(task.id, sectionId));
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
          sectionId: null,
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
    if (!undo) return;
    const action = undo;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (action.kind === "task") {
      setTasks((prev) =>
        [...prev, action.task].sort((a, b) => a.sortOrder - b.sortOrder)
      );
      run(restoreTask(action.task.id));
      return;
    }
    // The heading comes back and reclaims the to-dos that merged upward.
    setSections((prev) =>
      [...prev, action.section].sort((a, b) => a.sortOrder - b.sortOrder)
    );
    const reclaimed = new Set(action.taskIds);
    setTasks((prev) =>
      prev.map((t) =>
        reclaimed.has(t.id) ? { ...t, sectionId: action.section.id } : t
      )
    );
    run(restoreSection(action.section.id, action.taskIds));
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
  // Delegated groups by who holds the task; a project page groups by section
  // (unsectioned to-dos first, in the top area).
  const grouped = view === "anytime" || view === "someday";
  const groups = useMemo<TaskGroup[]>(() => {
    if (inProject) {
      const unsectioned = tasks.filter((t) => !t.sectionId);
      const known = new Set(projectSections.map((s) => s.id));
      // A section deleted in another tab would strand its to-dos; show them in
      // the top area rather than nowhere.
      const orphans = tasks.filter((t) => t.sectionId && !known.has(t.sectionId));
      const top = [...unsectioned, ...orphans].sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
      return [
        // Kept even when empty so the page has somewhere to drop a to-do that
        // belongs to no section, and so New has a landing spot.
        { key: "loose", heading: null, href: null, tasks: top },
        // Sections show empty too — you often make one before filling it.
        ...projectSections.map((section) => ({
          key: section.id,
          heading: section.name,
          href: null,
          section,
          tasks: tasks.filter((t) => t.sectionId === section.id),
        })),
      ];
    }
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
  }, [
    grouped,
    inProject,
    projectSections,
    view,
    tasks,
    members,
    projects,
    viewedEmail,
    selfEmail,
  ]);

  // Selection. Plain click selects one; shift extends a range from the last
  // anchor through the visible order; cmd/ctrl toggles membership. Folded
  // sections drop out — j/k and shift-ranges only walk what's on screen.
  const visibleOrder = useMemo(
    () =>
      groups.flatMap((g) =>
        g.section && collapsedSections.has(g.section.id)
          ? []
          : g.tasks.map((t) => t.id)
      ),
    [groups, collapsedSections]
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
    // Inside a project the draft also joins the section it lands in; summoned
    // from the header (no `after`) it opens in the unsectioned top area.
    const sectionId = inProject ? (after?.sectionId ?? null) : null;
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
      sectionId,
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
        sectionId,
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

  // ============================================================
  // Sections (project pages only)
  // ============================================================

  const toggleCollapsed = (sectionId: string) => {
    const folding = !collapsedSections.has(sectionId);
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      writeCollapsedSections(next);
      return next;
    });
    if (!folding) return;
    // Folding a section takes its rows off screen, so nothing inside it stays
    // selected or open — otherwise `e`/Delete would act on invisible to-dos.
    const hidden = new Set(
      tasks.filter((t) => t.sectionId === sectionId).map((t) => t.id)
    );
    setSelectedIds((prev) => {
      if (![...prev].some((id) => hidden.has(id))) return prev;
      return new Set([...prev].filter((id) => !hidden.has(id)));
    });
    if (anchorId.current && hidden.has(anchorId.current)) anchorId.current = null;
    setExpandedId((prev) => (prev && hidden.has(prev) ? null : prev));
  };

  /**
   * "Section": an untitled heading appended at the *bottom* of the project,
   * opened for naming in place. Bottom, not top (unlike a new to-do), because
   * sections accrete as a project grows — a new one shouldn't shove itself
   * above work that's already organized. It stays local until the name is
   * committed, so an abandoned one leaves nothing behind.
   */
  const handleInlineNewSection = () => {
    if (context.mode !== "project") return;
    const temp: TodoSection = {
      id: `temp-${crypto.randomUUID()}`,
      projectId: context.projectId,
      name: "",
      sortOrder:
        projectSections.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1,
    };
    setSections((prev) => [...prev, temp]);
    setEditingSectionId(temp.id);
    setExpandedId(null);
    setOpenMenu(null);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-section-id="${temp.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };
  const inlineNewSectionRef = useRef(handleInlineNewSection);
  inlineNewSectionRef.current = handleInlineNewSection;
  useEffect(() => onInlineNewSection(() => inlineNewSectionRef.current()), []);

  const commitSectionName = (section: TodoSection, raw: string) => {
    const name = raw.trim();
    setEditingSectionId(null);
    const isDraft = section.id.startsWith("temp-");
    if (!name) {
      // An empty name discards a new section rather than leaving an untitled
      // heading; on an existing one it's simply not committed.
      if (isDraft) setSections((prev) => prev.filter((s) => s.id !== section.id));
      return;
    }
    if (name === section.name) return;
    patchSection(section.id, { name });
    if (!isDraft) {
      run(renameSection(section.id, name));
      return;
    }
    run(
      createSection(section.projectId, name)
        .then((created) => {
          setSections((prev) =>
            prev.map((s) =>
              s.id === section.id
                ? { ...s, id: created.id, name, sortOrder: created.sortOrder }
                : s
            )
          );
        })
        .catch(() =>
          setSections((prev) => prev.filter((s) => s.id !== section.id))
        )
    );
  };

  const cancelSectionEdit = (section: TodoSection) => {
    setEditingSectionId(null);
    if (section.id.startsWith("temp-")) {
      setSections((prev) => prev.filter((s) => s.id !== section.id));
    }
  };

  /**
   * Deleting a section keeps its to-dos: they merge upward into the preceding
   * section (or the top area). No prompt — a heading is a label, not a
   * container of value, and the toast puts both back.
   */
  const handleDeleteSection = (section: TodoSection) => {
    if (section.id.startsWith("temp-")) {
      cancelSectionEdit(section);
      return;
    }
    const index = projectSections.findIndex((s) => s.id === section.id);
    const mergeInto = index > 0 ? projectSections[index - 1].id : null;
    const movedIds = tasks
      .filter((t) => t.sectionId === section.id)
      .map((t) => t.id);

    setSections((prev) => prev.filter((s) => s.id !== section.id));
    setTasks((prev) =>
      prev.map((t) =>
        t.sectionId === section.id ? { ...t, sectionId: mergeInto } : t
      )
    );
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({
      kind: "section",
      label: `Deleted “${section.name}”`,
      section,
      taskIds: movedIds,
    });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    run(deleteSection(section.id));
  };

  // ============================================================
  // Project-page drag: one context, many sections
  // ============================================================
  //
  // A project page runs a *single* DndContext over both the section headings
  // and every to-do row, because dnd-kit can only move an item between
  // droppables that share a context — with a context per group (what the view
  // pages still use) a row dragged into another section finds nothing to drop
  // onto. Sections keep their own SortableContext, each group's rows another;
  // the collision filter below keeps the two kinds from seeing each other.

  const sectionIdSet = useMemo(
    () => new Set(projectSections.map((s) => s.id)),
    [projectSections]
  );

  /** Each group's own droppable, wrapping its rows. */
  const CONTAINER_PREFIX = "container:";
  const containerId = (key: string) => `${CONTAINER_PREFIX}${key}`;
  const isContainerId = (id: string) => id.startsWith(CONTAINER_PREFIX);

  /** Which section an `over` id belongs to (null = the top area). */
  const overSection = (
    overId: string
  ): { sectionId: string | null } | null => {
    if (overId.startsWith(CONTAINER_PREFIX)) {
      const key = overId.slice(CONTAINER_PREFIX.length);
      return { sectionId: key === "loose" ? null : key };
    }
    const task = tasks.find((t) => t.id === overId);
    return task ? { sectionId: task.sectionId ?? null } : null;
  };

  const groupTasksOf = (sectionId: string | null) =>
    tasks
      .filter((t) => (t.sectionId ?? null) === sectionId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  // Where the dragged row started, so a cancel can put it back and the drop
  // knows whether it actually changed section.
  const dragOriginRef = useRef<{
    taskId: string;
    sectionId: string | null;
    sortOrder: number;
  } | null>(null);

  const revertDraggedTask = (origin = dragOriginRef.current) => {
    dragOriginRef.current = null;
    if (!origin) return;
    patchLocally(origin.taskId, {
      sectionId: origin.sectionId,
      sortOrder: origin.sortOrder,
    });
    setTasks((prev) => [...prev].sort((a, b) => a.sortOrder - b.sortOrder));
  };

  /**
   * Two kinds of drag share this context, so first split the droppables by
   * kind — a heading only ever lands among headings.
   *
   * For a to-do it's the standard two-pass answer to "which group, then where
   * in it": find the group the pointer is actually inside, then take the
   * nearest row *within that group*. Asking for the nearest row outright would
   * pick one in a neighbouring section whenever you hover empty space, and
   * letting the group boxes compete with rows directly would swallow them —
   * you could pick a section but never a position inside it.
   */
  const projectCollision: CollisionDetection = (args) => {
    if (sectionIdSet.has(String(args.active.id))) {
      return closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          sectionIdSet.has(String(c.id))
        ),
      });
    }
    const rows = args.droppableContainers.filter(
      (c) => !sectionIdSet.has(String(c.id)) && !isContainerId(String(c.id))
    );
    const boxes = args.droppableContainers.filter((c) =>
      isContainerId(String(c.id))
    );

    const inside = pointerWithin({ ...args, droppableContainers: boxes })[0];
    if (inside) {
      const key = String(inside.id).slice(CONTAINER_PREFIX.length);
      const sectionId = key === "loose" ? null : key;
      const siblings = rows.filter((c) => {
        const task = tasks.find((t) => t.id === String(c.id));
        return task && (task.sectionId ?? null) === sectionId;
      });
      const nearest =
        siblings.length > 0
          ? closestCorners({ ...args, droppableContainers: siblings })
          : [];
      // An empty group (or one holding only the row being dragged) answers
      // with itself, so it stays a target the whole way through the drop.
      return nearest.length > 0 ? nearest : [{ id: inside.id }];
    }
    // In the gutters — between groups, or over a heading. Nearest row wins.
    return closestCorners({ ...args, droppableContainers: rows });
  };

  /**
   * Crossing into another section mid-drag: relocate the row there and then,
   * so the gap opens where it will land. The exact index is settled on drop —
   * this only has to put it in the right group.
   */
  const handleProjectDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    if (sectionIdSet.has(activeId)) return;
    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;
    const dest = overSection(String(over.id));
    if (!dest || (activeTask.sectionId ?? null) === dest.sectionId) return;

    const destTasks = groupTasksOf(dest.sectionId).filter(
      (t) => t.id !== activeId
    );
    const overIdx = destTasks.findIndex((t) => t.id === String(over.id));
    const before = overIdx < 0 ? (destTasks[destTasks.length - 1] ?? null) : (destTasks[overIdx - 1] ?? null);
    const after = overIdx < 0 ? null : destTasks[overIdx];
    const sortOrder = needsRenormalize(before?.sortOrder, after?.sortOrder)
      ? (destTasks[destTasks.length - 1]?.sortOrder ?? 0) + 1
      : sortBetween(before?.sortOrder ?? null, after?.sortOrder ?? null);

    patchLocally(activeId, { sectionId: dest.sectionId, sortOrder });
    setTasks((prev) => [...prev].sort((a, b) => a.sortOrder - b.sortOrder));
  };

  const handleProjectDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    // Same context, two kinds of drag: a heading reorders its siblings.
    if (sectionIdSet.has(activeId)) {
      handleSectionDragEnd(event);
      return;
    }

    const { target, dragTasks } = settleDrag();
    const origin = dragOriginRef.current;

    // A drop on a heading or a sidebar item wins over the in-list position —
    // rewind whatever dragOver did so the drop handler starts from the truth.
    if (target && dragTasks.length > 0) {
      revertDraggedTask(origin);
      performSidebarDrop(target, dragTasks);
      return;
    }
    dragOriginRef.current = null;

    // Released over nothing (or over a group that vanished mid-drag): put the
    // row back where it started rather than leaving dragOver's guess.
    const over = event.over;
    const dest = over ? overSection(String(over.id)) : null;
    if (!over || !dest) {
      revertDraggedTask(origin);
      return;
    }
    const changedSection = !origin || origin.sectionId !== dest.sectionId;
    if (String(over.id) === activeId && !changedSection) return;

    const group = groupTasksOf(dest.sectionId);
    const oldIndex = group.findIndex((t) => t.id === activeId);
    if (oldIndex < 0) return;
    const overIndex = group.findIndex((t) => t.id === String(over.id));
    const newIndex = overIndex < 0 ? group.length - 1 : overIndex;
    const next = arrayMove(group, oldIndex, newIndex);
    const prevOrder = next[newIndex - 1]?.sortOrder ?? null;
    const nextOrder = next[newIndex + 1]?.sortOrder ?? null;

    if (needsRenormalize(prevOrder, nextOrder)) {
      next.forEach((t, i) => patchLocally(t.id, { sortOrder: i + 1 }));
      setTasks((prev) => [...prev].sort((a, b) => a.sortOrder - b.sortOrder));
      if (changedSection) {
        run(setTaskSection(activeId, dest.sectionId, newIndex + 1));
      }
      run(renormalizeTaskOrder(next.map((t) => t.id)));
    } else {
      const sortOrder = sortBetween(prevOrder, nextOrder);
      patchLocally(activeId, { sortOrder });
      setTasks((prev) => [...prev].sort((a, b) => a.sortOrder - b.sortOrder));
      run(
        changedSection
          ? setTaskSection(activeId, dest.sectionId, sortOrder)
          : setTaskSortOrder(activeId, sortOrder)
      );
    }

    // The rest of a multi-selection follows into the new section, appended —
    // only the row under the pointer gets an exact position.
    if (changedSection && dragTasks.length > 1) {
      dragTasks
        .filter((t) => t.id !== activeId)
        .forEach((t) => handlers.onSetSection(t, dest.sectionId));
    }
  };

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projectSections.findIndex((s) => s.id === active.id);
    const newIndex = projectSections.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(projectSections, oldIndex, newIndex);
    const prevOrder = next[newIndex - 1]?.sortOrder ?? null;
    const nextOrder = next[newIndex + 1]?.sortOrder ?? null;
    if (needsRenormalize(prevOrder, nextOrder)) {
      setSections((prev) =>
        prev.map((s) => {
          const i = next.findIndex((n) => n.id === s.id);
          return i < 0 ? s : { ...s, sortOrder: i + 1 };
        })
      );
      run(renormalizeSectionOrder(next.map((s) => s.id)));
      return;
    }
    const sortOrder = sortBetween(prevOrder, nextOrder);
    patchSection(String(active.id), { sortOrder });
    run(setSectionSortOrder(String(active.id), sortOrder));
  };

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
  // editor), m/a summon the project/assignee
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
        if (!undo) return;
        e.preventDefault();
        handleUndo();
        return;
      }
      case "C": {
        // ⇧C: a new section, the project page's other create key. (`c` stays
        // the to-do — the action you take dozens of times a day.)
        if (!inProject || e.repeat) return;
        e.preventDefault();
        handleInlineNewSection();
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
    setSection: (list, sectionId) =>
      list.forEach((t) => handlers.onSetSection(t, sectionId)),
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
    if (target.kind === "section") {
      // Same membership rule as a project drop (the section carries one), and
      // no-op when everything dragged already lives there.
      const section = sections.find((s) => s.id === target.sectionId);
      if (!section) return false;
      const project = projects.find((p) => p.id === section.projectId);
      return (
        !!project &&
        dragTasks.every((t) => project.memberEmails.includes(t.assigneeEmail)) &&
        dragTasks.some((t) => t.sectionId !== section.id)
      );
    }
    if (target.kind === "project") {
      const project = projects.find((p) => p.id === target.projectId);
      return (
        !!project &&
        dragTasks.every((t) => project.memberEmails.includes(t.assigneeEmail)) &&
        // Re-filing into the project a to-do is already in means "out of its
        // section" — only offer that when there's a section to leave.
        (project.id !== activeProjectId ||
          dragTasks.some((t) => t.sectionId !== null))
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
    // Where it started, so a cancel can put it back and the drop can tell
    // whether it crossed into another section (project pages only).
    dragOriginRef.current = {
      taskId: task.id,
      sectionId: task.sectionId,
      sortOrder: task.sortOrder,
    };
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
    setActiveDragId(task.id);
  };

  const handleDragMove = (_event: DragMoveEvent) => {
    const pointer = pointerRef.current;
    // A section heading is dragging (project pages share one context) — it has
    // no to-dos riding it, so there's nothing the sidebar could accept.
    if (!pointer || draggingTasksRef.current.length === 0) return;
    const hit = dropTargetAtPoint(pointer.x, pointer.y);
    const valid =
      hit && dropEligible(hit.key, draggingTasksRef.current) ? hit : null;
    if (dropTargetRef.current?.key !== valid?.key) {
      emitDropTarget(valid?.key ?? null);
      // Section headings live in this tree, so they highlight from state
      // rather than the window event the sidebar listens to.
      setHoverDropKey(valid?.key ?? null);
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
    setActiveDragId(null);
    setHoverDropKey(null);
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
    if (parsed.kind === "section") {
      dragTasks.forEach((t) => handlers.onSetSection(t, parsed.sectionId));
      return;
    }
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

  // Looked up rather than captured at drag start — dragOver rewrites the row's
  // section as it crosses, and the overlay should show the current one.
  const activeDragTask = activeDragId
    ? (tasks.find((t) => t.id === activeDragId) ?? null)
    : null;

  const emptyKey = inProject ? "project" : (view as string);
  const empty = EMPTY_STATES[emptyKey] ?? EMPTY_STATES.project;
  const EmptyIcon = empty.icon;

  return (
    // data-inline-new tells the global quick-add host that `c` is taken
    // here (quick-add.tsx checks for it before opening the modal).
    <div className="space-y-3" data-inline-new={canInlineNew ? "" : undefined}>
      {tasks.length === 0 && projectSections.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <EmptyIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{empty.text}</p>
        </div>
      ) : (
        // On a project page every group shares ONE context (headings and rows
        // both), so a to-do can be dragged from one section into another and
        // dropped between two rows. The view pages keep a context per group —
        // nothing crosses groups there.
        <ProjectDragContext
          enabled={inProject}
          sensors={sensors}
          collisionDetection={projectCollision}
          sectionIds={projectSections.map((s) => s.id)}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleProjectDragOver}
          onDragCancel={() => {
            settleDrag();
            revertDraggedTask();
          }}
          onDragEnd={handleProjectDragEnd}
          overlay={
            // Follows the pointer exactly; the row left behind in the list is
            // the gap showing where it will land.
            <DragOverlay dropAnimation={null}>
              {activeDragTask && (
                <div className="relative cursor-grabbing rounded-lg bg-card shadow-lg ring-1 ring-foreground/10">
                  <TaskRow
                    task={activeDragTask}
                    context={context}
                    members={members}
                    projects={projects}
                    sections={sections}
                    attachments={attachments[activeDragTask.id] ?? []}
                    uploading={[]}
                    viewedEmail={viewedEmail}
                    completing={false}
                    selected
                    expanded={false}
                    openMenu={null}
                    onMenuOpenChange={NOOP}
                    onSelect={NOOP}
                    onOpen={NOOP}
                    onClose={NOOP}
                    handlers={handlers}
                  />
                  {dragCount > 1 && (
                    <span className="pointer-events-none absolute -top-2 -right-2 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium tabular-nums text-primary-foreground shadow-sm">
                      {dragCount}
                    </span>
                  )}
                </div>
              )}
            </DragOverlay>
          }
        >
        <div className="space-y-5">
          {groups.map((group) => {
            const section = group.section;
            const collapsed = !!section && collapsedSections.has(section.id);
            const heading = (handle?: SectionDragHandle) =>
              section ? (
                <SectionHeader
                  id={section.id}
                  name={section.name}
                  count={group.tasks.length}
                  collapsed={collapsed}
                  editing={editingSectionId === section.id}
                  dropActive={hoverDropKey === sectionDropKey(section.id)}
                  dragHandle={handle}
                  onToggleCollapse={() => toggleCollapsed(section.id)}
                  onStartRename={() => setEditingSectionId(section.id)}
                  onCommitName={(name) => commitSectionName(section, name)}
                  onCancelEdit={() => cancelSectionEdit(section)}
                  onDelete={() => handleDeleteSection(section)}
                />
              ) : (
                group.heading && (
                  <Link
                    href={group.href!}
                    className="mb-1 flex items-center gap-1.5 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <CircleDashed className="size-3.5 text-primary/70" />
                    {group.heading}
                  </Link>
                )
              );
            const rows = (
                  <div className="space-y-0.5">
                    {group.tasks.map((task) => (
                      <SortableTaskRow
                        key={stableKey(task.id)}
                        id={task.id}
                        dragCount={dragCount}
                        removing={removingIds.has(task.id)}
                        overlaid={inProject}
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
                          sections={sections}
                          onTargetTask={handleContextTarget}
                          actions={menuActions}
                        >
                          <TaskRow
                            task={task}
                            context={context}
                            members={members}
                            projects={projects}
                            sections={sections}
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
            );
            const body = collapsed ? null : inProject ? (
              // Project mode: the rows join the page-wide context above, and
              // an *empty* group gets its own droppable so it's still a target
              // (a container droppable over a group that has rows would
              // swallow them and make "between these two" impossible).
              <SortableContext
                items={group.tasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppableGroup
                  id={containerId(group.key)}
                  empty={group.tasks.length === 0}
                  dragging={dragCount > 0}
                >
                  {rows}
                </DroppableGroup>
              </SortableContext>
            ) : (
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
                  {rows}
                </SortableContext>
              </DndContext>
            );
            // A section is the sortable unit, so the whole block — heading and
            // to-dos — travels with the drag; the heading is only the handle.
            return section ? (
              <SortableSection
                key={group.key}
                id={section.id}
                disabled={editingSectionId === section.id}
              >
                {(handle) => (
                  <>
                    {heading(handle)}
                    {body}
                  </>
                )}
              </SortableSection>
            ) : (
              <section key={group.key}>
                {heading()}
                {body}
              </section>
            );
          })}
        </div>
        </ProjectDragContext>
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

      {undo && (
        <ToastViewport>
          <Toast className="flex items-center justify-between gap-3">
            <span className="truncate text-muted-foreground">{undo.label}</span>
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

/**
 * One reorderable section block — the whole thing moves, so the to-dos travel
 * with their heading, and the heading the child renders is the drag handle.
 *
 * The transform deliberately does NOT go on the `<section>`. That element is
 * also dnd-kit's droppable, and droppables are re-measured *during* a drag: a
 * translated node reports a rect that follows the pointer, so the dragged
 * section stayed its own nearest collision and `over` never resolved to a
 * neighbour — every drop was a no-op that snapped back. Keeping the measured
 * node still and moving an inner wrapper leaves the drop rects where they
 * actually are; CSS transforms don't affect the parent's layout box.
 */
function SortableSection({
  id,
  disabled,
  children,
}: {
  id: string;
  /** True while the name is being edited — text selection isn't a drag. */
  disabled: boolean;
  children: (handle: SectionDragHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <section
      ref={setNodeRef}
      // Anchor for the new-section scrollIntoView.
      data-section-id={id}
      className="relative"
    >
      <div
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(isDragging && "relative z-10 opacity-70")}
      >
        {children({
          ref: setActivatorNodeRef,
          props: disabled ? attributes : { ...attributes, ...listeners },
        })}
      </div>
    </section>
  );
}

/**
 * The project page's single drag context, covering the section headings and
 * every to-do row at once — that shared registry is what lets a row cross from
 * one section into another. Rendered transparently (children only) on the view
 * pages, which keep a context per group.
 */
function ProjectDragContext({
  enabled,
  sensors,
  collisionDetection,
  sectionIds,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragCancel,
  onDragEnd,
  overlay,
  children,
}: {
  enabled: boolean;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: CollisionDetection;
  sectionIds: string[];
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  /** The DragOverlay — must live inside the context to receive the drag. */
  overlay: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <DndContext
      id="todos-project"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
    >
      {/* Headings sort among themselves; each group's rows have their own
          SortableContext nested inside. */}
      <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      {overlay}
    </DndContext>
  );
}

/**
 * The droppable box around a group's rows. Always registered — not just while
 * the group is empty: a box that unregisters the moment a row enters it pulls
 * the target out from under the drop, and the row snaps back. The collision
 * strategy (projectCollision) is what keeps it from swallowing its own rows.
 *
 * An empty group keeps a row-sized landing strip that only *paints* during a
 * drag. It has to hold its height at rest too: appearing on drag start would
 * push every row below it down before dnd-kit measures the grabbed one, and
 * the row would ride a good half-inch below the pointer for the whole drag.
 */
function DroppableGroup({
  id,
  empty,
  dragging,
  children,
}: {
  id: string;
  empty: boolean;
  dragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef}>
      {children}
      {empty && (
        <div
          aria-hidden={!dragging}
          className={cn(
            "flex h-9 items-center justify-center rounded-md border border-dashed text-xs transition-colors",
            !dragging
              ? "border-transparent text-transparent"
              : isOver
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground"
          )}
        >
          Drop here
        </div>
      )}
    </div>
  );
}

function SortableTaskRow({
  id,
  dragCount,
  removing = false,
  overlaid = false,
  children,
}: {
  id: string;
  /** Size of the drag set — badges the floating row when > 1. */
  dragCount: number;
  /** Phase two of check-off: collapse the row so the list closes around it. */
  removing?: boolean;
  /** A DragOverlay is drawing this row while it's dragged (project pages), so
   * what's left here is the gap it will drop into: faded, and *not* translated
   * — a second copy sliding under the pointer would read as a glitch. */
  overlaid?: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const placeheld = overlaid && isDragging;
  return (
    <div
      ref={setNodeRef}
      // Anchor for the keyboard selection's scrollIntoView.
      data-task-id={id}
      style={{
        transform: placeheld ? undefined : CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "relative",
        isDragging && (placeheld ? "opacity-30" : "z-10 opacity-70")
      )}
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
      {isDragging && !overlaid && dragCount > 1 && (
        <span className="pointer-events-none absolute -top-2 -right-2 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium tabular-nums text-primary-foreground shadow-sm">
          {dragCount}
        </span>
      )}
    </div>
  );
}
