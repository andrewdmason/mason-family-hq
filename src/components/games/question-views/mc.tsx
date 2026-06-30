"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { McPayload } from "@/lib/games/types";

/**
 * Multiple-choice answer area. Presentational: the runner owns scoring. Options
 * stay visible to the host (single device); the correct answer is only marked
 * once `revealed` is true. `removed` are 50/50'd-out indices.
 */
export function McView({
  payload,
  removed,
  chosenIndex,
  revealed,
  onPick,
}: {
  payload: McPayload;
  removed: number[];
  chosenIndex: number | null;
  revealed: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <div className="grid gap-2">
      {payload.options.map((opt, i) => {
        const isRemoved = removed.includes(i);
        const isCorrect = i === payload.correctIndex;
        const isChosen = i === chosenIndex;
        return (
          <button
            key={i}
            type="button"
            disabled={isRemoved || revealed}
            onClick={() => onPick(i)}
            className={cn(
              "flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left text-base transition-colors",
              !revealed && !isRemoved && "hover:border-foreground/30 hover:bg-accent",
              isRemoved && "opacity-30 line-through",
              revealed && isCorrect && "border-emerald-500 bg-emerald-50 text-emerald-900",
              revealed && isChosen && !isCorrect && "border-destructive bg-destructive/10",
              !revealed && isChosen && "border-foreground/40 bg-accent"
            )}
          >
            <span>{opt}</span>
            {revealed && isCorrect && <Check className="size-5 text-emerald-600" />}
            {revealed && isChosen && !isCorrect && <X className="size-5 text-destructive" />}
          </button>
        );
      })}
    </div>
  );
}
