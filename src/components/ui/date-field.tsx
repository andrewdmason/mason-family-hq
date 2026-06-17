"use client";

// Inline date picker for the event panel: a borderless trigger showing the
// formatted date, opening the shared MiniCalendar month grid. Values are local
// wall-clock "YYYY-MM-DD" strings.

import * as React from "react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MiniCalendar } from "@/components/ui/mini-calendar";
import { useNestedOverlayReporter } from "@/components/ui/nested-overlay";
import { toDateKey } from "@/lib/calendar/calendar-utils";

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
  const reportOverlay = useNestedOverlayReporter();

  function setOpenReported(next: boolean) {
    setOpen(next);
    reportOverlay(next);
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
        <MiniCalendar
          selected={fromDateKey(value)}
          onSelect={(day) => {
            onChange(toDateKey(day));
            setOpenReported(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
