"use client";

import {
  Archive,
  Check,
  CircleDashed,
  Copy,
  Inbox,
  Layers,
  Moon,
  PanelRightOpen,
  Star,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { snoozePresets } from "@/lib/todos/snooze";
import type {
  TodoBucket,
  TodoMember,
  TodoProject,
  TodoTask,
} from "@/lib/todos/types";
import { cn } from "@/lib/utils";

// Inbox isn't a "when" — it's the absence of triage, reachable only via the
// Project submenu's Inbox (which also clears the project).
const BUCKETS: { bucket: TodoBucket; label: string; icon: typeof Star; iconClass: string }[] = [
  { bucket: "today", label: "Today", icon: Star, iconClass: "text-amber-500" },
  { bucket: "anytime", label: "Anytime", icon: Layers, iconClass: "text-teal-700" },
  { bucket: "someday", label: "Someday", icon: Archive, iconClass: "text-stone-500" },
];

export type TaskContextActions = {
  open: (task: TodoTask) => void;
  complete: (tasks: TodoTask[]) => void;
  setBucket: (tasks: TodoTask[], bucket: TodoBucket) => void;
  snooze: (tasks: TodoTask[], when: Date) => void;
  wake: (tasks: TodoTask[]) => void;
  setProject: (tasks: TodoTask[], projectId: string | null) => void;
  moveToInbox: (tasks: TodoTask[]) => void;
  assign: (tasks: TodoTask[], email: string) => void;
  duplicate: (tasks: TodoTask[]) => void;
  requestDelete: (tasks: TodoTask[]) => void;
};

/**
 * Right-click menu for a task row, selection-aware: right-clicking inside the
 * current selection acts on all of it; right-clicking elsewhere re-selects
 * that row first (the parent handles that via onTargetTask). Things' menu,
 * trimmed to what this app supports — When → Move/Snooze, Move → Project,
 * Complete, Duplicate, Delete — plus our Assign to.
 */
export function TaskContextMenu({
  task,
  effectiveTasks,
  members,
  projects,
  onTargetTask,
  actions,
  children,
}: {
  task: TodoTask;
  effectiveTasks: TodoTask[];
  members: TodoMember[];
  projects: TodoProject[];
  /** Called on right-click so the parent can pull selection onto this row. */
  onTargetTask: (task: TodoTask) => void;
  actions: TaskContextActions;
  children: React.ReactNode;
}) {
  const tasks = effectiveTasks;
  const single = tasks.length === 1;
  const anySnoozed = tasks.some((t) => t.snoozedUntil);

  // The membership rule, applied to the whole selection: a project is
  // offered only when every selected task's assignee belongs to it; a member
  // only when they belong to every selected task's project.
  const eligibleProjects = projects.filter((p) =>
    tasks.every((t) => p.memberEmails.includes(t.assigneeEmail))
  );
  const eligibleMembers = members.filter((m) =>
    tasks.every((t) => {
      if (!t.projectId) return true;
      const project = projects.find((p) => p.id === t.projectId);
      return !project || project.memberEmails.includes(m.email);
    })
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        onContextMenu={() => onTargetTask(task)}
        className="block"
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {single && (
          <>
            <ContextMenuItem onClick={() => actions.open(task)} className="gap-2">
              <PanelRightOpen className="size-4 text-muted-foreground" />
              Open
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <Star className="size-4 text-amber-500" />
            Move to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {BUCKETS.map((option) => {
              const allHere =
                tasks.every((t) => t.bucket === option.bucket && !t.snoozedUntil);
              return (
                <ContextMenuItem
                  key={option.bucket}
                  disabled={allHere}
                  onClick={() => actions.setBucket(tasks, option.bucket)}
                  className="gap-2"
                >
                  <option.icon className={cn("size-4", option.iconClass)} />
                  <span className="flex-1">{option.label}</span>
                  {allHere && <Check className="size-4 text-primary" />}
                </ContextMenuItem>
              );
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <Moon className="size-4 text-indigo-500" />
            Snooze
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {snoozePresets().map((preset) => (
              <ContextMenuItem
                key={preset.key}
                onClick={() => actions.snooze(tasks, preset.when)}
                className="gap-2"
              >
                <span className="flex-1">{preset.label}</span>
                <span className="text-xs text-muted-foreground">{preset.hint}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {anySnoozed && (
          <ContextMenuItem onClick={() => actions.wake(tasks)} className="gap-2">
            <Sun className="size-4 text-amber-500" />
            Wake now
          </ContextMenuItem>
        )}

        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <CircleDashed className="size-4 text-primary/70" />
            Project
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              disabled={tasks.every(
                (t) => !t.projectId && t.bucket === "inbox" && !t.snoozedUntil
              )}
              onClick={() => actions.moveToInbox(tasks)}
              className="gap-2"
            >
              <Inbox className="size-4 text-sky-700" />
              <span className="flex-1">Inbox</span>
              {tasks.every(
                (t) => !t.projectId && t.bucket === "inbox" && !t.snoozedUntil
              ) && <Check className="size-4 text-primary" />}
            </ContextMenuItem>
            {eligibleProjects.length > 0 && <ContextMenuSeparator />}
            {eligibleProjects.map((project) => {
              const allHere = tasks.every((t) => t.projectId === project.id);
              return (
                <ContextMenuItem
                  key={project.id}
                  disabled={allHere}
                  onClick={() => actions.setProject(tasks, project.id)}
                  className="gap-2"
                >
                  <CircleDashed className="size-4 text-primary/70" />
                  <span className="flex-1 truncate">{project.name}</span>
                  {allHere && <Check className="size-4 text-primary" />}
                </ContextMenuItem>
              );
            })}
            {eligibleProjects.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem
              disabled={tasks.every((t) => !t.projectId)}
              onClick={() => actions.setProject(tasks, null)}
              className="gap-2 text-muted-foreground"
            >
              <span className="flex-1">No project</span>
              {tasks.every((t) => !t.projectId) && (
                <Check className="size-4 text-primary" />
              )}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <UserRound className="size-4 text-muted-foreground" />
            Assign to
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {eligibleMembers.map((member) => {
              const allHere = tasks.every(
                (t) => t.assigneeEmail === member.email
              );
              return (
                <ContextMenuItem
                  key={member.email}
                  disabled={allHere}
                  onClick={() => actions.assign(tasks, member.email)}
                  className="gap-2"
                >
                  <MemberAvatar name={member.name} size="xs" />
                  <span className="flex-1 truncate">
                    {member.name ?? member.email}
                  </span>
                  {allHere && <Check className="size-4 text-primary" />}
                </ContextMenuItem>
              );
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={() => actions.complete(tasks)} className="gap-2">
          <Check className="size-4 text-emerald-700" />
          Complete{single ? "" : ` ${tasks.length} to-dos`}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.duplicate(tasks)} className="gap-2">
          <Copy className="size-4 text-muted-foreground" />
          Duplicate{single ? "" : ` ${tasks.length} to-dos`}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          variant="destructive"
          onClick={() => actions.requestDelete(tasks)}
          className="gap-2"
        >
          <Trash2 className="size-4" />
          Delete{single ? "…" : ` ${tasks.length} to-dos…`}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
