"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  setSessionEffort,
  setSessionEnergy,
} from "@/app/(workouts)/workouts/actions";

/**
 * A session-level "flag the unusual" toggle: two options, and normally neither.
 * Null is the common case (a normal day), so you only tap when today stood out.
 * Tapping the active option clears it. Used for effort and energy.
 */
function FlagToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; emoji: string; label: string }[];
  value: T | null;
  onChange: (next: T | null) => Promise<void>;
}) {
  const [current, setCurrent] = useState<T | null>(value);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function pick(option: T) {
    const next = current === option ? null : option;
    setCurrent(next);
    startTransition(async () => {
      await onChange(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : saved ? (
          <Check className="size-3.5 text-primary" />
        ) : null}
      </div>
      <div className="flex items-center gap-2" role="group" aria-label={label}>
        {options.map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => pick(option.value)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-all",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              <span className="text-base leading-none">{option.emoji}</span>
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Was today easier or harder than a normal session? (Normally neither.) */
export function SessionEffort({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: "easier" | "harder" | null;
}) {
  return (
    <FlagToggle
      label="Effort"
      value={initial}
      options={[
        { value: "easier", emoji: "😌", label: "Easier than normal" },
        { value: "harder", emoji: "🥵", label: "Harder than normal" },
      ]}
      onChange={(next) => setSessionEffort(sessionId, next)}
    />
  );
}

/** How did the body feel going in? Flag only the unusual lows and highs. */
export function SessionEnergy({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: "low" | "high" | null;
}) {
  return (
    <FlagToggle
      label="Energy"
      value={initial}
      options={[
        { value: "low", emoji: "🪫", label: "Low energy" },
        { value: "high", emoji: "⚡", label: "High energy" },
      ]}
      onChange={(next) => setSessionEnergy(sessionId, next)}
    />
  );
}
