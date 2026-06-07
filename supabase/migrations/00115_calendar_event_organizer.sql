-- Capture the Google event's organizer so the logical-event grouping can pick the
-- right "owner" column for a shared event we didn't materialize (instead of a
-- deterministic guess). Set on Google read sync; null for other sources.
ALTER TABLE calendar_events
  ADD COLUMN organizer_email text;
