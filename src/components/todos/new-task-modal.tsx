"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Inbox, Star } from "lucide-react";
import { createTask } from "@/app/(todos)/todos/actions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import type { TodoBucket, TodoMember } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

export type NewTaskDefaults = {
  assigneeEmail?: string;
  bucket?: Extract<TodoBucket, "inbox" | "today">;
};

/**
 * Things-quick-entry-style capture: title with a decorative checkbox, a Notes
 * field beneath, and a footer bar where Inbox/Today and the assignee are
 * compact dropdowns next to Cancel/Save. Summoned globally — see quick-add.tsx.
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
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState(selfEmail);
  const [bucket, setBucket] = useState<TodoBucket>("inbox");
  const [saving, setSaving] = useState(false);

  // Each summon starts fresh, seeded by the opener's context (e.g. the Todos
  // header button passes the viewed member and the current view's bucket).
  useEffect(() => {
    if (open) {
      setTitle("");
      setNotes("");
      setAssignee(defaults?.assigneeEmail ?? selfEmail);
      setBucket(defaults?.bucket ?? "inbox");
    }
  }, [open, defaults, selfEmail]);

  const assigneeMember = members.find((m) => m.email === assignee);
  const BucketIcon = bucket === "today" ? Star : Inbox;

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await createTask({
        title: trimmed,
        notes: notes.trim() || undefined,
        assigneeEmail: assignee,
        bucket,
      });
      onOpenChange(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        showCloseButton={false}
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
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            placeholder="Notes"
            rows={3}
            className="mt-1.5 w-full resize-none bg-transparent pl-[28px] text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            aria-label="Notes"
          />
        </div>

        <div className="flex items-center gap-1 border-t border-border/60 bg-muted/40 px-3 py-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent/60"
                />
              }
            >
              <BucketIcon
                className={cn(
                  "size-4",
                  bucket === "today" ? "text-amber-500" : "text-sky-700"
                )}
              />
              {bucket === "today" ? "Today" : "Inbox"}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-36">
              {(
                [
                  { bucket: "inbox", label: "Inbox", icon: Inbox, iconClass: "text-sky-700" },
                  { bucket: "today", label: "Today", icon: Star, iconClass: "text-amber-500" },
                ] as const
              ).map((option) => (
                <DropdownMenuItem
                  key={option.bucket}
                  onClick={() => setBucket(option.bucket)}
                  className="gap-2"
                >
                  <option.icon className={cn("size-4", option.iconClass)} />
                  <span className="flex-1">{option.label}</span>
                  {bucket === option.bucket && (
                    <Check className="size-4 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

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
              className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
