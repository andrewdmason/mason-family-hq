"use client";

import {
  formatDayLabel,
  groupEventsByDay,
  isToday,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, CalendarMember } from "@/lib/calendar/types";
import { EventColumnCard, EventRow, type EventDisplay } from "./event-card";
import { cn } from "@/lib/utils";

const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  a.start_time.localeCompare(b.start_time);

// Time-of-day bands. Times within a band aren't aligned across members — the
// cards just stack — so the view groups loosely by part of day instead of
// pretending to be a linear time grid. All-day events get their own band on top.
type BandKey = "all-day" | "morning" | "afternoon" | "evening";

const BANDS: { key: BandKey; label: string }[] = [
  { key: "all-day", label: "All day" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

function bandOf(event: CalendarEvent): BandKey {
  if (event.all_day) return "all-day";
  const hour = new Date(event.start_time).getHours();
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function AgendaView({
  events,
  anchorDate,
  members,
  display,
  onEventClick,
  selectedEventId,
}: {
  events: CalendarEvent[];
  anchorDate: Date;
  // The members to show as columns. Empty when the user has filtered down to
  // family-only events, in which case only the shared banner renders.
  members: CalendarMember[];
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

  const memberEmails = new Set(members.map((m) => m.email));
  const gridTemplateColumns = `repeat(${members.length}, minmax(0, 1fr))`;
  const minWidthStyle = members.length
    ? { minWidth: `${members.length * 160}px` }
    : undefined;

  // The member columns for one time band. Cards are aligned into rows by their
  // exact start time: events at the same time share a row (so a shared line
  // genuinely means simultaneous), and events at different times never do (so
  // 4:30 can't sit beside 1:00). It's ordinal, not linear — one compact row per
  // distinct time, no proportional gaps and no left-hand time axis — so it reads
  // like a calendar without pretending vertical space is clock time.
  function renderColumns(memberEvents: CalendarEvent[]) {
    if (members.length === 0 || memberEvents.length === 0) return null;

    const byTime = new Map<string, CalendarEvent[]>();
    for (const e of memberEvents) {
      const arr = byTime.get(e.start_time) ?? [];
      arr.push(e);
      byTime.set(e.start_time, arr);
    }
    const times = [...byTime.keys()].sort();

    return (
      <div className="space-y-1.5">
        {times.map((time) => {
          const rowEvents = byTime.get(time)!;
          return (
            <div
              key={time}
              className="grid gap-3"
              style={{ gridTemplateColumns }}
            >
              {members.map((m) => {
                const cards = rowEvents
                  .filter((e) => e.member_email === m.email)
                  .sort(byStart);
                return (
                  <div key={m.email} className="space-y-1.5">
                    {cards.map((event) => (
                      <EventColumnCard
                        key={event.id}
                        display={display(event)}
                        onClick={onEventClick}
                        selected={event.id === selectedEventId}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div style={minWidthStyle}>
        {/* Member column headers. */}
        {members.length > 0 && (
          <div
            className="grid gap-3 border-b pb-2"
            style={{ gridTemplateColumns }}
          >
            {members.map((m) => (
              <div
                key={m.email}
                className="flex items-center gap-1.5 px-1 text-sm font-semibold text-foreground"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: m.color ?? "#64748b" }}
                  aria-hidden
                />
                <span className="truncate">{m.name ?? m.email}</span>
              </div>
            ))}
          </div>
        )}

        {dayKeys.map((key) => {
          const date = new Date(key + "T12:00:00");
          const dayEvents = byDay.get(key)!;
          const isFamily = (e: CalendarEvent) =>
            !e.member_email || !memberEmails.has(e.member_email);

          return (
            <section key={key} className="mt-6 first:mt-3">
              <h3
                className={cn(
                  "mb-2 text-sm font-semibold",
                  isToday(date) ? "text-primary" : "text-foreground",
                )}
              >
                {formatDayLabel(date)}
              </h3>

              <div className="space-y-4">
                {BANDS.map((band) => {
                  const inBand = dayEvents.filter((e) => bandOf(e) === band.key);
                  if (inBand.length === 0) return null;
                  const familyEvents = inBand.filter(isFamily).sort(byStart);
                  const memberEvents = inBand.filter((e) => !isFamily(e));

                  return (
                    <div key={band.key}>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {band.label}
                      </p>

                      {/* Shared family events span the full width of the day. */}
                      {familyEvents.length > 0 && (
                        <div className="mb-1.5 space-y-0.5 rounded-lg bg-muted/40 p-1">
                          {familyEvents.map((event) => (
                            <EventRow
                              key={event.id}
                              display={display(event)}
                              onClick={onEventClick}
                              selected={event.id === selectedEventId}
                              showLocation={false}
                            />
                          ))}
                        </div>
                      )}

                      {renderColumns(memberEvents)}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
