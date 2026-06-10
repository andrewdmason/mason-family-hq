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
import { Archive, CircleDashed, Inbox, Layers, Moon, Star } from "lucide-react";
import {
  completeTask,
  createTask,
  deleteTask,
  deleteTaskImage,
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
import { QuickEntry } from "@/components/todos/quick-entry";
import {
  TaskRow,
  type TaskRowContext,
  type TaskRowHandlers,
} from "@/components/todos/task-row";
import type { UploadingImage } from "@/components/todos/task-images";
import { Toast, ToastViewport } from "@/components/ui/toast";
import { isImageFile, uploadTaskImage } from "@/lib/todos/image-upload";
import { withAs } from "@/lib/todos/member-context";
import type { TodoTaskImage } from "@/lib/todos/queries";
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
  project: { icon: CircleDashed, text: "No tasks here yet. Add the first one above." },
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
  imagesByTask = {},
  viewedEmail,
  selfEmail,
}: {
  context: TaskRowContext;
  initialTasks: TodoTask[];
  members: TodoMember[];
  projects: TodoProject[];
  imagesByTask?: Record<string, TodoTaskImage[]>;
  viewedEmail: string;
  selfEmail: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [undoTask, setUndoTask] = useState<TodoTask | null>(null);
  const [images, setImages] = useState(imagesByTask);
  const [uploadingByTask, setUploadingByTask] = useState<
    Record<string, UploadingImage[]>
  >({});
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Server refresh is the source of truth (post-action reconciliation).
  useEffect(() => setTasks(initialTasks), [initialTasks]);
  useEffect(() => setImages(imagesByTask), [imagesByTask]);

  const inProject = context.mode === "project";
  const view: TodoView | null = context.mode === "view" ? context.view : null;

  const removeLocally = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setExpandedId((prev) => (prev === taskId ? null : prev));
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

  const handleCreate = (title: string) => {
    const bucket: TodoBucket = inProject
      ? "anytime"
      : view === "snoozed"
        ? "inbox"
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
      title,
      notesHtml: null,
      bucket,
      assigneeEmail,
      creatorEmail: selfEmail,
      projectId: inProject ? context.projectId : null,
      snoozedUntil: null,
      completedAt: null,
      completedByEmail: null,
      sortOrder: (tasks[tasks.length - 1]?.sortOrder ?? 0) + 1,
      assigneeSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    setTasks((prev) => [...prev, temp]);
    run(
      createTask({
        title,
        assigneeEmail,
        bucket,
        projectId: inProject ? context.projectId : null,
      })
        .then((created) =>
          setTasks((prev) => prev.map((t) => (t.id === temp.id ? created : t)))
        )
        .catch(() => removeLocally(temp.id))
    );
  };

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
      if (inProject || view === "snoozed") {
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
      if (inProject) patchLocally(task.id, { snoozedUntil: null, bucket: "today" });
      else removeLocally(task.id);
      run(clearSnooze(task.id));
    },
    onSetBucket: (task, bucket) => {
      if (inProject) patchLocally(task.id, { bucket, snoozedUntil: null });
      else if (view === "snoozed" || bucket !== view) removeLocally(task.id);
      run(setTaskBucket(task.id, bucket));
    },
    onReassign: (task, email) => {
      if (inProject) {
        patchLocally(task.id, { assigneeEmail: email });
      } else if (email !== viewedEmail) {
        removeLocally(task.id);
      } else {
        patchLocally(task.id, { assigneeEmail: email });
      }
      run(reassignTask(task.id, email));
    },
    onRenameTitle: (task, title) => {
      patchLocally(task.id, { title });
      run(updateTaskTitle(task.id, title));
    },
    onSetProject: (task, projectId) => {
      if (inProject && projectId !== context.projectId) removeLocally(task.id);
      else patchLocally(task.id, { projectId });
      run(setTaskProject(task.id, projectId));
    },
    onSaveNotes: (task, html) => {
      patchLocally(task.id, { notesHtml: html });
      run(updateTaskNotes(task.id, html));
    },
    onAddImages: (task, files) => {
      const imagesToUpload = files.filter(isImageFile);
      if (imagesToUpload.length === 0) return;
      const placeholders = imagesToUpload.map((file) => ({
        key: crypto.randomUUID(),
        objectUrl: URL.createObjectURL(file),
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
            await uploadTaskImage(task.id, placeholder.file);
          } finally {
            setUploadingByTask((prev) => ({
              ...prev,
              [task.id]: (prev[task.id] ?? []).filter(
                (u) => u.key !== placeholder.key
              ),
            }));
            URL.revokeObjectURL(placeholder.objectUrl);
          }
        })
      ).then(() => router.refresh());
    },
    onDeleteImage: (task, image) => {
      setImages((prev) => ({
        ...prev,
        [task.id]: (prev[task.id] ?? []).filter((i) => i.id !== image.id),
      }));
      run(deleteTaskImage(image.id));
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

  // Anytime and Someday group by project (loose tasks first), like Things.
  const grouped = view === "anytime" || view === "someday";
  const groups = useMemo<TaskGroup[]>(() => {
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
  }, [grouped, tasks, projects, viewedEmail, selfEmail]);

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
      {/* Bucket views capture via the global quick-add modal (`q` / the header
          button); the inline entry stays only on project pages, where it adds
          straight into the project. */}
      {inProject && (
        <QuickEntry placeholder="Add a to-do…" onCreate={handleCreate} />
      )}

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
                      <SortableTaskRow key={task.id} id={task.id}>
                        <TaskRow
                          task={task}
                          context={context}
                          members={members}
                          projects={projects}
                          images={images[task.id] ?? []}
                          uploading={uploadingByTask[task.id] ?? []}
                          viewedEmail={viewedEmail}
                          completing={completingIds.has(task.id)}
                          expanded={expandedId === task.id}
                          onToggleExpand={() =>
                            setExpandedId((prev) =>
                              prev === task.id ? null : task.id
                            )
                          }
                          handlers={handlers}
                        />
                      </SortableTaskRow>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </section>
          ))}
        </div>
      )}

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
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "z-10 opacity-70" : undefined}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
