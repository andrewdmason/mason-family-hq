"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchEventTeamAvailability,
  markEventRsvp,
} from "@/app/(calendar)/calendar/actions";
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

const RSVP_OPTIONS: { value: Exclude<TeamsnapRsvp, "no_reply">; label: string }[] =
  [
    { value: "going", label: "Going" },
    { value: "maybe", label: "Maybe" },
    { value: "not_going", label: "Not going" },
  ];

/** The TeamSnap attendance block in the event sheet: the player's own RSVP
 * (settable, written back to TeamSnap) plus the whole team's roster. Both come
 * from one live fetch so the displayed state always matches TeamSnap on open. */
export function TeamsnapAttendance({
  eventId,
  canRsvp,
}: {
  eventId: string;
  canRsvp: boolean;
}) {
  const [data, setData] = useState<TeamAvailabilityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<TeamsnapRsvp>("no_reply");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    startTransition(async () => {
      const result = await fetchEventTeamAvailability(eventId);
      if (!active) return;
      if ("error" in result) {
        setError(result.error);
      } else {
        setData(result);
        setMyStatus(result.myStatus ?? "no_reply");
      }
    });
    return () => {
      active = false;
    };
  }, [eventId]);

  async function choose(value: Exclude<TeamsnapRsvp, "no_reply">) {
    if (saving || value === myStatus) return;
    const prev = myStatus;
    setMyStatus(value);
    setSaving(true);
    setSaveError(null);
    const result = await markEventRsvp(eventId, value);
    setSaving(false);
    if ("error" in result) {
      setMyStatus(prev);
      setSaveError(result.error);
    }
  }

  if (error) {
    // TeamSnap unreachable: still let a parent pick (the write will retry the
    // connection), but don't show a broken roster.
    return canRsvp ? (
      <RsvpControl
        myStatus={myStatus}
        saving={saving}
        saveError={saveError}
        onChoose={choose}
      />
    ) : null;
  }

  if (!data) {
    // Skeleton with the same shape and height as the loaded content, so the
    // rows below (Going, drop-off/pick-up) don't jump when the fetch resolves.
    return (
      <>
        {canRsvp && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Attendance
              </span>
              <span className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="inline-flex w-full rounded-lg border p-0.5">
              {RSVP_OPTIONS.map((o) => (
                <span
                  key={o.value}
                  className="flex-1 rounded-md px-2 py-1 text-center text-xs font-medium text-muted-foreground/40"
                >
                  {o.label}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2 border-t pt-3">
          <div className="text-xs font-medium text-muted-foreground">
            TeamSnap attendance
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="h-3.5 w-44 animate-pulse rounded bg-muted" />
            <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />
          </div>
        </div>
      </>
    );
  }

  const { counts } = data;
  const total = counts.going + counts.maybe + counts.not_going + counts.no_reply;
  const summaryParts: Array<{ n: number; label: string; cls: string }> = [
    { n: counts.going, label: "Going", cls: "text-green-600" },
    { n: counts.maybe, label: "Maybe", cls: "text-yellow-600" },
    { n: counts.not_going, label: "Not going", cls: "text-red-600" },
    { n: counts.no_reply, label: "No reply", cls: "text-muted-foreground" },
  ].filter((p) => p.n > 0);

  return (
    <>
      {canRsvp && (
        <RsvpControl
          myStatus={myStatus}
          saving={saving}
          saveError={saveError}
          onChoose={choose}
        />
      )}

      {total > 0 && (
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
                {summaryParts.map((p, i) => (
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
      )}
    </>
  );
}

function RsvpControl({
  myStatus,
  saving,
  saveError,
  onChoose,
}: {
  myStatus: TeamsnapRsvp;
  saving: boolean;
  saveError: string | null;
  onChoose: (value: Exclude<TeamsnapRsvp, "no_reply">) => void;
}) {
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Attendance
        </span>
        {myStatus === "no_reply" ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            Needs RSVP
          </span>
        ) : (
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            TeamSnap
          </span>
        )}
      </div>
      <div className="inline-flex w-full rounded-lg border p-0.5">
        {RSVP_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={saving}
            onClick={() => onChoose(o.value)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60",
              myStatus === o.value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
    </div>
  );
}
