"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Inbox, ListTodo, Plus, Star } from "lucide-react";
import { completeTask, createTask } from "@/app/(todos)/todos/actions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { TaskCheckbox } from "@/components/todos/task-row";
import { WidgetCard } from "@/components/home/widget-card";
import type { HomeTodos } from "@/lib/home/todos";
import type { TodoBucket, TodoMember } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

const COMPLETE_ANIMATION_MS = 600;
const VISIBLE_TASKS = 6;

/**
 * Home dashboard widget: your Today list (check things off right here), the
 * Inbox triage count, and a "new task" modal for capture — including dropping
 * a task straight onto another family member's list.
 */
export function TodosWidget({
  data,
  members,
}: {
  data: HomeTodos;
  members: TodoMember[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(data.todayTasks);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => setTasks(data.todayTasks), [data.todayTasks]);

  const handleComplete = (taskId: string) => {
    if (completingIds.has(taskId)) return;
    setCompletingIds((prev) => new Set(prev).add(taskId));
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      completeTask(taskId).finally(() => router.refresh());
    }, COMPLETE_ANIMATION_MS);
  };

  const visible = tasks.slice(0, VISIBLE_TASKS);
  const overflow = tasks.length - visible.length;

  return (
    <WidgetCard
      title="Todos"
      icon={ListTodo}
      href="/todos/today"
      action={
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary hover:bg-primary/10"
        >
          <Plus className="size-4" />
          New
        </button>
      }
    >
      {visible.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">
          Today is clear.
          {data.inboxCount === 0 && " Inbox is empty too — nice."}
        </p>
      ) : (
        <div className="-mx-1.5">
          {visible.map((task) => {
            const completing = completingIds.has(task.id);
            return (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-opacity duration-500",
                  completing && "opacity-40"
                )}
              >
                <TaskCheckbox
                  checked={completing}
                  onToggle={() => handleComplete(task.id)}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm text-foreground",
                    completing && "text-muted-foreground line-through"
                  )}
                >
                  {task.title}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        {overflow > 0 && (
          <Link href="/todos/today" className="hover:text-foreground">
            +{overflow} more today
          </Link>
        )}
        <Link
          href="/todos/inbox"
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground",
            data.inboxCount > 0 && "text-primary"
          )}
        >
          <Inbox className="size-3.5" />
          {data.inboxCount > 0
            ? `${data.inboxCount} in Inbox`
            : "Inbox zero"}
        </Link>
      </div>

      <NewTaskModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        members={members}
        selfEmail={data.selfEmail}
        onCreated={() => router.refresh()}
      />
    </WidgetCard>
  );
}

/**
 * Things-quick-entry-style capture: title with a decorative checkbox, a Notes
 * field beneath, and a footer bar where Inbox/Today and the assignee are
 * compact dropdowns next to Cancel/Save.
 */
function NewTaskModal({
  open,
  onOpenChange,
  members,
  selfEmail,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: TodoMember[];
  selfEmail: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState(selfEmail);
  const [bucket, setBucket] = useState<TodoBucket>("inbox");
  const [saving, setSaving] = useState(false);

  const assigneeMember = members.find((m) => m.email === assignee);
  const BucketIcon = bucket === "today" ? Star : Inbox;

  const reset = () => {
    setTitle("");
    setNotes("");
    setBucket("inbox");
    setAssignee(selfEmail);
  };

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
      reset();
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
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
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
