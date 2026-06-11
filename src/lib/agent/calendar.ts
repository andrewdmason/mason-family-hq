// Data loading + serialization for the agent-facing calendar API
// (src/app/api/agent/calendar/*). The family assistant reads the calendar as
// JSON, so events are serialized with everything it needs to reason about a
// day in one shot: who the event belongs to, who's going, drop-off/pick-up
// state, TeamSnap RSVP, and what it conflicts with.

import { createAdminClient } from "@/lib/supabase/admin";
import { detectConflictMap } from "@/lib/calendar/conflicts";
import { isHomeLocation } from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, EventDuties } from "@/lib/calendar/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Query-param date: "YYYY-MM-DD" or full ISO. Bare dates anchor to the start
 * (or, for range ends, the end) of that wall-clock day in UTC. */
export function parseDateParam(
  value: string | null,
  endOfDay: boolean,
): Date | null | "invalid" {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`
    : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

// Mirrors EVENT_COLUMNS in @/lib/calendar/queries (which is session-scoped;
// this side reads through the service-role client).
const EVENT_COLUMNS =
  "id, member_email, calendar_source_id, title, description, location, start_time, end_time, all_day, source_type, external_id, google_event_id, organizer_email, teamsnap_opponent, teamsnap_arrival_time, teamsnap_is_game, teamsnap_rsvp, rrule, google_recurring_event_id, google_attendees, is_canceled, dismissed, drive_source_event_id, drive_duty, drive_minutes";

export interface AgentMember {
  email: string;
  name: string | null;
  role: "owner" | "parent" | "kid";
}

export interface AgentCalendarData {
  events: CalendarEvent[];
  members: Map<string, AgentMember>;
  sourceNames: Map<string, string>;
  attendees: Map<string, string[]>; // event id -> emails marked going
  duties: Map<string, EventDuties>; // event id -> dropoff/pickup state
  homeAddress: string | null;
  conflictMap: Map<string, Set<string>>;
}

/** Everything the agent endpoints need for a window of events, in five reads.
 * Attendee/duty rows are fetched whole and filtered in JS — a PostgREST .in()
 * with a window's worth of event ids overflows the URL (see queries.ts). */
export async function loadAgentCalendar(range: {
  from: Date;
  to: Date;
}): Promise<AgentCalendarData> {
  const admin = createAdminClient();

  const [evRes, memRes, srcRes, attRes, dutyRes, logRes] = await Promise.all([
    admin
      .from("calendar_events")
      .select(EVENT_COLUMNS)
      .eq("is_canceled", false)
      .eq("dismissed", false)
      .not("member_email", "is", null)
      .gte("start_time", range.from.toISOString())
      .lte("start_time", range.to.toISOString())
      .order("start_time", { ascending: true }),
    admin.from("family_members").select("email, name, role"),
    admin.from("calendar_sources").select("id, nickname, teamsnap_team_name"),
    admin
      .from("event_attendees")
      .select("event_id, member_email")
      .eq("going", true),
    admin
      .from("event_duty_assignments")
      .select("event_id, duty, assignee_email, is_na"),
    admin
      .from("calendar_logistics_settings")
      .select("home_address")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const events = (evRes.data ?? []) as CalendarEvent[];
  const eventIds = new Set(events.map((e) => e.id));

  const members = new Map<string, AgentMember>(
    (memRes.data ?? []).map((m) => [
      m.email as string,
      {
        email: m.email as string,
        name: (m.name as string | null) ?? null,
        role: m.role as AgentMember["role"],
      },
    ]),
  );

  const sourceNames = new Map<string, string>(
    (srcRes.data ?? []).flatMap((s) => {
      const name = (s.nickname ?? s.teamsnap_team_name) as string | null;
      return name ? [[s.id as string, name] as [string, string]] : [];
    }),
  );

  const attendees = new Map<string, string[]>();
  for (const r of attRes.data ?? []) {
    if (!eventIds.has(r.event_id as string)) continue;
    const list = attendees.get(r.event_id as string) ?? [];
    list.push(r.member_email as string);
    attendees.set(r.event_id as string, list);
  }

  const duties = new Map<string, EventDuties>();
  for (const r of dutyRes.data ?? []) {
    if (!eventIds.has(r.event_id as string)) continue;
    const d = duties.get(r.event_id as string) ?? {};
    d[r.duty as "dropoff" | "pickup"] = {
      assignee: r.assignee_email as string | null,
      isNa: r.is_na as boolean,
    };
    duties.set(r.event_id as string, d);
  }

  return {
    events,
    members,
    sourceNames,
    attendees,
    duties,
    homeAddress: (logRes.data?.home_address as string | null) ?? null,
    conflictMap: detectConflictMap(events),
  };
}

/** The JSON shape an event takes in agent responses. */
export function serializeEvent(ev: CalendarEvent, data: AgentCalendarData) {
  const member = ev.member_email ? data.members.get(ev.member_email) : null;
  const isKidEvent = member?.role === "kid";
  const duties = data.duties.get(ev.id) ?? {};

  return {
    id: ev.id,
    title: ev.title,
    member: member
      ? { email: member.email, name: member.name, role: member.role }
      : null,
    start_time: ev.start_time,
    end_time: ev.end_time,
    all_day: ev.all_day,
    location: ev.location,
    description: ev.description,
    source_type: ev.source_type,
    calendar: ev.calendar_source_id
      ? (data.sourceNames.get(ev.calendar_source_id) ?? null)
      : null,
    // Drive blocks are the materialized drop-off/pick-up trips on a parent's
    // calendar — they point back at the kid's event they serve.
    drive_block: ev.drive_source_event_id
      ? { for_event_id: ev.drive_source_event_id, duty: ev.drive_duty }
      : null,
    teamsnap:
      ev.source_type === "teamsnap"
        ? {
            is_game: ev.teamsnap_is_game,
            opponent: ev.teamsnap_opponent,
            arrival_time: ev.teamsnap_arrival_time,
            rsvp: ev.teamsnap_rsvp,
          }
        : null,
    // Family members marked "going" (parents attending a kid's event).
    going: data.attendees.get(ev.id) ?? [],
    // Drop-off/pick-up assignments — only meaningful on kids' timed events
    // away from home. A missing key means unset.
    duties: isKidEvent
      ? {
          dropoff: duties.dropoff
            ? { assignee: duties.dropoff.assignee, is_na: duties.dropoff.isNa }
            : null,
          pickup: duties.pickup
            ? { assignee: duties.pickup.assignee, is_na: duties.pickup.isNa }
            : null,
        }
      : null,
    drive_minutes: ev.drive_minutes,
    conflicts_with: [...(data.conflictMap.get(ev.id) ?? [])],
  };
}

export type AgentEvent = ReturnType<typeof serializeEvent>;

/** Whether this event takes drop-off/pick-up at all — mirrors setDuty's
 * validations (kid's event, timed, away from home, not itself a drive block). */
function dutyEligible(ev: CalendarEvent, data: AgentCalendarData): boolean {
  const member = ev.member_email ? data.members.get(ev.member_email) : null;
  return (
    member?.role === "kid" &&
    !ev.all_day &&
    !ev.drive_source_event_id &&
    !isHomeLocation(ev.location, data.homeAddress ?? undefined)
  );
}

/** The "what needs attention" digest: conflicts, unset drop-off/pick-up,
 * unanswered TeamSnap RSVPs, and kid events with no parent marked going.
 * Only future events make the lists — the past can't be resolved. */
export function computeReview(data: AgentCalendarData, now: Date) {
  const future = data.events.filter(
    (ev) => new Date(ev.end_time ?? ev.start_time).getTime() >= now.getTime(),
  );

  // Conflicts as pairs, each reported once.
  const conflicts: Array<{
    member_email: string | null;
    events: AgentEvent[];
  }> = [];
  const seenPairs = new Set<string>();
  const byId = new Map(data.events.map((e) => [e.id, e]));
  for (const ev of future) {
    for (const otherId of data.conflictMap.get(ev.id) ?? []) {
      const key = [ev.id, otherId].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const other = byId.get(otherId);
      if (!other) continue;
      conflicts.push({
        member_email: ev.member_email,
        events: [serializeEvent(ev, data), serializeEvent(other, data)],
      });
    }
  }

  // Unset drop-off/pick-up on eligible kid events. A kid who isn't going
  // (TeamSnap not_going) needs no drive.
  const missingDuties: Array<{ event: AgentEvent; missing: string[] }> = [];
  for (const ev of future) {
    if (!dutyEligible(ev, data)) continue;
    if (ev.teamsnap_rsvp === "not_going") continue;
    const duties = data.duties.get(ev.id) ?? {};
    const missing = (["dropoff", "pickup"] as const).filter((d) => !duties[d]);
    if (missing.length > 0) {
      missingDuties.push({ event: serializeEvent(ev, data), missing });
    }
  }

  // TeamSnap events whose player RSVP is still unanswered.
  const unansweredTeamsnap = future
    .filter(
      (ev) =>
        ev.source_type === "teamsnap" &&
        !ev.drive_source_event_id &&
        (ev.teamsnap_rsvp === null || ev.teamsnap_rsvp === "no_reply"),
    )
    .map((ev) => serializeEvent(ev, data));

  // Kid events (timed, away from home) where no parent is marked going.
  const noParentGoing = future
    .filter((ev) => {
      if (!dutyEligible(ev, data)) return false;
      if (ev.teamsnap_rsvp === "not_going") return false;
      const going = data.attendees.get(ev.id) ?? [];
      return !going.some((email) => {
        const role = data.members.get(email)?.role;
        return role === "owner" || role === "parent";
      });
    })
    .map((ev) => serializeEvent(ev, data));

  return {
    conflicts,
    missing_duties: missingDuties,
    unanswered_teamsnap: unansweredTeamsnap,
    no_parent_going: noParentGoing,
  };
}

/** Resolve where a new event should be written. "auto" prefers the member's
 * primary Google calendar (so the event lands on their real calendar), falling
 * back to any of their Google sources, then to an app-only manual event.
 * "app" forces app-only; anything else is taken as a calendar source id. */
export async function resolveCreateTarget(
  admin: AdminClient,
  memberEmail: string,
  calendar: string | undefined,
): Promise<{ calendarSourceId: string | null } | { error: string }> {
  const mode = calendar ?? "auto";
  if (mode === "app") return { calendarSourceId: null };

  if (mode !== "auto") {
    const { data: src } = await admin
      .from("calendar_sources")
      .select("id, source_type")
      .eq("id", mode)
      .maybeSingle();
    if (!src) return { error: `No calendar source with id ${mode}.` };
    if (src.source_type !== "google") {
      return {
        error:
          "Events can only be created on Google sources or as app-only events (calendar: \"app\").",
      };
    }
    return { calendarSourceId: src.id as string };
  }

  const { data: member } = await admin
    .from("family_members")
    .select("primary_calendar_id")
    .eq("email", memberEmail)
    .maybeSingle();

  const { data: sources } = await admin
    .from("calendar_sources")
    .select("id, google_calendar_id")
    .eq("source_type", "google")
    .eq("member_email", memberEmail);

  const primary = (sources ?? []).find(
    (s) =>
      member?.primary_calendar_id &&
      s.google_calendar_id === member.primary_calendar_id,
  );
  const target = primary ?? (sources ?? [])[0];
  return { calendarSourceId: (target?.id as string | undefined) ?? null };
}
