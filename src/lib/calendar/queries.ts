// Server-side reads for the Calendar app. Uses the RLS-scoped server client:
// any provisioned family member can read sources and events.

import { createClient } from "@/lib/supabase/server";
import { memberColor } from "./calendar-utils";
import type { CalendarEvent, CalendarMember, CalendarSource } from "./types";

const EVENT_COLUMNS =
  "id, member_email, calendar_source_id, title, description, location, start_time, end_time, all_day, source_type, external_id, google_event_id, organizer_email, teamsnap_opponent, teamsnap_arrival_time, teamsnap_is_game, teamsnap_rsvp, recurrence, recurrence_parent_id, is_canceled, dismissed";

const SOURCE_COLUMNS =
  "id, member_email, source_type, teamsnap_team_id, teamsnap_team_name, teamsnap_player_member_id, ics_url, google_calendar_id, google_connection_email, nickname, color, is_active, last_synced_at, sync_error";

export async function getCalendarMembers(): Promise<CalendarMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("family_members")
    .select(
      "email, name, role, color, primary_calendar_id, primary_calendar_connection, primary_calendar_mode, primary_calendar_summary",
    )
    .order("role", { ascending: true })
    .order("name", { ascending: true });

  return (data ?? []).map((m) => ({
    email: m.email,
    name: m.name,
    role: m.role,
    // Official color when set, else a deterministic per-email hash color.
    color: m.color ?? memberColor(m.email),
    primary_calendar_id: m.primary_calendar_id ?? null,
    primary_calendar_connection: m.primary_calendar_connection ?? null,
    primary_calendar_mode: m.primary_calendar_mode ?? null,
    primary_calendar_summary: m.primary_calendar_summary ?? null,
  }));
}

export async function getCalendarSources(): Promise<CalendarSource[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_sources")
    .select(SOURCE_COLUMNS)
    .order("created_at", { ascending: true });
  return (data ?? []) as CalendarSource[];
}

// A generous default window so agenda/week/month navigation is instant (no
// server round-trip): ~2 months back, ~6 months forward. Computed here (not in a
// component's render) so `Date.now()` stays out of the render path.
const DAY_MS = 86_400_000;

export function defaultEventWindow(): { rangeStart: Date; rangeEnd: Date } {
  const now = Date.now();
  return {
    rangeStart: new Date(now - 60 * DAY_MS),
    rangeEnd: new Date(now + 180 * DAY_MS),
  };
}

export async function getCalendarEvents(
  range?: { rangeStart: Date; rangeEnd: Date },
): Promise<CalendarEvent[]> {
  const { rangeStart, rangeEnd } = range ?? defaultEventWindow();
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_events")
    .select(EVENT_COLUMNS)
    .eq("is_canceled", false)
    .not("member_email", "is", null) // every event belongs to a member
    .gte("start_time", rangeStart.toISOString())
    .lte("start_time", rangeEnd.toISOString())
    .order("start_time", { ascending: true });
  return (data ?? []) as CalendarEvent[];
}

/** Who's marked "going" per event, for the given event ids. Returns a map of
 * event id -> member emails (only going=true rows). */
export async function getEventAttendees(
  eventIds: string[],
): Promise<Record<string, string[]>> {
  if (eventIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("event_attendees")
    .select("event_id, member_email")
    .eq("going", true)
    .in("event_id", eventIds);

  const out: Record<string, string[]> = {};
  for (const r of data ?? []) {
    (out[r.event_id as string] ??= []).push(r.member_email as string);
  }
  return out;
}
