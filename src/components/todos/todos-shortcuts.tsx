"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { emitChordHints } from "@/lib/todos/chord-hints";
import { inOpenOverlay, isTypingTarget } from "@/lib/todos/keyboard";
import type { TodoView } from "@/lib/todos/types";
import { requestViewSwitch } from "@/lib/todos/view-switch";

/**
 * Gmail-style `g` navigation chords for the whole Todos app (mounted in the
 * todos layout), plus the `?` cheat sheet. Listens in the capture phase so a
 * pending chord swallows the next key before the task-list or quick-add
 * handlers can read it as an action (`g s` must never snooze).
 *
 * Hold `g` for a beat and the sidebar decorates each view with its follow-up
 * key (see chord-hints.ts) — a reminder for half-learned chords.
 */

const CHORD_WINDOW_MS = 1_000;
const HINT_DELAY_MS = 450;

const GO_TARGETS: Record<string, TodoView> = {
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
  const showHintsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideHintsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintsShown = useRef(false);
  // Keep the ?as= impersonation param across keyboard navigation.
  const asParam = searchParams.get("as");

  useEffect(() => {
    const clearHints = () => {
      if (showHintsTimer.current) clearTimeout(showHintsTimer.current);
      showHintsTimer.current = null;
      if (hideHintsTimer.current) clearTimeout(hideHintsTimer.current);
      hideHintsTimer.current = null;
      if (hintsShown.current) {
        hintsShown.current = false;
        emitChordHints(false);
      }
    };

    // (Re-)arm the chord window. Held `g` auto-repeats through here, so the
    // window — and the hints' lifetime — stretches for as long as it's down.
    // The hide timer is only a fallback (e.g. focus lost mid-hold); releasing
    // `g` hides the hints instantly via keyup below.
    const armChord = () => {
      chordUntil.current = performance.now() + CHORD_WINDOW_MS;
      if (!hintsShown.current && showHintsTimer.current == null) {
        showHintsTimer.current = setTimeout(() => {
          showHintsTimer.current = null;
          hintsShown.current = true;
          emitChordHints(true);
        }, HINT_DELAY_MS);
      }
      if (hideHintsTimer.current) clearTimeout(hideHintsTimer.current);
      hideHintsTimer.current = setTimeout(clearHints, CHORD_WINDOW_MS);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Bare modifiers (e.g. holding shift for `?`) shouldn't eat a chord.
      if (["Shift", "Meta", "Control", "Alt"].includes(e.key)) return;
      if (isTypingTarget(e.target) || inOpenOverlay(e.target)) return;

      if (performance.now() < chordUntil.current) {
        // A held (auto-repeating) or re-tapped `g` keeps the chord armed
        // rather than counting as the chord's second key.
        if (e.key.toLowerCase() === "g") {
          e.preventDefault();
          e.stopPropagation();
          armChord();
          return;
        }
        chordUntil.current = 0;
        clearHints();
        // Swallow whatever follows `g`, matched or not, so a fumbled chord
        // can't fire a single-letter action underneath.
        e.preventDefault();
        e.stopPropagation();
        const view = GO_TARGETS[e.key.toLowerCase()];
        if (view) {
          // Instant client-side switch when the views shell is mounted; a
          // real navigation otherwise (project pages, browse, settings).
          if (requestViewSwitch(view)) return;
          router.push(
            asParam
              ? `/todos/${view}?as=${encodeURIComponent(asParam)}`
              : `/todos/${view}`
          );
        }
        return;
      }

      if (e.key === "g") {
        armChord();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    // Releasing `g` hides the hints immediately. The chord stays armed —
    // tap-`g`-then-`i` still navigates — so a quick tap never flashes hints
    // (its keyup cancels the pending show timer).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "g") clearHints();
    };

    // Capture phase: runs before the bubble-phase listeners on window.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      clearHints();
    };
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
      { keys: ["⌘Z"], label: "Undo complete" },
      { keys: ["⇧⌘Z"], label: "Redo complete" },
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
