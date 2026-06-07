"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { setSessionRpe } from "@/app/(workouts)/workouts/actions";

// A quick, tappable effort scale for the whole session, normalized for CrossFit:
// a "normal" WOD is already a hard effort (RPE 8), hence the jump from "easier
// than normal" (6) — so the scale isn't bottom-heavy. Stored as an RPE number.
const RPE_LEVELS: { value: number; emoji: string; label: string }[] = [
  { value: 6, emoji: "😌", label: "Easier than normal" },
  { value: 8, emoji: "😤", label: "Normal" },
  { value: 9, emoji: "🥵", label: "Hard" },
  { value: 10, emoji: "💀", label: "Max" },
];

/** Session-level perceived effort: one emoji tap for "how hard was today". */
export function SessionEffort({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: number | null;
}) {
  const [rpe, setRpe] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const current = RPE_LEVELS.find((l) => l.value === rpe);

  function pick(value: number) {
    const next = rpe === value ? null : value;
    setRpe(next);
    startTransition(async () => {
      await setSessionRpe(sessionId, next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Effort
        </span>
        {current && (
          <span className="text-xs text-muted-foreground">{current.label}</span>
        )}
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : saved ? (
          <Check className="size-3.5 text-primary" />
        ) : null}
      </div>
      <div className="flex items-center gap-1.5" role="group" aria-label="Effort">
        {RPE_LEVELS.map((level) => {
          const active = rpe === level.value;
          return (
            <button
              key={level.value}
              type="button"
              title={`${level.label} (RPE ${level.value})`}
              aria-label={`${level.label}, RPE ${level.value}`}
              aria-pressed={active}
              onClick={() => pick(level.value)}
              className={cn(
                "flex size-11 items-center justify-center rounded-lg border text-2xl leading-none transition-all",
                active
                  ? "border-primary bg-primary/10 scale-110"
                  : "border-input opacity-40 grayscale hover:opacity-90 hover:grayscale-0"
              )}
            >
              {level.emoji}
            </button>
          );
        })}
      </div>
    </div>
  );
}
