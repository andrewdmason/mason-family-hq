"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Flag, MapPin } from "lucide-react";
import {
  eventDayKey,
  formatTimeRange,
  toDateKey,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, CalendarMember } from "@/lib/calendar/types";
import type { EventDisplay } from "./event-card";
import { cn } from "@/lib/utils";

// A true vertical time axis: position encodes when, height encodes how long.
// Each person gets a column on the shared axis (desktop); mobile merges them into
// one lane. Overlapping events in a lane are packed side-by-side so both stay
// legible — the narrowing itself signals the clash.
const PX_PER_HOUR = 48;
const GUTTER = 44; // px reserved for the hour labels
const MIN_BLOCK = 26; // px floor so a short event's label still fits
const FAMILY_KEY = "__family__";
const FAMILY_COLOR = "#64748b";
// A subtle blue wash marking the signed-in user's own column.
const ME_TINT = "bg-blue-50/70 dark:bg-blue-500/10";

const localMin = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
const startMin = (e: CalendarEvent) => localMin(e.start_time);
const endMin = (e: CalendarEvent) => {
  const s = startMin(e);
  if (!e.end_time) return s + 30; // give a point-in-time event a visible block
  const em = localMin(e.end_time);
  return em <= s ? 24 * 60 : Math.max(em, s + 15); // clamp events crossing midnight
};
const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  a.start_time.localeCompare(b.start_time) || endMin(a) - endMin(b);

type Placed = { event: CalendarEvent; lane: number; lanes: number };

