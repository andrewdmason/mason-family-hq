"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronRight, Flag, MapPin } from "lucide-react";
import {
  eventDayKey,
  formatTimeRange,
  toDateKey,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, CalendarMember } from "@/lib/calendar/types";
import {
  FAMILY_COLOR,
  FAMILY_KEY,
  byStart,
  driveArrowClip,
  driveDutyOf,
  endMin,
  hourLabel,
  pack,
  startMin,
  wash,
  type Placed,
} from "@/lib/calendar/grid-layout";
import { DutyGlyphs, type EventDisplay } from "./event-card";
import { MemberAvatar } from "@/components/journal/member-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MiniCalendar } from "@/components/ui/mini-calendar";
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
// Pin-mark geometry (the Tufte-style treatment for everyone-but-you): a thin
// colored rule the height of the event, with a marker at its start instant. The
// rule's length says how long, the marker says when it begins, the color says
// who — three facts, almost no ink, so your own full cards stay the loudest read.
const RULE_W = 2; // px — the duration rule's thickness
const DOT = 8; // px — the start marker's box, and the rule lane's width
const PIN_MIN = 12; // px floor so a short event's rule still reads beneath its dot
const PIN_MODE_KEY = "dayview-pin-mode";
// In pin mode each non-self member gets a narrow fixed-width column holding just
// their rule lane — overlapping events stack on the same line rather than fanning
// into sub-lanes. The titles all move to a single labels column on the right
// (desktop only), Google-Docs-comments style, stacked to avoid overlap.
const PIN_COL = 28; // px — a non-self member's narrow rule column
const AVATAR = 22; // px — the member's photo marking each event's start
const LABEL_H = 18; // px — a labels-column row's height, for collision spacing
const LABEL_GAP = 2; // px — minimum gap between stacked labels
// A faint wash marking the signed-in user's own column — derived from their own
// color (like the prototype's Andrew-blue at low alpha) so it stays warm and on
// theme, rather than a fixed cool blue. color-mix works for hex or oklch alike.
// Desaturate a member color toward the warm gray ground — the prototype's earthy
// palette. Scoped to this view, so vivid member colors elsewhere (avatars, home)
// are untouched.
const mute = (color: string) => `color-mix(in srgb, ${color} 60%, #6f6a5f)`;
const meTint = (color: string) => `color-mix(in srgb, ${color} 7%, transparent)`;

// When an arrow block is too short for its full title, it falls back to just
// the drive time — "11 min drive" — since the arrow direction and the kid
// color already say the rest. Parsed from the title (the one server-written
// source of truth); merged multi-stop titles carry no minutes, so they fall
// back to the kid names instead ("Oscar + Theo").
const compactDriveLabel = (title: string) => {
  const mins = title.match(/\((~?\d+ min drive)\)/)?.[1];
  return (
    mins ??
    title
      .replace(/^(?:Drop off \+ pickup|Drop off|Pickup)\s*/, "")
      .replace(/\s*@.*$/, "")
  );
};

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

// The day-view's layout toggle glyph: a dot-over-rule "pin" when pins are on, a
// small rounded card when they're off — so the corner control previews what a
// tap switches TO sits in its title, and what's active reads at a glance.
function ViewModeGlyph({ pins }: { pins: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      {pins ? (
        <g fill="currentColor">
          <circle cx="8" cy="4" r="2.4" />
          <rect x="7" y="6" width="2" height="7" rx="1" />
        </g>
      ) : (
        <rect
          x="2.5"
          y="3.5"
          width="11"
          height="9"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      )}
    </svg>
  );
}

