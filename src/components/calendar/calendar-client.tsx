"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  addDays,
  addMonths,
  addWeeks,
  eventDayKey,
  formatDayLabel,
  formatMonthLabel,
  formatWeekLabel,
  isHomeLocation,
  memberColor,
  mutedColor,
  parseAnchorDate,
  toDateKey,
  toLogicalEvents,
} from "@/lib/calendar/calendar-utils";
import { detectConflicts } from "@/lib/calendar/conflicts";
import {
  driveBlockWindow,
  driveEventTitle,
  clusterDriveBlocks,
  FALLBACK_DRIVE_MINUTES,
  COMBINE_GAP_MINUTES,
  type PlannedDriveBlock,
} from "@/lib/calendar/drive-window";
import type { LogisticsHints } from "@/lib/calendar/queries";
import type {
  CalendarEvent,
  CalendarMember,
  CalendarSource,
  EventDuties,
  EventDuty,
} from "@/lib/calendar/types";
import { DayView } from "./day-view";
import { AgendaView } from "./agenda-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { EventSheet, type SheetMode } from "./event-sheet";
import { SyncButton } from "./sync-button";
import type { DutyChip, EventDisplay, EventDutyChips } from "./event-card";
import {
  changeEventOwner,
  setEventDuty,
  setEventGoing,
} from "@/app/(calendar)/calendar/actions";

type View = "day" | "feed" | "week" | "month";

const VIEWS: View[] = ["day", "feed", "week", "month"];

function parseView(value: string | null): View {
  return VIEWS.includes(value as View) ? (value as View) : "day";
}

