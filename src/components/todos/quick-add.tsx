"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  NewTaskModal,
  type NewTaskDefaults,
} from "@/components/todos/new-task-modal";
import { Toast, ToastViewport } from "@/components/ui/toast";
import { inOpenOverlay, isTypingTarget } from "@/lib/todos/keyboard";
import { withAs } from "@/lib/todos/member-context";
import { viewLabel, type TodoMember, type TodoTask } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

/**
 * Global quick-add: the new-to-do modal is mounted once (root layout, via
 * global-quick-add.tsx) and summoned from anywhere — press `c` (Gmail/Linear's
 * create key; single letters never collide with Chrome's shortcuts) or
 * dispatch the window event via emitQuickAdd() / <QuickAddButton>. The same
 * window-event pattern as src/lib/optimistic-task.ts, so openers don't need
 * a shared React context across layouts.
 *
 * Views that create in place (bucket views, project pages) own `c` instead —
 * their task list marks itself with data-inline-new and the key handler here
 * stands down, so the modal is only the capture path everywhere else.
 */

const QUICK_ADD_EVENT = "todo-quick-add";
const QUICK_ADD_KEY = "c";

export function emitQuickAdd(defaults?: NewTaskDefaults): void {
  window.dispatchEvent(
    new CustomEvent<NewTaskDefaults | undefined>(QUICK_ADD_EVENT, {
      detail: defaults,
    })
  );
}

type CreatedToast = {
  /** Bumped per create so back-to-back captures replay the entrance. */
  key: number;
  title: string;
  /** "Inbox", "Becca’s Today", … — where the task actually landed. */
  destination: string;
  href: string;
};

/** Mounted once; listens for the key + event and hosts the modal. */
export function QuickAddHost({
  members,
  selfEmail,
}: {
  members: TodoMember[];
  selfEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState<NewTaskDefaults | undefined>();
  const [toast, setToast] = useState<CreatedToast | null>(null);

  useEffect(() => {
    const onEvent = (e: Event) => {
      setDefaults((e as CustomEvent<NewTaskDefaults | undefined>).detail);
      setOpen(true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== QUICK_ADD_KEY) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || inOpenOverlay(e.target)) return;
      // A task list that creates in place owns `c` (an inline draft below
      // the selection — see task-list.tsx). Listener order between the two
      // window handlers isn't guaranteed, so the marker is the contract.
      if (document.querySelector("[data-inline-new]")) return;
      // Focus mode isn't a capture surface — same marker contract.
      if (document.querySelector("[data-focus-mode]")) return;
      e.preventDefault();
      // Like Things' quick entry, the When defaults to where you're standing:
      // `c` on /todos/anytime preselects Anytime; the ?as= member carries
      // over too. Anywhere else falls back to Inbox capture.
      const match = window.location.pathname.match(
        /^\/todos\/(inbox|today|anytime|someday)$/
      );
      const as = new URLSearchParams(window.location.search).get("as");
      setDefaults({
        bucket: (match?.[1] as NewTaskDefaults["bucket"]) ?? undefined,
        assigneeEmail: as ?? undefined,
      });
      setOpen(true);
    };
    window.addEventListener(QUICK_ADD_EVENT, onEvent);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(QUICK_ADD_EVENT, onEvent);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Confirmation toasts are transient — unlike the toast surface's default
  // wait-for-action prompts, these dismiss themselves.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onCreated = (task: TodoTask) => {
    router.refresh();
    // The capture modal can file a task anywhere — another person's list, a
    // snooze, a different bucket — so confirm where it landed, with a way
    // there. Snoozed creations ride bucket=today but render in Snoozed.
    const view = task.snoozedUntil ? "snoozed" : task.bucket;
    const mine = task.assigneeEmail === selfEmail;
    const member = members.find((m) => m.email === task.assigneeEmail);
    const first =
      member?.name?.trim().split(/\s+/)[0] ?? task.assigneeEmail.split("@")[0];
    setToast({
      key: Date.now(),
      // Ellipsize the title here rather than CSS-truncating the line — the
      // destination is the message and must never be the part clipped off.
      title:
        task.title.length > 40 ? `${task.title.slice(0, 40).trimEnd()}…` : task.title,
      destination: mine ? viewLabel(view) : `${first}’s ${viewLabel(view)}`,
      href: withAs(`/todos/${view}`, task.assigneeEmail, selfEmail),
    });
  };

  return (
    <>
      <NewTaskModal
        open={open}
        onOpenChange={setOpen}
        members={members}
        selfEmail={selfEmail}
        defaults={defaults}
        onCreated={onCreated}
      />
      {toast && (
        <ToastViewport>
          <Toast
            key={toast.key}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="min-w-0 text-muted-foreground">
              Added “{toast.title}” to {toast.destination}
            </span>
            <Link
              href={toast.href}
              onClick={() => setToast(null)}
              className="shrink-0 font-medium text-primary hover:underline"
            >
              View
            </Link>
          </Toast>
        </ToastViewport>
      )}
    </>
  );
}

/** A "+ New to-do" button that summons the global modal with context. */
export function QuickAddButton({
  defaults,
  label = "New to-do",
  className,
}: {
  defaults?: NewTaskDefaults;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => emitQuickAdd(defaults)}
      title="New to-do (c)"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary hover:bg-primary/10",
        className
      )}
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}
