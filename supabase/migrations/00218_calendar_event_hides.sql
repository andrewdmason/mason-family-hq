-- Events a member has hidden from their own view of the calendar (the iPhone
-- app's long-press › Hide). Personal: nobody else's calendar changes, and the
-- event itself is untouched. Not the same as calendar_events.dismissed, which
-- takes an event off the calendar for the whole family.
--
-- A hide is of one event, or of a whole Google repeating series:
--   scope 'event'  → target is the event's Google id when it has one (so every
--                    member's copy of a shared event counts as the one event),
--                    else the calendar_events row id.
--   scope 'series' → target is google_recurring_event_id.
-- There is no foreign key to calendar_events: the target outlives a re-sync,
-- and a hide whose event has gone is harmless.
--
-- title, owner_email, start_time and rrule are what the event looked like when
-- it was hidden, for the app's list of hidden events (a hidden series can be
-- well outside the window the phone holds).

CREATE TABLE calendar_event_hides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  scope       text NOT NULL CHECK (scope IN ('event', 'series')),
  target      text NOT NULL,
  title       text NOT NULL,
  owner_email text,
  start_time  timestamptz,
  rrule       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, target)
);

ALTER TABLE calendar_event_hides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own hides" ON calendar_event_hides FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
