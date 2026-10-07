-- "Not going" for the event's owner (a kid skipping practice). Unlike a family
-- member's "going along" toggle (event_attendees), this takes the whole event
-- off the calendars: the owner's Google copy is cancelled (which drops every
-- guest's copy with it) and drop-off/pick-up blocks are torn down. Duty
-- assignments and attendee rows are kept, so flipping back to going restores
-- everything. The source upserts never touch this column, so the decision
-- survives re-sync — including a time/location change on the feed.
ALTER TABLE calendar_events
  ADD COLUMN owner_not_going boolean NOT NULL DEFAULT false;
