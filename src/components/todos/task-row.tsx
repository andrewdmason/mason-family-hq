"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  CircleDashed,
  FileText,
  Inbox,
  Layers,
  Moon,
  Paperclip,
  Star,
  Sun,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { AssigneePicker } from "@/components/todos/assignee-picker";
import { firstNameOf } from "@/components/todos/member-name";
import { SnoozeMenu } from "@/components/todos/snooze-menu";
import {
  TaskAttachments,
  type UploadingAttachment,
} from "@/components/todos/task-attachments";
import { TodoNotesEditor } from "@/components/todos/todo-notes-editor";
import type { TodoTaskAttachment } from "@/lib/todos/queries";
import { formatWake } from "@/lib/todos/snooze";
import type {
  TodoBucket,
  TodoMember,
  TodoProject,
  TodoTask,
  TodoView,
} from "@/lib/todos/types";
import { cn } from "@/lib/utils";

const BUCKET_OPTIONS: { bucket: TodoBucket; label: string; icon: typeof Star; iconClass: string }[] = [
  { bucket: "inbox", label: "Inbox", icon: Inbox, iconClass: "text-sky-700" },
  { bucket: "today", label: "Today", icon: Star, iconClass: "text-amber-500" },
  { bucket: "anytime", label: "Anytime", icon: Layers, iconClass: "text-teal-700" },
  { bucket: "someday", label: "Someday", icon: Archive, iconClass: "text-stone-500" },
];

export function bucketIcon(bucket: TodoBucket) {
  return BUCKET_OPTIONS.find((o) => o.bucket === bucket)!;
}

/** Where this row is rendered: a sidebar view or a project page. */
export type TaskRowContext =
  | { mode: "view"; view: TodoView }
  | { mode: "project"; projectId: string };

export type TaskRowHandlers = {
  onComplete: (task: TodoTask) => void;
  onDelete: (task: TodoTask) => void;
  onSnooze: (task: TodoTask, when: Date) => void;
  onWake: (task: TodoTask) => void;
  onSetBucket: (task: TodoTask, bucket: TodoBucket) => void;
  onReassign: (task: TodoTask, email: string) => void;
  onRenameTitle: (task: TodoTask, title: string) => void;
  onSetProject: (task: TodoTask, projectId: string | null) => void;
  onSaveNotes: (task: TodoTask, html: string) => void;
  onAddFiles: (task: TodoTask, files: File[]) => void;
  onDeleteAttachment: (task: TodoTask, attachment: TodoTaskAttachment) => void;
};

/** Files from a drop/paste payload (empty when it's not a file payload). */
function payloadFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []);
}

/**
 * One task, with Things' interaction model: a single click selects the row,
 * a double click opens it. Opened, the static title line is *replaced* by the
 * editable title (cursor at the end), with notes, attachments, and controls
 * beneath.
 */
export function TaskRow({
  task,
  context,
  members,
  projects,
  attachments,
  uploading,
  viewedEmail,
  completing,
  selected,
  expanded,
  onSelect,
  onOpen,
  handlers,
}: {
  task: TodoTask;
  context: TaskRowContext;
  members: TodoMember[];
  projects: TodoProject[];
  attachments: TodoTaskAttachment[];
  uploading: UploadingAttachment[];
  viewedEmail: string;
  completing: boolean;
  selected: boolean;
  expanded: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  handlers: TaskRowHandlers;
}) {
  const [dragOver, setDragOver] = useState(false);
  const creator = members.find((m) => m.email === task.creatorEmail);
  const assignee = members.find((m) => m.email === task.assigneeEmail);
  const fromSomeoneElse = task.creatorEmail !== task.assigneeEmail;
  const inProjectMode = context.mode === "project";
  const showSnoozeChip =
    !!task.snoozedUntil &&
    (inProjectMode || (context.mode === "view" && context.view === "snoozed"));
  const BucketIcon = bucketIcon(task.bucket);
  const hasNotes = !!task.notesHtml;

  return (
    <div
      className={cn(
        "rounded-lg transition-colors",
        expanded && "bg-card shadow-sm ring-1 ring-foreground/10",
        dragOver && "ring-2 ring-primary/50"
      )}
      // OS file drags attach straight onto the task — images and any other
      // file type (dnd-kit's pointer sensor never sees these, so row sorting
      // is unaffected).
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const files = payloadFiles(e.dataTransfer.files);
        if (files.length > 0) {
          e.preventDefault();
          handlers.onAddFiles(task, files);
        }
        setDragOver(false);
      }}
    >
      <div
        className={cn(
          "group flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 transition-opacity duration-500",
          !expanded && "hover:bg-accent/30",
          !expanded && selected && "bg-accent/60",
          completing && "opacity-40"
        )}
        onClick={expanded ? undefined : onSelect}
        onDoubleClick={expanded ? undefined : onOpen}
      >
        <TaskCheckbox
          checked={completing}
          onToggle={(e) => {
            e.stopPropagation();
            handlers.onComplete(task);
          }}
        />
        {expanded ? (
          // Open: the title becomes the editor — no duplicate line below.
          <TitleInput task={task} onRename={handlers.onRenameTitle} />
        ) : (
          <>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm text-foreground transition-all select-none",
                completing && "text-muted-foreground line-through"
              )}
            >
              {task.title}
            </span>
            {hasNotes && (
              <FileText className="size-3.5 shrink-0 text-muted-foreground/60" />
            )}
            {attachments.length > 0 && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground/60">
                <Paperclip className="size-3.5" />
                {attachments.length}
              </span>
            )}
            {fromSomeoneElse && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                from {firstNameOf(creator)}
              </span>
            )}
            {inProjectMode && task.assigneeEmail !== viewedEmail && (
              <span
                className="shrink-0"
                title={assignee?.name ?? task.assigneeEmail}
              >
                <MemberAvatar name={assignee?.name} size="xs" />
              </span>
            )}
            {inProjectMode && !task.snoozedUntil && task.bucket !== "anytime" && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <BucketIcon.icon className={cn("size-3", BucketIcon.iconClass)} />
                {BucketIcon.label}
              </span>
            )}
            {showSnoozeChip && task.snoozedUntil && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-700">
                <Moon className="size-3" />
                {formatWake(task.snoozedUntil)}
              </span>
            )}
          </>
        )}
      </div>

      {expanded && (
        <ExpandedEditor
          task={task}
          context={context}
          members={members}
          projects={projects}
          attachments={attachments}
          uploading={uploading}
          handlers={handlers}
        />
      )}
    </div>
  );
}

