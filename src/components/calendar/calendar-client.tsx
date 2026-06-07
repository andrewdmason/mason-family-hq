"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  formatDayLabel,
  formatMonthLabel,
  formatWeekLabel,
  memberColor,
  parseAnchorDate,
  toDateKey,
  toLogicalEvents,
} from "@/lib/calendar/calendar-utils";
import { detectConflicts } from "@/lib/calendar/conflicts";
import type {
  CalendarEvent,
  CalendarMember,
  CalendarSource,
} from "@/lib/calendar/types";
import { DayView } from "./day-view";
import { AgendaView } from "./agenda-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { EventSheet, type SheetMode } from "./event-sheet";
import { SyncButton } from "./sync-button";
import type { EventDisplay } from "./event-card";
import { setEventGoing } from "@/app/(calendar)/calendar/actions";

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
  canManage,
  currentMemberEmail,
}: {
  members: CalendarMember[];
  sources: CalendarSource[];
  events: CalendarEvent[];
  goingByEvent: Record<string, string[]>;
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

  // Collapse the same underlying event (a shared Google event read from several
  // members' calendars, or our materialized event + its guest copies) into one
  // logical event owned by a single member, with the others as attendees. This is
  // what stops a family event rendering as four separate cards.
  const base = useMemo(
    () => toLogicalEvents(events, goingByEvent, members.map((m) => m.email)),
    [events, goingByEvent, members],
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

  const display = useMemo(() => {
    return (event: CalendarEvent): EventDisplay => {
      const source = event.calendar_source_id
        ? sourcesById.get(event.calendar_source_id)
        : undefined;
      // Member identity drives the card color so a card matches its column
      // header dot. Fall back to the source color (e.g. a family calendar with
      // no member) and finally a hashed color.
      const color =
        (event.member_email ? memberColors.get(event.member_email) : null) ??
        source?.color ??
        memberColor(event.member_email);
      const sourceLabel =
        source?.nickname ??
        source?.teamsnap_team_name ??
        (event.member_email ? memberNames.get(event.member_email) ?? null : null);
      // The calendar's own name (not the owner's name), shown only when this
      // owner has more than one calendar so cards can tell them apart.
      const calendarLabel =
        (sourceCountByOwner.get(event.member_email) ?? 0) > 1
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
      return {
        event,
        color,
        sourceLabel,
        calendarLabel,
        conflict: conflictIds.has(event.id),
        rsvp,
        attendees,
      };
    };
  }, [
    sourcesById,
    memberNames,
    memberColors,
    sourceCountByOwner,
    conflictIds,
    attendeesFor,
  ]);

  function openDetail(event: CalendarEvent) {
    setActiveEvent(event);
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
          <DayView
            events={visibleEvents}
            anchorDate={anchor}
            members={agendaMembers}
            display={display}
            onEventClick={openDetail}
            selectedEventId={sheetOpen ? activeEvent?.id ?? null : null}
            currentMemberEmail={currentMemberEmail}
          />
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
      />
    </div>
  );
}