// What a grid create-gesture reports up to the calendar client. `commit`
// distinguishes the live preview during a drag (draft block only) from the
// release (open the panel).
export type GridDraft = {
  memberEmail: string | null;
  start: string; // ISO
  end: string; // ISO
  commit: boolean;
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
  canManage = false,
  onGridDraft,
  onEventTimeChange,
  onJumpToDate,
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
  canManage?: boolean;
  /** Click/drag on empty grid creates a draft event (desktop only). */
  onGridDraft?: (draft: GridDraft) => void;
  /** Drag an event block to move it, or its top/bottom edge to resize it
   * (desktop only). Reports the new times on release. */
  onEventTimeChange?: (
    event: CalendarEvent,
    start: string,
    end: string | null,
  ) => void;
  /** Tapping the date badge in the gutter jumps to the picked day. */
  onJumpToDate?: (date: Date) => void;
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

  // Pin mode: render everyone-but-you's events as sparse dot+rule marks instead
  // of filled blocks, and (on desktop) give the signed-in column the same extra
  // width it gets on the phone — so the day reads as YOUR commitments in full,
  // with the family's as quiet colored ticks in the margins. Start false (the
  // card layout, which is also the SSR-safe baseline) and read the saved choice
  // on mount, like the clock and breakpoint above; a first-time visitor defaults
  // to pins so the new treatment is what they see.
  const [pinMode, setPinMode] = useState(false);
  useEffect(() => {
    const apply = () => {
      const saved = window.localStorage.getItem(PIN_MODE_KEY);
      setPinMode(saved === null ? true : saved === "1");
    };
    apply();
  }, []);
  const togglePinMode = () =>
    setPinMode((on) => {
      const next = !on;
      window.localStorage.setItem(PIN_MODE_KEY, next ? "1" : "0");
      return next;
    });
  // The event whose pin (or label) the pointer is over — set from both the pin
  // line and its row in the labels column, so hovering either lights up the
  // other and you can tell which line a label belongs to.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Mobile peek: tapping a non-self pin line first raises a light card at the
  // bottom with the event's basics (no labels column to read on a phone); a tap
  // on that card opens the full drawer, and a drag down dismisses it.
  //   peekEvent — the tapped event (null = no card mounted)
  //   peekUp    — resting position: raised (true) vs hidden below (false)
  //   peekDragY — live downward offset during a drag (null = resting, animated)
  // The card mounts hidden and is raised the next frame so the transform
  // transitions up; closing drops peekUp, and the card unmounts only after it
  // has slid back down (onTransitionEnd), so the exit animates too. The mount
  // effect keys on peekEvent alone, so flipping peekUp on close never re-raises.
  const [peekEvent, setPeekEvent] = useState<CalendarEvent | null>(null);
  const [peekUp, setPeekUp] = useState(false);
  const [peekDragY, setPeekDragY] = useState<number | null>(null);
  const peekDrag = useRef<{ startY: number; y: number; moved: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!peekEvent) return;
    const id = requestAnimationFrame(() => setPeekUp(true));
    return () => cancelAnimationFrame(id);
  }, [peekEvent]);
  const closePeek = () => {
    setPeekDragY(null);
    setPeekUp(false);
  };
  // Past this much downward drag, release dismisses; short of it, it snaps back.
  const PEEK_DISMISS = 56;
  function onPeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    peekDrag.current = { startY: e.clientY, y: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPeekPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = peekDrag.current;
    if (!d) return;
    const y = Math.max(0, e.clientY - d.startY); // downward only
    d.y = y;
    if (y > 4) d.moved = true;
    setPeekDragY(y);
  }
  function onPeekPointerUp() {
    const d = peekDrag.current;
    peekDrag.current = null;
    if (!d) return;
    if (!d.moved) {
      // A tap (no real drag): open the full drawer, then let the peek slide away.
      if (peekEvent) onEventClick(peekEvent);
      closePeek();
      return;
    }
    if (d.y > PEEK_DISMISS) closePeek();
    else setPeekDragY(null); // snap back up (peekUp is still true)
  }
  function onPeekPointerCancel() {
    peekDrag.current = null;
    setPeekDragY(null);
  }

  // The gutter date badge doubles as a "jump to a date" trigger — a small
  // month-grid popover.
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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

  // --- Drag-to-create (desktop only) ---------------------------------------
  // Press on a column's empty background and drag to draw a draft event; a
  // plain click drops a 30-minute one. The live preview renders through the
  // calendar client (the draft becomes a synthetic event), and release opens
  // the panel. Touch keeps its existing gestures (tap-to-open, swipe-day).
  const createDrag = useRef<{
    member: string | null;
    startMin: number;
    colEl: HTMLElement;
    moved: boolean;
  } | null>(null);

  const snap15 = (m: number) => Math.round(m / 15) * 15;
  const minuteAtPointer = (clientY: number, colEl: HTMLElement) => {
    const rect = colEl.getBoundingClientRect();
    const min = minH * 60 + ((clientY - rect.top) / PX_PER_HOUR) * 60;
    return Math.max(minH * 60, Math.min(maxH * 60, min));
  };
  // The viewed day at a minutes-since-midnight instant, as ISO.
  const isoAt = (min: number) => {
    const d = new Date(anchorDate);
    d.setHours(0, min, 0, 0);
    return d.toISOString();
  };
  const draftRange = (a: number, b: number): [number, number] =>
    b >= a ? [a, Math.max(b, a + 15)] : [b, a];

  function onColPointerDown(e: React.PointerEvent<HTMLDivElement>, member: string | null) {
    if (!onGridDraft || !canManage || isMobile || e.pointerType === "touch") return;
    if (e.button !== 0) return;
    // Only the empty background starts a create — presses on event blocks (or
    // their handles) belong to the blocks.
    if ((e.target as Element).closest("button")) return;
    const colEl = e.currentTarget;
    createDrag.current = {
      member,
      startMin: snap15(minuteAtPointer(e.clientY, colEl)),
      colEl,
      moved: false,
    };
    colEl.setPointerCapture(e.pointerId);
  }

  function onColPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = createDrag.current;
    if (!d) return;
    const m = snap15(minuteAtPointer(e.clientY, d.colEl));
    if (!d.moved && m === d.startMin) return; // slop: ignore sub-snap jitters
    d.moved = true;
    e.preventDefault(); // no text selection while drawing
    const [a, b] = draftRange(d.startMin, m);
    onGridDraft?.({ memberEmail: d.member, start: isoAt(a), end: isoAt(b), commit: false });
  }

  function onColPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = createDrag.current;
    createDrag.current = null;
    if (!d) return;
    if (!d.moved) {
      // Plain click: a 30-minute draft at the snapped point.
      const a = snap15(minuteAtPointer(e.clientY, d.colEl));
      onGridDraft?.({ memberEmail: d.member, start: isoAt(a), end: isoAt(a + 30), commit: true });
      return;
    }
    const m = snap15(minuteAtPointer(e.clientY, d.colEl));
    const [a, b] = draftRange(d.startMin, m);
    onGridDraft?.({ memberEmail: d.member, start: isoAt(a), end: isoAt(b), commit: true });
  }

  function onColPointerCancel() {
    createDrag.current = null;
  }

  // --- Drag-to-move / drag-to-resize (desktop only) -------------------------
  // Press an event block and drag to move it along the axis (15-minute snap),
  // or grab its top/bottom edge to change just the start/end. The live preview
  // is local to this view; the release reports the final times up to the
  // calendar client, which applies them optimistically and persists.
  const blockDrag = useRef<{
    event: CalendarEvent;
    mode: "move" | "start" | "end";
    startY: number;
    baseStart: number; // minutes
    baseEnd: number;
    moved: boolean;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    startMin: number;
    endMin: number;
  } | null>(null);
  // A drag's pointerup is followed by a click on the same block — swallow it
  // so releasing a move doesn't also open the panel.
  const suppressClick = useRef(false);

  // The browser shows the hovered element's cursor, so mid-drag feedback would
  // flip back to the arrow the moment the pointer leaves the thin handle strip
  // (or the card). Pin the gesture's cursor on <body> instead, and suspend text
  // selection for the duration.
  const dragCursor = (cursor: string | null) => {
    if (cursor) {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    } else {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    }
  };
  useEffect(() => () => dragCursor(null), []); // never leak past unmount

  // Times are draggable where the panel allows editing: manual + Google
  // events. Synced feeds (TeamSnap/ICS) are read-only, drive blocks are
  // derived artifacts of the duty assignment, and the in-progress draft's
  // times belong to the create gesture/panel.
  const canDragEvent = (e: CalendarEvent) =>
    !!onEventTimeChange &&
    canManage &&
    !isMobile &&
    !e.all_day &&
    !e.drive_source_event_id &&
    !e.id.startsWith("draft:") &&
    (e.source_type === "manual" || e.source_type === "google");

  // The dragged block's [start, end] minutes at a pointer position, snapped
  // and clamped: a move keeps the duration and stays inside the axis window;
  // a resize pins the other edge and keeps at least 15 minutes.
  function dragRange(
    d: NonNullable<typeof blockDrag.current>,
    clientY: number,
  ): [number, number] {
    const delta = ((clientY - d.startY) / PX_PER_HOUR) * 60;
    if (d.mode === "move") {
      const dur = d.baseEnd - d.baseStart;
      const s = Math.min(
        Math.max(snap15(d.baseStart + delta), minH * 60),
        maxH * 60 - dur,
      );
      return [s, s + dur];
    }
    if (d.mode === "start") {
      const s = Math.min(
        Math.max(snap15(d.baseStart + delta), minH * 60),
        d.baseEnd - 15,
      );
      return [s, d.baseEnd];
    }
    const e = Math.max(
      Math.min(snap15(d.baseEnd + delta), maxH * 60),
      d.baseStart + 15,
    );
    return [d.baseStart, e];
  }

  const shiftIso = (iso: string, minutes: number) =>
    new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

  function onBlockPointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    event: CalendarEvent,
  ) {
    if (e.pointerType === "touch" || e.button !== 0) return;
    suppressClick.current = false;
    const handle = (e.target as Element)
      .closest("[data-resize]")
      ?.getAttribute("data-resize");
    blockDrag.current = {
      event,
      mode: handle === "top" ? "start" : handle === "bottom" ? "end" : "move",
      startY: e.clientY,
      baseStart: startMin(event),
      baseEnd: endMin(event),
      moved: false,
    };
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onBlockPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = blockDrag.current;
    if (!d) return;
    const [s, en] = dragRange(d, e.clientY);
    if (!d.moved && s === d.baseStart && en === d.baseEnd) return; // slop
    if (!d.moved) {
      d.moved = true;
      dragCursor(d.mode === "move" ? "grabbing" : "ns-resize");
    }
    e.preventDefault();
    setDragPreview({ id: d.event.id, startMin: s, endMin: en });
  }

  function onBlockPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = blockDrag.current;
    blockDrag.current = null;
    dragCursor(null);
    if (!d) return;
    setDragPreview(null);
    if (!d.moved) return; // plain click — the click handler opens the panel
    suppressClick.current = true;
    const [s, en] = dragRange(d, e.clientY);
    const ev = d.event;
    if (d.mode === "move") {
      const delta = s - d.baseStart;
      if (delta === 0) return;
      // Shift the real instants so cross-midnight ends (clamped on the axis)
      // keep their true duration.
      onEventTimeChange?.(
        ev,
        shiftIso(ev.start_time, delta),
        ev.end_time ? shiftIso(ev.end_time, delta) : null,
      );
    } else if (d.mode === "start") {
      if (s === d.baseStart) return;
      // Resizing a point-in-time event (no end) materializes its implied end,
      // pinning the bottom edge where the block already drew it.
      onEventTimeChange?.(ev, isoAt(s), ev.end_time ?? isoAt(d.baseEnd));
    } else {
      if (en === d.baseEnd) return;
      onEventTimeChange?.(ev, ev.start_time, isoAt(en));
    }
  }

  function onBlockPointerCancel() {
    blockDrag.current = null;
    dragCursor(null);
    setDragPreview(null);
  }

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

  // Classify timed events. Every event renders ONCE as a normal card in its
  // owner's column; a member who's attending someone else's event gets a solid
  // block in the OWNER's color in their own column (built per-column below) —
  // the color says whose thing it is, with no cross-column frame physically
  // linking them. Ownerless events fall to the Family column.
  const familyTimed = timed.filter(isFamily);
  const soloByEmail = new Map<string, CalendarEvent[]>();
  const attendByEmail = new Map<string, CalendarEvent[]>();
  for (const e of timed) {
    if (isFamily(e)) continue;
    const attending = attendingMembersOf(e);
    // The owner's column carries the real card; if the owner isn't a shown
    // member, the first shown attendee's column stands in.
    const owner =
      e.member_email && memberEmails.has(e.member_email)
        ? e.member_email
        : attending[0] ?? e.member_email!;
    const arr = soloByEmail.get(owner) ?? [];
    arr.push(e);
    soloByEmail.set(owner, arr);
    for (const g of attending) {
      if (g === owner) continue;
      const a = attendByEmail.get(g) ?? [];
      a.push(e);
      attendByEmail.set(g, a);
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
    attend: CalendarEvent[];
    allDay: CalendarEvent[];
    isMe: boolean;
  };
  const columns: Column[] = members.map((m) => ({
    key: m.email,
    label: m.name ?? m.email,
    color: m.color ?? FAMILY_COLOR,
    solo: soloByEmail.get(m.email) ?? [],
    attend: attendByEmail.get(m.email) ?? [],
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
      attend: [],
      allDay: familyAllDay,
      isMe: false,
    });
  }

  // The signed-in user always leads, so their day is the first thing read.
  const meIndex = columns.findIndex((c) => c.isMe);
  if (meIndex > 0) columns.unshift(columns.splice(meIndex, 1)[0]);

  const memberColumns = columns.filter((c) => c.key !== FAMILY_KEY);

  // Column widths. On the phone layout the signed-in user's column is ME_WEIGHT
  // times as wide as the others (room for titles); every other column is a thin
  // tick. Desktop keeps them equal. The shared-event overlay positions off these
  // same weights so it stays aligned with the columns underneath.
  const meColIndex = columns.findIndex((c) => c.isMe);
  // Pin mode only engages when there's a signed-in column to anchor it — a
  // family-only view (no "me") keeps the card layout so nothing goes all-ticks.
  const pinActive = pinMode && meColIndex >= 0;
  // The signed-in column gets the extra width on the phone OR whenever pins are
  // on, so the desktop pin layout matches the phone's "wide me + thin rest".
  const weighted = isMobile || pinActive;
  const weights = columns.map((c) => (weighted && c.isMe ? ME_WEIGHT : 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  // Explicit percentage widths, NOT flexGrow/flexBasis: 0 — with border-box a
  // zero basis is floored at each cell's padding+border, so rows whose cells
  // pad differently (padded name cells vs border-only axis columns) would
  // distribute the same weights differently and the columns would misalign.
  const colWidth = (i: number) => `${(weights[i] / totalWeight) * 100}%`;
  // A column renders full (titled) cards on desktop, or when it's the signed-in
  // user's wide column on the phone; the other phone columns render thin ticks.
  // In pin mode ONLY the signed-in column is full — every other column (and the
  // family column) drops to dot+rule marks, on the phone and the desktop alike.
  const isFull = (i: number) =>
    pinActive ? i === meColIndex : !isMobile || i === meColIndex;

  // The labels column (Google-Docs-comments style) only earns its keep on the
  // desktop, where there's room beside the narrow rule columns; the phone keeps
  // the wide-me + thin-pins read with no titles.
  const labelsLayout = pinActive && !isMobile;
  // Per-column sizing. Card mode (and the phone) keeps the weighted percentages.
  // Pin mode swaps to: a flexible signed-in column, a narrow fixed lane per other
  // member, and (desktop) a flexible labels column appended after them all.
  const colStyle = (i: number): React.CSSProperties => {
    if (!pinActive) return { width: colWidth(i) };
    return columns[i].isMe
      ? { flexGrow: 2, flexBasis: 0, minWidth: isMobile ? 0 : 240 }
      : { width: PIN_COL, flexGrow: 0, flexShrink: 0 };
  };
  const labelsColStyle: React.CSSProperties = {
    flexGrow: 3,
    flexBasis: 0,
    minWidth: 200,
  };

  // An attended (not owned) event, with this member's own one-way drive legs
  // fused in: drive → attend → drive reads as ONE commitment in their column,
  // with width steps (divots) at the true event start/end separating driving
  // from being there.
  type FusedAttend = {
    event: CalendarEvent; // the owner's event (click/selection target)
    legTop: CalendarEvent | null; // this member's drop-off leg
    legBottom: CalendarEvent | null; // this member's pick-up leg
  };

  // A column's positioned blocks: its own events (and any unfused drive
  // arrows), plus one fused shape per attended event. The fused shape packs
  // lanes under a shadow event spanning leg start → leg end, so overlap math
  // sees the real footprint; the rendered content comes from the source event.
  function placedFor(
    c: Column,
  ): { placed: Placed; fused?: FusedAttend }[] {
    if (c.attend.length === 0) {
      return pack(c.solo).map((placed) => ({ placed }));
    }
    const fusedByShadow = new Map<string, FusedAttend>();
    const claimed = new Set<string>();
    const items: CalendarEvent[] = [];
    for (const e of c.attend) {
      const leg = (duty: "dropoff" | "pickup") =>
        c.solo.find(
          (s) => s.drive_source_event_id === e.id && s.drive_duty === duty,
        ) ?? null;
      const legTop = leg("dropoff");
      const legBottom = leg("pickup");
      if (legTop) claimed.add(legTop.id);
      if (legBottom) claimed.add(legBottom.id);
      const shadow: CalendarEvent = {
        ...e,
        id: `attend:${e.id}`,
        start_time: legTop?.start_time ?? e.start_time,
        end_time: legBottom?.end_time ?? e.end_time,
      };
      fusedByShadow.set(shadow.id, { event: e, legTop, legBottom });
      items.push(shadow);
    }
    items.push(...c.solo.filter((s) => !claimed.has(s.id)));
    return pack(items).map((placed) => ({
      placed,
      fused: fusedByShadow.get(placed.event.id),
    }));
  }

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
  // location. A thin block — the other columns on the phone — is a textless block
  // washed in the member color (position already says when and the column says
  // who), light enough that the me column's full-color cards stay the loudest
  // thing on screen. It shows only a baseball glyph for TeamSnap games (when tall
  // enough). Drive blocks are the exception: their clip-path arrow stays a solid
  // fill so the shape reads.
  //
  // A plain render function, NOT a <Component>: defined inside DayView, a
  // component would get a fresh identity every render, making React REMOUNT
  // every block whenever state changes — which destroys the DOM node holding a
  // drag's pointer capture mid-gesture (the drag would only track while the
  // cursor stayed over the card). Plain JSX keeps the nodes stable.
  // The pin mark — pin mode's stand-in for a thin/washed block, drawn in a narrow
  // one-per-member column. A colored rule the height of the event encodes how
  // long; a marker at its start instant encodes when (● a plain event, ○ a
  // TeamSnap game, ◆ a drive leg); the muted member color encodes who. A fused
  // attended event draws its full driving span as a faint rule with the
  // being-there core picked out solid, so the bracket survives. Overlapping
  // events in the same column simply stack on the same line — the title lives in
  // the labels column, and hovering the line lights its label up.
  function renderPinMark(placed: Placed, fused?: FusedAttend) {
    const { event } = placed;
    const src = fused ? fused.event : event;
    const d = display(src);
    const color = mute(d.color);
    const top = y(startMin(event));
    const height = Math.max(y(endMin(event)) - top, PIN_MIN);
    const selected = src.id === selectedEventId;
    // Emphasized while hovered (desktop) or while its peek card is open (mobile).
    const hot = hoveredId === src.id || peekEvent?.id === src.id;
    const isDrive = !!event.drive_source_event_id;
    // The marker is the owner's profile photo (a circle) when we can resolve the
    // member, a diamond for a drive leg, else a small colored dot.
    const owner = members.find((m) => m.email === src.member_email) ?? null;
    const isPhoto = !isDrive && !!owner;
    // The being-there core within the (possibly drive-extended) span: the whole
    // height for a plain event, the true event start→end for a fused one.
    const coreTop = fused ? Math.max(y(startMin(fused.event)) - top, 0) : 0;
    const coreEnd = fused ? Math.min(y(endMin(fused.event)) - top, height) : height;
    const ruleW = hot ? RULE_W + 1.5 : RULE_W;
    const ruleLeft = (DOT - ruleW) / 2;
    const markerSize = isPhoto ? AVATAR : isDrive ? DOT - 2 : DOT;
    const markerTop = coreTop - markerSize / 2;
    const markerLeft = (DOT - markerSize) / 2;
    return (
      <button
        key={event.id}
        type="button"
        data-event-id={src.id}
        // On a phone the first tap raises the peek card (basics only); the full
        // drawer opens from there. On the desktop a pin opens the drawer directly
        // — the labels column already carries the title.
        onClick={(e) => {
          if (isMobile) {
            e.stopPropagation();
            setPeekEvent(src);
          } else {
            onEventClick(src);
          }
        }}
        onMouseEnter={() => setHoveredId(src.id)}
        onMouseLeave={() => setHoveredId((id) => (id === src.id ? null : id))}
        title={d.calendarLabel ? `${d.calendarLabel}: ${src.title}` : src.title}
        // Full column width so the whole narrow lane is an easy hover/tap target,
        // and centered so stacked events share one line.
        style={{ top, height, left: 0, right: 0 }}
        className={cn(
          "group absolute flex justify-center overflow-visible",
          hot ? "z-30" : "z-20",
          d.pendingDrive && "animate-pulse opacity-60",
          event.id.startsWith("draft:") && "opacity-70",
        )}
      >
        {/* The rule + start marker, in a fixed lane the width of one marker. */}
        <span className="relative shrink-0" style={{ width: DOT }} aria-hidden>
          {/* A fused event's full driving span, faint behind the solid core. */}
          {fused && (
            <span
              className="absolute rounded-full"
              style={{
                left: (DOT - RULE_W) / 2,
                top: 0,
                bottom: 0,
                width: RULE_W,
                backgroundColor: color,
                opacity: 0.3,
              }}
            />
          )}
          {/* The being-there rule — the part that counts as a commitment. */}
          <span
            className="absolute rounded-full"
            style={{
              left: ruleLeft,
              top: coreTop,
              height: Math.max(coreEnd - coreTop, 2),
              width: ruleW,
              backgroundColor: color,
            }}
          />
          {/* The start marker: the owner's photo in a circle, a drive leg's ◆,
              or a fallback ● for ownerless/family events. */}
          {!isDrive && owner ? (
            <span
              className={cn(
                "absolute overflow-hidden rounded-full ring-1 ring-background transition-transform",
                hot && "scale-110 ring-2",
                selected && "ring-2 ring-ring",
              )}
              style={{
                left: markerLeft,
                top: markerTop,
                width: markerSize,
                height: markerSize,
              }}
            >
              <MemberAvatar
                name={owner.name}
                url={owner.avatar_url}
                size="sm"
                className="h-full w-full"
              />
            </span>
          ) : (
            <span
              className={cn(
                "absolute transition-transform",
                hot && "scale-125",
                isDrive ? "rotate-45 rounded-[1px]" : "rounded-full",
                selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
              )}
              style={{
                left: markerLeft,
                top: markerTop,
                width: markerSize,
                height: markerSize,
                backgroundColor: color,
              }}
            />
          )}
        </span>
      </button>
    );
  }

  function renderBlock(placed: Placed, full: boolean, fused?: FusedAttend) {
    const { event } = placed;
    const d = display(fused ? fused.event : event);
    // While this block is being dragged, draw it (position AND time text) from
    // the preview minutes instead of its stored times.
    const pv = dragPreview?.id === event.id ? dragPreview : null;
    const shown = pv
      ? { ...event, start_time: isoAt(pv.startMin), end_time: isoAt(pv.endMin) }
      : event;
    const draggable = full && !fused && canDragEvent(event);
    const dragProps = draggable
      ? {
          onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) =>
            onBlockPointerDown(e, event),
          onPointerMove: onBlockPointerMove,
          onPointerUp: onBlockPointerUp,
          onPointerCancel: onBlockPointerCancel,
        }
      : null;
    const trueTop = y(startMin(shown));
    const trueHeight = y(endMin(shown)) - trueTop;
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
    // An attended event (someone else's, in this member's column): one solid
    // rounded block in the OWNER's color spanning any fused drive legs plus
    // the event itself. The legs are full-width segments a shade lighter,
    // separated from the event span by a thin hairline at the true event
    // start/end — Fantastical's travel-time treatment: one commitment, with
    // the driving visibly bracketing the being-there.
    if (fused) {
      const e = fused.event;
      const evTop = Math.max(y(startMin(e)) - top, 0);
      const evEnd = Math.min(y(endMin(e)) - top, height);
      const hasTop = !!fused.legTop;
      const hasBottom = !!fused.legBottom;
      return (
        <button
          key={event.id}
          type="button"
          data-event-id={e.id}
          onClick={() => onEventClick(e)}
          title={`${e.title} — you're going`}
          style={{
            ...pos,
            backgroundColor: full ? mute(d.color) : wash(mute(d.color)),
          }}
          className={cn(
            "absolute z-20 overflow-hidden rounded-md text-left transition-[filter] hover:brightness-95",
            e.id === selectedEventId && "ring-1 ring-ring",
          )}
        >
          {hasTop && (
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 top-0 border-b",
                full ? "border-white/90 bg-white/25" : "bg-white/40",
              )}
              style={{
                height: evTop,
                ...(full ? null : { borderColor: mute(d.color) }),
              }}
            />
          )}
          {hasBottom && (
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 border-t",
                full ? "border-white/90 bg-white/25" : "bg-white/40",
              )}
              style={{
                top: evEnd,
                bottom: 0,
                ...(full ? null : { borderColor: mute(d.color) }),
              }}
            />
          )}
          {full && (
            <span
              className="absolute inset-x-0 flex items-center overflow-hidden px-1.5"
              // Vertically centered on the event span — capped so a multi-hour
              // span reads top-anchored (with breathing room) rather than
              // floating its title mid-block.
              style={{
                top: evTop,
                height: Math.min(Math.max(evEnd - evTop, 18), 40),
              }}
            >
              <span className="flex min-w-0 items-center gap-1">
                {/* Whose event this is — the owner's initial, since the block
                    sits in someone else's column. */}
                <MemberAvatar
                  name={
                    members.find((m) => m.email === e.member_email)?.name ??
                    e.member_email
                  }
                  size="xs"
                />
                <span className="line-clamp-2 min-w-0 text-[11px] leading-tight text-white/95">
                  {e.title}
                </span>
              </span>
            </span>
          )}
        </button>
      );
    }
    const isDraft = event.id.startsWith("draft:");
    const isDrive = !!event.drive_source_event_id;
    const driveDuty = driveDutyOf(event);
    if (!full) {
      return (
        <button
          key={event.id}
          type="button"
          data-event-id={event.id}
          onClick={() => onEventClick(event)}
          title={
            d.calendarLabel ? `${d.calendarLabel}: ${event.title}` : event.title
          }
          style={{
            ...pos,
            backgroundColor: isDrive ? mute(d.color) : wash(mute(d.color)),
            ...(isDrive
              ? { clipPath: driveArrowClip(driveDuty, 7) }
              : { color: mute(d.color) }),
          }}
          className={cn(
            "absolute z-20 flex items-start justify-end overflow-hidden rounded-sm px-0.5 py-0.5",
            event.id === selectedEventId && "ring-1 ring-ring",
            d.pendingDrive && "animate-pulse opacity-60",
            isDraft && "opacity-70",
          )}
        >
          {d.isTeamsnap && height >= TALL && (
            <BaseballGlyph
              className={cn("h-2.5 w-2.5 shrink-0", isDrive && "text-white/90")}
            />
          )}
        </button>
      );
    }
    if (isDrive) {
      // The arrow block. No time row (the title carries the stop time and the
      // position says when to leave) and no border (clip-path would cut it);
      // the solid kid color against white cards is the identity. A block with
      // its lane to itself shows the full title — one line when short, two
      // when tall; a shared (narrow) lane would clip mid-name, so it falls
      // back to the tersest label ("11 min") — arrow direction and kid color
      // already say the rest.
      const label =
        placed.lanes > 1
          ? compactDriveLabel(event.title).replace(" drive", "")
          : event.title;
      return (
        <button
          key={event.id}
          type="button"
          data-event-id={event.id}
          onClick={() => onEventClick(event)}
          title={event.title}
          style={{
            ...pos,
            backgroundColor: mute(d.color),
            clipPath: driveArrowClip(driveDuty, 10),
          }}
          className={cn(
            "absolute z-20 flex items-center overflow-hidden text-left transition-[filter] hover:brightness-95",
            // Pad the pointed end(s) so text clears the cut.
            driveDuty === "dropoff" ? "pl-1.5 pr-3.5" : "pl-3.5 pr-1.5",
            driveDuty === "combined" && "pr-3.5",
            event.id === selectedEventId && "brightness-[.82]",
            d.pendingDrive && "animate-pulse opacity-60",
          )}
        >
          <span
            className={cn(
              "min-w-0 text-[11px] leading-tight text-white/95",
              height < 40 ? "truncate" : "line-clamp-2",
            )}
          >
            {label}
          </span>
        </button>
      );
    }
    // The start time is already encoded by the card's position on the axis, so
    // it's the first thing to drop when a short card can't fit it and the title.
    const showTime = height >= 46;
    return (
      <button
        key={event.id}
        type="button"
        data-event-id={event.id}
        onClick={() => {
          // A drag's release fires a click too — that one doesn't open the panel.
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onEventClick(event);
        }}
        {...dragProps}
        title={
          d.calendarLabel ? `${d.calendarLabel}: ${event.title}` : event.title
        }
        style={{ ...pos, borderLeftColor: mute(d.color) }}
        className={cn(
          "absolute z-20 flex flex-col overflow-hidden rounded-sm border border-border/70 border-l-[3px] bg-white px-1.5 py-0.5 text-left transition-colors hover:bg-muted/40 dark:bg-card",
          event.id === selectedEventId && "ring-1 ring-ring",
          // A duty tap's block-to-be: visible instantly, ghosted until the
          // real mirror row replaces it.
          d.pendingDrive && "animate-pulse opacity-60",
          // The not-yet-saved draft the panel is collecting details for.
          isDraft && "border-dashed bg-white/70 dark:bg-card/70",
          // Mid-drag: lift it over its neighbors so the preview reads cleanly.
          pv && "z-30 shadow-md ring-1 ring-ring",
        )}
      >
        {showTime && (
          <span className="flex items-center gap-1 text-[10px] italic tabular-nums leading-tight text-muted-foreground">
            <span className="truncate">
              {formatTimeRange(shown.start_time, shown.end_time, false)}
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
          {/* Short cards drop the time row, so the going-avatars and the duty
              glyphs ride the title row instead. Only the amber "unset" nudge
              earns the duty ink here — assigned duties already show as drive
              blocks in the assignee's column, and a full set of glyphs can
              crush the title out of a narrow lane. */}
          {!showTime &&
            (() => {
              const needsNudge =
                d.duties &&
                (d.duties.dropoff === "unset" || d.duties.pickup === "unset");
              if (!needsNudge && d.attendees.length === 0) return null;
              return (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {needsNudge && d.duties && (
                    <DutyGlyphs
                      duties={d.duties}
                      hasLocation={!!event.location}
                      className="text-[10px]"
                    />
                  )}
                  {d.attendees.length > 0 && (
                    <span className="flex -space-x-1">
                      {d.attendees.slice(0, 2).map((a) => (
                        <span
                          key={a.email}
                          title={a.name ?? a.email}
                          className="inline-flex"
                        >
                          <MemberAvatar
                            name={a.name}
                            size="xs"
                            className="ring-1 ring-card"
                          />
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              );
            })()}
        </span>
        {height >= 60 && event.location && (
          <span className="mt-0.5 flex items-center gap-0.5 truncate text-[10px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            {event.location}
          </span>
        )}
        {draggable && resizeHandles()}
      </button>
    );
  }

  // Invisible grab strips along a draggable block's top and bottom edges —
  // the pointerdown handler reads data-resize to start a resize instead of a
  // move. Last children, so they paint above the card's content.
  function resizeHandles() {
    return (
      <>
        <span
          data-resize="top"
          aria-hidden
          className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
        />
        <span
          data-resize="bottom"
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
        />
      </>
    );
  }


  // An all-day marker: a flag plus the title in a full (titled) column, matching
  // the agenda's treatment; a textless member-colored chip in a thin phone column.
  // A shared all-day event carries the same attendance glyph as the timed ones.
  function allDayItem(event: CalendarEvent, full: boolean, pin: boolean) {
    const d = display(event);
    const attending = attendingMembersOf(event);
    if (!full) {
      // Pin mode renders a thin column's all-day event as a small colored dot —
      // the same sparse vocabulary as the timed pins above it — rather than a
      // washed bar, so the margin stays quiet.
      if (pin) {
        return (
          <button
            key={event.id}
            type="button"
            data-event-id={event.id}
            onClick={() => onEventClick(event)}
            title={event.title}
            style={{ backgroundColor: mute(d.color) }}
            className={cn(
              "block h-2 w-2 rounded-full transition-transform hover:scale-125",
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
          style={{ backgroundColor: wash(mute(d.color)) }}
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

  // The labels column's rows: one per non-self event, anchored to its pin's
  // start Y, then pushed down greedily so none overlap (Google-Docs comments).
  // The hover wiring ties each row back to its line.
  type PinLabel = {
    id: string;
    src: CalendarEvent;
    color: string;
    time: string;
    title: string;
    calendarLabel: string | null;
    top: number;
  };
  function buildPinLabels(): PinLabel[] {
    const raw: (Omit<PinLabel, "top"> & { anchorY: number })[] = [];
    for (const c of columns) {
      if (c.isMe) continue;
      for (const { placed, fused } of placedFor(c)) {
        const src = fused ? fused.event : placed.event;
        const d = display(src);
        raw.push({
          id: src.id,
          src,
          color: mute(d.color),
          time: formatTimeRange(src.start_time, null, false),
          title: src.title,
          calendarLabel: d.calendarLabel,
          anchorY: y(startMin(fused ? fused.event : placed.event)),
        });
      }
    }
    raw.sort((a, b) => a.anchorY - b.anchorY);
    const out: PinLabel[] = [];
    let prevBottom = -Infinity;
    for (const e of raw) {
      // Center the row on the dot (anchorY is the start instant = the dot's
      // center), so by default the text sits level with its marker; collision
      // then only pushes a row down when it would overlap the one above.
      const top = Math.max(e.anchorY - LABEL_H / 2, prevBottom + LABEL_GAP);
      out.push({ ...e, top });
      prevBottom = top + LABEL_H;
    }
    return out;
  }

  function labelsColumn() {
    return (
      <div className="relative" style={labelsColStyle}>
        {buildPinLabels().map((e) => {
          const hot = hoveredId === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onEventClick(e.src)}
              onMouseEnter={() => setHoveredId(e.id)}
              onMouseLeave={() =>
                setHoveredId((id) => (id === e.id ? null : id))
              }
              title={e.calendarLabel ? `${e.calendarLabel}: ${e.title}` : e.title}
              style={{ top: e.top, backgroundColor: hot ? wash(e.color) : undefined }}
              className={cn(
                "absolute inset-x-0 flex items-center rounded px-1.5 py-0.5 text-left transition-colors",
                hot ? "z-10" : "opacity-80 hover:opacity-100",
              )}
            >
              <span
                className="truncate text-[11px] leading-tight"
                style={{ color: e.color }}
              >
                <span
                  className={cn(
                    "tabular-nums",
                    hot ? "font-medium" : "opacity-70",
                  )}
                >
                  {e.time}
                </span>{" "}
                <span className={cn(hot && "font-medium")}>
                  {e.calendarLabel ? `${e.calendarLabel}: ` : ""}
                  {e.title}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
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
          {/* Column headers — first name only on mobile to fit the narrow columns.
              The gutter corner holds the Pins/Cards toggle. */}
          <div className="flex">
            <button
              type="button"
              onClick={togglePinMode}
              aria-pressed={pinMode}
              title={
                pinMode
                  ? "Pin marks for others — switch to cards"
                  : "Event cards for everyone — switch to pins"
              }
              className="flex shrink-0 items-center justify-center self-stretch text-muted-foreground/70 transition-colors hover:text-foreground"
              style={{ width: GUTTER }}
            >
              <ViewModeGlyph pins={pinMode} />
            </button>
            {columns.map((c, i) => {
              // In pin mode the other members' names go away — their color on the
              // line and in the labels column carries identity — so their header
              // cell is just an empty spacer that keeps the columns aligned.
              const named = !pinActive || c.isMe;
              return (
                <div
                  key={c.key}
                  className="flex min-w-0 shrink-0 items-center gap-1 px-1 pb-1.5 pt-1 text-[11px] font-medium text-foreground md:gap-1.5 md:px-2 md:pb-2 md:text-sm"
                  style={{
                    ...colStyle(i),
                    ...(c.isMe
                      ? { backgroundColor: meTint(mute(c.color)) }
                      : null),
                  }}
                >
                  {named && (
                    <>
                      <span
                        className="h-2 w-2 shrink-0 rounded-full md:h-2.5 md:w-2.5"
                        style={{ backgroundColor: mute(c.color) }}
                        aria-hidden
                      />
                      <span className="truncate md:hidden">
                        {c.label.split(" ")[0]}
                      </span>
                      <span className="hidden truncate md:inline">{c.label}</span>
                    </>
                  )}
                </div>
              );
            })}
            {labelsLayout && <div style={labelsColStyle} />}
          </div>

          {/* All-day strip. Its gutter shows the viewed date — today gets the
              filled badge — so the strip earns its place even on days with no
              all-day events. */}
          <div className="flex border-y border-border/60 bg-muted/20">
            {onJumpToDate ? (
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger
                  aria-label="Jump to date"
                  title="Jump to date"
                  className={cn(
                    "flex shrink-0 flex-col items-center justify-center gap-0.5 py-1 pr-1 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    datePickerOpen && "bg-accent/60",
                  )}
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
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2 font-sans">
                  <MiniCalendar
                    selected={anchorDate}
                    onSelect={(day) => {
                      onJumpToDate(day);
                      setDatePickerOpen(false);
                    }}
                  />
                  {now != null && !isToday && (
                    <button
                      type="button"
                      onClick={() => {
                        onJumpToDate(new Date());
                        setDatePickerOpen(false);
                      }}
                      className="mt-1 w-full rounded-md py-1.5 text-center text-sm font-medium text-primary transition-colors hover:bg-accent"
                    >
                      Today
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
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
            )}
            <div className="flex min-w-0 flex-1">
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className={cn(
                    "min-w-0 shrink-0 border-l border-border/40 px-1 py-1",
                    pinActive && !isFull(i)
                      ? "flex flex-wrap items-center gap-1"
                      : "space-y-0.5",
                  )}
                  style={{
                    ...colStyle(i),
                    ...(c.isMe
                      ? { backgroundColor: meTint(mute(c.color)) }
                      : null),
                  }}
                >
                  {c.allDay.map((event) =>
                    allDayItem(event, isFull(i), pinActive && !isFull(i)),
                  )}
                </div>
              ))}
              {labelsLayout && <div style={labelsColStyle} />}
            </div>
          </div>
        </div>

        {beforeAxis}

        {dayEvents.length === 0 && (isMobile || !canManage || !onGridDraft) ? (
          <p className="px-1 py-16 text-center text-sm text-muted-foreground">
            Nothing scheduled this day.
          </p>
        ) : (
          // The axis. Rendered even on an empty day when the grid is
          // create-enabled — the empty hours are the click-to-create surface.
          <div className="relative" style={{ height: totalH }}>
            {axisLines()}
            <div
              className="absolute inset-y-0 flex"
              style={{ left: GUTTER, right: 0 }}
              // A tap on empty grid (or any card — pins stop propagation) closes
              // the mobile peek card.
              onClick={() => {
                if (peekEvent) closePeek();
              }}
            >
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className="relative min-w-0 shrink-0 border-l border-border/60"
                  style={{
                    ...colStyle(i),
                    ...(c.isMe
                      ? { backgroundColor: meTint(mute(c.color)) }
                      : null),
                  }}
                  onPointerDown={(e) =>
                    onColPointerDown(e, c.key === FAMILY_KEY ? null : c.key)
                  }
                  onPointerMove={onColPointerMove}
                  onPointerUp={onColPointerUp}
                  onPointerCancel={onColPointerCancel}
                >
                  {placedFor(c).map(({ placed, fused }) =>
                    pinActive && !isFull(i)
                      ? renderPinMark(placed, fused)
                      : renderBlock(placed, isFull(i), fused),
                  )}
                </div>
              ))}
              {labelsLayout && labelsColumn()}
            </div>
            {nowLine()}
          </div>
        )}
      </div>

      {/* Mobile peek card — portaled to the body so `fixed` anchors to the
          viewport, not the transformed swipe track. Tap it to open the full
          drawer; drag it down to dismiss. The wrapper is click-through; only the
          card catches the pointer. */}
      {peekEvent &&
        createPortal(
          (() => {
            const d = display(peekEvent);
            const color = mute(d.color);
            return (
              <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 p-3">
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={onPeekPointerDown}
                  onPointerMove={onPeekPointerMove}
                  onPointerUp={onPeekPointerUp}
                  onPointerCancel={onPeekPointerCancel}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onEventClick(peekEvent);
                      closePeek();
                    } else if (e.key === "Escape") {
                      closePeek();
                    }
                  }}
                  onTransitionEnd={() => {
                    if (!peekUp && peekDragY == null) setPeekEvent(null);
                  }}
                  style={{
                    transform:
                      peekDragY != null
                        ? `translateY(${peekDragY}px)`
                        : peekUp
                          ? "translateY(0)"
                          : "translateY(140%)",
                  }}
                  className={cn(
                    "pointer-events-auto mx-auto flex max-w-lg touch-none cursor-grab select-none flex-col rounded-2xl bg-background pb-3 pt-2 font-serif shadow-lg ring-1 ring-foreground/10 active:cursor-grabbing",
                    peekDragY == null && "transition-transform duration-200 ease-out",
                  )}
                >
                  {/* Grab handle — signals the drag-down-to-dismiss gesture. */}
                  <div
                    className="mx-auto mb-1.5 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
                    aria-hidden
                  />
                  <div className="flex items-center gap-3 px-4">
                    <span
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] italic tabular-nums text-muted-foreground">
                        {formatTimeRange(
                          peekEvent.start_time,
                          peekEvent.end_time,
                          peekEvent.all_day,
                        )}
                      </div>
                      <div
                        className="truncate text-sm leading-snug"
                        style={{ color }}
                      >
                        {d.calendarLabel && (
                          <span className="opacity-70">
                            {d.calendarLabel}:{" "}
                          </span>
                        )}
                        {peekEvent.title}
                      </div>
                    </div>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </div>
                </div>
              </div>
            );
          })(),
          document.body,
        )}
    </div>
  );
}