export function CalendarClient({
  members,
  sources,
  events,
  goingByEvent,
  dutiesByEvent,
  logistics,
  canManage,
  currentMemberEmail,
}: {
  members: CalendarMember[];
  sources: CalendarSource[];
  events: CalendarEvent[];
  goingByEvent: Record<string, string[]>;
  dutiesByEvent: Record<string, EventDuties>;
  logistics: LogisticsHints;
  canManage: boolean;
  currentMemberEmail: string | null;
}) {
  // View + anchored date live in the URL (?view=…&date=YYYY-MM-DD) so a refresh
  // (or a shared link) lands on the same day and view instead of resetting to
  // today/Day. We seed state from the URL on mount and write changes back below.
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>(() =>
    parseView(searchParams.get("view")),
  );
  const [anchor, setAnchor] = useState(() =>
    parseAnchorDate(searchParams.get("date") ?? undefined),
  );
  const [filter, setFilter] = useState<string>("all");

  // Keep the URL in sync with view/date. We use the History API directly rather
  // than router.replace so navigating days doesn't trigger a server round-trip
  // (the page fetches all events regardless of date); Next still reads these
  // params on a full reload to restore state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    params.set("date", toDateKey(anchor));
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [view, anchor]);
  // TeamSnap events you've RSVP'd "Not going" to are hidden unless this is on.
  const [showDeclined, setShowDeclined] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("detail");
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  // Optimistic per-event "going" overrides (email -> going). The base attendee
  // set is derived from server data (event_attendees + members who already have
  // the event on their calendar as a guest); these overrides layer the user's
  // pending toggles on top, so the agenda avatars/ghosts and the drawer's "Going"
  // highlights stay in sync from a single source without a round-trip.
  const [overrides, setOverrides] = useState<
    Record<string, Record<string, boolean>>
  >({});

  // Optimistic drop-off/pick-up overrides, layered over the server-fetched
  // assignments the same way the "going" overrides are. A key set to null means
  // "unset" (delete); an absent key means "no pending change".
  const [dutyOverrides, setDutyOverrides] = useState<
    Record<string, Partial<Record<"dropoff" | "pickup", EventDuty | null>>>
  >({});

  const dutiesFor = useCallback(
    (eventId: string): EventDuties => {
      const merged: EventDuties = { ...(dutiesByEvent[eventId] ?? {}) };
      const ov = dutyOverrides[eventId];
      if (ov) {
        for (const duty of ["dropoff", "pickup"] as const) {
          if (duty in ov) {
            const v = ov[duty];
            if (v == null) delete merged[duty];
            else merged[duty] = v;
          }
        }
      }
      return merged;
    },
    [dutiesByEvent, dutyOverrides],
  );

  // Clicks are non-blocking, so several writes for the same duty can be in
  // flight at once; the seq makes an older failure revert only if nothing
  // newer has been clicked since (last write wins).
  const dutySeq = useRef<Record<string, number>>({});
  // The real drive block is written AFTER the action's response (see
  // setEventDuty); a debounced refresh a few seconds later swaps the ghost
  // block for the real mirror row without the user doing anything.
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  async function toggleGoing(
    eventId: string,
    email: string,
    willGo: boolean,
  ): Promise<{ warning?: string }> {
    const set = (going: boolean) =>
      setOverrides((prev) => ({
        ...prev,
        [eventId]: { ...(prev[eventId] ?? {}), [email]: going },
      }));
    set(willGo); // optimistic
    const res = await setEventGoing(eventId, email, willGo);
    if ("error" in res) {
      set(!willGo); // revert
      throw new Error(res.error);
    }
    // Going can reshape this parent's drive block (round trip ↔ one-way leg)
    // after the response — swap the ghost for the real row, like duty taps.
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 4000);
    return { warning: res.warning };
  }

  async function setDuty(
    eventId: string,
    duty: "dropoff" | "pickup",
    state: EventDuty | null,
  ): Promise<void> {
    const key = `${eventId}:${duty}`;
    const seq = (dutySeq.current[key] = (dutySeq.current[key] ?? 0) + 1);
    const before = dutiesFor(eventId)[duty] ?? null;
    const set = (v: EventDuty | null) =>
      setDutyOverrides((prev) => ({
        ...prev,
        [eventId]: { ...(prev[eventId] ?? {}), [duty]: v },
      }));
    set(state); // optimistic
    let res: Awaited<ReturnType<typeof setEventDuty>>;
    try {
      res = await setEventDuty(eventId, duty, state);
    } catch (err) {
      // Network-level failure (dead server, offline) — the action never ran.
      if (dutySeq.current[key] === seq) set(before);
      throw err;
    }
    if ("error" in res) {
      if (dutySeq.current[key] === seq) {
        set(before); // revert — still the latest click for this duty
      }
      throw new Error(res.error);
    }
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 4000);
  }

  // Reassign an event to another member's calendar ("this is Oscar's event").
  // The server re-creates it on the new owner's Google calendar with the old
  // owner + guests invited and deletes the original; revalidation then redraws
  // the columns. The active event is patched so the open sheet tracks the move.
  async function changeOwner(
    eventId: string,
    email: string,
  ): Promise<{ warning?: string }> {
    const res = await changeEventOwner(eventId, email);
    if ("error" in res) throw new Error(res.error);
    setActiveEvent((prev) =>
      prev && prev.id === eventId ? { ...prev, member_email: email } : prev,
    );
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 4000);
    return { warning: res.warning };
  }

  const sourcesById = useMemo(
    () => new Map(sources.map((s) => [s.id, s])),
    [sources],
  );
  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.email, m.name ?? m.email])),
    [members],
  );
  const memberColors = useMemo(
    () => new Map(members.map((m) => [m.email, m.color])),
    [members],
  );
  const kidEmails = useMemo(
    () => new Set(members.filter((m) => m.role === "kid").map((m) => m.email)),
    [members],
  );
  const parents = useMemo(
    () => members.filter((m) => m.role !== "kid"),
    [members],
  );
  // Raw events by id — resolves a drive block's source kid event (the raw list,
  // not the logical one, so the link works even if the kid event was collapsed).
  const eventsById = useMemo(
    () => new Map(events.map((e) => [e.id, e])),
    [events],
  );

  // How many active calendars each owner (member, or null for family) has. When
  // it's more than one, an event card shows its calendar name to disambiguate —
  // a single-calendar owner doesn't need it.
  const sourceCountByOwner = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const s of sources) {
      if (!s.is_active) continue;
      counts.set(s.member_email, (counts.get(s.member_email) ?? 0) + 1);
    }
    return counts;
  }, [sources]);

  // A TeamSnap event the linked player has RSVP'd "Not going" to. These are the
  // events we hide by default — same logic the row's RSVP badge uses.
  const isDeclined = useMemo(() => {
    return (event: CalendarEvent): boolean => {
      // Deleted off the owner's Google calendar → treated as declined (hidden).
      if (event.dismissed) return true;
      const source = event.calendar_source_id
        ? sourcesById.get(event.calendar_source_id)
        : undefined;
      return (
        source?.source_type === "teamsnap" &&
        source.teamsnap_player_member_id != null &&
        event.teamsnap_rsvp === "not_going"
      );
    };
  }, [sourcesById]);

  // Ghost drive blocks: the server creates/moves/deletes the real mirror rows
  // AFTER its response (the taps are non-blocking), so the calendar would lag
  // a tap by seconds. Instead, derive what the blocks SHOULD be from the
  // optimistic duty state using the server's exact math — per-event windows,
  // the same-event ↔ combine, AND the cross-event multi-stop merge — then
  // diff against the real mirror rows: show a ghost where a block is coming,
  // hide a mirror whose duty was just cleared, reassigned, or folded into a
  // merged block. When refreshed props deliver the real rows, ghosts dissolve.
  const driveAdjusted = useMemo(() => {
    const hidden = new Set<string>();
    const extra: CalendarEvent[] = [];
    const mirrorByKey = new Map<string, CalendarEvent>();
    for (const e of events) {
      if (e.drive_source_event_id && e.drive_duty) {
        mirrorByKey.set(`${e.drive_source_event_id}:${e.drive_duty}`, e);
      }
    }
    // Pass 1: per event + duty, the same per-event math as the server.
    const planned: PlannedDriveBlock[] = [];
    const sourceByKey = new Map<
      string,
      { ev: CalendarEvent; duty: "dropoff" | "pickup" }
    >();
    for (const ev of events) {
      if (ev.drive_source_event_id || ev.all_day) continue;
      if (!ev.member_email || !kidEmails.has(ev.member_email)) continue;
      if (isHomeLocation(ev.location, logistics.homeAddress)) continue;
      const d = dutiesFor(ev.id);
      if (!d.dropoff?.assignee && !d.pickup?.assignee) {
        // Nothing assigned — any lingering mirror is a just-cleared duty.
        for (const duty of ["dropoff", "pickup"] as const) {
          const m = mirrorByKey.get(`${ev.id}:${duty}`);
          if (m) hidden.add(m.id);
        }
        continue;
      }
      const driveMinutes = ev.drive_minutes ?? FALLBACK_DRIVE_MINUTES;
      const isEstimate = ev.drive_minutes == null;
      const windowArgs = {
        startTime: ev.start_time,
        endTime: ev.end_time,
        teamsnapArrivalTime: ev.teamsnap_arrival_time,
        driveMinutes,
        bufferMinutes: logistics.bufferMinutes,
      };
      // Same attending rule as the server: a parent who's "going" (server rows
      // overlaid with pending toggles) gets one-way legs, not round trips.
      const isGoing = (email: string) =>
        overrides[ev.id]?.[email] ??
        (goingByEvent[ev.id] ?? []).includes(email);
      const attending = {
        dropoff: !!d.dropoff?.assignee && isGoing(d.dropoff.assignee),
        pickup: !!d.pickup?.assignee && isGoing(d.pickup.assignee),
      };
      const dropW = driveBlockWindow({
        duty: "dropoff",
        attending: attending.dropoff,
        ...windowArgs,
      });
      const pickW = driveBlockWindow({
        duty: "pickup",
        attending: attending.pickup,
        ...windowArgs,
      });
      // Same combine rule as the server: one ↔ block when the same parent has
      // both duties with no real time at home between trips — unless they're
      // attending (one-way legs; the event itself fills the middle).
      const combined =
        !!d.dropoff?.assignee &&
        d.dropoff.assignee === d.pickup?.assignee &&
        !attending.dropoff &&
        (new Date(pickW.start).getTime() - new Date(dropW.end).getTime()) /
          60_000 <
          COMBINE_GAP_MINUTES;
      const kidName = (memberNames.get(ev.member_email) ?? ev.member_email)
        .split(" ")[0];
      for (const duty of ["dropoff", "pickup"] as const) {
        const assignee = d[duty]?.assignee ?? null;
        const shouldExist = !!assignee && !(combined && duty === "pickup");
        if (!shouldExist) {
          const m = mirrorByKey.get(`${ev.id}:${duty}`);
          if (m) hidden.add(m.id);
          continue;
        }
        const key = `${ev.id}:${duty}`;
        planned.push({
          key,
          assignee,
          duty: combined ? "combined" : duty,
          attending: attending[duty],
          kidName,
          location: ev.location,
          window: combined
            ? { start: dropW.start, end: pickW.end }
            : duty === "dropoff"
              ? dropW
              : pickW,
          title: driveEventTitle({
            duty: combined ? "combined" : duty,
            kidName,
            driveMinutes,
            isEstimate,
          }),
          anchor:
            duty === "pickup"
              ? ev.end_time ?? ev.start_time
              : ev.teamsnap_arrival_time ?? ev.start_time,
          isEstimate,
        });
        sourceByKey.set(key, { ev, duty });
      }
    }
    // Pass 2: cluster (the server's cross-event merge rule), then diff each
    // cluster against the real mirror rows. The title encodes the user-visible
    // identity (duty arrow, membership, minutes) but NOT the window — a going
    // toggle flips the same-titled block between round-trip and one-way — so
    // a mirror must match on parent, title, AND window to count as in place.
    for (const cluster of clusterDriveBlocks(planned)) {
      const owner = cluster.members[0];
      for (const m of cluster.members.slice(1)) {
        const mirror = mirrorByKey.get(m.key);
        if (mirror) hidden.add(mirror.id); // folded into the owner's block
      }
      const mirror = mirrorByKey.get(owner.key);
      if (
        mirror &&
        mirror.member_email === owner.assignee &&
        mirror.title === cluster.title &&
        mirror.end_time != null &&
        // epoch compare — DB timestamptz strings aren't byte-identical to ISO
        +new Date(mirror.start_time) === +new Date(cluster.window.start) &&
        +new Date(mirror.end_time) === +new Date(cluster.window.end)
      ) {
        continue; // real & right
      }
      if (mirror) hidden.add(mirror.id); // reassigned or reshaped — stale copy
      const src = sourceByKey.get(owner.key)!;
      extra.push({
        id: `pending-drive:${src.ev.id}:${src.duty}`,
        member_email: owner.assignee,
        calendar_source_id: null,
        title: cluster.title,
        description: null,
        location: cluster.location,
        start_time: cluster.window.start,
        end_time: cluster.window.end,
        all_day: false,
        source_type: "manual",
        external_id: null,
        google_event_id: null,
        organizer_email: null,
        teamsnap_opponent: null,
        teamsnap_arrival_time: null,
        teamsnap_is_game: null,
        teamsnap_rsvp: null,
        recurrence: "none",
        recurrence_parent_id: null,
        is_canceled: false,
        dismissed: false,
        drive_source_event_id: src.ev.id,
        drive_duty: src.duty,
        drive_minutes: null,
      });
    }
    return { hidden, extra };
  }, [events, dutiesFor, kidEmails, memberNames, logistics, goingByEvent, overrides]);

  const effectiveEvents = useMemo(
    () => [
      ...events.filter((e) => !driveAdjusted.hidden.has(e.id)),
      ...driveAdjusted.extra,
    ],
    [events, driveAdjusted],
  );

  // Collapse the same underlying event (a shared Google event read from several
  // members' calendars, or our materialized event + its guest copies) into one
  // logical event owned by a single member, with the others as attendees. This is
  // what stops a family event rendering as four separate cards.
  const base = useMemo(
    () =>
      toLogicalEvents(effectiveEvents, goingByEvent, members.map((m) => m.email)),
    [effectiveEvents, goingByEvent, members],
  );

  // Effective attendee emails for a logical event = server base ± optimistic
  // overrides. Used by both the agenda (avatars/ghosts) and the drawer toggles.
  const attendeesFor = useCallback(
    (eventId: string, ownerEmail: string | null): string[] => {
      const set = new Set(base.attendeesById.get(eventId) ?? []);
      const ov = overrides[eventId];
      if (ov) {
        for (const [email, going] of Object.entries(ov)) {
          if (going) set.add(email);
          else set.delete(email);
        }
      }
      if (ownerEmail) set.delete(ownerEmail);
      return [...set];
    },
    [base, overrides],
  );

  // Declined events don't create a scheduling conflict — you're not going, so
  // they can't clash with anything. Scan only the events you're actually
  // attending, regardless of whether declined events are currently shown.
  const conflictIds = useMemo(
    () => detectConflicts(base.events.filter((e) => !isDeclined(e))),
    [base, isDeclined],
  );

  const memberFiltered = useMemo(() => {
    if (filter === "all") return base.events;
    return base.events.filter((e) => e.member_email === filter);
  }, [base, filter]);

  // Which members get a column in the agenda. "Family" collapses to no
  // columns (only the shared banner); a single-member filter shows just them.
  const agendaMembers = useMemo(() => {
    if (filter === "all") return members;
    return members.filter((m) => m.email === filter);
  }, [filter, members]);

  const declinedCount = useMemo(
    () => memberFiltered.filter(isDeclined).length,
    [memberFiltered, isDeclined],
  );

  const visibleEvents = useMemo(
    () =>
      showDeclined
        ? memberFiltered
        : memberFiltered.filter((e) => !isDeclined(e)),
    [memberFiltered, showDeclined, isDeclined],
  );

  // Triage: the day view leads with one bar per kid event whose drop-off or
  // pick-up is still undecided, with inline quick-set chips. Driven by the
  // optimistic duty state, so deciding the last open duty dismisses the bar
  // in the same frame. Client-only (nowTick fills in after mount — no
  // Date-dependent SSR output), and only future-ish events nag: once an
  // event is over there's nothing left to arrange.
  const [nowTick, setNowTick] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowTick(Date.now());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const triageEvents = useMemo(() => {
    if (view !== "day" || nowTick == null || !canManage) return [];
    const dayKey = toDateKey(anchor);
    return visibleEvents.filter((e) => {
      if (e.all_day || e.drive_source_event_id) return false;
      if (!e.member_email || !kidEmails.has(e.member_email)) return false;
      if (!e.location || isHomeLocation(e.location, logistics.homeAddress))
        return false;
      if (eventDayKey(e) !== dayKey) return false;
      const over = new Date(e.end_time ?? e.start_time).getTime() < nowTick;
      if (over) return false;
      const d = dutiesFor(e.id);
      return !d.dropoff || !d.pickup;
    });
  }, [
    view,
    nowTick,
    canManage,
    visibleEvents,
    anchor,
    kidEmails,
    logistics,
    dutiesFor,
  ]);

  const display = useMemo(() => {
    return (event: CalendarEvent): EventDisplay => {
      const source = event.calendar_source_id
        ? sourcesById.get(event.calendar_source_id)
        : undefined;
      // A drive block borrows the KID's color (not its parent owner's): color
      // identity + flush time edges are what visually tie the block to the
      // kid's event across the columns — no connector lines.
      const driveSource = event.drive_source_event_id
        ? eventsById.get(event.drive_source_event_id)
        : undefined;
      // Member identity drives the card color so a card matches its column
      // header dot. Fall back to the source color (e.g. a family calendar with
      // no member) and finally a hashed color.
      const color =
        (driveSource?.member_email
          ? memberColors.get(driveSource.member_email)
          : null) ??
        (event.member_email ? memberColors.get(event.member_email) : null) ??
        source?.color ??
        memberColor(event.member_email);
      const sourceLabel =
        source?.nickname ??
        source?.teamsnap_team_name ??
        (event.member_email ? memberNames.get(event.member_email) ?? null : null);
      // The calendar's own name, shown as a "Name: Title" prefix. Always shown
      // for imported (TeamSnap/ICS) events so you can tell which team/feed an
      // event came from; for other calendars only when the owner has more than
      // one (to disambiguate) so it isn't redundant noise.
      const isImported =
        source?.source_type === "teamsnap" || source?.source_type === "ics";
      const calendarLabel =
        isImported || (sourceCountByOwner.get(event.member_email) ?? 0) > 1
          ? source?.nickname ?? source?.teamsnap_team_name ?? null
          : null;
      // RSVP only applies to TeamSnap events whose source is linked to a player.
      const rsvp =
        source?.source_type === "teamsnap" && source.teamsnap_player_member_id
          ? event.teamsnap_rsvp ?? "no_reply"
          : null;
      const attendees = attendeesFor(event.id, event.member_email).map(
        (email) => ({
          email,
          name: memberNames.get(email) ?? email,
          color: memberColors.get(email) ?? memberColor(email),
        }),
      );
      // Drop-off/pick-up chips: only kid-owned timed events carry duty (a
      // drive block never does — it IS the duty — and an event AT home needs
      // no transport at all).
      let duties: EventDutyChips | null = null;
      if (
        !event.all_day &&
        !event.drive_source_event_id &&
        !isHomeLocation(event.location, logistics.homeAddress) &&
        event.member_email &&
        kidEmails.has(event.member_email)
      ) {
        const d = dutiesFor(event.id);
        const chip = (v: EventDuty | undefined): DutyChip => {
          if (!v) return "unset";
          if (v.isNa || !v.assignee) return "na";
          const name = memberNames.get(v.assignee) ?? v.assignee;
          return {
            initial: name.charAt(0).toUpperCase(),
            color: memberColors.get(v.assignee) ?? memberColor(v.assignee),
          };
        };
        duties = { dropoff: chip(d.dropoff), pickup: chip(d.pickup) };
      }
      return {
        event,
        color,
        sourceLabel,
        calendarLabel,
        conflict: conflictIds.has(event.id),
        rsvp,
        isTeamsnap: source?.source_type === "teamsnap",
        attendees,
        duties,
        // A synthesized block awaiting its real mirror row — rendered as a
        // translucent ghost so the tap visibly "took" instantly.
        pendingDrive: event.id.startsWith("pending-drive:"),
      };
    };
  }, [
    sourcesById,
    memberNames,
    memberColors,
    sourceCountByOwner,
    conflictIds,
    attendeesFor,
    kidEmails,
    dutiesFor,
    eventsById,
    logistics,
  ]);

  const logicalById = useMemo(
    () => new Map(base.events.map((e) => [e.id, e])),
    [base],
  );

  function openDetail(event: CalendarEvent) {
    // A drive block opens its source kid event — the block is an artifact of
    // the assignment, not a thing to inspect or edit on its own.
    const target = event.drive_source_event_id
      ? logicalById.get(event.drive_source_event_id) ??
        eventsById.get(event.drive_source_event_id) ??
        event
      : event;
    setActiveEvent(target);
    setSheetMode("detail");
    setSheetOpen(true);
  }

  function openCreate() {
    setActiveEvent(null);
    setSheetMode("create");
    setSheetOpen(true);
  }

  function shift(dir: 1 | -1) {
    setAnchor((d) =>
      view === "month"
        ? addMonths(d, dir)
        : view === "week"
          ? addWeeks(d, dir)
          : view === "day"
            ? addDays(d, dir)
            : addDays(d, dir * 7),
    );
  }

  const periodLabel =
    view === "month"
      ? formatMonthLabel(anchor)
      : view === "day"
        ? formatDayLabel(anchor)
        : formatWeekLabel(anchor);

  const filterOptions: { key: string; label: string; color?: string }[] = [
    { key: "all", label: "All" },
    ...members.map((m) => ({
      key: m.email,
      label: m.name ?? m.email,
      color: m.color ?? memberColor(m.email),
    })),
  ];

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 sm:px-6">
      {/* Filter chips + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setFilter(o.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === o.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {o.color && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: o.color }}
                  aria-hidden
                />
              )}
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <SyncButton />
          {canManage && (
            <>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href="/settings/calendars" />}
              >
                <SlidersHorizontal />
                Calendars
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus />
                Event
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Date nav (left) + view switch (right) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger
              aria-label="Filters"
              className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
            >
              <Filter className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <label
                    htmlFor="show-declined"
                    className="text-sm font-medium"
                  >
                    Show hidden events
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Events you&rsquo;ve declined are hidden — a TeamSnap
                    &ldquo;Not going,&rdquo; or one removed from its Google
                    calendar.
                    {declinedCount > 0 &&
                      ` ${declinedCount} hidden right now.`}
                  </p>
                </div>
                <Switch
                  id="show-declined"
                  checked={showDeclined}
                  onCheckedChange={setShowDeclined}
                />
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => shift(-1)}
            aria-label="Previous"
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => shift(1)}
            aria-label="Next"
          >
            <ChevronRight />
          </Button>
          {view !== "feed" && (
            <span className="ml-1 text-sm font-medium">{periodLabel}</span>
          )}
        </div>
        <div className="inline-flex rounded-lg border p-0.5">
          {(["day", "feed", "week", "month"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                view === v
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* The view */}
      <div className="py-4">
        {view === "day" && (
          <>
            {triageEvents.length > 0 && (
              <div className="mb-4 space-y-1.5">
                {triageEvents.map((e) => (
                  <DutyTriageBar
                    key={e.id}
                    event={e}
                    kidName={
                      (memberNames.get(e.member_email ?? "") ??
                        e.member_email ??
                        "")?.split(" ")[0]
                    }
                    color={
                      memberColors.get(e.member_email ?? "") ??
                      memberColor(e.member_email)
                    }
                    duties={dutiesFor(e.id)}
                    parents={parents}
                    onSetDuty={setDuty}
                    onOpen={() => openDetail(e)}
                  />
                ))}
              </div>
            )}
            <DayView
              events={visibleEvents}
              anchorDate={anchor}
              members={agendaMembers}
              display={display}
              onEventClick={openDetail}
              selectedEventId={sheetOpen ? activeEvent?.id ?? null : null}
              currentMemberEmail={currentMemberEmail}
            />
          </>
        )}
        {view === "feed" && (
          <AgendaView
            events={visibleEvents}
            anchorDate={anchor}
            members={agendaMembers}
            display={display}
            onEventClick={openDetail}
            selectedEventId={sheetOpen ? activeEvent?.id ?? null : null}
          />
        )}
        {view === "week" && (
          <WeekView
            events={visibleEvents}
            anchorDate={anchor}
            display={display}
            onEventClick={openDetail}
          />
        )}
        {view === "month" && (
          <MonthView
            events={visibleEvents}
            anchorDate={anchor}
            display={display}
            onEventClick={openDetail}
          />
        )}
      </div>

      <EventSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        mode={sheetMode}
        onModeChange={setSheetMode}
        event={activeEvent}
        members={members}
        sources={sources}
        canManage={canManage}
        canRsvp={
          canManage &&
          (activeEvent?.calendar_source_id
            ? sourcesById.get(activeEvent.calendar_source_id)?.source_type ===
              "teamsnap"
            : false)
        }
        sourceLabel={activeEvent ? display(activeEvent).sourceLabel : null}
        going={
          activeEvent
            ? attendeesFor(activeEvent.id, activeEvent.member_email)
            : []
        }
        onToggleGoing={toggleGoing}
        onChangeOwner={changeOwner}
        duties={activeEvent ? dutiesFor(activeEvent.id) : {}}
        parents={parents}
        showLogistics={
          !!activeEvent &&
          !activeEvent.all_day &&
          !activeEvent.drive_source_event_id &&
          !isHomeLocation(activeEvent.location, logistics.homeAddress) &&
          !!activeEvent.member_email &&
          kidEmails.has(activeEvent.member_email)
        }
        onSetDuty={setDuty}
      />
    </div>
  );
}

