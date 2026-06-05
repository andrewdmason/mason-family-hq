"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchEventTeamAvailability } from "@/app/(calendar)/calendar/actions";
import type { TeamAvailability as TeamAvailabilityData } from "@/lib/calendar/attendance";
import type { TeamsnapRsvp } from "@/lib/calendar/types";

const STATUS_DOT: Record<TeamsnapRsvp, string> = {
  going: "bg-green-500",
  maybe: "bg-yellow-500",
  not_going: "bg-red-500",
  no_reply: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<TeamsnapRsvp, string> = {
  going: "Going",
  maybe: "Maybe",
  not_going: "Not going",
  no_reply: "No reply",
};

/** The whole team's RSVP for a TeamSnap event: a one-line summary that expands
 * to the per-player roster. Read-only — loaded from TeamSnap on open. */
export function TeamAvailability({ eventId }: { eventId: string }) {
  const [data, setData] = useState<TeamAvailabilityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    startTransition(async () => {
      const result = await fetchEventTeamAvailability(eventId);
      if (!active) return;
      if ("error" in result) setError(result.error);
      else setData(result);
    });
    return () => {
      active = false;
    };
  }, [eventId]);

  if (error) return null; // Stay quiet when TeamSnap can't be reached.

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading team availability…
      </div>
    );
  }

  const { counts } = data;
  const total = counts.going + counts.maybe + counts.not_going + counts.no_reply;
  if (total === 0) return null;

  const parts: Array<{ n: number; label: string; cls: string }> = [
    { n: counts.going, label: "Going", cls: "text-green-600" },
    { n: counts.maybe, label: "Maybe", cls: "text-yellow-600" },
    { n: counts.not_going, label: "Not going", cls: "text-red-600" },
    { n: counts.no_reply, label: "No reply", cls: "text-muted-foreground" },
  ].filter((p) => p.n > 0);

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground">
        TeamSnap attendance
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span>
            {parts.map((p, i) => (
              <span key={p.label}>
                {i > 0 && ", "}
                <strong className={p.cls}>{p.n}</strong> {p.label}
              </span>
            ))}
            <span className="ml-1">({total} total)</span>
          </span>
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>

      {expanded && (
        <ul className="ml-5 space-y-1">
          {data.roster.map((m, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  STATUS_DOT[m.status],
                )}
                aria-hidden
              />
              <span className="text-foreground">{m.name}</span>
              <span className="text-muted-foreground">
                {STATUS_LABEL[m.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
