"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Flag, MapPin } from "lucide-react";
import {
  eventDayKey,
  formatTimeRange,
  getWeekDays,
  mutedColor,
  toDateKey,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, CalendarMember } from "@/lib/calendar/types";
import {
  byStart,
  driveArrowClip,
  driveDutyOf,
  endMin,
  hourLabel,
  pack,
  startMin,
  timeWindow,
  wash,
  type Placed,
} from "@/lib/calendar/grid-layout";
import { DutyGlyphs, type EventDisplay } from "./event-card";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { cn } from "@/lib/utils";

// The week as seven shared day columns on one time axis — the day view, fanned
// across the week. Each day column is a miniature of it: your own events as
// white titled cards filling the column, and everyone else's collapsed to a thin
// dot-rail down the leading edge (a colored dot per event, diamonds for drive
// legs, overlaps stacked on one line). Who an event belongs to is said by color;
// the others' titles stay hidden until you hover a dot (there's no room for a
// labels column across seven days). The only other vivid ink is what needs
// attention: amber for conflicts and unassigned duties, red for now.
//
// Mobile transposes a single shared chart: days become rows (Mon top), time
// flows rightward, each row is one track holding the whole family — the week
// reads on one screen like seven lines of text, and the day view is a tap away.
const PX_PER_HOUR = 30; // denser than the day view's 48 — week over detail
const GUTTER = 44; // px reserved for the hour labels (desktop)
const MIN_BLOCK = 16; // px floor so a short event still shows its title line
const DATE_COL = 44; // px reserved for the date labels (mobile)
const TRACK_H = 22; // px height of a mobile day row's time track
// Desktop week borrows the day view's pin treatment for everyone-but-you: a set
// of thin per-member lanes down each day column's TRAILING (right) edge, one lane
// per other family member, each holding that member's events as colored dots
// (diamonds for drive legs) with overlaps stacked on one line. Titles stay hidden
// until you hover a dot (no room for a labels column across seven days). Your own
// events keep the white titled cards filling the rest of the column to the left.
const LANE = 12; // px — width of one other member's dot lane
const DOT = 7; // px — an other member's start marker
const RULE_W = 2; // px — the marker's duration rule
const RAIL_MIN = 9; // px floor so a short event's rule still reads under its dot
// A block grows text the moment it's actually wide and tall enough to hold it,
// so a crowded cluster degrades to silhouette instead of clipped letters.
const TEXT_MIN_W = 42;
const TEXT_MIN_H = 12;

type DayData = {
  date: Date;
  key: string;
  allDay: CalendarEvent[];
  // Mobile packs every event into one shared track; desktop splits them: the
  // signed-in user's events (lane-packed cards) vs. everyone else's (rail dots).
  placed: Placed[];
  minePlaced: Placed[];
  others: CalendarEvent[];
};

