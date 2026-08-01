"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Folder,
  MoreHorizontal,
  Plus,
  Rows3,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  addProjectMember,
  completeProject,
  deleteProject,
  removeProjectMember,
  renameProject,
  restoreProject,
  setProjectArea,
  createArea,
} from "@/app/(todos)/todos/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InlineNewButton,
  emitInlineNewSection,
} from "@/components/todos/inline-new-button";
import { Toast, ToastViewport } from "@/components/ui/toast";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { firstNameOf } from "@/components/todos/member-name";
import type { TodoArea, TodoMember, TodoProject } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

const UNDO_WINDOW_MS = 6_000;

/**
 * Project page header: editable name, the member list (add/remove — removal is
 * blocked while the member has open tasks here), area assignment, and the
 * complete / delete lifecycle (complete confirms when open tasks remain;
 * delete soft-deletes project + tasks with an undo window).
 */
export function ProjectHeader({
  project,
  area,
  areas,
  members,
  openTaskCount,
  openTasksByMember,
  homeHref,
  logbookHref,
}: {
  project: TodoProject;
  area: TodoArea | null;
  areas: TodoArea[];
  members: TodoMember[];
  openTaskCount: number;
  openTasksByMember: Record<string, number>;
  homeHref: string;
  logbookHref: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ deletedAt: string } | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setName(project.name), [project.name]);

  const projectMembers = members.filter((m) =>
    project.memberEmails.includes(m.email)
  );
  const nonMembers = members.filter(
    (m) => !project.memberEmails.includes(m.email)
  );

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      renameProject(project.id, trimmed).finally(() => router.refresh());
    } else {
      setName(project.name);
    }
  };

  const handleComplete = () => {
    if (openTaskCount > 0) {
      setConfirmComplete(true);
      return;
    }
    void doComplete();
  };

  const doComplete = async () => {
    setConfirmComplete(false);
    await completeProject(project.id);
    // No refresh() after push — it would cancel the navigation (the todos
    // pages are force-dynamic, so the push alone fetches fresh data).
    router.push(logbookHref);
  };

  const handleRemoveMember = async (email: string) => {
    const result = await removeProjectMember(project.id, email);
    if (result.blocked) setNotice(result.blocked);
    router.refresh();
  };

  const handleDelete = async () => {
    const { deletedAt } = await deleteProject(project.id);
    setPendingDelete({ deletedAt });
    deleteTimer.current = setTimeout(() => {
      router.push(homeHref); // refresh() here would cancel the push
    }, UNDO_WINDOW_MS);
  };

  const handleUndoDelete = async () => {
    if (!pendingDelete) return;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    await restoreProject(project.id, pendingDelete.deletedAt);
    setPendingDelete(null);
    router.refresh();
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={handleComplete}
          aria-label="Complete project"
          title="Complete project"
          className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 border-primary/50 text-transparent transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(project.name);
          }}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent font-serif text-2xl tracking-tight text-foreground outline-none focus:border-border focus:bg-background"
          aria-label="Project name"
        />

        {/* New lives in the title row rather than a strip of its own — one
            fewer band of chrome between the header and the first to-do. */}
        <InlineNewButton className="shrink-0" />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Project options"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              />
            }
          >
            <MoreHorizontal className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              // The menu closes and hands focus back to its trigger on click;
              // let that finish before the new heading's input asks for focus.
              onClick={() => setTimeout(emitInlineNewSection, 0)}
              className="gap-2"
            >
              <Rows3 className="size-4 text-muted-foreground" />
              <span className="flex-1">New section</span>
              <DropdownMenuShortcut>⇧C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Folder className="size-4 text-muted-foreground" />
                <span className="flex-1">Area</span>
                {area && (
                  <span className="max-w-24 truncate text-xs text-muted-foreground">
                    {area.name}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                {areas.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onClick={() => {
                      if (a.id !== project.areaId) {
                        setProjectArea(project.id, a.id).finally(() =>
                          router.refresh()
                        );
                      }
                    }}
                    className="gap-2"
                  >
                    <Folder className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{a.name}</span>
                    {a.id === project.areaId && (
                      <Check className="size-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => {
                    if (project.areaId) {
                      setProjectArea(project.id, null).finally(() =>
                        router.refresh()
                      );
                    }
                  }}
                  className="gap-2 text-muted-foreground"
                >
                  <span className="flex-1">No area</span>
                  {!project.areaId && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
                <NewAreaItem
                  onCreate={async (areaName) => {
                    const { id } = await createArea(areaName);
                    await setProjectArea(project.id, id);
                    router.refresh();
                  }}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleComplete} className="gap-2">
              <CheckCircle2 className="size-4 text-emerald-700" />
              Complete project
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void handleDelete()}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              Delete project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
        {area && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {area.name}
          </span>
        )}
        {projectMembers.map((member) => (
          <DropdownMenu key={member.email}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                />
              }
            >
              <MemberAvatar name={member.name} size="xs" />
              {firstNameOf(member)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void handleRemoveMember(member.email)}
                disabled={(openTasksByMember[member.email] ?? 0) > 0}
                className="gap-2"
              >
                Remove from project
                {(openTasksByMember[member.email] ?? 0) > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    has open tasks
                  </span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
        {nonMembers.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Add member"
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                />
              }
            >
              <UserPlus className="size-3.5" />
              Add
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {nonMembers.map((member) => (
                <DropdownMenuItem
                  key={member.email}
                  onClick={() =>
                    addProjectMember(project.id, member.email).finally(() =>
                      router.refresh()
                    )
                  }
                  className="gap-2"
                >
                  <MemberAvatar name={member.name} size="xs" />
                  {member.name ?? member.email}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Complete-with-open-tasks confirmation */}
      <Dialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Complete “{project.name}”?</DialogTitle>
            <DialogDescription>
              {openTaskCount} open task{openTaskCount === 1 ? "" : "s"} will be
              completed with it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmComplete(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void doComplete()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Complete all
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(notice || pendingDelete) && (
        <ToastViewport>
          {notice && (
            <Toast className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 font-medium text-primary hover:underline"
              >
                OK
              </button>
            </Toast>
          )}
          {pendingDelete && (
            <Toast className="flex items-center justify-between gap-3">
              <span className="truncate text-muted-foreground">
                Deleted “{project.name}”
              </span>
              <button
                type="button"
                onClick={() => void handleUndoDelete()}
                className="shrink-0 font-medium text-primary hover:underline"
              >
                Undo
              </button>
            </Toast>
          )}
        </ToastViewport>
      )}

      <div className={cn(pendingDelete && "pointer-events-none opacity-40")} />
    </div>
  );
}

function NewAreaItem({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!adding) {
    return (
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => setAdding(true)}
        className="gap-2 text-muted-foreground"
      >
        <Plus className="size-4" />
        New area…
      </DropdownMenuItem>
    );
  }

  return (
    <div className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // The input lives inside a Base UI Menu, which otherwise swallows
          // keystrokes for typeahead/arrow navigation. Keep them on the input.
          e.stopPropagation();
          if (e.key === "Enter" && name.trim()) {
            void onCreate(name.trim());
            setAdding(false);
            setName("");
          }
        }}
        placeholder="Area name"
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none"
      />
    </div>
  );
}
