"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { createTask } from "@/app/(todos)/todos/actions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { TodoNotesEditor } from "@/components/todos/todo-notes-editor";
import { WhenPicker } from "@/components/todos/when-picker";
import { isImageFile, uploadTaskAttachment } from "@/lib/todos/attachment-upload";
import type { TodoBucket, TodoMember, TodoTask } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

export type NewTaskDefaults = {
  assigneeEmail?: string;
  bucket?: TodoBucket;
};

type PendingFile = {
  key: string;
  file: File;
  /** Local preview for images; null for plain files. */
  objectUrl: string | null;
};

/**
 * Things-quick-entry-style capture: title with a decorative checkbox, rich
 * Tiptap notes beneath (same editor as the task detail), drag/paste
 * attachments queued until save, and a footer bar where Inbox/Today and the
 * assignee are compact dropdowns next to Cancel/Save. Summoned globally —
 * see quick-add.tsx.
 */
export function NewTaskModal({
  open,
  onOpenChange,
  members,
  selfEmail,
  defaults,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: TodoMember[];
  selfEmail: string;
  defaults?: NewTaskDefaults;
  onCreated: (task: TodoTask) => void;
}) {
  const [title, setTitle] = useState("");
  const [notesHtml, setNotesHtml] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [assignee, setAssignee] = useState(selfEmail);
  const [bucket, setBucket] = useState<TodoBucket>("inbox");
  const [snoozedUntil, setSnoozedUntil] = useState<Date | null>(null);
  // Controlled so ⇧⌘S can summon the When type-ahead while typing the title.
  const [whenOpen, setWhenOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Remounts the Tiptap editor so each summon starts blank.
  const [session, setSession] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  // Each summon starts fresh, seeded by the opener's context (e.g. the Todos
  // header button passes the viewed member and the current view's bucket).
  useEffect(() => {
    if (open) {
      setTitle("");
      setNotesHtml("");
      setPendingFiles((prev) => {
        prev.forEach((p) => p.objectUrl && URL.revokeObjectURL(p.objectUrl));
        return [];
      });
      setAssignee(defaults?.assigneeEmail ?? selfEmail);
      setBucket(defaults?.bucket ?? "inbox");
      setSnoozedUntil(null);
      setWhenOpen(false);
      setSession((s) => s + 1);
    }
  }, [open, defaults, selfEmail]);

  const assigneeMember = members.find((m) => m.email === assignee);

  const queueFiles = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles((prev) => [
      ...prev,
      ...files.map((file) => ({
        key: crypto.randomUUID(),
        file,
        objectUrl: isImageFile(file) ? URL.createObjectURL(file) : null,
      })),
    ]);
  };

  const removePending = (key: string) => {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
      return prev.filter((p) => p.key !== key);
    });
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const created = await createTask({
        title: trimmed,
        notesHtml: notesHtml || undefined,
        assigneeEmail: assignee,
        // A snoozed creation wakes into Today; the bucket rides along.
        bucket: snoozedUntil ? "today" : bucket,
        snoozedUntil: snoozedUntil?.toISOString(),
      });
      // Attachments upload after the row exists (storage paths are task-scoped).
      await Promise.allSettled(
        pendingFiles.map((p) => uploadTaskAttachment(created.id, p.file))
      );
      pendingFiles.forEach((p) => p.objectUrl && URL.revokeObjectURL(p.objectUrl));
      setPendingFiles([]);
      onOpenChange(false);
      onCreated(created);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden p-0 sm:max-w-md",
          dragOver && "ring-2 ring-primary/50"
        )}
        showCloseButton={false}
        onKeyDown={(e) => {
          // ⇧⌘S: hop from the title/notes into the When type-ahead.
          if (
            (e.metaKey || e.ctrlKey) &&
            e.shiftKey &&
            !e.altKey &&
            e.key.toLowerCase() === "s"
          ) {
            e.preventDefault();
            setWhenOpen(true);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) {
            e.preventDefault();
            queueFiles(files);
          }
          setDragOver(false);
        }}
        onPasteCapture={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            queueFiles(files);
          }
        }}
      >
        <DialogTitle className="sr-only">New to-do</DialogTitle>

        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-[18px] shrink-0 rounded-[5px] border border-foreground/25"
            />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="New To-Do"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
              aria-label="Task title"
            />
          </div>

          <div className="mt-1.5 max-h-56 overflow-y-auto pl-[28px]">
            <TodoNotesEditor
              key={session}
              initialHtml=""
              onChange={setNotesHtml}
            />
          </div>

          {pendingFiles.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[28px]">
              {pendingFiles.map((pending) =>
                pending.objectUrl ? (
                  <div key={pending.key} className="group/pending relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pending.objectUrl}
                      alt=""
                      className="h-14 w-14 rounded-lg border border-border object-cover"
                    />
                    <PendingRemove onClick={() => removePending(pending.key)} />
                  </div>
                ) : (
                  <span
                    key={pending.key}
                    className="group/pending relative inline-flex max-w-56 items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2.5 pl-2 text-xs text-foreground"
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{pending.file.name}</span>
                    <PendingRemove onClick={() => removePending(pending.key)} />
                  </span>
                )
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 border-t border-border/60 bg-muted/40 px-3 py-2.5">
          <WhenPicker
            bucket={bucket}
            snoozedUntil={snoozedUntil ? snoozedUntil.toISOString() : null}
            onSetBucket={(next) => {
              setBucket(next);
              setSnoozedUntil(null);
            }}
            onSnooze={(when) => setSnoozedUntil(when)}
            open={whenOpen}
            onOpenChange={setWhenOpen}
            triggerClassName="rounded-md bg-transparent px-2 py-1 hover:bg-accent/60"
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent/60"
                />
              }
            >
              <MemberAvatar name={assigneeMember?.name} size="xs" />
              {assigneeMember?.name?.split(/\s+/)[0] ?? assignee.split("@")[0]}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {members.map((member) => (
                <DropdownMenuItem
                  key={member.email}
                  onClick={() => setAssignee(member.email)}
                  className="gap-2"
                >
                  <MemberAvatar name={member.name} size="xs" />
                  <span className="flex-1 truncate">
                    {member.name ?? member.email}
                  </span>
                  {assignee === member.email && (
                    <Check className="size-4 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <label
            className="inline-flex cursor-pointer items-center rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            title="Attach files (or drag/paste them anywhere here)"
          >
            <Paperclip className="size-4" />
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                queueFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PendingRemove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove attachment"
      className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-foreground/80 text-background shadow group-hover/pending:flex"
    >
      <X className="size-3" />
    </button>
  );
}
