"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  formatMonthLabel,
  formatWeekLabel,
  memberColor,
} from "@/lib/calendar/calendar-utils";
import { detectConflicts } from "@/lib/calendar/conflicts";
import type {
  CalendarEvent,
  CalendarMember,
  CalendarSource,
} from "@/lib/calendar/types";
import { AgendaView } from "./agenda-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { EventSheet, type SheetMode } from "./event-sheet";
import { SyncButton } from "./sync-button";
import type { EventDisplay } from "./event-card";

type View = "agenda" | "week" | "month";
const FAMILY = "__family__";

export function CalendarClient({
  members,
  sources,
  events,
  canManage,
}: {
  members: CalendarMember[];
  sources: CalendarSource[];
  events: CalendarEvent[];
  canManage: boolean;
}) {
  const [view, setView] = useState<View>("agenda");
  const [anchor, setAnchor] = useState(() => new Date());
  const [filter, setFilter] = useState<string>("all");
  // TeamSnap events you've RSVP'd "Not going" to are hidden unless this is on.
  const [showDeclined, setShowDeclined] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("detail");
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);

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

  // A TeamSnap event the linked player has RSVP'd "Not going" to. These are the
  // events we hide by default — same logic the row's RSVP badge uses.
  const isDeclined = useMemo(() => {
    return (event: CalendarEvent): boolean => {
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

  // Declined events don't create a scheduling conflict — you're not going, so
  // they can't clash with anything. Scan only the events you're actually
  // attending, regardless of whether declined events are currently shown.
  const conflictIds = useMemo(
    () => detectConflicts(events.filter((e) => !isDeclined(e))),
    [events, isDeclined],
  );

  const memberFiltered = useMemo(() => {
    if (filter === "all") return events;
    if (filter === FAMILY) return events.filter((e) => !e.member_email);
    return events.filter((e) => e.member_email === filter);
  }, [events, filter]);

  // Which members get a column in the agenda. "Family" collapses to no
  // columns (only the shared banner); a single-member filter shows just them.
  const agendaMembers = useMemo(() => {
    if (filter === FAMILY) return [];
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
      // RSVP only applies to TeamSnap events whose source is linked to a player.
      const rsvp =
        source?.source_type === "teamsnap" && source.teamsnap_player_member_id
          ? event.teamsnap_rsvp ?? "no_reply"
          : null;
      return {
        event,
        color,
        sourceLabel,
        conflict: conflictIds.has(event.id),
        rsvp,
      };
    };
  }, [sourcesById, memberNames, memberColors, conflictIds]);

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
          : addDays(d, dir * 7),
    );
  }

  const periodLabel =
    view === "month" ? formatMonthLabel(anchor) : formatWeekLabel(anchor);

  const filterOptions: { key: string; label: string; color?: string }[] = [
    { key: "all", label: "All" },
    ...members.map((m) => ({
      key: m.email,
      label: m.name ?? m.email,
      color: m.color ?? memberColor(m.email),
    })),
    { key: FAMILY, label: "Family", color: memberColor(null) },
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

      {/* View switch + date nav */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="inline-flex rounded-lg border p-0.5">
          {(["agenda", "week", "month"] as View[]).map((v) => (
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
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger
              aria-label="Filters"
              className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
            >
              <Filter className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <label
                    htmlFor="show-declined"
                    className="text-sm font-medium"
                  >
                    Show declined events
                  </label>
                  <p className="text-xs text-muted-foreground">
                    TeamSnap events you&rsquo;ve marked &ldquo;Not going&rdquo;
                    are hidden.
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
          {view !== "agenda" && (
            <span className="ml-1 text-sm font-medium">{periodLabel}</span>
          )}
        </div>
      </div>

      {/* The view */}
      <div className="py-4">
        {view === "agenda" && (
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
      />
    </div>
  );
}
