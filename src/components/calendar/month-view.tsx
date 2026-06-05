"use client";

import {
  getMonthGrid,
  groupEventsByDay,
  isToday,
  toDateKey,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent } from "@/lib/calendar/types";
import { EventPill, type EventDisplay } from "./event-card";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_CELL = 3;

export function MonthView({
  events,
  anchorDate,
  display,
  onEventClick,
}: {
  events: CalendarEvent[];
  anchorDate: Date;
  display: (event: CalendarEvent) => EventDisplay;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const grid = getMonthGrid(anchorDate);
  const byDay = groupEventsByDay(events);
  const month = anchorDate.getMonth();

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {grid.flat().map((day) => {
          const key = toDateKey(day);
          const inMonth = day.getMonth() === month;
          const dayEvents = (byDay.get(key) ?? [])
            .slice()
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          const shown = dayEvents.slice(0, MAX_PER_CELL);
          const overflow = dayEvents.length - shown.length;
          return (
            <div
              key={key}
              className={cn(
                "min-h-[5.5rem] bg-background p-1",
                !inMonth && "bg-muted/30 text-muted-foreground",
              )}
            >
              <div
                className={cn(
                  "mb-0.5 text-right text-xs tabular-nums",
                  isToday(day) && "font-semibold text-primary",
                )}
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {shown.map((event) => (
                  <EventPill
                    key={event.id}
                    display={display(event)}
                    onClick={onEventClick}
                  />
                ))}
                {overflow > 0 && (
                  <div className="px-1 text-[11px] text-muted-foreground">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
