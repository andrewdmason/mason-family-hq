import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { WorkoutTrend } from "@/lib/workouts/progress";

function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (current === 0 && previous === 0) {
    return <span className="text-xs text-muted-foreground/60">no data</span>;
  }
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" /> same as prior
      </span>
    );
  }
  const up = diff > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={
        "inline-flex items-center gap-0.5 text-xs " +
        (up ? "text-primary" : "text-muted-foreground")
      }
    >
      <Icon className="size-3" />
      {up ? "+" : "−"}
      {Math.abs(diff)} vs prior
    </span>
  );
}

function Period({
  label,
  current,
  previous,
}: {
  label: string;
  current: number;
  previous: number;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-serif text-2xl tabular-nums text-foreground">
        {current}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          {current === 1 ? "workout" : "workouts"}
        </span>
      </span>
      <Delta current={current} previous={previous} />
    </div>
  );
}

/** How often you've trained recently — last 7 and 30 days, trended vs the prior
 * equivalent window. */
export function WorkoutTrendWidget({ trend }: { trend: WorkoutTrend }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-2 gap-3">
        <Period label="Last 7 days" current={trend.last7} previous={trend.prev7} />
        <Period
          label="Last 30 days"
          current={trend.last30}
          previous={trend.prev30}
        />
      </div>
    </section>
  );
}
