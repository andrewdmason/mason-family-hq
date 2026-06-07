"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateBlock, type BlockPatch } from "@/app/(workouts)/workouts/actions";
import type { BlockView } from "@/lib/workouts/queries";
import { SCORE_TYPE_LABEL } from "@/lib/workouts/format";

/**
 * Logs the block's result — the field shape follows its score type (a finish
 * time, AMRAP rounds+reps, calories, …) — plus a freeform note. Perceived effort
 * is logged once per session, not per block. Saves on change.
 */
export function BlockScore({
  block,
  sessionId,
}: {
  block: BlockView;
  sessionId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const [minutes, setMinutes] = useState(
    block.score.seconds != null ? Math.floor(block.score.seconds / 60) : null
  );
  const [seconds, setSeconds] = useState(
    block.score.seconds != null ? block.score.seconds % 60 : null
  );
  const [rounds, setRounds] = useState(block.score.rounds);
  const [reps, setReps] = useState(block.score.reps);
  const [distance, setDistance] = useState(block.score.distance);
  const [calories, setCalories] = useState(block.score.calories);
  const [notes, setNotes] = useState(block.notes ?? "");

  function save(patch: BlockPatch) {
    startTransition(async () => {
      await updateBlock(block.id, sessionId, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  }

  const num = (
    label: string,
    value: number | null,
    setter: (v: number | null) => void,
    commit: () => void,
    step = 1
  ) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        step={step}
        value={value ?? ""}
        onChange={(e) =>
          setter(e.target.value === "" ? null : Number(e.target.value))
        }
        onBlur={commit}
        className="h-10 w-16 rounded-md border border-input bg-background px-2 text-center text-base tabular-nums focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );

  const commitTime = () => {
    const total = (minutes ?? 0) * 60 + (seconds ?? 0);
    save({ scoreSeconds: minutes == null && seconds == null ? null : total });
  };

  // 'load' is logged on the strength movement's own set (which feeds e1RM), so a
  // separate block-level load field would be a duplicate entry — show only the
  // rx/effort/notes meta for both 'none' and 'load' blocks.
  if (block.scoreType === "none" || block.scoreType === "load") {
    return (
      <BlockMeta
        notes={notes}
        setNotes={setNotes}
        save={save}
        pending={pending}
        saved={saved}
      />
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {SCORE_TYPE_LABEL[block.scoreType]} — your result
        </span>
        <SaveDot pending={pending} saved={saved} />
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        {block.scoreType === "time" && (
          <>
            {num("Min", minutes, setMinutes, commitTime)}
            {num("Sec", seconds, setSeconds, commitTime)}
          </>
        )}
        {block.scoreType === "rounds_reps" && (
          <>
            {num("Rounds", rounds, setRounds, () => save({ scoreRounds: rounds }))}
            {num("+ Reps", reps, setReps, () => save({ scoreReps: reps }))}
          </>
        )}
        {block.scoreType === "reps" &&
          num("Reps", reps, setReps, () => save({ scoreReps: reps }))}
        {block.scoreType === "distance" &&
          num("Meters", distance, setDistance, () =>
            save({ scoreDistance: distance })
          )}
        {block.scoreType === "calories" &&
          num("Cal", calories, setCalories, () => save({ scoreCalories: calories }))}
      </div>

      <BlockMeta
        notes={notes}
        setNotes={setNotes}
        save={save}
        pending={pending}
        saved={false}
        compact
      />
    </div>
  );
}

function BlockMeta({
  notes,
  setNotes,
  save,
  pending,
  saved,
  compact,
}: {
  notes: string;
  setNotes: (v: string) => void;
  save: (patch: BlockPatch) => void;
  pending: boolean;
  saved: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact ? "mt-3" : "")}>
      {!compact && <SaveDot pending={pending} saved={saved} />}

      <input
        type="text"
        value={notes}
        placeholder="Notes — felt heavy, grip gave out…"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => save({ notes })}
        className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

function SaveDot({ pending, saved }: { pending: boolean; saved: boolean }) {
  return (
    <span className="flex w-4 justify-center">
      {pending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : saved ? (
        <Check className="size-4 text-primary" />
      ) : null}
    </span>
  );
}
