"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AlertTriangle, Flag, MapPin } from "lucide-react";
import {
  eventDayKey,
  formatTimeRange,
  toDateKey,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, CalendarMember } from "@/lib/calendar/types";
import { DutyGlyphs, type EventDisplay } from "./event-card";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { cn } from "@/lib/utils";

// A true vertical time axis: position encodes when, height encodes how long.
// Each person gets a column on the shared axis (desktop); mobile merges them into
// one lane. Overlapping events in a lane are packed side-by-side so both stay
// legible — the narrowing itself signals the clash.
const PX_PER_HOUR = 48;
const GUTTER = 44; // px reserved for the hour labels
const MIN_BLOCK = 26; // px floor so a short event's label still fits
// On the phone layout a thin column's block only carries its baseball glyph once
// it's tall enough to fit it; below this it stays a bare colored rectangle.
const TALL = 34;
// On the phone layout the signed-in user's column is this many times as wide as
// the others, so it has room for event titles while the rest stay thin ticks.
const ME_WEIGHT = 3;
const FAMILY_KEY = "__family__";
// Warm taupe-gray for shared/family events (the prototype's #8a8a80), so "ours"
// reads neutral-but-warm against the cream ground rather than a cool slate.
const FAMILY_COLOR = "#8a8a80";
// A faint wash marking the signed-in user's own column — derived from their own
// color (like the prototype's Andrew-blue at low alpha) so it stays warm and on
// theme, rather than a fixed cool blue. color-mix works for hex or oklch alike.
// Desaturate a member color toward the warm gray ground — the prototype's earthy
// palette. Scoped to this view, so vivid member colors elsewhere (avatars, home)
// are untouched.
const mute = (color: string) => `color-mix(in srgb, ${color} 60%, #6f6a5f)`;
const meTint = (color: string) => `color-mix(in srgb, ${color} 7%, transparent)`;

