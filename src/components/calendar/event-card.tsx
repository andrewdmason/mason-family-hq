"use client";

import { AlertTriangle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeRange } from "@/lib/calendar/calendar-utils";
import type { CalendarEvent } from "@/lib/calendar/types";

export interface EventDisplay {
  event: CalendarEvent;
  color: string;
  sourceLabel: string | null;
  conflict: boolean;
}

/** A row in the agenda / day list. */
export function EventRow({
  display,
  onClick,
  selected,
}: {
  display: EventDisplay;
  onClick: (event: CalendarEvent) => void;
  selected?: boolean;
}) {
  const { event, color, sourceLabel, conflict } = display;
  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted/60",
        selected && "border-border bg-muted/60",
      )}
    >
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {event.title}
          </span>
          {conflict && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {formatTimeRange(event.start_time, event.end_time, event.all_day)}
          </span>
          {sourceLabel && <span className="truncate">· {sourceLabel}</span>}
          {event.location && (
            <span className="inline-flex items-center gap-0.5 truncate">
              <MapPin className="h-3 w-3" />
              {event.location}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** A compact pill for week / month grids. */
export function EventPill({
  display,
  onClick,
}: {
  display: EventDisplay;
  onClick: (event: CalendarEvent) => void;
}) {
  const { event, color, conflict } = display;
  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      title={event.title}
      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-colors hover:bg-muted"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {!event.all_day && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {new Date(event.start_time).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
      <span className="truncate text-foreground">{event.title}</span>
      {conflict && (
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
      )}
    </button>
  );
}
