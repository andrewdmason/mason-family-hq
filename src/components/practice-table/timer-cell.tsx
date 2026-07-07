"use client";

import { useState } from "react";
import { ClockIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const GOAL_PRESETS = [5, 10, 15, 20, 30, 45, 60];

function parseGoalInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const hourMatch = trimmed.match(/(\d+)\s*h/);
  const minMatch = trimmed.match(/(\d+)\s*m/);
  if (hourMatch || minMatch) {
    const h = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    const m = minMatch ? parseInt(minMatch[1], 10) : 0;
    return h * 60 + m;
  }
  const num = parseInt(trimmed, 10);
  return Number.isNaN(num) ? null : num;
}

function formatMinutesShort(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function TimerCell({
  elapsedSeconds,
  goalSeconds,
  isActive,
  isCompleted,
  onToggleTimer,
  onChangeGoal,
}: {
  elapsedSeconds: number;
  goalSeconds: number;
  isActive: boolean;
  isCompleted: boolean;
  onToggleTimer: () => void;
  onChangeGoal: (seconds: number) => void;
}) {
  const [goalOpen, setGoalOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");

  const elapsedMinutes = Math.floor(Math.max(0, elapsedSeconds) / 60);
  const goalMinutes = Math.round(goalSeconds / 60);
  const goalReached = goalSeconds > 0 && elapsedSeconds >= goalSeconds;

  const setGoal = (minutes: number) => {
    onChangeGoal(minutes * 60);
    setGoalOpen(false);
    setCustomInput("");
  };

  const handleCustomSubmit = () => {
    const minutes = parseGoalInput(customInput);
    if (minutes !== null && minutes >= 0) setGoal(minutes);
  };

  return (
    <div className="flex items-center tabular-nums">
      <button
        onClick={onToggleTimer}
        disabled={isCompleted || goalSeconds <= 0}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
          isActive
            ? "bg-white/20 text-white hover:bg-white/30"
            : "hover:bg-muted text-muted-foreground hover:text-foreground",
          (isCompleted || goalSeconds <= 0) && "cursor-not-allowed opacity-60"
        )}
      >
        <ClockIcon className="size-3" />
        {elapsedMinutes}m
      </button>

      <span
        className={cn(
          "mx-0.5 select-none",
          isActive ? "text-white/50" : "text-muted-foreground/40"
        )}
      >
        /
      </span>

      <Popover open={goalOpen} onOpenChange={setGoalOpen}>
        <PopoverTrigger
          className={cn(
            "rounded px-1.5 py-0.5 transition-colors focus:outline-none",
            goalReached
              ? isActive
                ? "bg-emerald-500 text-white ring-1 ring-inset ring-white/30 hover:bg-emerald-600"
                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300"
              : isActive
                ? "text-white/80 hover:bg-white/20"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {formatMinutesShort(goalMinutes)}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          className="w-auto min-w-[220px] gap-2 p-2 data-closed:!animate-none data-closed:!duration-0"
        >
          <div className="flex flex-wrap gap-1">
            {GOAL_PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => setGoal(m)}
                className={cn(
                  "rounded px-2 py-1 text-xs tabular-nums transition-colors",
                  m === goalMinutes
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                )}
              >
                {m}m
              </button>
            ))}
          </div>
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCustomSubmit();
              } else if (e.key === "Escape") {
                setGoalOpen(false);
              }
            }}
            placeholder="Custom (e.g. 25 or 1h30m)"
            className="w-full rounded border border-input bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </PopoverContent>
      </Popover>

    </div>
  );
}