// Interval-partition a column's events into side-by-side lanes: chained overlaps
// form a cluster, and within it each event takes the first lane free at its start
// time. Every event in a cluster shares the cluster's lane count so their widths
// line up.
function pack(events: CalendarEvent[]): Placed[] {
  const sorted = [...events].sort(byStart);
  const out: Placed[] = [];
  let cluster: { event: CalendarEvent; end: number; lane: number }[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = cluster.reduce((m, c) => Math.max(m, c.lane + 1), 0);
    for (const c of cluster) out.push({ event: c.event, lane: c.lane, lanes });
    cluster = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    const s = startMin(event);
    if (cluster.length && s >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const c of cluster)
      laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -1, c.end);
    let lane = 0;
    while (laneEnds[lane] != null && laneEnds[lane] > s) lane++;
    const e = endMin(event);
    cluster.push({ event, end: e, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

const hourLabel = (h: number) => {
  const hr = h % 24;
  if (hr === 0) return "12a";
  if (hr < 12) return `${hr}a`;
  if (hr === 12) return "12p";
  return `${hr - 12}p`;
};

export function DayView({
  events,
  anchorDate,
  members,
  display,
  onEventClick,
  selectedEventId,
  currentMemberEmail,
}: {
  events: CalendarEvent[];
  anchorDate: Date;
  members: CalendarMember[];
  display: (event: CalendarEvent) => EventDisplay;
  onEventClick: (event: CalendarEvent) => void;
  selectedEventId: string | null;
  currentMemberEmail: string | null;
}) {
  // A live clock so the "now" line tracks the real time. Minute granularity is
  // plenty for an hour-scale axis; the interval is cleared on unmount.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const isToday = toDateKey(anchorDate) === toDateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const dayKey = toDateKey(anchorDate);
  const dayEvents = events.filter((e) => eventDayKey(e) === dayKey);
  const allDay = dayEvents.filter((e) => e.all_day).sort(byStart);
  const timed = dayEvents.filter((e) => !e.all_day);

  const memberEmails = new Set(members.map((m) => m.email));
  const isFamily = (e: CalendarEvent) =>
    !e.member_email || !memberEmails.has(e.member_email);

  if (dayEvents.length === 0) {
    return (
      <p className="px-1 py-16 text-center text-sm text-muted-foreground">
        Nothing scheduled this day.
      </p>
    );
  }

  // Time window: a 6 a.m.–10 p.m. spine, widened to swallow any event that runs
  // earlier or later so nothing falls off the axis.
  let minH = 6;
  let maxH = 22;
  for (const e of timed) {
    minH = Math.min(minH, Math.floor(startMin(e) / 60));
    maxH = Math.max(maxH, Math.ceil(endMin(e) / 60));
  }
  // Keep the current-time line on the axis when we're looking at today.
  if (isToday) {
    minH = Math.min(minH, Math.floor(nowMin / 60));
    maxH = Math.max(maxH, Math.ceil(nowMin / 60) + 1);
  }
  minH = Math.max(0, minH);
  maxH = Math.min(24, maxH);
  const totalH = (maxH - minH) * PX_PER_HOUR;
  const y = (min: number) => ((min - minH * 60) / 60) * PX_PER_HOUR;
  const hourMarks = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);

  // The columns on the axis: one per shown member, plus a shared "Family" column
  // when the day has any ownerless events. A family-only filter (no members)
  // collapses to that single Family column.
  type Column = {
    key: string;
    label: string;
    color: string;
    events: CalendarEvent[];
    allDay: CalendarEvent[];
    isMe: boolean;
  };
  const columns: Column[] = members.map((m) => ({
    key: m.email,
    label: m.name ?? m.email,
    color: m.color ?? FAMILY_COLOR,
    events: timed.filter((e) => e.member_email === m.email),
    allDay: allDay.filter((e) => e.member_email === m.email),
    isMe: m.email === currentMemberEmail,
  }));
  const familyTimed = timed.filter(isFamily);
  const familyAllDay = allDay.filter(isFamily);
  if (familyTimed.length > 0 || familyAllDay.length > 0) {
    columns.push({
      key: FAMILY_KEY,
      label: "Family",
      color: FAMILY_COLOR,
      events: familyTimed,
      allDay: familyAllDay,
      isMe: false,
    });
  }

  // The signed-in user always leads, so their day is the first thing read.
  const meIndex = columns.findIndex((c) => c.isMe);
  if (meIndex > 0) columns.unshift(columns.splice(meIndex, 1)[0]);

  const hasAllDay = columns.some((c) => c.allDay.length > 0);

  // One positioned event block. `showMember` stamps the owner's name — used only
  // in the merged mobile lane, where columns don't carry identity.
  function Block({
    placed,
    showMember,
  }: {
    placed: Placed;
    showMember?: boolean;
  }) {
    const { event } = placed;
    const d = display(event);
    const top = y(startMin(event));
    const height = Math.max(y(endMin(event)) - top, MIN_BLOCK);
    const widthPct = 100 / placed.lanes;
    const leftPct = placed.lane * widthPct;
    const memberName =
      showMember && event.member_email
        ? (members.find((m) => m.email === event.member_email)?.name ?? "")
            .split(" ")[0]
        : null;
    return (
      <button
        type="button"
        onClick={() => onEventClick(event)}
        title={
          d.calendarLabel ? `${d.calendarLabel}: ${event.title}` : event.title
        }
        style={{
          top,
          height,
          left: `calc(${leftPct}% + 1px)`,
          width: `calc(${widthPct}% - 3px)`,
          borderLeftColor: d.color,
        }}
        className={cn(
          "absolute overflow-hidden rounded-md border border-border/70 border-l-[3px] bg-card px-1.5 py-0.5 text-left shadow-sm transition-colors hover:bg-muted/50",
          event.id === selectedEventId && "ring-1 ring-ring",
        )}
      >
        <span className="flex items-center gap-1 text-[10px] tabular-nums leading-tight text-muted-foreground">
          <span className="truncate">
            {formatTimeRange(event.start_time, event.end_time, false)}
          </span>
          {d.conflict && (
            <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-600" />
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-tight text-foreground">
          {memberName && (
            <span className="text-muted-foreground">{memberName} · </span>
          )}
          {d.calendarLabel && (
            <span className="text-muted-foreground">{d.calendarLabel}: </span>
          )}
          {event.title}
        </span>
        {height >= 46 && event.location && (
          <span className="mt-0.5 flex items-center gap-0.5 truncate text-[10px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            {event.location}
          </span>
        )}
      </button>
    );
  }

  // An all-day marker: a flag plus the title, matching the agenda's treatment.
  function allDayItem(event: CalendarEvent) {
    const d = display(event);
    return (
      <button
        key={event.id}
        type="button"
        onClick={() => onEventClick(event)}
        className={cn(
          "flex w-full items-center gap-1 rounded px-0.5 text-left text-[11px] transition-colors hover:text-foreground",
          event.id === selectedEventId && "underline",
        )}
      >
        <Flag className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium text-foreground">
          {event.title}
        </span>
        {d.conflict && (
          <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-600" />
        )}
      </button>
    );
  }

  // Fantastical-style current-time marker: a thin red rule across the axis with
  // a dot anchored in the hour gutter. Only on today, only when in the window.
  function nowLine() {
    if (!isToday || nowMin < minH * 60 || nowMin > maxH * 60) return null;
    return (
      <div
        className="pointer-events-none absolute inset-x-0 z-20"
        style={{ top: y(nowMin) }}
        aria-hidden
      >
        <div
          className="absolute h-2 w-2 -translate-y-1/2 rounded-full bg-red-500"
          style={{ left: GUTTER - 4 }}
        />
        <div
          className="absolute border-t border-red-500"
          style={{ left: GUTTER, right: 0 }}
        />
      </div>
    );
  }

  function axisLines() {
    return hourMarks.map((h) => (
      <div key={h}>
        <div
          className="absolute border-t border-border/50"
          style={{ top: y(h * 60), left: GUTTER, right: 0 }}
          aria-hidden
        />
        {h < maxH && (
          <div
            className="absolute -translate-y-1/2 pr-1 text-right text-[10px] tabular-nums text-muted-foreground"
            style={{ top: y(h * 60), left: 0, width: GUTTER }}
          >
            {hourLabel(h)}
          </div>
        )}
      </div>
    ));
  }

  return (
    <>
      {/* Desktop: a column per person on a shared axis. */}
      <div className="hidden md:block">
        {/* Column headers */}
        <div className="flex" style={{ paddingLeft: GUTTER }}>
          {columns.map((c) => (
            <div
              key={c.key}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 px-2 pb-2 pt-1 text-sm font-semibold text-foreground",
                c.isMe && ME_TINT,
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
                aria-hidden
              />
              <span className="truncate">{c.label}</span>
            </div>
          ))}
        </div>

        {/* All-day strip */}
        {hasAllDay && (
          <div className="flex border-y border-border/60 bg-muted/20">
            <div
              className="shrink-0 py-1 pr-1 text-right text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
              style={{ width: GUTTER }}
            >
              All day
            </div>
            <div className="flex min-w-0 flex-1">
              {columns.map((c) => (
                <div
                  key={c.key}
                  className={cn(
                    "min-w-0 flex-1 space-y-0.5 border-l border-border/40 px-1 py-1",
                    c.isMe && ME_TINT,
                  )}
                >
                  {c.allDay.map((event) => allDayItem(event))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The axis */}
        <div className="relative" style={{ height: totalH }}>
          {axisLines()}
          <div
            className="absolute inset-y-0 flex"
            style={{ left: GUTTER, right: 0 }}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                className={cn(
                  "relative min-w-0 flex-1 border-l border-border/60",
                  c.isMe && ME_TINT,
                )}
              >
                {pack(c.events).map((p) => (
                  <Block key={p.event.id} placed={p} />
                ))}
              </div>
            ))}
          </div>
          {nowLine()}
        </div>
      </div>

      {/* Mobile: one merged lane, each block stamped with its owner. */}
      <div className="md:hidden">
        {allDay.length > 0 && (
          <div className="mb-2 space-y-0.5 border-b pb-2">
            {allDay.map((event) => allDayItem(event))}
          </div>
        )}
        <div className="relative" style={{ height: totalH }}>
          {axisLines()}
          <div
            className="absolute inset-y-0"
            style={{ left: GUTTER, right: 0 }}
          >
            {pack(timed).map((p) => (
              <Block key={p.event.id} placed={p} showMember />
            ))}
          </div>
          {nowLine()}
        </div>
      </div>
    </>
  );
}
