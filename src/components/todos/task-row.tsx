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
import { WhenPicker } from "@/components/todos/when-picker";
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
  /** Back to the Inbox: clears project + snooze (un-triage). */
  onMoveToInbox: (task: TodoTask) => void;
  onSaveNotes: (task: TodoTask, html: string) => void;
  onAddFiles: (task: TodoTask, files: File[]) => void;
  onDeleteAttachment: (task: TodoTask, attachment: TodoTaskAttachment) => void;
};

/** Files from a drop/paste payload (empty when it's not a file payload). */
function payloadFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []);
}

/** Open/close animation length — keep in sync with the duration-200 classes. */
const EXPAND_MS = 200;

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
  onClose,
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
  /** Collapse the open editor (Enter in the title commits and closes). */
  onClose: () => void;
  handlers: TaskRowHandlers;
}) {
  const [dragOver, setDragOver] = useState(false);
  // Things animates open/close: the editor body grows from zero (the grid
  // 0fr→1fr trick, so the dynamic notes/attachments height needs no
  // measuring) while the card gains breathing room (margin) + its chrome.
  // `open` flips a frame after `expanded` so a row that mounts already
  // expanded (the inline-New draft) still starts from the collapsed state;
  // on close the editor stays mounted until the exit transition finishes.
  const [open, setOpen] = useState(false);
  const [editorMounted, setEditorMounted] = useState(expanded);
  useEffect(() => {
    if (expanded) {
      setEditorMounted(true);
      const raf = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    setOpen(false);
    const timer = setTimeout(() => setEditorMounted(false), EXPAND_MS);
    return () => clearTimeout(timer);
  }, [expanded]);
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
        "rounded-lg transition-all duration-200 ease-out",
        open && "my-3 bg-card shadow-sm ring-1 ring-foreground/10",
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
          // (`!open` so the selection wash crossfades with the card chrome;
          // opacity keeps its slow completing-fade, background matches the
          // 200ms open/close animation.)
          "group flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 [transition:opacity_500ms,background-color_200ms]",
          !open && selected && "bg-accent/70",
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
            onClose={onClose}
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

      {/* Always-rendered grid shell so the height animates both ways; the
          (heavy) editor itself only mounts while open or closing. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          {editorMounted && (
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
      </div>
    </div>
  );
}

/**
 * The opened task's title editor: replaces the static row title, focused with
 * the cursor parked at the end of the name. Fully controlled — every
 * keystroke flows into the list state (so closing the editor any way, even
 * Escape, never loses typed text); the server commit flushes on blur, Enter,
 * and unmount. Enter also collapses the task, like Things.
 */
function TitleInput({
  task,
  onChange,
  onCommit,
  onClose,
}: {
  task: TodoTask;
  onChange: (title: string) => void;
  onCommit: (title: string) => void;
  onClose: () => void;
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
        if (e.key === "Enter") {
          flush();
          onClose();
        }
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
        {/* When: one Things-style chip naming the current state, opening the
            unified picker (Today, snooze moments, Anytime, Someday, Inbox). */}
        <WhenPicker
          bucket={task.bucket}
          snoozedUntil={task.snoozedUntil}
          onSetBucket={(bucket) => handlers.onSetBucket(task, bucket)}
          onSnooze={(when) => handlers.onSnooze(task, when)}
          open={openMenu === "snooze"}
          onOpenChange={(open) => onMenuOpenChange("snooze", open)}
        />

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
          onMoveToInbox={() => handlers.onMoveToInbox(task)}
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
 * The task's location, Things' "Move" dimension: the Inbox (no project, no
 * decision), a project, or loose ("No project" — triaged but unfiled). Only
 * offers projects the task's assignee belongs to — the membership rule,
 * enforced at the picker. Inbox lives HERE, not in the When picker: a task
 * in a project can't be in the Inbox, so picking Inbox clears the project.
 */
function ProjectPicker({
  task,
  projects,
  onSetProject,
  onMoveToInbox,
  open,
  onOpenChange,
}: {
  task: TodoTask;
  projects: TodoProject[];
  onSetProject: (projectId: string | null) => void;
  onMoveToInbox: () => void;
  /** Controlled open (the keyboard `m` summons it); omit for internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const current = projects.find((p) => p.id === task.projectId);
  const options = projects.filter((p) =>
    p.memberEmails.includes(task.assigneeEmail)
  );
  const inInbox = !task.projectId && task.bucket === "inbox" && !task.snoozedUntil;

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
        {/* The chip stays the project's empty state even in the Inbox — the
            When chip already says Inbox, and twins read as a glitch. */}
        <CircleDashed className="size-4 text-primary/70" />
        {current?.name ?? "No project"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem
          onClick={() => {
            if (!inInbox) onMoveToInbox();
          }}
          className="gap-2"
        >
          <Inbox className="size-4 text-sky-700" />
          <span className="flex-1">Inbox</span>
          {inInbox && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
        {options.length > 0 && <DropdownMenuSeparator />}
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
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            if (task.projectId) onSetProject(null);
          }}
          className="gap-2 text-muted-foreground"
        >
          <span className="flex-1">No project</span>
          {!task.projectId && !inInbox && <Check className="size-4 text-primary" />}
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
