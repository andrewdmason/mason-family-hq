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

/** The expanded editor's summonable menus (keyboard `s` / `m` / `a`). */
export type TaskRowMenu = "snooze" | "project" | "assignee";

export type TaskRowHandlers = {
  onComplete: (task: TodoTask) => void;
  onDelete: (task: TodoTask) => void;
  onSnooze: (task: TodoTask, when: Date) => void;
  onWake: (task: TodoTask) => void;
  onSetBucket: (task: TodoTask, bucket: TodoBucket) => void;
  onReassign: (task: TodoTask, email: string) => void;
  /** Live (every keystroke) — keeps list state current while editing. */
  onTitleChange: (task: TodoTask, title: string) => void;
  /** Commit (blur/Enter/close) — persists to the server. */
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
  openMenu,
  onMenuOpenChange,
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
  /** Which expanded-editor menu is keyboard-summoned open (if any). */
  openMenu: TaskRowMenu | null;
  onMenuOpenChange: (menu: TaskRowMenu, open: boolean) => void;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  handlers: TaskRowHandlers;
}) {
  const [dragOver, setDragOver] = useState(false);
  const creator = members.find((m) => m.email === task.creatorEmail);
  const assignee = members.find((m) => m.email === task.assigneeEmail);
  const inProjectMode = context.mode === "project";
  // Delegated groups by assignee and is creator==viewer by definition, so
  // the "from X" chip would be pure noise there.
  const inDelegated = context.mode === "view" && context.view === "delegated";
  const fromSomeoneElse =
    task.creatorEmail !== task.assigneeEmail && !inDelegated;
  // Status lenses (snoozed, delegated) and project pages show where the task
  // sits: its wake time, or its bucket.
  const showSnoozeChip =
    !!task.snoozedUntil &&
    (inProjectMode ||
      inDelegated ||
      (context.mode === "view" && context.view === "snoozed"));
  const showBucketChip =
    (inProjectMode || inDelegated) &&
    !task.snoozedUntil &&
    task.bucket !== "anytime";
  const BucketIcon = bucketIcon(task.bucket);
  const hasNotes = !!task.notesHtml;

  return (
    <div
      // Marks the row (incl. its expanded editor) for the background-click
      // deselect listener in TaskList.
      data-task-row=""
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
          // Like Things: no hover wash — selection is the only row highlight.
          "group flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 transition-opacity duration-500",
          !expanded && selected && "bg-accent/70",
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
          <TitleInput
            task={task}
            onChange={(title) => handlers.onTitleChange(task, title)}
            onCommit={(title) => handlers.onRenameTitle(task, title)}
          />
        ) : (
          <>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm text-foreground transition-all select-none",
                !task.title.trim() && "text-muted-foreground/60",
                completing && "text-muted-foreground line-through"
              )}
            >
              {task.title.trim() || "New To-Do"}
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
            {showBucketChip && (
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
          openMenu={openMenu}
          onMenuOpenChange={onMenuOpenChange}
          handlers={handlers}
        />
      )}
    </div>
  );
}

/**
 * The opened task's title editor: replaces the static row title, focused with
 * the cursor parked at the end of the name. Fully controlled — every
 * keystroke flows into the list state (so closing the editor any way, even
 * Escape, never loses typed text); the server commit flushes on blur, Enter,
 * and unmount.
 */
function TitleInput({
  task,
  onChange,
  onCommit,
}: {
  task: TodoTask;
  onChange: (title: string) => void;
  onCommit: (title: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The last server-committed value; flush only when it changed.
  const committedRef = useRef(task.title);
  const latestRef = useRef(task.title);
  latestRef.current = task.title;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // On open: focus with the caret at the end of the name. On close (unmount):
  // flush an uncommitted title.
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    return () => {
      if (latestRef.current !== committedRef.current) {
        onCommitRef.current(latestRef.current);
      }
    };
  }, []);

  const flush = () => {
    if (task.title !== committedRef.current) {
      committedRef.current = task.title;
      onCommit(task.title);
    }
  };

  return (
    <input
      ref={inputRef}
      value={task.title}
      onChange={(e) => onChange(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      placeholder="New To-Do"
      className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
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
  openMenu,
  onMenuOpenChange,
  handlers,
}: {
  task: TodoTask;
  context: TaskRowContext;
  members: TodoMember[];
  projects: TodoProject[];
  attachments: TodoTaskAttachment[];
  uploading: UploadingAttachment[];
  openMenu: TaskRowMenu | null;
  onMenuOpenChange: (menu: TaskRowMenu, open: boolean) => void;
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
        {/* When: one segmented control — the four buckets plus Snooze, which
            is the same dimension ("when does this surface?") and opens its
            preset picker in place. Bucket moves clear any snooze. */}
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
          <SnoozeMenu
            label={task.snoozedUntil ? formatWake(task.snoozedUntil) : "Snooze"}
            triggerClassName={cn(
              "gap-1.5 rounded-md px-2 py-1 text-xs",
              task.snoozedUntil
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-transparent hover:text-foreground"
            )}
            onSnooze={(when) => handlers.onSnooze(task, when)}
            open={openMenu === "snooze"}
            onOpenChange={(open) => onMenuOpenChange("snooze", open)}
          />
        </div>

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
          open={openMenu === "project"}
          onOpenChange={(open) => onMenuOpenChange("project", open)}
        />

        <AssigneePicker
          members={assignableMembers}
          assigneeEmail={task.assigneeEmail}
          onReassign={(email) => handlers.onReassign(task, email)}
          open={openMenu === "assignee"}
          onOpenChange={(open) => onMenuOpenChange("assignee", open)}
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
  open,
  onOpenChange,
}: {
  task: TodoTask;
  projects: TodoProject[];
  onSetProject: (projectId: string | null) => void;
  /** Controlled open (the keyboard `m` summons it); omit for internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const current = projects.find((p) => p.id === task.projectId);
  const options = projects.filter((p) =>
    p.memberEmails.includes(task.assigneeEmail)
  );

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
    >
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