// One triage bar: a kid event on the viewed day whose drop-off or pick-up is
// still undecided. Inline chips set either duty without opening the sheet;
// the optimistic duty state dismisses the bar the moment the last open duty
// is decided. Amber, like every other "needs a decision" cue in the calendar.
function DutyTriageBar({
  event,
  kidName,
  color,
  duties,
  parents,
  onSetDuty,
  onOpen,
}: {
  event: CalendarEvent;
  kidName: string;
  color: string;
  duties: EventDuties;
  parents: CalendarMember[];
  onSetDuty: (
    eventId: string,
    duty: "dropoff" | "pickup",
    state: EventDuty | null,
  ) => Promise<void>;
  onOpen: () => void;
}) {
  const time = new Date(event.start_time).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  function group(duty: "dropoff" | "pickup") {
    const cur = duties[duty];
    const label = duty === "dropoff" ? "drop-off" : "pick-up";
    return (
      <span className="flex items-center gap-1.5 sm:gap-1">
        <span className="text-muted-foreground" aria-hidden>
          {duty === "dropoff" ? "→" : "←"}
        </span>
        {parents.map((p) => {
          const selected = cur?.assignee === p.email;
          const name = p.name ?? p.email;
          return (
            <button
              key={p.email}
              type="button"
              onClick={() =>
                onSetDuty(
                  event.id,
                  duty,
                  selected ? null : { assignee: p.email, isNa: false },
                ).catch(() => {})
              }
              aria-pressed={selected}
              title={`${name}: ${label}`}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold leading-none text-white transition-opacity sm:h-5 sm:w-5 sm:text-[10px]",
                selected ? "opacity-100" : "opacity-40 hover:opacity-75",
              )}
              style={{
                backgroundColor: mutedColor(p.color ?? memberColor(p.email)),
              }}
            >
              {name.charAt(0).toUpperCase()}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() =>
            onSetDuty(
              event.id,
              duty,
              cur?.isNa ? null : { assignee: null, isNa: true },
            ).catch(() => {})
          }
          aria-pressed={!!cur?.isNa}
          title={`No ${label} needed`}
          className={cn(
            "rounded-full border px-2 py-1 text-[11px] font-medium leading-none transition-colors sm:px-1.5 sm:py-px sm:text-[10px]",
            cur?.isNa
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground opacity-60 hover:opacity-100",
          )}
        >
          N/A
        </button>
      </span>
    );
  }

  // Phone: the title takes the full first line and the chip groups sit on
  // their own line with finger-sized targets. Desktop (sm+): one line, chips
  // trailing right.
  return (
    <div className="flex flex-col gap-y-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs sm:flex-row sm:items-center sm:gap-x-3 sm:py-1.5 dark:border-amber-900 dark:bg-amber-950/40">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 items-center gap-2 text-left hover:underline sm:flex-1"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: mutedColor(color) }}
          aria-hidden
        />
        <span className="truncate font-medium text-foreground">
          {kidName} · {event.title}
        </span>
        <span className="shrink-0 italic text-muted-foreground">{time}</span>
      </button>
      <span className="flex shrink-0 items-center gap-5 pl-4 sm:gap-3 sm:pl-0">
        {group("dropoff")}
        {group("pickup")}
      </span>
    </div>
  );
}
