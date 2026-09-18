"use client";

import { ClockIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function formatMinsShort(totalSeconds: number): string {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function AggregateTimerPill({
  elapsedSeconds,
  goalSeconds,
  onClick,
  title,
  size = "sm",
}: {
  elapsedSeconds: number;
  goalSeconds: number;
  onClick?: () => void;
  title?: string;
  size?: "sm" | "md";
}) {
  const goalReached = goalSeconds > 0 && elapsedSeconds >= goalSeconds;
  const interactive = !!onClick;
  const textClass = size === "md" ? "text-sm" : "text-xs";

  const content = (
    <>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground/70 transition-colors",
          interactive &&
            "group-hover/pill:bg-muted group-hover/pill:text-foreground",
        )}
      >
        <ClockIcon className="size-3" />
        {formatMinsShort(elapsedSeconds)}
      </span>
      <span className="mx-0.5 select-none text-muted-foreground/30">/</span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 transition-colors",
          goalReached
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            : cn(
                "text-muted-foreground/70",
                interactive &&
                  "group-hover/pill:bg-muted group-hover/pill:text-foreground",
              ),
        )}
      >
        {goalSeconds > 0 ? formatMinsShort(goalSeconds) : "—"}
      </span>
    </>
  );

  const baseClass = cn("inline-flex items-center tabular-nums", textClass);

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn("group/pill", baseClass)}
      >
        {content}
      </button>
    );
  }

  return <div className={baseClass}>{content}</div>;
}
