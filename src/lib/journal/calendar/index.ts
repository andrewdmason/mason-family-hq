import { createClient } from "@/lib/supabase/server";
import { formatCalendarBlock } from "./format";
import type { CalendarWindow, FeedResult, NormalizedEvent } from "./types";

const DAY_MS = 86400000;

// Recurring posts scale the calendar window to their cadence; clamp so a wild
// custom cadence can't ask for a year of events.
const MAX_LOOKBACK_DAYS = 92;
const MAX_LOOKAHEAD_DAYS = 31;

/**
 * Build the calendar context block for the interviewer's system prompt from the
 * native Calendar app (calendar_events), replacing the old external-iCal-feed
 * path. Reads under the journaling member's session — calendar_events is
 * family-shared, so the block carries the family's events (kids' sports +
 * personal calendars). Returns null when there's nothing to inject.
 *
 * `window` defaults to "recent": the block carries only past + already-happened
 * events. Pass "ahead" for a forward-looking question (intentions). `spanDays`
 * scales the window to a recurring post's cadence.
 */
export async function loadCalendarBlock(
  today: string,
  tz: string,
  window: CalendarWindow = "recent",
  spanDays?: number,
): Promise<string | null> {
  const span = Math.max(1, Math.round(spanDays ?? (window === "ahead" ? 7 : 3)));
  const lookbackDays = window === "recent" ? Math.min(span, MAX_LOOKBACK_DAYS) : 3;
  const lookaheadDays =
    window === "ahead" ? Math.min(span, MAX_LOOKAHEAD_DAYS) : 0;

  // Fetch a fixed superset range; formatCalendarBlock trims to the asked window.
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const rangeStart = new Date(todayMs - (MAX_LOOKBACK_DAYS + 1) * DAY_MS);
  const rangeEnd = new Date(todayMs + (MAX_LOOKAHEAD_DAYS + 2) * DAY_MS);

  let events: NormalizedEvent[];
  try {
    events = await loadNativeEvents(rangeStart, rangeEnd);
  } catch (err) {
    console.error("[journal/calendar] failed to load events:", err);
    return null;
  }
  if (events.length === 0) return null;

  const results: FeedResult[] = [
    { ok: true, sourceId: "native", sourceName: "Calendar", events },
  ];

  const block = formatCalendarBlock(
    results,
    today,
    tz,
    new Date(),
    window,
    lookbackDays,
    lookaheadDays,
  );
  return block === "" ? null : block;
}

// Map calendar_events rows (joined to their source) into the NormalizedEvent
// shape formatCalendarBlock consumes. The "source name" shown in the block is
// the source nickname/team, falling back to the member's name.
async function loadNativeEvents(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<NormalizedEvent[]> {
  const supabase = await createClient();

  const [{ data: rows }, { data: members }] = await Promise.all([
    supabase
      .from("calendar_events")
      .select(
        "id, member_email, title, location, start_time, end_time, all_day, teamsnap_rsvp, calendar_sources(nickname, teamsnap_team_name)",
      )
      .eq("is_canceled", false)
      .gte("start_time", rangeStart.toISOString())
      .lte("start_time", rangeEnd.toISOString())
      .order("start_time", { ascending: true }),
    supabase.from("family_members").select("email, name"),
  ]);

  const nameByEmail = new Map(
    (members ?? []).map((m) => [m.email as string, m.name as string | null]),
  );

  return (rows ?? []).map((r): NormalizedEvent => {
    const source = r.calendar_sources as
      | { nickname: string | null; teamsnap_team_name: string | null }
      | { nickname: string | null; teamsnap_team_name: string | null }[]
      | null;
    const src = Array.isArray(source) ? source[0] : source;
    const sourceName =
      src?.nickname ??
      src?.teamsnap_team_name ??
      (r.member_email ? nameByEmail.get(r.member_email) ?? null : null) ??
      "Calendar";
    return {
      sourceId: (r.id as string) ?? "native",
      sourceName,
      title: r.title as string,
      start: new Date(r.start_time as string),
      end: r.end_time ? new Date(r.end_time as string) : null,
      allDay: r.all_day as boolean,
      location: (r.location as string | null) ?? null,
      tentative: r.teamsnap_rsvp === "maybe",
    };
  });
}
