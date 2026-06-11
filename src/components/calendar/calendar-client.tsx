"use client";

import {
  type ReactNode,
  type TouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  List,
  ListFilter,
  Plus,
  type LucideIcon,
} from "lucide-react";
import {
  AppHeaderContent,
  AppNavContent,
} from "@/components/layout/app-header";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { DutyChip, EventDisplay, EventDutyChips } from "./event-card";
import {
  changeEventOwner,
  setEventDuty,
  setEventGoing,
} from "@/app/(calendar)/calendar/actions";

type View = "day" | "feed" | "week" | "month";

const VIEWS: View[] = ["day", "feed", "week", "month"];

// Icons for the mobile nav sheet's view picker.
const VIEW_ICONS: Record<View, LucideIcon> = {
  day: Calendar,
  feed: List,
  week: CalendarRange,
  month: CalendarDays,
};

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
  // Person filter: emails whose events to show; empty = everyone. Multi-select
  // pills in the header's filter popover (same pattern as the timeline's).
  const [selectedPeople, setSelectedPeople] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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
        rrule: null,
        google_recurring_event_id: null,
        google_attendees: null,
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
    if (selectedPeople.size === 0) return base.events;
    return base.events.filter((e) => selectedPeople.has(e.member_email ?? ""));
  }, [base, selectedPeople]);

  // Which members get a column in the agenda. No selection shows everyone;
  // a person filter shows just the selected columns.
  const agendaMembers = useMemo(() => {
    if (selectedPeople.size === 0) return members;
    return members.filter((m) => selectedPeople.has(m.email));
  }, [selectedPeople, members]);

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

  // One period forward/back, sized to the current view (day/week/month; the
  // feed pages by a week). Shared by the header arrows and the swipe gesture.
  const anchorFor = (from: Date, dir: 1 | -1) =>
    view === "month"
      ? addMonths(from, dir)
      : view === "week"
        ? addWeeks(from, dir)
        : view === "day"
          ? addDays(from, dir)
          : addDays(from, dir * 7);

  function shift(dir: 1 | -1) {
    setAnchor((d) => anchorFor(d, dir));
  }

  const periodLabel =
    view === "month"
      ? formatMonthLabel(anchor)
      : view === "day"
        ? formatDayLabel(anchor)
        : formatWeekLabel(anchor);

  // Swipe left/right on the view to go forward/back a period, with the
  // adjacent period sliding in under the finger (Google Calendar style). The
  // view renders as a 3-panel track (prev | current | next) parked at -100%;
  // a horizontally-dominant drag mounts the neighbors and moves the track
  // imperatively (no re-render per touchmove), release animates to the
  // neighbor, and the anchor swap + track reset happen inside flushSync so
  // the new period lands in the center with no flash. The track's resting
  // transform lives in a class, not a style prop, so React re-renders during
  // the drag can't stomp the imperative transform.
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    horizontal: boolean | null;
  } | null>(null);
  const swipeAnimating = useRef(false);
  // Neighbors only exist during a gesture — no point tripling render work.
  const [neighborsMounted, setNeighborsMounted] = useState(false);

  function setTrack(transform: string, transition: string) {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = transition;
    track.style.transform = transform;
  }

  function settleTrack(delayMs: number, after?: () => void) {
    swipeAnimating.current = true;
    window.setTimeout(() => {
      const track = trackRef.current;
      if (track) track.style.transition = "none";
      after?.();
      track?.style.removeProperty("transform");
      track?.style.removeProperty("transition");
      swipeAnimating.current = false;
    }, delayMs);
  }

  function onViewTouchStart(e: TouchEvent) {
    gesture.current =
      !swipeAnimating.current && e.touches.length === 1
        ? {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            horizontal: null,
          }
        : null;
  }

  function onViewTouchMove(e: TouchEvent) {
    const g = gesture.current;
    if (!g || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - g.x;
    const dy = e.touches[0].clientY - g.y;
    if (g.horizontal === null) {
      // Wait out the slop radius, then commit to one axis for the whole
      // gesture so vertical scrolling never turns into a half-swipe.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
      if (g.horizontal) setNeighborsMounted(true);
    }
    if (!g.horizontal) return;
    setTrack(`translateX(calc(-100% + ${dx}px))`, "none");
  }

  function onViewTouchEnd(e: TouchEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.horizontal) return;
    const dx = e.changedTouches[0].clientX - g.x;
    const width = trackRef.current?.clientWidth ?? 0;
    if (Math.abs(dx) < Math.min(96, width / 3)) {
      // Not far enough — snap back to the current period.
      setTrack("translateX(-100%)", "transform 200ms ease-out");
      settleTrack(220, () => setNeighborsMounted(false));
      return;
    }
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    setTrack(
      `translateX(${dir === 1 ? "-200%" : "0%"})`,
      "transform 250ms ease-out",
    );
    settleTrack(260, () =>
      flushSync(() => {
        shift(dir);
        setNeighborsMounted(false);
      }),
    );
  }

  function onViewTouchCancel() {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.horizontal) return;
    setTrack("translateX(-100%)", "transform 200ms ease-out");
    settleTrack(220, () => setNeighborsMounted(false));
  }

  function togglePerson(email: string) {
    setSelectedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function clearFilters() {
    setSelectedPeople(new Set());
    setShowDeclined(false);
  }

  // Both knobs in the filter popover count toward the trigger's badge.
  const filterCount = selectedPeople.size + (showDeclined ? 1 : 0);

  // Drop-off/pick-up triage bars for the viewed day. They render below the
  // day view's anchored chrome (DayView's beforeAxis) so the member/date
  // header stays flush against the global header from scroll position zero.
  const triageBars =
    triageEvents.length > 0 ? (
      <div className="my-2 space-y-1.5">
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
            onOpen={() => openDetail(e)}
          />
        ))}
      </div>
    ) : null;

  // One period of the current view, anchored anywhere — the center panel gets
  // the real anchor, the swipe panels get its neighbors.
  const renderView = (anchorDate: Date) => (
    <>
      {view === "day" && (
        <DayView
          events={visibleEvents}
          anchorDate={anchorDate}
          members={agendaMembers}
          display={display}
          onEventClick={openDetail}
          selectedEventId={sheetOpen ? activeEvent?.id ?? null : null}
          currentMemberEmail={currentMemberEmail}
          // Reference equality: only the center panel is the real anchor —
          // the swipe neighbors get fresh Date objects from anchorFor().
          beforeAxis={anchorDate === anchor ? triageBars : null}
        />
      )}
      {view === "feed" && (
        <AgendaView
          events={visibleEvents}
          anchorDate={anchorDate}
          members={agendaMembers}
          display={display}
          onEventClick={openDetail}
          selectedEventId={sheetOpen ? activeEvent?.id ?? null : null}
        />
      )}
      {view === "week" && (
        <WeekView
          events={visibleEvents}
          anchorDate={anchorDate}
          display={display}
          onEventClick={openDetail}
        />
      )}
      {view === "month" && (
        <MonthView
          events={visibleEvents}
          anchorDate={anchorDate}
          display={display}
          onEventClick={openDetail}
        />
      )}
    </>
  );

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 sm:px-6">
      {/* The calendar's whole toolbar rides in the global header (see
          AppHeaderContent): date nav on the left; view switcher (sm+) and
          filter on the right, next to the notification bell. New event is the
          floating button below; phones switch views from the hamburger. */}
      <AppHeaderContent>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pl-2 sm:pl-4">
          <div className="flex min-w-0 items-center gap-1">
            {/* Google-style "today": a calendar-page glyph carrying today's
                date number. Rendered client-side only (the header slot), so
                new Date() can't cause a hydration mismatch. */}
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setAnchor(new Date())}
              aria-label="Today"
              title="Today"
            >
              <span className="flex size-4.5 items-center justify-center rounded-[5px] border-[1.5px] border-current pt-px text-[9px] font-semibold leading-none">
                {new Date().getDate()}
              </span>
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
            {/* Day view shows its date in the anchored all-day gutter instead
                (see DayView), so the toolbar label is week/month-only. */}
            {(view === "week" || view === "month") && (
              <span className="mx-1 hidden min-w-0 truncate text-sm font-medium sm:inline">
                {periodLabel}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Phones pick the view from the hamburger sheet instead (the
                AppNavContent block below). */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Calendar view"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "capitalize max-sm:hidden",
                )}
              >
                {view}
                <ChevronDown className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuRadioGroup
                  value={view}
                  onValueChange={(value) => setView(value as View)}
                >
                  {VIEWS.map((v) => (
                    <DropdownMenuRadioItem
                      key={v}
                      value={v}
                      closeOnClick
                      className="capitalize"
                    >
                      {v}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger
                aria-label="Filters"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-sm" }),
                  "relative",
                  filterCount > 0 && "bg-accent text-foreground",
                )}
              >
                <ListFilter className="size-4" />
                {filterCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground px-0.5 text-[9px] font-semibold tabular-nums text-background">
                    {filterCount}
                  </span>
                )}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    Filter
                  </span>
                  {filterCount > 0 && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  People
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <FilterPill
                      key={m.email}
                      selected={selectedPeople.has(m.email)}
                      onClick={() => togglePerson(m.email)}
                      leading={
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: m.color ?? memberColor(m.email),
                          }}
                          aria-hidden
                        />
                      }
                    >
                      {m.name ?? m.email}
                    </FilterPill>
                  ))}
                </div>
                <div className="mt-3 flex items-start justify-between gap-3 border-t pt-3">
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
          </div>
        </div>
      </AppHeaderContent>

      {/* The mobile nav sheet's calendar section: the view picker lives there
          on phones, where the header has no room for the dropdown. */}
      <AppNavContent>
        <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          View
        </div>
        <div className="flex flex-col gap-0.5">
          {VIEWS.map((v) => {
            const Icon = VIEW_ICONS[v];
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2 py-2 text-left text-sm capitalize",
                  active
                    ? "bg-accent/60 text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {v}
                {active && (
                  <Check className="ml-auto size-4 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </AppNavContent>

      {/* New event floats over the grid, Google Calendar style, instead of
          taking up header space. */}
      {canManage && (
        <Button
          onClick={openCreate}
          aria-label="New event"
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] right-5 z-40 size-12 rounded-full shadow-lg"
        >
          <Plus className="size-5" />
        </Button>
      )}

      {/* The view. No top padding: the day view's anchored chrome must sit
          flush against the global header at scroll zero, so the two read as
          one fixed header instead of the chrome drifting up before pinning. */}
      <div className="pb-4">
        {/* Swipe track: 3 panels parked one panel-width left, so the current
            period sits in the clipped window and its neighbors wait offstage.
            touch-pan-y leaves vertical scrolling to the browser. overflow-x-
            clip (not hidden) does the clipping WITHOUT creating a scrollport,
            so the day view's sticky date/all-day chrome keeps sticking to the
            page scroll. */}
        <div
          className="touch-pan-y overflow-x-clip"
          onTouchStart={onViewTouchStart}
          onTouchMove={onViewTouchMove}
          onTouchEnd={onViewTouchEnd}
          onTouchCancel={onViewTouchCancel}
        >
          <div
            ref={trackRef}
            className="flex items-start [transform:translateX(-100%)]"
          >
            <div className="w-full shrink-0">
              {neighborsMounted && renderView(anchorFor(anchor, -1))}
            </div>
            <div className="w-full shrink-0">{renderView(anchor)}</div>
            <div className="w-full shrink-0">
              {neighborsMounted && renderView(anchorFor(anchor, 1))}
            </div>
          </div>
        </div>
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
// still undecided. Tapping it opens the event drawer to set the duties; the
// optimistic duty state dismisses the bar the moment the last open duty is
// decided. Amber, like every other "needs a decision" cue in the calendar.
function DutyTriageBar({
  event,
  kidName,
  color,
  duties,
  onOpen,
}: {
  event: CalendarEvent;
  kidName: string;
  color: string;
  duties: EventDuties;
  onOpen: () => void;
}) {
  const time = new Date(event.start_time).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  // The whole bar is one tap target opening the event drawer, where the
  // duties get set — inline assignee chips were too much chrome, especially
  // on the phone. The trailing arrows just say which legs are still open.
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-left text-xs transition-colors hover:bg-amber-100/60 dark:border-amber-900 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
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
      <span className="ml-auto flex shrink-0 items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
        {!duties.dropoff && (
          <span title="Drop-off unset" aria-label="Drop-off unset">
            →?
          </span>
        )}
        {!duties.pickup && (
          <span title="Pick-up unset" aria-label="Pick-up unset">
            ←?
          </span>
        )}
        <ChevronRight className="size-3.5" aria-hidden />
      </span>
    </button>
  );
}

// Toggleable filter pill, matching the timeline's filter popover (see
// FilterPill in vertical-timeline.tsx) so filtering feels the same across apps.
function FilterPill({
  selected,
  onClick,
  leading,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {leading}
      {children}
    </button>
  );
}
