"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateSet, type SetActualPatch } from "@/app/(workouts)/workouts/actions";
import type { SetView } from "@/lib/workouts/queries";
import { formatSetMetric } from "@/lib/workouts/format";

/**
 * One editable set row, mobile-first. Shows what was prescribed and lets you log
 * what you actually did with big-tap number fields. Saves on blur (or step) and
 * shows whether the actual differs from the prescription. Only the fields that
 * make sense for the set's metric are shown.
 */
export function SetEditor({
  set,
  sessionId,
  index,
}: {
  set: SetView;
  sessionId: string;
  index: number;
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  // Local controlled values so typing feels instant.
  const [reps, setReps] = useState(set.actual.reps);
  const [load, setLoad] = useState(set.actual.load);
  const [distance, setDistance] = useState(set.actual.distance);
  const [duration, setDuration] = useState(set.actual.duration);
  const [calories, setCalories] = useState(set.actual.calories);

  const prescribedLabel = formatSetMetric(set.metricType, set.prescribed);

  function save(patch: SetActualPatch) {
    startTransition(async () => {
      await updateSet(set.id, sessionId, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  }

  const numField = (
    label: string,
    value: number | null,
    onChange: (v: number | null) => void,
    onCommit: (v: number | null) => void,
    opts: { step?: number; unit?: string } = {}
  ) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={opts.step ?? 1}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        onBlur={() => onCommit(value)}
        className="h-11 w-20 rounded-md border border-input bg-background px-2 text-center text-base tabular-nums focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">Set {index + 1}</span>
        {prescribedLabel !== "—" && (
          <span className="truncate text-xs text-muted-foreground/80">
            {prescribedLabel}
          </span>
        )}
      </div>

      <div className="flex items-end gap-2">
        {set.metricType === "load_reps" && (
          <>
            {numField(
              "Load",
              load,
              setLoad,
              (v) => save({ actualLoad: v }),
              { step: 5, unit: set.actual.unit ?? "lb" }
            )}
            {numField("Reps", reps, setReps, (v) => save({ actualReps: v }))}
          </>
        )}
        {set.metricType === "reps" &&
          numField("Reps", reps, setReps, (v) => save({ actualReps: v }))}
        {set.metricType === "distance" &&
          numField("Meters", distance, setDistance, (v) =>
            save({ actualDistance: v })
          )}
        {set.metricType === "duration" &&
          numField(
            "Seconds",
            duration,
            setDuration,
            (v) => save({ actualDuration: v }),
            { step: 5 }
          )}
        {set.metricType === "calories" &&
          numField("Cal", calories, setCalories, (v) =>
            save({ actualCalories: v })
          )}

        <span className="flex w-4 justify-center">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : saved ? (
            <Check className="size-4 text-primary" />
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** A non-editable badge showing the set's stored e1RM, when it has one. */
export function SetE1rmBadge({ set }: { set: SetView }) {
  if (set.e1rm == null) return null;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
        set.e1rmIsLoose
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary"
      )}
      title={set.e1rmIsLoose ? "Loose estimate (high reps)" : "Estimated 1RM"}
    >
      e1RM {set.e1rm}
      {set.e1rmIsLoose ? "≈" : ""}
    </span>
  );
}
