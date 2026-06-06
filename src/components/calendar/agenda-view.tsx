"use client";

import {
  eventDayKey,
  formatDayLabel,
  groupEventsByDay,
  isToday,
  toDateKey,
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
  // Keep events on or after the anchor day, compared by calendar day (not raw
  // instant) so an all-day event anchored at midnight UTC isn't mistaken for the
  // day before — and so today's all-day events aren't dropped.
  const anchorKey = toDateKey(anchorDate);
  const upcoming = events.filter((e) => eventDayKey(e) >= anchorKey);
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
