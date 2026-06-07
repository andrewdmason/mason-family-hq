"use client";

import { Fragment } from "react";
import {
  eventDayKey,
  formatDayLabel,
  formatWeekLabel,
  getWeekBounds,
  groupEventsByDay,
  isToday,
  toDateKey,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, CalendarMember } from "@/lib/calendar/types";
import {
  EventColumnCard,
  EventGhost,
  EventRow,
  type EventDisplay,
} from "./event-card";
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

  const memberEmails = new Set(members.map((m) => m.email));
  const memberByEmail = new Map(members.map((m) => [m.email, m]));
  const gridTemplateColumns = `repeat(${members.length}, minmax(0, 1fr))`;
  // Desktop reserves a fixed left gutter so the time-of-day labels (Morning,
  // Afternoon…) sit in their own column instead of crowding the first member.
  const LABEL_COL_PX = 96;
  const outerGrid = `${LABEL_COL_PX}px minmax(0, 1fr)`;
  const minWidthStyle = members.length
    ? { minWidth: `${members.length * 160 + LABEL_COL_PX}px` }
    : undefined;

  // An event is "family" — and renders in the shared full-width banner rather
  // than a member column — when it has no member, or its member isn't shown.
  const isFamily = (e: CalendarEvent) =>
    !e.member_email || !memberEmails.has(e.member_email);

  // The member identity stamped onto a single-column (mobile) row: first name
  // plus the member's color, matching the desktop column headers. fullName lets
  // the caller drop a redundant "· name" source label.
  function memberBadgeFor(event: CalendarEvent) {
    const m = event.member_email ? memberByEmail.get(event.member_email) : null;
    if (!m) return null;
    const fullName = m.name ?? m.email;
    return {
      name: fullName.split(" ")[0] || fullName,
      color: m.color ?? "#64748b",
      fullName,
    };
  }

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
                // Events owned by someone else that this member is attending show
                // as a muted "busy" ghost here (only meaningful with >1 column).
                const ghosts =
                  members.length > 1
                    ? rowEvents
                        .filter(
                          (e) =>
                            e.member_email !== m.email &&
                            display(e).attendees.some((a) => a.email === m.email),
                        )
                        .sort(byStart)
                    : [];
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
                    {ghosts.map((event) => (
                      <EventGhost
                        key={`ghost-${event.id}`}
                        display={display(event)}
                        onClick={onEventClick}
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

  // A single merged column for narrow viewports: every member event sorted by
  // time and stamped with its member, so identity survives without column
  // headers. This is the Cozi-style "one timeline, color-dot per person" view.
  function renderMemberList(memberEvents: CalendarEvent[]) {
    if (memberEvents.length === 0) return null;
    const sorted = [...memberEvents].sort(byStart);

    return (
      <div className="space-y-0.5">
        {sorted.map((event) => {
          const d = display(event);
          const badge = memberBadgeFor(event);
          // The badge already names who it's for, so drop a source label that's
          // just the member's own name — otherwise it reads "Oscar · Oscar".
          const rowDisplay =
            badge && d.sourceLabel === badge.fullName
              ? { ...d, sourceLabel: null }
              : d;
          return (
            <EventRow
              key={event.id}
              display={rowDisplay}
              onClick={onEventClick}
              selected={event.id === selectedEventId}
              memberBadge={badge && { name: badge.name, color: badge.color }}
            />
          );
        })}
      </div>
    );
  }

  // The time bands for one day. The member events render as columns (desktop) or
  // a single merged list (mobile); the shared family banner is the same in both.
  function renderBands(
    dayEvents: CalendarEvent[],
    layout: "columns" | "list",
  ) {
    return (
      <div className="space-y-4">
        {BANDS.map((band) => {
          const inBand = dayEvents.filter((e) => bandOf(e) === band.key);
          if (inBand.length === 0) return null;
          const familyEvents = inBand.filter(isFamily).sort(byStart);
          const memberEvents = inBand.filter((e) => !isFamily(e));

          const label = (
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {band.label}
            </p>
          );

          const content = (
            <>
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

              {layout === "columns"
                ? renderColumns(memberEvents)
                : renderMemberList(memberEvents)}
            </>
          );

          // Mobile: the label stacks on top of a single merged column.
          if (layout === "list") {
            return (
              <div key={band.key}>
                <div className="mb-1.5">{label}</div>
                {content}
              </div>
            );
          }

          // Desktop: the label lives in the reserved left gutter, aligned to the
          // top of its band's content so it reads as a row header.
          return (
            <div
              key={band.key}
              className="grid gap-3"
              style={{ gridTemplateColumns: outerGrid }}
            >
              <div className="pt-0.5">{label}</div>
              <div>{content}</div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderDays(layout: "columns" | "list") {
    let prevWeekKey: string | null = null;
    return dayKeys.map((key) => {
      const date = new Date(key + "T12:00:00");
      // Drop a labeled divider whenever the calendar week (Mon–Sun) rolls over,
      // so long scrolls break into scannable weeks. Never before the first day.
      const weekKey = toDateKey(getWeekBounds(date).start);
      const showWeekBreak = prevWeekKey !== null && weekKey !== prevWeekKey;
      prevWeekKey = weekKey;
      return (
        <Fragment key={key}>
          {showWeekBreak && (
            <div className="mt-8 mb-3 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {formatWeekLabel(date)}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          <section className={showWeekBreak ? "mt-2" : "mt-6 first:mt-3"}>
            <h3
              className={cn(
                "mb-3 text-lg font-semibold tracking-tight",
                isToday(date) ? "text-primary" : "text-foreground",
              )}
            >
              {formatDayLabel(date)}
            </h3>
            {renderBands(byDay.get(key)!, layout)}
          </section>
        </Fragment>
      );
    });
  }

  return (
    <>
      {/* Desktop: per-member columns, scrolling horizontally if narrow. */}
      <div className="hidden overflow-x-auto md:block">
        <div style={minWidthStyle}>
          {/* Member column headers, offset by the empty label gutter so they
              align with the columns under each time band. */}
          {members.length > 0 && (
            <div
              className="grid gap-3 border-b pb-2"
              style={{ gridTemplateColumns: outerGrid }}
            >
              <div />
              <div className="grid gap-3" style={{ gridTemplateColumns }}>
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
            </div>
          )}
          {renderDays("columns")}
        </div>
      </div>

      {/* Mobile: a single merged column, each row stamped with its member. */}
      <div className="md:hidden">{renderDays("list")}</div>
    </>
  );
}
