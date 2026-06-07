-- "Dismissed" events: deleting a materialized TeamSnap/ICS event off its owner's
-- Google calendar is treated as declining it — we hide it (like a TeamSnap
-- "Not going" RSVP) and stop recreating it on Google. The sync detects the
-- deletion (the materialized event is gone/cancelled on the calendar) and sets
-- this flag; the source upserts never touch it, so the dismissal survives re-sync.
ALTER TABLE calendar_events
  ADD COLUMN dismissed boolean NOT NULL DEFAULT false;
