-- Recurrence (RRULE-based) + external guests for the redesigned event editor.
--
-- Google is the engine for recurrence: we write an RRULE to the series master
-- and sync mirrors the expanded instances (singleEvents=true), exactly as it
-- already does for recurring events created elsewhere. These columns capture
-- what that flow needs:
--   * rrule                     — the series rule, denormalized onto every
--                                 instance row for display ("Repeats weekly").
--                                 RFC5545 body without the "RRULE:" prefix.
--   * google_recurring_event_id — the Google series-master id
--                                 (GoogleEvent.recurringEventId). Non-null marks
--                                 the row as part of a series and is the target
--                                 for "all events" edits/deletes.
--   * google_attendees          — the event's full Google guest list from the
--                                 last sync: [{email, responseStatus,
--                                 displayName?}]. Family "going" state still
--                                 lives in event_attendees (durable across
--                                 re-sync); this is display + dedup for
--                                 external guests.

alter table calendar_events
  add column rrule text,
  add column google_recurring_event_id text,
  add column google_attendees jsonb;

create index idx_calendar_events_recurring
  on calendar_events (google_recurring_event_id)
  where google_recurring_event_id is not null;

-- Retire the never-wired v0 recurrence model (00098): the enum column and
-- parent pointer were never written by any code path.
alter table calendar_events drop column recurrence;
alter table calendar_events drop column recurrence_parent_id;
drop type calendar_recurrence;
