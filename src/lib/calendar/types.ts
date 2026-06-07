// Shared types for the Calendar app. These mirror the columns of the
// calendar_events / calendar_sources tables (migration 00098), scoped to a
// family member (member_email) rather than KidCalendar's separate kid/parent
// tables.

export type CalendarSourceType = "teamsnap" | "ics" | "manual" | "google";
export type CalendarRecurrence = "none" | "weekly" | "biweekly";
export type TeamsnapRsvp = "going" | "maybe" | "not_going" | "no_reply";

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
  recurrence: CalendarRecurrence;
  recurrence_parent_id: string | null;
  is_canceled: boolean;
  // Set when the user deleted the materialized event off their Google calendar:
  // treated as a decline (hidden, not recreated). Survives re-sync.
  dismissed: boolean;
}

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
  // The one Google calendar everything imports into. Null until set up.
  primary_calendar_id: string | null;
  primary_calendar_connection: string | null;
  primary_calendar_mode: PrimaryCalendarMode | null;
  primary_calendar_summary: string | null; // human-readable calendar title
}