// A tiny baseball — circle plus two curved seams — stamped on TeamSnap blocks in
// the textless mobile view so a sports commitment reads at a glance. Uses
// currentColor so the wrapper sets it against the saturated block fill.
function BaseballGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M3.5 4.2 C5.5 6 5.5 10 3.5 11.8" />
      <path d="M12.5 4.2 C10.5 6 10.5 10 12.5 11.8" />
    </svg>
  );
}

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
  beforeAxis,
}: {
  events: CalendarEvent[];
  anchorDate: Date;
  members: CalendarMember[];
  display: (event: CalendarEvent) => EventDisplay;
  onEventClick: (event: CalendarEvent) => void;
  selectedEventId: string | null;
  currentMemberEmail: string | null;
  /** Rendered between the anchored chrome and the time axis (triage bars). */
  beforeAxis?: ReactNode;
}) {
  // A live clock so the "now" line tracks the real time. Starts null so the
  // server and the first client render agree (no Date-dependent output during
  // SSR, which would hydrate-mismatch across timezones); the effect fills it in
  // on mount and refreshes every minute.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const initial = setTimeout(update, 0); // client-only, after first paint
    const id = setInterval(update, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);
  const isToday = now != null && toDateKey(anchorDate) === toDateKey(now);
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : -1;

  // The phone layout gives the signed-in user a wide, titled column and keeps the
  // others as thin ticks. We resolve the breakpoint in JS (not just CSS) because
  // the weighted column widths AND the shared-event overlay need the real column
  // geometry to line up. Start desktop (equal columns) so SSR/first paint stay
  // hydration-stable, like the clock above; the effect corrects it on mount.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const dayKey = toDateKey(anchorDate);
  const dayEvents = events.filter((e) => eventDayKey(e) === dayKey);
  const allDay = dayEvents.filter((e) => e.all_day).sort(byStart);
  const timed = dayEvents.filter((e) => !e.all_day);

  const memberEmails = new Set(members.map((m) => m.email));
  const isFamily = (e: CalendarEvent) =>
    !e.member_email || !memberEmails.has(e.member_email);

  // The viewed date, shown Google Calendar style in the all-day strip's
  // gutter ("WED 11") — it doubles as the day view's date display, so the
  // toolbar doesn't need a label.
  const weekday = anchorDate.toLocaleDateString("en-US", { weekday: "short" });
  const dayNum = anchorDate.getDate();

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

  // The shown members attending an event — its owner (when shown) plus any guest
  // members. The set, not an owner, is what a shared event really is.
  const attendingMembersOf = (e: CalendarEvent): string[] => {
    const set = new Set<string>();
    if (e.member_email && memberEmails.has(e.member_email))
      set.add(e.member_email);
    for (const a of display(e).attendees)
      if (memberEmails.has(a.email)) set.add(a.email);
    return [...set];
  };

  // Classify timed events. A multi-attendee event is drawn ONCE as a shared
  // object tied across its attendees' columns (below); a single-attendee event is
  // a solo block in its owner's column. Ownerless events fall to the Family column.
  const familyTimed = timed.filter(isFamily);
  const soloByEmail = new Map<string, CalendarEvent[]>();
  const sharedEvents: CalendarEvent[] = [];
  for (const e of timed) {
    if (isFamily(e)) continue;
    const attending = attendingMembersOf(e);
    if (attending.length >= 2) {
      sharedEvents.push(e);
    } else {
      const owner = attending[0] ?? e.member_email!;
      const arr = soloByEmail.get(owner) ?? [];
      arr.push(e);
      soloByEmail.set(owner, arr);
    }
  }

  // The columns on the axis: one per shown member, plus a shared "Family" column
  // when the day has any ownerless events. A family-only filter (no members)
  // collapses to that single Family column.
  type Column = {
    key: string;
    label: string;
    color: string;
    solo: CalendarEvent[];
    allDay: CalendarEvent[];
    isMe: boolean;
  };
  const columns: Column[] = members.map((m) => ({
    key: m.email,
    label: m.name ?? m.email,
    color: m.color ?? FAMILY_COLOR,
    solo: soloByEmail.get(m.email) ?? [],
    allDay: allDay.filter((e) => e.member_email === m.email),
    isMe: m.email === currentMemberEmail,
  }));
  const familyAllDay = allDay.filter(isFamily);
  if (familyTimed.length > 0 || familyAllDay.length > 0) {
    columns.push({
      key: FAMILY_KEY,
      label: "Family",
      color: FAMILY_COLOR,
      solo: familyTimed,
      allDay: familyAllDay,
      isMe: false,
    });
  }

  // The signed-in user always leads, so their day is the first thing read.
  const meIndex = columns.findIndex((c) => c.isMe);
  if (meIndex > 0) columns.unshift(columns.splice(meIndex, 1)[0]);

  // Map each shared event to the column indices it spans (computed after the
  // me-first reorder so positions are final).
  const colIndexByKey = new Map(columns.map((c, i) => [c.key, i]));
  const memberColumns = columns.filter((c) => c.key !== FAMILY_KEY);

  // Column widths. On the phone layout the signed-in user's column is ME_WEIGHT
  // times as wide as the others (room for titles); every other column is a thin
  // tick. Desktop keeps them equal. The shared-event overlay positions off these
  // same weights so it stays aligned with the columns underneath.
  const meColIndex = columns.findIndex((c) => c.isMe);
  const weights = columns.map((c) => (isMobile && c.isMe ? ME_WEIGHT : 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  // Left edge of column i as a fraction of the axis width: edge(0) === 0 and
  // edge(columns.length) === 1.
  const edge = (i: number) =>
    weights.slice(0, i).reduce((sum, w) => sum + w, 0) / totalWeight;
  // Explicit percentage widths, NOT flexGrow/flexBasis: 0 — with border-box a
  // zero basis is floored at each cell's padding+border, so rows whose cells
  // pad differently (padded name cells vs border-only axis columns) would
  // distribute the same weights differently and the columns would misalign.
  const colWidth = (i: number) => `${(weights[i] / totalWeight) * 100}%`;
  // A column renders full (titled) blocks on desktop, or when it's the signed-in
  // user's wide column on the phone; the other phone columns render thin ticks.
  const isFull = (i: number) => !isMobile || i === meColIndex;
  const sharedTimed = sharedEvents
    .map((event) => ({
      event,
      cols: attendingMembersOf(event)
        .map((email) => colIndexByKey.get(email))
        .filter((i): i is number => i != null)
        .sort((a, b) => a - b),
    }))
    .filter((s) => s.cols.length >= 2);

  // A row of dots, one per member column in left-to-right order, filled for the
  // members attending — so the exact combination reads at a glance, including
  // non-contiguous sets the bracket alone can't disambiguate.
  function AttendanceGlyph({ attending }: { attending: Set<string> }) {
    return (
      <span className="inline-flex items-center gap-[2px]" aria-hidden>
        {memberColumns.map((c) => {
          const on = attending.has(c.key);
          return (
            <span
              key={c.key}
              className={cn(
                "h-1.5 w-1.5 rounded-full border",
                !on && "border-muted-foreground/40",
              )}
              style={
                on
                  ? { backgroundColor: mute(c.color), borderColor: mute(c.color) }
                  : undefined
              }
            />
          );
        })}
      </span>
    );
  }

  // One positioned event block. A "full" block — every column on desktop, and the
  // signed-in user's wide column on the phone — is a white card with time/title/
  // location. A thin block — the other columns on the phone — is a bare member-
  // colored tick: position already says when and the column says who, so it shows
  // only a baseball glyph for TeamSnap games (when tall enough), no text.
  function Block({ placed, full }: { placed: Placed; full: boolean }) {
    const { event } = placed;
    const d = display(event);
    const trueTop = y(startMin(event));
    const trueHeight = y(endMin(event)) - trueTop;
    const height = Math.max(trueHeight, MIN_BLOCK);
    // A drop-off drive block too short to read at true scale grows UP from its
    // end, not down from its start: its anchor instant is the arrival, and by
    // construction the event it feeds into starts right where it ends — growing
    // down would bury it under that event's card (e.g. a 6-minute one-way
    // drop-off abutting a practice the same parent is attending).
    const top =
      event.drive_duty === "dropoff" && trueHeight < MIN_BLOCK
        ? trueTop + trueHeight - height
        : trueTop;
    const widthPct = 100 / placed.lanes;
    const leftPct = placed.lane * widthPct;
    const pos = {
      top,
      height,
      left: `calc(${leftPct}% + 1px)`,
      width: `calc(${widthPct}% - 3px)`,
    };
    const isDraft = event.id.startsWith("draft:");
    if (!full) {
      return (
        <button
          type="button"
          data-event-id={event.id}
          onClick={() => onEventClick(event)}
          title={
            d.calendarLabel ? `${d.calendarLabel}: ${event.title}` : event.title
          }
          style={{ ...pos, backgroundColor: mute(d.color) }}
          className={cn(
            "absolute flex items-start justify-end overflow-hidden rounded-sm px-0.5 py-0.5",
            event.id === selectedEventId && "ring-1 ring-ring",
            d.pendingDrive && "animate-pulse opacity-60",
            isDraft && "opacity-70",
          )}
        >
          {d.isTeamsnap && height >= TALL && (
            <BaseballGlyph className="h-2.5 w-2.5 shrink-0 text-white/90" />
          )}
        </button>
      );
    }
    // The start time is already encoded by the card's position on the axis, so
    // it's the first thing to drop when a short card can't fit it and the title.
    const showTime = height >= 46;
    return (
      <button
        type="button"
        data-event-id={event.id}
        onClick={() => onEventClick(event)}
        title={
          d.calendarLabel ? `${d.calendarLabel}: ${event.title}` : event.title
        }
        style={{ ...pos, borderLeftColor: mute(d.color) }}
        className={cn(
          "absolute flex flex-col overflow-hidden rounded-sm border border-border/70 border-l-[3px] bg-white px-1.5 py-0.5 text-left transition-colors hover:bg-muted/40 dark:bg-card",
          event.id === selectedEventId && "ring-1 ring-ring",
          // A duty tap's block-to-be: visible instantly, ghosted until the
          // real mirror row replaces it.
          d.pendingDrive && "animate-pulse opacity-60",
          // The not-yet-saved draft the panel is collecting details for.
          isDraft && "border-dashed bg-white/70 dark:bg-card/70",
        )}
      >
        {showTime && (
          <span className="flex items-center gap-1 text-[10px] italic tabular-nums leading-tight text-muted-foreground">
            <span className="truncate">
              {formatTimeRange(event.start_time, event.end_time, false)}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1 not-italic">
              {d.duties && (
                <DutyGlyphs
                  duties={d.duties}
                  hasLocation={!!event.location}
                />
              )}
              {d.attendees.length > 0 && (
                <span className="flex -space-x-1">
                  {d.attendees.slice(0, 3).map((a) => (
                    <span key={a.email} title={a.name ?? a.email} className="inline-flex">
                      <MemberAvatar name={a.name} size="xs" className="ring-1 ring-card" />
                    </span>
                  ))}
                </span>
              )}
            </span>
          </span>
        )}
        <span className={cn("flex items-start gap-1", showTime && "mt-0.5")}>
          <span className="line-clamp-2 min-w-0 text-[11px] leading-tight text-foreground">
            {d.calendarLabel && (
              <span className="text-muted-foreground">{d.calendarLabel}: </span>
            )}
            {event.title}
          </span>
          {d.conflict && (
            <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0 text-amber-600" />
          )}
          {/* Short cards drop the time row, so the duty glyphs ride the title
              row instead — the amber "unset" nudge can't be height-gated away. */}
          {!showTime && d.duties && (
            <DutyGlyphs
              duties={d.duties}
              hasLocation={!!event.location}
              className="ml-auto text-[10px]"
            />
          )}
        </span>
        {height >= 60 && event.location && (
          <span className="mt-0.5 flex items-center gap-0.5 truncate text-[10px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            {event.location}
          </span>
        )}
      </button>
    );
  }

  // A shared (multi-attendee) event drawn as ONE card frame spanning from its
  // first to its last attending column. The card is filled (a normal white card)
  // only over the columns that ARE attending; any column it jumps over is left as
  // an open "window" — the frame's top and bottom edges bridge across it, but its
  // interior is transparent, so the column beneath (its separators, its tint, its
  // free time) shows through. That reads as "these two are one event, and the
  // people in between simply aren't in it" rather than "their time is blocked."
  function renderSpanningEvent({
    event,
    cols,
  }: {
    event: CalendarEvent;
    cols: number[];
  }) {
    const d = display(event);
    const first = cols[0];
    const last = cols[cols.length - 1];
    const top = y(startMin(event));
    const height = Math.max(y(endMin(event)) - top, MIN_BLOCK);
    const everyone = cols.length === memberColumns.length;
    const selected = event.id === selectedEventId;
    const showTime = height >= 46;
    // The frame spans from the first to the last attending column, positioned off
    // the same weights as the columns (so it lines up when the me column is wide).
    const frameL = edge(first);
    const frameW = edge(last + 1) - frameL;
    // It renders full (titled) when it leads in the wide me column, or on desktop;
    // otherwise it's thin colored fills with just a glyph, like the solo ticks.
    const full = !isMobile || first === meColIndex;
    // Contiguous runs of attending columns — each gets a filled segment; the gaps
    // between runs are the open windows.
    const runs: Array<[number, number]> = [];
    for (const i of cols) {
      const r = runs[runs.length - 1];
      if (r && i === r[1] + 1) r[1] = i;
      else runs.push([i, i]);
    }
    // Content lives in the leading run so a long title truncates instead of
    // running across the windows. Positions are fractions of the frame's width.
    const fillLeft = (a: number) => ((edge(a) - frameL) / frameW) * 100;
    const fillWidth = (a: number, b: number) =>
      ((edge(b + 1) - edge(a)) / frameW) * 100;
    const leadWidthPct = ((edge(runs[0][1] + 1) - frameL) / frameW) * 100;
    return (
      <button
        key={event.id}
        type="button"
        data-event-id={event.id}
        onClick={() => onEventClick(event)}
        title={event.title}
        style={{
          top,
          height,
          left: `calc(${frameL * 100}% + 1px)`,
          width: `calc(${frameW * 100}% - 3px)`,
          borderLeftColor: mute(d.color),
        }}
        className={cn(
          "group pointer-events-auto absolute overflow-hidden rounded-sm bg-transparent text-left",
          full && "border border-border/70 border-l-[3px]",
          selected && "ring-1 ring-ring",
        )}
      >
        {/* Filled segments over the attending columns; the gaps between runs stay
            open windows. White cards when full, member-colored ticks when thin. */}
        {runs.map(([a, b]) => (
          <span
            key={`fill-${a}`}
            aria-hidden
            className={cn(
              "absolute inset-y-0 transition-colors",
              full && "bg-white group-hover:bg-muted/40 dark:bg-card",
            )}
            style={{
              left: `${fillLeft(a)}%`,
              width: `${fillWidth(a, b)}%`,
              ...(full ? null : { backgroundColor: mute(d.color) }),
            }}
          />
        ))}
        {/* Thin: just a baseball glyph in the leading run, once tall enough. */}
        {!full && d.isTeamsnap && height >= TALL && (
          <span
            className="absolute inset-y-0 left-0 flex items-start justify-end px-0.5 py-0.5"
            style={{ width: `${leadWidthPct}%` }}
          >
            <BaseballGlyph className="h-2.5 w-2.5 shrink-0 text-white/90" />
          </span>
        )}
        {/* Full content, in the leading run. */}
        {full && (
          <span
            className="absolute inset-y-0 left-0 flex flex-col overflow-hidden px-1.5 py-0.5"
            style={{ width: `${leadWidthPct}%` }}
          >
            {showTime && (
              <span className="flex items-center gap-1 text-[10px] italic tabular-nums leading-tight text-muted-foreground">
                <span className="truncate">
                  {formatTimeRange(event.start_time, event.end_time, false)}
                </span>
                {everyone && (
                  <span className="shrink-0 not-italic">· Everyone</span>
                )}
                {d.duties && (
                  <DutyGlyphs
                    duties={d.duties}
                    hasLocation={!!event.location}
                    className="ml-auto not-italic"
                  />
                )}
              </span>
            )}
            <span className={cn("flex items-start gap-1", showTime && "mt-0.5")}>
              <span className="line-clamp-2 min-w-0 text-[11px] leading-tight text-foreground">
                {event.title}
              </span>
              {d.conflict && (
                <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0 text-amber-600" />
              )}
            </span>
            {height >= 60 && event.location && (
              <span className="mt-0.5 flex items-center gap-0.5 truncate text-[10px] text-muted-foreground">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                {event.location}
              </span>
            )}
          </span>
        )}
      </button>
    );
  }

  // An all-day marker: a flag plus the title in a full (titled) column, matching
  // the agenda's treatment; a textless member-colored chip in a thin phone column.
  // A shared all-day event carries the same attendance glyph as the timed ones.
  function allDayItem(event: CalendarEvent, full: boolean) {
    const d = display(event);
    const attending = attendingMembersOf(event);
    if (!full) {
      return (
        <button
          key={event.id}
          type="button"
          data-event-id={event.id}
          onClick={() => onEventClick(event)}
          title={event.title}
          style={{ backgroundColor: mute(d.color) }}
          className={cn(
            "block h-2.5 w-full rounded-sm transition-colors",
            event.id === selectedEventId && "ring-1 ring-ring",
          )}
        />
      );
    }
    return (
      <button
        key={event.id}
        type="button"
        data-event-id={event.id}
        onClick={() => onEventClick(event)}
        title={event.title}
        className={cn(
          "flex w-full items-center gap-1 rounded px-0.5 text-left text-[11px] transition-colors hover:text-foreground",
          event.id === selectedEventId && "underline",
        )}
      >
        <Flag className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium text-foreground">
          {event.title}
        </span>
        {attending.length >= 2 && (
          <AttendanceGlyph attending={new Set(attending)} />
        )}
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
            className="absolute -translate-y-1/2 pr-1 text-right text-[10px] italic tabular-nums text-muted-foreground/80"
            style={{ top: y(h * 60), left: 0, width: GUTTER }}
          >
            {hourLabel(h)}
          </div>
        )}
      </div>
    ));
  }

  return (
    // Serif (Lora) for the view's text — the prototype's editorial voice — while
    // the header controls stay sans. Warm cream ground and hairlines come from the
    // app theme already.
    <div className="font-serif">
      {/* One column per person on a shared axis. Desktop shows full event cards;
          the narrow mobile columns drop to textless member-colored blocks so the
          four-column "who's busy today" read survives on a phone. */}
      <div>
        {/* Anchored chrome, Google Calendar style: the member columns and the
            all-day strip (whose gutter carries the viewed date) stick under
            the global header while the axis scrolls beneath them. This works
            inside the swipe track because the track's wrapper clips with
            overflow-x: clip — an overflow: hidden scrollport would swallow
            the stickiness. */}
        <div className="sticky top-14 z-30 bg-background">
          {/* Column headers — first name only on mobile to fit the narrow columns. */}
          <div className="flex" style={{ paddingLeft: GUTTER }}>
            {columns.map((c, i) => (
              <div
                key={c.key}
                className="flex min-w-0 shrink-0 items-center gap-1 px-1 pb-1.5 pt-1 text-[11px] font-medium text-foreground md:gap-1.5 md:px-2 md:pb-2 md:text-sm"
                style={{
                  width: colWidth(i),
                  ...(c.isMe
                    ? { backgroundColor: meTint(mute(c.color)) }
                    : null),
                }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full md:h-2.5 md:w-2.5"
                  style={{ backgroundColor: mute(c.color) }}
                  aria-hidden
                />
                <span className="truncate md:hidden">{c.label.split(" ")[0]}</span>
                <span className="hidden truncate md:inline">{c.label}</span>
              </div>
            ))}
          </div>

          {/* All-day strip. Its gutter shows the viewed date — today gets the
              filled badge — so the strip earns its place even on days with no
              all-day events. */}
          <div className="flex border-y border-border/60 bg-muted/20">
            <div
              className="flex shrink-0 flex-col items-center justify-center gap-0.5 py-1 pr-1"
              style={{ width: GUTTER }}
            >
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                {weekday}
              </span>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full font-sans text-sm font-semibold tabular-nums leading-none",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground",
                )}
              >
                {dayNum}
              </span>
            </div>
            <div className="flex min-w-0 flex-1">
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className="min-w-0 shrink-0 space-y-0.5 border-l border-border/40 px-1 py-1"
                  style={{
                    width: colWidth(i),
                    ...(c.isMe
                      ? { backgroundColor: meTint(mute(c.color)) }
                      : null),
                  }}
                >
                  {c.allDay.map((event) => allDayItem(event, isFull(i)))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {beforeAxis}

        {dayEvents.length === 0 ? (
          <p className="px-1 py-16 text-center text-sm text-muted-foreground">
            Nothing scheduled this day.
          </p>
        ) : (
          // The axis
          <div className="relative" style={{ height: totalH }}>
            {axisLines()}
            <div
              className="absolute inset-y-0 flex"
              style={{ left: GUTTER, right: 0 }}
            >
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className="relative min-w-0 shrink-0 border-l border-border/60"
                  style={{
                    width: colWidth(i),
                    ...(c.isMe
                      ? { backgroundColor: meTint(mute(c.color)) }
                      : null),
                  }}
                >
                  {pack(c.solo).map((p) => (
                    <Block key={p.event.id} placed={p} full={isFull(i)} />
                  ))}
                </div>
              ))}
            </div>
            {/* Shared events tie across columns in an overlay above them. */}
            {sharedTimed.length > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{ left: GUTTER, right: 0 }}
              >
                {sharedTimed.map((s) => renderSpanningEvent(s))}
              </div>
            )}
            {nowLine()}
          </div>
        )}
      </div>
    </div>
  );
}
