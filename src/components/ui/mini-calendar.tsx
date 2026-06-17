"use client";

// A compact, navigable month grid — the body shared by the event panel's
// DateField and the day view's "jump to date" popover. Monday-start, built on
// the same getMonthGrid the calendar's month view uses. Works in Date objects;
// callers that hold "YYYY-MM-DD" strings convert at the edge.

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getMonthGrid,
  toDateKey,
  isSameDay,
  isToday,
  addMonths,
  formatMonthLabel,
} from "@/lib/calendar/calendar-utils";

export function MiniCalendar({
  selected,
  onSelect,
  className,
}: {
  selected: Date;
  onSelect: (date: Date) => void;
  className?: string;
}) {
  // The visible month starts on the selected date's month and only moves via
  // the chevrons — re-seeded whenever a fresh `selected` arrives (e.g. the
  // popover reopens on a new day).
  const [viewMonth, setViewMonth] = React.useState(selected);
  const selectedKey = toDateKey(selected);
  React.useEffect(() => {
    setViewMonth(selected);
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className}>
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
                onClick={() => onSelect(day)}
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
    </div>
  );
}
