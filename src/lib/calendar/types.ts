// Shared types for the Calendar app. These mirror the columns of the
// calendar_events / calendar_sources tables (migration 00098), scoped to a
// family member (member_email) rather than KidCalendar's separate kid/parent
// tables.

export type CalendarSourceType = "teamsnap" | "ics" | "manual" | "google";
export type TeamsnapRsvp = "going" | "maybe" | "not_going" | "no_reply";

// One entry of a Google event's guest list, as captured at last sync. Family
// "going" state lives in event_attendees; this is display + dedup for guests
// outside the family.
export interface GoogleAttendee {
  email: string;
  responseStatus: string; // "accepted" | "declined" | "tentative" | "needsAction"
  displayName?: string;
}

export interface CalendarEvent {
  id: string;
  member_email: string | null;
  calendar_source_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  source_type: CalendarSourceType;
  external_id: string | null;
  // The real Google event id when this row was materialized by the importer.
  // Used to collapse an event and its guest copies into one logical event.
  google_event_id: string | null;
  // The Google event's organizer (read sync only) — picks the owner column for a
  // shared event.
  organizer_email: string | null;
  teamsnap_opponent: string | null;
  teamsnap_arrival_time: string | null;
  teamsnap_is_game: boolean | null;
  teamsnap_rsvp: TeamsnapRsvp | null;
  // RFC5545 RRULE body (no "RRULE:" prefix) when the event is part of a
  // recurring series — denormalized from the Google series master so the panel
  // can say "Repeats weekly" without a fetch.
  rrule: string | null;
  // The Google series-master event id (GoogleEvent.recurringEventId). Non-null
  // marks the row as an instance of a series and is the target for "all events"
  // edits/deletes.
  google_recurring_event_id: string | null;
  // The event's full Google guest list from the last sync (externals included).
  google_attendees: GoogleAttendee[] | null;
  is_canceled: boolean;
  // Set when the user deleted the materialized event off their Google calendar:
  // treated as a decline (hidden, not recreated). Survives re-sync.
  dismissed: boolean;
  // Set only on drive-block mirror rows (drive-events.ts): the kid's event this
  // block drives to/from. The UI colors the block with the kid's color and
  // opens the kid's event sheet on tap.
  drive_source_event_id: string | null;
  drive_duty: "dropoff" | "pickup" | null;
  // Cached one-way home→event drive (drive-time.ts); null until computed.
  // The client uses it to place ghost blocks exactly where the real one lands.
  drive_minutes: number | null;
}

// A drop-off/pick-up duty's saved state. Unset is the absence of the key.
// Exactly one of {assignee, isNa, caregiver} carries the state.
export interface EventDuty {
  assignee: string | null; // a parent's email, else null
  isNa: boolean; // explicitly "no drive needed"
  caregiver: string | null; // a nanny/babysitter name (see caregivers.ts)
}

export type EventDuties = { dropoff?: EventDuty; pickup?: EventDuty };

export interface CalendarSource {
  id: string;
  member_email: string | null;
  source_type: CalendarSourceType;
  teamsnap_team_id: number | null;
  teamsnap_team_name: string | null;
  teamsnap_player_member_id: number | null;
  ics_url: string | null;
  google_calendar_id: string | null;
  google_connection_email: string | null;
  nickname: string | null;
  color: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  sync_error: string | null;
}

export type PrimaryCalendarMode = "managed" | "connected";

// A trimmed family member as the calendar needs it: who calendars/events belong
// to, plus a display color and their primary calendar config (00112).
export interface CalendarMember {
  email: string;
  name: string | null;
  role: "owner" | "parent" | "kid";
  color: string | null;
  // Signed display URL for the member's primary profile photo (1h TTL), or null
  // when they have none. Drives the day-view pin markers.
  avatar_url: string | null;
  // The one Google calendar everything imports into. Null until set up.
  primary_calendar_id: string | null;
  primary_calendar_connection: string | null;
  primary_calendar_mode: PrimaryCalendarMode | null;
  primary_calendar_summary: string | null; // human-readable calendar title
}
