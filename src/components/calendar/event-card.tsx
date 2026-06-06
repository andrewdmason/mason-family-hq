"use client";

import { AlertTriangle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeRange } from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, TeamsnapRsvp } from "@/lib/calendar/types";

export interface EventDisplay {
  event: CalendarEvent;
  color: string;
  sourceLabel: string | null;
  conflict: boolean;
  // The player's RSVP state for a linked TeamSnap event, or null when RSVP
  // doesn't apply (no team source, or no player linked to it).
  rsvp: TeamsnapRsvp | null;
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
  const { event, color, sourceLabel, conflict, rsvp } = display;
  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted/60",
        selected && "border-border bg-muted/60",
      )}
    >
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
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
                style={{ backgroundColor: memberBadge.color }}
                aria-hidden
              />
              {memberBadge.name}
            </span>
          )}
          <span>
            {formatTimeRange(event.start_time, event.end_time, event.all_day)}
          </span>
          {sourceLabel && <span className="truncate">· {sourceLabel}</span>}
          {showLocation && event.location && (
            <span className="inline-flex items-center gap-0.5 truncate">
              <MapPin className="h-3 w-3" />
              {event.location}
            </span>
          )}
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
  const { event, color, conflict, rsvp } = display;
  const time = event.all_day
    ? "All day"
    : new Date(event.start_time).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      title={event.title}
      style={{ borderLeftColor: color }}
      className={cn(
        "block w-full rounded-md border border-border/70 border-l-[3px] bg-card px-2 py-1.5 text-left shadow-sm transition-colors hover:bg-muted/50",
        selected && "ring-1 ring-ring",
      )}
    >
      <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
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
  const { event, color, conflict, rsvp } = display;
  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      title={event.title}
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
      <span className="truncate text-foreground">{event.title}</span>
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
