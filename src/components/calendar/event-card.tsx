"use client";

import { AlertTriangle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeRange, mutedColor } from "@/lib/calendar/calendar-utils";
import { MemberAvatar } from "@/components/journal/member-avatar";
import type { CalendarEvent, TeamsnapRsvp } from "@/lib/calendar/types";

export interface EventAttendee {
  email: string;
  name: string | null;
  color: string;
}

// A duty slot as the cards render it: the assigned parent's initial in their
// color, "na" (explicitly no drive needed — renders nothing), or "unset" (the
// attention state — a hollow amber dot, shown only when the event has a
// location to drive to).
export type DutyChip = { initial: string; color: string } | "na" | "unset";

export interface EventDutyChips {
  dropoff: DutyChip;
  pickup: DutyChip;
}

export interface EventDisplay {
  event: CalendarEvent;
  color: string;
  sourceLabel: string | null;
  // The source calendar's name, set only when this event's owner has more than
  // one calendar — so a card can disambiguate which one it came from (e.g.
  // "NOLL12: Scrimmage…"). Null when the owner has a single calendar, where the
  // name would just be noise.
  calendarLabel: string | null;
  conflict: boolean;
  // The player's RSVP state for a linked TeamSnap event, or null when RSVP
  // doesn't apply (no team source, or no player linked to it).
  rsvp: TeamsnapRsvp | null;
  // True when this event's calendar source is a TeamSnap feed — drives the
  // baseball glyph on the textless mobile day view.
  isTeamsnap: boolean;
  // Family members (besides the owner) on this event — rendered as avatars on
  // the card, and as ghost blocks in their own columns.
  attendees: EventAttendee[];
  // Drop-off/pick-up chips for a kid's timed event; null when duty doesn't
  // apply (adult-owned, all-day, or a drive block itself).
  duties: EventDutyChips | null;
  // A client-synthesized drive block whose real mirror row hasn't landed yet —
  // rendered translucent/pulsing so a duty tap shows its block instantly.
  pendingDrive: boolean;
}

/** The drop-off (→) / pick-up (←) glyphs on a kid's event card. Assigned reads
 * as the parent's initial in their color; N/A consumes no ink at all; unset is
 * a hollow amber dot — the only state that asks for attention — and only when
 * the event has a location (a proxy for "someone has to drive"). */
export function DutyGlyphs({
  duties,
  hasLocation,
  className,
}: {
  duties: EventDutyChips;
  hasLocation: boolean;
  className?: string;
}) {
  const slot = (duty: "dropoff" | "pickup", chip: DutyChip) => {
    if (chip === "na") return null;
    const arrow = duty === "dropoff" ? "→" : "←";
    const label = duty === "dropoff" ? "Drop-off" : "Pick-up";
    if (chip === "unset") {
      if (!hasLocation) return null;
      return (
        <span
          key={duty}
          title={`${label} not set`}
          className="inline-flex items-center gap-0.5 text-muted-foreground"
        >
          <span aria-hidden>{arrow}</span>
          <span className="h-2 w-2 rounded-full border border-amber-500" />
        </span>
      );
    }
    return (
      <span
        key={duty}
        title={label}
        className="inline-flex items-center gap-0.5 text-muted-foreground"
      >
        <span aria-hidden>{arrow}</span>
        <span
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-semibold leading-none text-white"
          style={{ backgroundColor: mutedColor(chip.color) }}
        >
          {chip.initial}
        </span>
      </span>
    );
  };
  const dropoff = slot("dropoff", duties.dropoff);
  const pickup = slot("pickup", duties.pickup);
  if (!dropoff && !pickup) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", className)}>
      {dropoff}
      {pickup}
    </span>
  );
}

/** Overlapping avatars for the other family members on an event. */
function AttendeeAvatars({ attendees }: { attendees: EventAttendee[] }) {
  if (attendees.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1">
      {attendees.slice(0, 4).map((a) => (
        <span key={a.email} title={a.name ?? a.email} className="inline-flex">
          <MemberAvatar name={a.name} size="sm" className="ring-1 ring-card" />
        </span>
      ))}
    </span>
  );
}

/** A small pill for an event's RSVP state. "Needs RSVP" is the actionable one;
 * answered states are shown muted so they fade into the row. */
function RsvpBadge({ rsvp }: { rsvp: TeamsnapRsvp }) {
  if (rsvp === "no_reply") {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:bg-amber-950 dark:text-amber-400">
        RSVP
      </span>
    );
  }
  const styles: Record<Exclude<TeamsnapRsvp, "no_reply">, string> = {
    going: "text-green-600",
    maybe: "text-yellow-600",
    not_going: "text-red-600",
  };
  const labels: Record<Exclude<TeamsnapRsvp, "no_reply">, string> = {
    going: "Going",
    maybe: "Maybe",
    not_going: "Not going",
  };
  return (
    <span className={cn("shrink-0 text-[10px] font-medium", styles[rsvp])}>
      {labels[rsvp]}
    </span>
  );
}

/** A row in the agenda / day list. The optional member badge stamps the row
 * with who the event belongs to — used by the single-column mobile agenda, where
 * there are no per-member column headers to carry that identity. */
