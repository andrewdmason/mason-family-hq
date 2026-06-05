"use client";

import {
  formatDayLabel,
  groupEventsByDay,
  isToday,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent } from "@/lib/calendar/types";
import { EventRow, type EventDisplay } from "./event-card";
import { cn } from "@/lib/utils";

export function AgendaView({
  events,
  anchorDate,
  display,
  onEventClick,
  selectedEventId,
}: {
  events: CalendarEvent[];
  anchorDate: Date;
  display: (event: CalendarEvent) => EventDisplay;
  onEventClick: (event: CalendarEvent) => void;
  selectedEventId: string | null;
}) {
  const dayStart = new Date(anchorDate);
  dayStart.setHours(0, 0, 0, 0);

  const upcoming = events.filter(
    (e) => new Date(e.start_time).getTime() >= dayStart.getTime(),
  );
  const byDay = groupEventsByDay(upcoming);
  const dayKeys = [...byDay.keys()].sort();

  if (dayKeys.length === 0) {
    return (
      <p className="px-1 py-16 text-center text-sm text-muted-foreground">
        Nothing on the calendar from here on.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {dayKeys.map((key) => {
        const date = new Date(key + "T12:00:00");
        const dayEvents = byDay.get(key)!;
        return (
          <section key={key}>
            <h3
              className={cn(
                "sticky top-0 mb-1 bg-background/95 py-1 text-sm font-semibold backdrop-blur",
                isToday(date) ? "text-primary" : "text-foreground",
              )}
            >
              {formatDayLabel(date)}
            </h3>
            <div className="space-y-0.5">
              {dayEvents.map((event) => (
                <EventRow
                  key={event.id}
                  display={display(event)}
                  onClick={onEventClick}
                  selected={event.id === selectedEventId}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
