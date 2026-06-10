"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  NewTaskModal,
  type NewTaskDefaults,
} from "@/components/todos/new-task-modal";
import type { TodoMember } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

/**
 * Global quick-add: the new-to-do modal is mounted once (root layout, via
 * global-quick-add.tsx) and summoned from anywhere — press `q` (Todoist's
 * quick-add key; single letters never collide with Chrome's shortcuts) or
 * dispatch the window event via emitQuickAdd() / <QuickAddButton>. The same
 * window-event pattern as src/lib/optimistic-task.ts, so openers don't need
 * a shared React context across layouts.
 */

const QUICK_ADD_EVENT = "todo-quick-add";
const QUICK_ADD_KEY = "q";

export function emitQuickAdd(defaults?: NewTaskDefaults): void {
  window.dispatchEvent(
    new CustomEvent<NewTaskDefaults | undefined>(QUICK_ADD_EVENT, {
      detail: defaults,
    })
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

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

  useEffect(() => {
    const onEvent = (e: Event) => {
      setDefaults((e as CustomEvent<NewTaskDefaults | undefined>).detail);
      setOpen(true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== QUICK_ADD_KEY) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setDefaults(undefined);
      setOpen(true);
    };
    window.addEventListener(QUICK_ADD_EVENT, onEvent);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(QUICK_ADD_EVENT, onEvent);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <NewTaskModal
      open={open}
      onOpenChange={setOpen}
      members={members}
      selfEmail={selfEmail}
      defaults={defaults}
      onCreated={() => router.refresh()}
    />
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
      title="New to-do (q)"
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