export function EventRow({
  display,
  onClick,
  selected,
  showLocation = true,
  memberBadge,
}: {
  display: EventDisplay;
  onClick: (event: CalendarEvent) => void;
  selected?: boolean;
  showLocation?: boolean;
  memberBadge?: { name: string; color: string } | null;
}) {
  const {
    event,
    color,
    sourceLabel,
    conflict,
    rsvp,
    attendees,
    calendarLabel,
    duties,
  } = display;
  return (
    <button
      type="button"
      data-event-id={event.id}
      onClick={() => onClick(event)}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted/60",
        selected && "border-border bg-muted/60",
      )}
    >
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: mutedColor(color) }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {calendarLabel && (
              <span className="text-muted-foreground">{calendarLabel}: </span>
            )}
            {event.title}
          </span>
          {conflict && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          )}
          {rsvp && <RsvpBadge rsvp={rsvp} />}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {memberBadge && (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: mutedColor(memberBadge.color) }}
                aria-hidden
              />
              {memberBadge.name}
            </span>
          )}
          <span className="italic">
            {formatTimeRange(event.start_time, event.end_time, event.all_day)}
          </span>
          {sourceLabel && <span className="truncate">· {sourceLabel}</span>}
          {showLocation && event.location && (
            <span className="inline-flex items-center gap-0.5 truncate">
              <MapPin className="h-3 w-3" />
              {event.location}
            </span>
          )}
          {duties && (
            <DutyGlyphs duties={duties} hasLocation={!!event.location} />
          )}
          {attendees.length > 0 && <AttendeeAvatars attendees={attendees} />}
        </span>
      </span>
    </button>
  );
}

/** A discrete card for the per-member columns agenda. Reads as its own card
 * (border, surface, member-colored left accent) so a column of these never looks
 * like a rigid grid that should line up row-for-row across members. The start
 * time lives inside the card. */
export function EventColumnCard({
  display,
  onClick,
  selected,
}: {
  display: EventDisplay;
  onClick: (event: CalendarEvent) => void;
  selected?: boolean;
}) {
  const { event, color, conflict, rsvp, calendarLabel, attendees, duties } =
    display;
  const time = event.all_day
    ? "All day"
    : new Date(event.start_time).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
  return (
    <button
      type="button"
      data-event-id={event.id}
      onClick={() => onClick(event)}
      title={calendarLabel ? `${calendarLabel}: ${event.title}` : event.title}
      style={{ borderLeftColor: mutedColor(color) }}
      className={cn(
        "block w-full rounded-sm border border-border/70 border-l-[3px] bg-white px-2 py-1.5 text-left transition-colors hover:bg-muted/40 dark:bg-card",
        selected && "ring-1 ring-ring",
        display.pendingDrive && "animate-pulse opacity-60",
      )}
    >
      <span className="flex items-center gap-1 text-[11px] italic tabular-nums text-muted-foreground">
        <span>{time}</span>
        {conflict && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
        )}
        {rsvp === "no_reply" && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-1 text-[9px] font-medium leading-tight text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            RSVP
          </span>
        )}
      </span>
      <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-foreground">
        {calendarLabel && (
          <span className="text-muted-foreground">{calendarLabel}: </span>
        )}
        {event.title}
      </span>
      {(attendees.length > 0 || duties) && (
        <span className="mt-1 flex items-center gap-1.5">
          {duties && (
            <DutyGlyphs duties={duties} hasLocation={!!event.location} />
          )}
          {attendees.length > 0 && <AttendeeAvatars attendees={attendees} />}
        </span>
      )}
    </button>
  );
}

/** A muted "busy" placeholder shown in an attendee's column for an event owned by
 * someone else — so a shared event reads as one card in the owner's column while
 * still blocking the attendees' time. Clickable to open the same event. */
export function EventGhost({
  display,
  onClick,
}: {
  display: EventDisplay;
  onClick: (event: CalendarEvent) => void;
}) {
  const { event, color } = display;
  const time = event.all_day
    ? "All day"
    : new Date(event.start_time).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
  return (
    <button
      type="button"
      data-event-id={event.id}
      onClick={() => onClick(event)}
      title={`${event.title} (you're going)`}
      style={{ borderLeftColor: color }}
      className="block w-full rounded-md border border-dashed border-border/60 border-l-[3px] bg-muted/30 px-2 py-1.5 text-left opacity-70 transition-opacity hover:opacity-100"
    >
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {time}
      </span>
      <span className="mt-0.5 line-clamp-2 text-xs italic leading-snug text-muted-foreground">
        {event.title}
      </span>
    </button>
  );
}

/** A compact pill for week / month grids. */
export function EventPill({
  display,
  onClick,
}: {
  display: EventDisplay;
  onClick: (event: CalendarEvent) => void;
}) {
  const { event, color, conflict, rsvp, calendarLabel, duties } = display;
  return (
    <button
      type="button"
      data-event-id={event.id}
      onClick={() => onClick(event)}
      title={calendarLabel ? `${calendarLabel}: ${event.title}` : event.title}
      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-colors hover:bg-muted"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {!event.all_day && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {new Date(event.start_time).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
      <span className="truncate text-foreground">
        {calendarLabel && (
          <span className="text-muted-foreground">{calendarLabel}: </span>
        )}
        {event.title}
      </span>
      {duties && (
        <DutyGlyphs
          duties={duties}
          hasLocation={!!event.location}
          className="ml-auto"
        />
      )}
      {rsvp === "no_reply" && (
        <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-1 text-[9px] font-medium leading-tight text-amber-700 dark:bg-amber-950 dark:text-amber-400">
          RSVP
        </span>
      )}
      {conflict && (
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
      )}
    </button>
  );
}
