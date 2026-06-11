"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Lock, Users } from "lucide-react";
import { dismissJournalNudge } from "@/app/(todos)/todos/actions";
import { TaskCheckbox } from "@/components/todos/task-row";
import { useReconciler } from "@/lib/todos/reconcile";
import { cn } from "@/lib/utils";

// The two-beat check-off, matched to the real rows' timings (task-list.tsx's
// COMPLETE_ANIMATION_MS / REMOVE_ANIMATION_MS).
const COMPLETE_ANIMATION_MS = 600;
const REMOVE_ANIMATION_MS = 250;

/**
 * The synthetic "Write in your journal" row at the top of your own Today
 * view. Not a todo_tasks row: the server decides each render whether it's
 * pending (no journal entry written today, not checked off today — see
 * lib/todos/journal-nudge.ts). Checking it off records a per-day dismissal,
 * so it stays gone until tomorrow; actually journaling hides it without any
 * check-off. The chips jump straight into a family- or private-audience
 * compose at /journal/new.
 */
export function JournalNudgeRow({ onDismissed }: { onDismissed: () => void }) {
  const { run } = useReconciler();
  const [phase, setPhase] = useState<"idle" | "completing" | "removing">(
    "idle"
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const check = () => {
    if (phase !== "idle") return;
    // Same two beats as a real task: crossed-out for a moment, then the row
    // collapses while the list closes up around it.
    setPhase("completing");
    timers.current.push(
      setTimeout(() => {
        setPhase("removing");
        timers.current.push(
          setTimeout(() => {
            onDismissed();
            run(dismissJournalNudge());
          }, REMOVE_ANIMATION_MS)
        );
      }, COMPLETE_ANIMATION_MS)
    );
  };

  const completing = phase !== "idle";
  const chipClass =
    "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    // The 1fr→0fr grid row animates the collapse, like SortableTaskRow.
    <div
      data-task-row=""
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[250ms] ease-in",
        phase === "removing" ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"
      )}
    >
      <div
        className={cn(
          "min-h-0",
          phase === "removing" && "pointer-events-none overflow-hidden"
        )}
      >
        <div
          className={cn(
            "flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 [transition:opacity_500ms]",
            completing && "opacity-40"
          )}
        >
          <TaskCheckbox checked={completing} onToggle={check} />
          <span className="min-w-0 flex-1 select-none">
            <span
              className={cn(
                "block truncate text-sm text-foreground",
                completing && "text-muted-foreground line-through"
              )}
            >
              Write in your journal
            </span>
          </span>
          <Link href="/journal/new?audience=family" className={chipClass}>
            <Users className="size-3" />
            Family
          </Link>
          <Link href="/journal/new?audience=private" className={chipClass}>
            <Lock className="size-3" />
            Personal
          </Link>
        </div>
      </div>
    </div>
  );
}