/** The opened task's title editor: replaces the static row title, focused
 * with the cursor parked at the end of the name. */
function TitleInput({
  task,
  onRename,
}: {
  task: TodoTask;
  onRename: (task: TodoTask, title: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTitle(task.title), [task.title]);

  // On open: focus with the caret at the end of the name.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const saveTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) onRename(task, trimmed);
    else setTitle(task.title);
  };

  return (
    <input
      ref={inputRef}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={saveTitle}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setTitle(task.title);
      }}
      className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none"
      aria-label="Task title"
    />
  );
}

function ExpandedEditor({
  task,
  context,
  members,
  projects,
  attachments,
  uploading,
  handlers,
}: {
  task: TodoTask;
  context: TaskRowContext;
  members: TodoMember[];
  projects: TodoProject[];
  attachments: TodoTaskAttachment[];
  uploading: UploadingAttachment[];
  handlers: TaskRowHandlers;
}) {
  // Membership = the assignable set: inside a project, only its members.
  const project = projects.find((p) => p.id === task.projectId);
  const assignableMembers = project
    ? members.filter((m) => project.memberEmails.includes(m.email))
    : members;

  return (
    <div
      // Left padding lines the body up under the title text (row padding +
      // checkbox + gap).
      className="space-y-3 pt-1 pr-3 pb-3 pl-9"
      // Pasting a screenshot (or any copied file) anywhere in the detail
      // attaches it; text pastes pass through to the focused input/editor.
      onPasteCapture={(e) => {
        const files = payloadFiles(e.clipboardData?.files);
        if (files.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          handlers.onAddFiles(task, files);
        }
      }}
    >
      <TodoNotesEditor
        key={task.id}
        initialHtml={task.notesHtml ?? ""}
        onSave={(html) => handlers.onSaveNotes(task, html)}
      />

      <TaskAttachments
        attachments={attachments}
        uploading={uploading}
        onAddFiles={(files) => handlers.onAddFiles(task, files)}
        onDelete={(attachment) => handlers.onDeleteAttachment(task, attachment)}
      />

      <div className="flex flex-wrap items-center gap-1">
        {/* When: bucket moves (these also clear any snooze) */}
        <div className="flex items-center rounded-lg border border-border/70 p-0.5">
          {BUCKET_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = task.bucket === option.bucket && !task.snoozedUntil;
            return (
              <button
                key={option.bucket}
                type="button"
                onClick={() => {
                  if (!active) handlers.onSetBucket(task, option.bucket);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
                  active
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className={cn("size-3.5", option.iconClass)} />
                {option.label}
              </button>
            );
          })}
        </div>

        <SnoozeMenu onSnooze={(when) => handlers.onSnooze(task, when)} />

        {context.mode === "view" && context.view === "snoozed" && (
          <button
            type="button"
            onClick={() => handlers.onWake(task)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <Sun className="size-4 text-amber-500" />
            Wake now
          </button>
        )}

        <ProjectPicker
          task={task}
          projects={projects}
          onSetProject={(projectId) => handlers.onSetProject(task, projectId)}
        />

        <AssigneePicker
          members={assignableMembers}
          assigneeEmail={task.assigneeEmail}
          onReassign={(email) => handlers.onReassign(task, email)}
        />

        <button
          type="button"
          onClick={() => handlers.onDelete(task)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete task"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Move a task into / out of a project. Only offers projects the task's
 * assignee belongs to — the membership rule, enforced at the picker.
 */
function ProjectPicker({
  task,
  projects,
  onSetProject,
}: {
  task: TodoTask;
  projects: TodoProject[];
  onSetProject: (projectId: string | null) => void;
}) {
  const current = projects.find((p) => p.id === task.projectId);
  const options = projects.filter((p) =>
    p.memberEmails.includes(task.assigneeEmail)
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          />
        }
      >
        <CircleDashed className="size-4 text-primary/70" />
        {current?.name ?? "No project"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {options.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => {
              if (project.id !== task.projectId) onSetProject(project.id);
            }}
            className="gap-2"
          >
            <CircleDashed className="size-4 text-primary/70" />
            <span className="flex-1 truncate">{project.name}</span>
            {project.id === task.projectId && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {options.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={() => {
            if (task.projectId) onSetProject(null);
          }}
          className="gap-2 text-muted-foreground"
        >
          <span className="flex-1">No project</span>
          {!task.projectId && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Things-style round-cornered checkbox that fills on completion. */
export function TaskCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={checked ? "Mark incomplete" : "Mark complete"}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/25 hover:border-primary/60"
      )}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}