export function WeekView({
  events,
  anchorDate,
  members,
  display,
  onEventClick,
  selectedEventId,
  currentMemberEmail,
  onDayOpen,
}: {
  events: CalendarEvent[];
  anchorDate: Date;
  members: CalendarMember[];
  display: (event: CalendarEvent) => EventDisplay;
  onEventClick: (event: CalendarEvent) => void;
  selectedEventId: string | null;
  currentMemberEmail: string | null;
  /** Drill into the day view for a date — day headers and empty day regions. */
  onDayOpen: (date: Date) => void;
}) {
  // Null-seeded clock + desktop-seeded breakpoint, exactly like the day view:
  // no Date- or viewport-dependent output during SSR (hydration-stable), the
  // effects correct both on mount.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const initial = setTimeout(update, 0);
    const id = setInterval(update, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);
  const todayKey = now ? toDateKey(now) : null;
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : -1;

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // The grid's real pixel width, so blocks can decide whether they're wide
  // enough to carry their title. Starts 0 (textless) for a hydration-stable
  // first paint; the observer fills it in and tracks window resizes.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridW, setGridW] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

  // One prep pass both layouts consume: each day's lane-packed events, the
  // shared hour window, and a display cache (display() is closure-heavy and
  // every block needs it).
  const { days, minH, maxH, displayById } = useMemo(() => {
    const weekDays = getWeekDays(anchorDate);
    const keys = weekDays.map(toDateKey);
    const keySet = new Set(keys);
    // eventDayKey is the one correct day-bucketing path (all-day events are
    // anchored to midnight UTC; reading them in local time shifts them a day).
    const weekEvents = events.filter((e) => keySet.has(eventDayKey(e)));
    const timed = weekEvents.filter((e) => !e.all_day);

    const displayById = new Map<string, EventDisplay>();
    for (const e of weekEvents) displayById.set(e.id, display(e));

    const mine = (e: CalendarEvent) =>
      !!currentMemberEmail && e.member_email === currentMemberEmail;
    const days: DayData[] = weekDays.map((date, i) => {
      const key = keys[i];
      const dayTimed = timed.filter((e) => eventDayKey(e) === key);
      return {
        date,
        key,
        allDay: weekEvents
          .filter((e) => e.all_day && eventDayKey(e) === key)
          .sort(byStart),
        placed: pack(dayTimed),
        minePlaced: pack(dayTimed.filter(mine)),
        others: dayTimed.filter((e) => !mine(e)).sort(byStart),
      };
    });

    const { minH, maxH } = timeWindow(timed, { startH: 7, endH: 22 });
    return { days, minH, maxH, displayById };
  }, [events, anchorDate, display, currentMemberEmail]);

  const totalMin = (maxH - minH) * 60;
  const winTop = minH * 60;
  const dGet = (e: CalendarEvent) => displayById.get(e.id) ?? display(e);

  // The other family members, each its own lane on the right edge of every day —
  // a fixed left-to-right order so a member reads as one column down the week.
  // Their lanes' combined width is reserved out of each day column.
  const otherCols = useMemo(
    () => members.filter((m) => m.email !== currentMemberEmail),
    [members, currentMemberEmail],
  );
  const laneOf = useMemo(() => {
    const map = new Map<string, number>();
    otherCols.forEach((m, i) => map.set(m.email, i));
    return (e: CalendarEvent) => {
      const i = e.member_email ? map.get(e.member_email) : undefined;
      return i ?? 0;
    };
  }, [otherCols]);
  const railW = otherCols.length * LANE;

  // The desktop hover card: one shared fixed-position element fed by plain
  // mouse handlers — not a popover primitive per block, which would mount a
  // portal for every event of the week.
  const [hover, setHover] = useState<{
    event: CalendarEvent;
    rect: DOMRect;
  } | null>(null);

  // The amber attention marks — the only vivid ink on the chart. Conflict: a
  // filled dot. Duty nobody has claimed (and there's somewhere to drive): a
  // hollow dot, the same nudge as the day view's cards.
  const needsDutyNudge = (e: CalendarEvent, d: EventDisplay) =>
    !!d.duties &&
    !!e.location &&
    (d.duties.dropoff === "unset" || d.duties.pickup === "unset");

  function alertDots(e: CalendarEvent, d: EventDisplay) {
    const conflict = d.conflict;
    const duty = needsDutyNudge(e, d);
    if (!conflict && !duty) return null;
    return (
      <span
        className="pointer-events-none absolute right-0.5 top-0.5 z-10 flex gap-0.5"
        aria-hidden
      >
        {conflict && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
        {duty && (
          <span className="h-1.5 w-1.5 rounded-full border border-amber-500 bg-background" />
        )}
      </span>
    );
  }

  // ---- Desktop: 7 shared day columns on a vertical axis --------------------

  // Your own event: the day view's white titled card, lane-packed in the card
  // area to the right of the dot-rail. `cardPx` is that area's width (per lane)
  // so the title only renders when it'll actually fit.
  function desktopMineCard(placed: Placed, cardPx: number) {
    const { event } = placed;
    const d = dGet(event);
    const isDrive = !!event.drive_source_event_id;
    const isDraft = event.id.startsWith("draft:");
    const top = ((startMin(event) - winTop) / 60) * PX_PER_HOUR;
    const height = Math.max(
      ((endMin(event) - startMin(event)) / 60) * PX_PER_HOUR,
      isDrive ? 8 : MIN_BLOCK,
    );
    const widthPct = 100 / placed.lanes;
    const blockPx = cardPx / placed.lanes;
    const showText = blockPx >= TEXT_MIN_W && height >= TEXT_MIN_H;
    const duty = isDrive ? driveDutyOf(event) : null;
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
          left: `calc(${placed.lane * widthPct}% + 1px)`,
          width: `calc(${widthPct}% - 3px)`,
          ...(isDrive
            ? { backgroundColor: mutedColor(d.color) }
            : { borderLeftColor: mutedColor(d.color) }),
          ...(duty ? { clipPath: driveArrowClip(duty, 5) } : null),
        }}
        className={cn(
          "absolute z-10 overflow-hidden text-left transition-[filter] hover:brightness-95",
          isDrive
            ? "rounded-[2px]"
            : "rounded-sm border border-border/70 border-l-[3px] bg-white hover:bg-muted/40 dark:bg-card",
          event.id === selectedEventId && "z-20 ring-1 ring-ring",
          d.pendingDrive && "animate-pulse opacity-60",
          isDraft &&
            (isDrive
              ? "border border-dashed border-foreground/40 opacity-70"
              : "border-dashed bg-white/70 opacity-70 dark:bg-card/70"),
        )}
      >
        {!isDrive && alertDots(event, d)}
        {showText && (
          <span
            className={cn(
              "block min-w-0 pt-px text-[10px] leading-[1.15]",
              height >= 36 ? "line-clamp-3" : height >= 24 ? "line-clamp-2" : "truncate",
              isDrive ? "text-white/95" : "text-foreground",
              // Pad a drive arrow's pointed end(s) so text clears the cut.
              duty === "dropoff" && "pl-1 pr-2",
              duty === "pickup" && "pl-2 pr-1",
              duty === "combined" && "px-2",
              !isDrive && "px-1",
            )}
          >
            {event.title}
          </span>
        )}
      </button>
    );
  }

  // Another member's event: a colored dot (◆ for a drive leg) at its start with a
  // thin rule down its duration, in that member's lane on the day's right edge. No
  // title — hovering reveals the label card. Overlapping events in one member's
  // lane stack on the same line.
  function desktopRailPin(event: CalendarEvent) {
    const d = dGet(event);
    const color = mutedColor(d.color);
    const top = ((startMin(event) - winTop) / 60) * PX_PER_HOUR;
    const height = Math.max(
      ((endMin(event) - startMin(event)) / 60) * PX_PER_HOUR,
      RAIL_MIN,
    );
    const isDrive = !!event.drive_source_event_id;
    const selected = event.id === selectedEventId;
    const hot = hover?.event.id === event.id;
    const ruleW = hot ? RULE_W + 1 : RULE_W;
    const markerSize = isDrive ? DOT - 1 : DOT;
    return (
      <button
        key={event.id}
        type="button"
        data-event-id={event.id}
        onClick={() => {
          setHover(null);
          onEventClick(event);
        }}
        onMouseEnter={(e) =>
          setHover({ event, rect: e.currentTarget.getBoundingClientRect() })
        }
        onMouseLeave={() => setHover(null)}
        style={{ top, height, left: laneOf(event) * LANE, width: LANE }}
        className={cn(
          "group absolute flex justify-center overflow-visible",
          hot ? "z-20" : "z-10",
          d.pendingDrive && "animate-pulse opacity-60",
        )}
      >
        <span className="relative shrink-0" style={{ width: DOT }} aria-hidden>
          <span
            className="absolute rounded-full"
            style={{
              left: (DOT - ruleW) / 2,
              top: 0,
              bottom: 0,
              width: ruleW,
              backgroundColor: color,
            }}
          />
          <span
            className={cn(
              "absolute transition-transform",
              hot && "scale-125",
              isDrive ? "rotate-45 rounded-[1px]" : "rounded-full",
              selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
            style={{
              left: (DOT - markerSize) / 2,
              top: -markerSize / 2,
              width: markerSize,
              height: markerSize,
              backgroundColor: color,
            }}
          />
        </span>
      </button>
    );
  }

  function desktopAllDayChip(event: CalendarEvent) {
    const d = dGet(event);
    return (
      <button
        key={event.id}
        type="button"
        data-event-id={event.id}
        onClick={() => onEventClick(event)}
        title={event.title}
        className={cn(
          "flex w-full items-center gap-0.5 rounded px-0.5 text-left text-[10px] leading-tight transition-colors hover:text-foreground",
          event.id === selectedEventId && "underline",
        )}
      >
        <Flag
          className="h-2 w-2 shrink-0"
          style={{ color: mutedColor(d.color) }}
          aria-hidden
        />
        <span className="truncate font-medium text-foreground">
          {event.title}
        </span>
        {d.conflict && (
          <AlertTriangle className="h-2 w-2 shrink-0 text-amber-600" />
        )}
      </button>
    );
  }

  function hoverCard() {
    if (!hover) return null;
    const d = dGet(hover.event);
    const e = hover.event;
    const cardW = 256;
    let left = hover.rect.right + 8;
    if (left + cardW > window.innerWidth - 8)
      left = Math.max(8, hover.rect.left - cardW - 8);
    const top = Math.min(hover.rect.top, window.innerHeight - 170);
    // Portaled to <body>: the swipe track's translateX wrapper is a transformed
    // ancestor, which would re-anchor position:fixed to itself (off-screen).
    return createPortal(
      <div
        className="pointer-events-none fixed z-50 w-64 rounded-md border border-border bg-card px-2.5 py-2 shadow-md"
        style={{ left, top }}
      >
        <p className="flex items-start gap-1 text-xs font-medium leading-snug text-foreground">
          <span
            className="mt-1 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: mutedColor(d.color) }}
            aria-hidden
          />
          <span className="min-w-0">
            {d.calendarLabel && (
              <span className="text-muted-foreground">{d.calendarLabel}: </span>
            )}
            {e.title}
          </span>
          {d.conflict && (
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
          )}
        </p>
        <p className="mt-0.5 text-[11px] italic tabular-nums text-muted-foreground">
          {formatTimeRange(e.start_time, e.end_time, e.all_day)}
        </p>
        {e.location && (
          <p className="mt-0.5 flex items-center gap-0.5 truncate text-[11px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            {e.location}
          </p>
        )}
        {(d.duties || d.attendees.length > 0) && (
          <p className="mt-1 flex items-center gap-1.5">
            {d.duties && (
              <DutyGlyphs duties={d.duties} hasLocation={!!e.location} />
            )}
            {d.attendees.length > 0 && (
              <span className="flex -space-x-1">
                {d.attendees.slice(0, 4).map((a) => (
                  <span key={a.email} className="inline-flex">
                    <MemberAvatar
                      name={a.name}
                      size="xs"
                      className="ring-1 ring-card"
                    />
                  </span>
                ))}
              </span>
            )}
          </p>
        )}
      </div>,
      document.body,
    );
  }

  function desktopLayout() {
    const totalH = (maxH - minH) * PX_PER_HOUR;
    const hourMarks = Array.from(
      { length: maxH - minH + 1 },
      (_, i) => minH + i,
    );
    const y = (min: number) => ((min - winTop) / 60) * PX_PER_HOUR;
    const dayColPx = gridW > 0 ? (gridW - GUTTER) / 7 : 0;
    return (
      <div>
        <div className="sticky top-14 z-30 bg-background">
          <div className="flex" style={{ paddingLeft: GUTTER }}>
            {days.map((day) => {
              const isToday = day.key === todayKey;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => onDayOpen(day.date)}
                  className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-t px-1 pb-1 pt-0.5 transition-colors hover:bg-muted/60"
                  title="Open day view"
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {day.date.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full font-sans text-sm font-semibold tabular-nums leading-none",
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground",
                    )}
                  >
                    {day.date.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
          {/* All-day strip: full column width, so short titles actually fit,
              and all-day events ("No school") often shape the week more than
              anything on the axis. */}
          {days.some((day) => day.allDay.length > 0) && (
            <div
              className="flex border-y border-border/60 bg-muted/20"
              style={{ paddingLeft: GUTTER }}
            >
              {days.map((day) => (
                <div
                  key={day.key}
                  className="min-w-0 flex-1 space-y-px border-l border-border/40 px-0.5 py-0.5"
                >
                  {day.allDay.map(desktopAllDayChip)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div ref={gridRef} className="relative" style={{ height: totalH }}>
          {hourMarks.map((h) => (
            <div key={h}>
              <div
                className="absolute border-t border-border/50"
                style={{ top: y(h * 60), left: GUTTER, right: 0 }}
                aria-hidden
              />
              {h < maxH && h % 2 === 0 && (
                <div
                  className="absolute -translate-y-1/2 pr-1 text-right text-[10px] italic tabular-nums text-muted-foreground/80"
                  style={{ top: y(h * 60), left: 0, width: GUTTER }}
                >
                  {hourLabel(h)}
                </div>
              )}
            </div>
          ))}
          <div
            className="absolute inset-y-0 flex"
            style={{ left: GUTTER, right: 0 }}
          >
            {days.map((day) => {
              const isToday = day.key === todayKey;
              const showNow =
                isToday && nowMin >= winTop && nowMin <= maxH * 60;
              return (
                <div
                  key={day.key}
                  className={cn(
                    "relative min-w-0 flex-1 border-l border-border/60",
                    isToday && "bg-muted/30",
                  )}
                  onClick={(e) => {
                    // Only the empty background drills in — clicks on event
                    // blocks belong to the blocks.
                    if ((e.target as Element).closest("button")) return;
                    onDayOpen(day.date);
                  }}
                >
                  {/* Your titled cards fill the column, left of the lanes. */}
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ right: railW }}
                  >
                    {day.minePlaced.map((p) =>
                      desktopMineCard(p, Math.max(dayColPx - railW, 0)),
                    )}
                  </div>
                  {/* One lane per other member, down the day's right edge. */}
                  <div
                    className="absolute inset-y-0 right-0"
                    style={{ width: railW }}
                  >
                    {day.others.map((e) => desktopRailPin(e))}
                  </div>
                  {showNow && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20"
                      style={{ top: y(nowMin) }}
                      aria-hidden
                    >
                      <div className="absolute -left-1 h-2 w-2 -translate-y-1/2 rounded-full bg-red-500" />
                      <div className="absolute inset-x-0 border-t border-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {hoverCard()}
      </div>
    );
  }

  // ---- Mobile: the chart transposed — day rows, time flowing rightward -----

  function mobileBar(placed: Placed, trackPx: number) {
    const { event } = placed;
    const d = dGet(event);
    const isDrive = !!event.drive_source_event_id;
    const isDraft = event.id.startsWith("draft:");
    const left = ((startMin(event) - winTop) / totalMin) * 100;
    const width = ((endMin(event) - startMin(event)) / totalMin) * 100;
    // Overlaps split the track's height (the horizontal version of side-by-side
    // lanes), so simultaneous events both stay visible.
    const laneH = TRACK_H / placed.lanes;
    const barH = Math.max(laneH - 1, 5);
    const barPx = (trackPx * width) / 100;
    const showText = !isDrive && barPx >= TEXT_MIN_W && barH >= 11;
    const conflict = d.conflict || needsDutyNudge(event, d);
    return (
      <button
        key={event.id}
        type="button"
        data-event-id={event.id}
        onClick={() => onEventClick(event)}
        style={{
          left: `${left}%`,
          width: `${width}%`,
          minWidth: 3,
          top: placed.lane * laneH,
          height: barH,
          backgroundColor: isDrive
            ? mutedColor(d.color)
            : wash(mutedColor(d.color)),
          ...(isDrive
            ? { clipPath: driveArrowClip(driveDutyOf(event), 3) }
            : { borderLeftColor: mutedColor(d.color) }),
        }}
        className={cn(
          "absolute overflow-hidden rounded-[2px] text-left",
          !isDrive && "border-l-2",
          event.id === selectedEventId && "z-20 ring-1 ring-ring",
          d.pendingDrive && "animate-pulse opacity-60",
          isDraft && "border border-dashed border-foreground/40 opacity-70",
        )}
      >
        {/* Thin bars are hard to tap — an oversize invisible child carries
            the touch target. */}
        <span className="absolute -inset-1.5" aria-hidden />
        {showText && (
          <span className="block truncate px-1 text-[9px] leading-[1.2] text-foreground">
            {event.title}
          </span>
        )}
        {conflict && !isDrive && (
          <span
            className={cn(
              "absolute -top-px right-0 z-10 h-1.5 w-1.5 rounded-full",
              d.conflict
                ? "bg-amber-500"
                : "border border-amber-500 bg-background",
            )}
            aria-hidden
          />
        )}
      </button>
    );
  }

  function mobileLayout() {
    // Ruler ticks every 4 hours, snapped to multiples of 4 so the default
    // window reads 8a · 12p · 4p · 8p.
    const ticks: number[] = [];
    for (let h = Math.ceil(minH / 4) * 4; h <= maxH; h += 4) {
      if (h > minH && h < maxH) ticks.push(h);
    }
    const x = (min: number) => ((min - winTop) / totalMin) * 100;
    const trackPx = gridW > 0 ? gridW - DATE_COL - 4 : 0;
    return (
      <div>
        <div
          className="relative h-4 text-[9px] italic tabular-nums text-muted-foreground/80"
          style={{ marginLeft: DATE_COL }}
        >
          {ticks.map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2"
              style={{ left: `${x(h * 60)}%` }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
        <div
          ref={gridRef}
          className="overflow-hidden rounded-md border border-border/60"
        >
          {days.map((day, i) => {
            const isToday = day.key === todayKey;
            const showNow = isToday && nowMin >= winTop && nowMin <= maxH * 60;
            const overflow = day.allDay.length - 3;
            return (
              <div
                key={day.key}
                className={cn(
                  "flex items-stretch",
                  i > 0 && "border-t border-border/40",
                  isToday && "bg-muted/30",
                )}
                onClick={(e) => {
                  if ((e.target as Element).closest("button")) return;
                  onDayOpen(day.date);
                }}
              >
                <button
                  type="button"
                  onClick={() => onDayOpen(day.date)}
                  className="flex shrink-0 flex-col items-center justify-center gap-0.5 py-1.5"
                  style={{ width: DATE_COL }}
                  title="Open day view"
                >
                  <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {day.date.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full font-sans text-xs font-semibold tabular-nums leading-none",
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground",
                    )}
                  >
                    {day.date.getDate()}
                  </span>
                </button>
                <div className="relative min-w-0 flex-1 py-1.5 pr-1">
                  {/* The ruler's hour marks continue down through the rows as
                      faint hairlines, so times stay readable mid-week. */}
                  {ticks.map((h) => (
                    <span
                      key={h}
                      className="absolute inset-y-0 border-l border-border/30"
                      style={{ left: `${x(h * 60)}%` }}
                      aria-hidden
                    />
                  ))}
                  {/* All-day events ride the row's leading edge as flag chips —
                      they have no time, so they stay off the axis. */}
                  {day.allDay.length > 0 && (
                    <span className="absolute left-0 top-0 z-10 flex items-center gap-0.5">
                      {day.allDay.slice(0, 3).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          data-event-id={e.id}
                          onClick={() => onEventClick(e)}
                          title={e.title}
                          className="relative inline-flex"
                        >
                          <span className="absolute -inset-1" aria-hidden />
                          <Flag
                            className="h-2 w-2"
                            style={{ color: mutedColor(dGet(e).color) }}
                          />
                        </button>
                      ))}
                      {overflow > 0 && (
                        <span className="text-[8px] text-muted-foreground">
                          +{overflow}
                        </span>
                      )}
                    </span>
                  )}
                  <div className="relative" style={{ height: TRACK_H }}>
                    {day.placed.map((p) => mobileBar(p, trackPx))}
                  </div>
                  {showNow && (
                    <span
                      className="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500"
                      style={{ left: `${x(nowMin)}%` }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="font-serif">
      {isMobile ? mobileLayout() : desktopLayout()}
    </div>
  );
}
