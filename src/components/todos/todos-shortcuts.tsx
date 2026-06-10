"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inOpenOverlay, isTypingTarget } from "@/lib/todos/keyboard";

/**
 * Gmail-style `g` navigation chords for the whole Todos app (mounted in the
 * todos layout), plus the `?` cheat sheet. Listens in the capture phase so a
 * pending chord swallows the next key before the task-list or quick-add
 * handlers can read it as an action (`g s` must never snooze).
 */

const CHORD_WINDOW_MS = 1_000;

const GO_TARGETS: Record<string, string> = {
  i: "inbox",
  t: "today",
  a: "anytime",
  s: "someday",
  z: "snoozed", // s is taken; z as in zzz
  d: "delegated",
  l: "logbook",
};

export function TodosShortcuts() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [helpOpen, setHelpOpen] = useState(false);
  const chordUntil = useRef(0);
  // Keep the ?as= impersonation param across keyboard navigation.
  const asParam = searchParams.get("as");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Bare modifiers (e.g. holding shift for `?`) shouldn't eat a chord.
      if (["Shift", "Meta", "Control", "Alt"].includes(e.key)) return;
      if (isTypingTarget(e.target) || inOpenOverlay(e.target)) return;

      if (performance.now() < chordUntil.current) {
        chordUntil.current = 0;
        // Swallow whatever follows `g`, matched or not, so a fumbled chord
        // can't fire a single-letter action underneath.
        e.preventDefault();
        e.stopPropagation();
        const view = GO_TARGETS[e.key.toLowerCase()];
        if (view) {
          router.push(
            asParam
              ? `/todos/${view}?as=${encodeURIComponent(asParam)}`
              : `/todos/${view}`
          );
        }
        return;
      }

      if (e.key === "g") {
        chordUntil.current = performance.now() + CHORD_WINDOW_MS;
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    // Capture phase: runs before the bubble-phase listeners on window.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [router, asParam]);

  return <ShortcutCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />;
}

type ShortcutRow = { keys: string[]; label: string };

const SECTIONS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "Capture",
    rows: [{ keys: ["c"], label: "New to-do" }],
  },
  {
    title: "Go to",
    rows: [
      { keys: ["g", "i"], label: "Inbox" },
      { keys: ["g", "t"], label: "Today" },
      { keys: ["g", "a"], label: "Anytime" },
      { keys: ["g", "s"], label: "Someday" },
      { keys: ["g", "z"], label: "Snoozed" },
      { keys: ["g", "d"], label: "Delegated" },
      { keys: ["g", "l"], label: "Logbook" },
    ],
  },
  {
    title: "List",
    rows: [
      { keys: ["j", "↓"], label: "Next task" },
      { keys: ["k", "↑"], label: "Previous task" },
      { keys: ["⏎", "o"], label: "Open task" },
      { keys: ["⌘A"], label: "Select all" },
      { keys: ["esc"], label: "Close / clear selection" },
    ],
  },
  {
    title: "Selected task",
    rows: [
      { keys: ["e"], label: "Complete" },
      { keys: ["⌫", "#"], label: "Delete" },
      { keys: ["s"], label: "Snooze…" },
      { keys: ["w"], label: "Wake now" },
      { keys: ["m"], label: "Move to project…" },
      { keys: ["a"], label: "Assign to…" },
      { keys: ["z"], label: "Undo delete" },
    ],
  },
];

function ShortcutCheatSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h3>
              <ul className="space-y-1">
                {section.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span>{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((key, i) => (
                        <kbd
                          key={i}
                          className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
