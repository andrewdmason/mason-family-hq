// Server-side reads for the Calendar app. Uses the RLS-scoped server client:
// any provisioned family member can read sources and events.

import { createClient } from "@/lib/supabase/server";
import { memberColor } from "./calendar-utils";
import { FAMILY_TZ } from "./drive-time";
import type {
  CalendarEvent,
  CalendarMember,
  CalendarSource,
  EventDuties,
} from "./types";

const EVENT_COLUMNS =
  "id, member_email, calendar_source_id, title, description, location, start_time, end_time, all_day, source_type, external_id, google_event_id, organizer_email, teamsnap_opponent, teamsnap_arrival_time, teamsnap_is_game, teamsnap_rsvp, rrule, google_recurring_event_id, google_attendees, is_canceled, dismissed, drive_source_event_id, drive_duty, drive_minutes";

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

  // Each member's primary profile photo, as a short-lived signed URL — the
  // day-view pin markers render these (falling back to initials when absent).
  const avatars = new Map<string, string>();
  const { data: photos } = await supabase
    .from("journal_member_photos")
    .select("member_email, storage_path")
    .eq("is_primary", true);
  if (photos?.length) {
    const { data: signed } = await supabase.storage
      .from("member-photos")
      .createSignedUrls(
        photos.map((p) => p.storage_path as string),
        60 * 60,
      );
    photos.forEach((p, i) => {
      const url = signed?.[i]?.signedUrl;
      if (url) avatars.set((p.member_email as string).toLowerCase(), url);
    });
  }

  return (data ?? []).map((m) => ({
    email: m.email,
    name: m.name,
    role: m.role,
    // Official color when set, else a deterministic per-email hash color.
    color: m.color ?? memberColor(m.email),
    avatar_url: avatars.get(m.email.toLowerCase()) ?? null,
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
  const { data, error } = await supabase
    .from("calendar_events")
    .select(EVENT_COLUMNS)
    .eq("is_canceled", false)
    .not("member_email", "is", null) // every event belongs to a member
    .gte("start_time", rangeStart.toISOString())
    .lte("start_time", rangeEnd.toISOString())
    .order("start_time", { ascending: true });
  if (error) {
    // Don't let a schema/query failure read as "no events" — the classic local
    // cause is a sibling workspace's db reset dropping this branch's columns
    // (run `npm run db:heal`).
    console.error("[calendar] events query failed:", error.message);
  }
  return (data ?? []) as CalendarEvent[];
}

// NOTE: these per-event maps deliberately fetch ALL rows and filter in JS
// rather than passing the event ids to PostgREST — an `.in()` with the
// calendar window's ~1000 event ids overflows the URL line (HTTP 414) and
// supabase-js surfaces that as silently-empty data.

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
    .eq("going", true);

  const wanted = new Set(eventIds);
  const out: Record<string, string[]> = {};
  for (const r of data ?? []) {
    if (!wanted.has(r.event_id as string)) continue;
    (out[r.event_id as string] ??= []).push(r.member_email as string);
  }
  return out;
}

export interface LogisticsHints {
  // Recognizes events located AT home, which need no drop-off/pick-up.
  homeAddress: string | null;
  // Lets the client compute ghost drive blocks with the server's exact math.
  bufferMinutes: number;
  // Formats ghost-block titles' "@ time" exactly as the server writes them.
  timeZone: string;
}

/** The logistics facts the calendar client needs (read-only). */
export async function getLogisticsHints(): Promise<LogisticsHints> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_logistics_settings")
    .select("home_address, drive_buffer_minutes")
    .eq("id", 1)
    .maybeSingle();
  return {
    homeAddress: (data?.home_address as string | null) ?? null,
    bufferMinutes: (data?.drive_buffer_minutes as number | null) ?? 5,
    timeZone: FAMILY_TZ,
  };
}

/** Drop-off / pick-up assignments per event, for the given event ids. A missing
 * duty key means unset (no row). */
export async function getEventDuties(
  eventIds: string[],
): Promise<Record<string, EventDuties>> {
  if (eventIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("event_duty_assignments")
    .select("event_id, duty, assignee_email, is_na, caregiver");

  const wanted = new Set(eventIds);
  const out: Record<string, EventDuties> = {};
  for (const r of data ?? []) {
    if (!wanted.has(r.event_id as string)) continue;
    (out[r.event_id as string] ??= {})[r.duty as "dropoff" | "pickup"] = {
      assignee: r.assignee_email as string | null,
      isNa: r.is_na as boolean,
      caregiver: r.caregiver as string | null,
    };
  }
  return out;
}
