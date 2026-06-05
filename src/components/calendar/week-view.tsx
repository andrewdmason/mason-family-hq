"use client";

import {
  getWeekDays,
  groupEventsByDay,
  isToday,
  toDateKey,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent } from "@/lib/calendar/types";
import { EventPill, type EventDisplay } from "./event-card";
import { cn } from "@/lib/utils";

export function WeekView({
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
  const days = getWeekDays(anchorDate);
  const byDay = groupEventsByDay(events);

  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-7">
      {days.map((day) => {
        const key = toDateKey(day);
        const dayEvents = (byDay.get(key) ?? []).slice().sort((a, b) =>
          a.start_time.localeCompare(b.start_time),
        );
        return (
          <div key={key} className="min-h-[8rem] bg-background p-2">
            <div
              className={cn(
                "mb-1.5 flex items-baseline gap-1 text-xs font-medium",
                isToday(day) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span>{day.toLocaleDateString("en-US", { weekday: "short" })}</span>
              <span
                className={cn(
                  "tabular-nums",
                  isToday(day) &&
                    "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
                )}
              >
                {day.getDate()}
              </span>
            </div>
            <div className="space-y-0.5">
              {dayEvents.map((event) => (
                <EventPill
                  key={event.id}
                  display={display(event)}
                  onClick={onEventClick}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
