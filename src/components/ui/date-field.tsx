"use client";

// Inline date picker for the event panel: a borderless trigger showing the
// formatted date, opening a small month grid (reuses getMonthGrid, the same
// Monday-start grid the calendar's month view is built on). Values are local
// wall-clock "YYYY-MM-DD" strings.

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNestedOverlayReporter } from "@/components/ui/nested-overlay";
import {
  getMonthGrid,
  toDateKey,
  isSameDay,
  isToday,
  addMonths,
  formatMonthLabel,
} from "@/lib/calendar/calendar-utils";

function fromDateKey(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateFieldLabel(ymd: string): string {
  const d = fromDateKey(ymd);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

export function DateField({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string; // "YYYY-MM-DD" (local wall-clock)
  onChange: (ymd: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(() => fromDateKey(value));
  const reportOverlay = useNestedOverlayReporter();
  const selected = fromDateKey(value);

  function setOpenReported(next: boolean) {
    setOpen(next);
    reportOverlay(next);
    if (next) setViewMonth(fromDateKey(value));
  }

  return (
    <Popover open={open} onOpenChange={setOpenReported}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "rounded-md px-1.5 py-0.5 text-sm tabular-nums transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none",
          open && "bg-accent",
          className,
        )}
      >
        {formatDateFieldLabel(value)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-sm font-medium">
            {formatMonthLabel(viewMonth)}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              aria-label="Previous month"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className="py-0.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {getMonthGrid(viewMonth)
            .flat()
            .map((day) => {
              const inMonth = day.getMonth() === viewMonth.getMonth();
              const isSelected = isSameDay(day, selected);
              return (
                <button
                  key={toDateKey(day)}
                  type="button"
                  onClick={() => {
                    onChange(toDateKey(day));
                    setOpenReported(false);
                  }}
                  className={cn(
                    "mx-auto flex size-8 items-center justify-center rounded-full text-sm tabular-nums transition-colors hover:bg-accent",
                    !inMonth && "text-muted-foreground/50",
                    isToday(day) && !isSelected && "font-semibold text-primary",
                    isSelected &&
                      "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
