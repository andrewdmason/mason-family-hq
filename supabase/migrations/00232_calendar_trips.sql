-- Trips: a named stretch of days with its travelers, the bookings that get
-- them there, house them and bring them home, and their own to-dos. Plan:
-- docs/plans/2026-11-28-001-feat-calendar-trips-plan.md.
--
-- The apps write these straight to Supabase under the member's sign-in (as
-- calendar_event_hides): nothing here touches Google, TeamSnap or drive
-- blocks. Every family member can read and change every trip, as with events.

CREATE TABLE calendar_trips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  -- Whole days, the last one included. The nights are start_date … end_date - 1.
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  -- Who's going, by family_members.email (lowercased).
  traveler_emails  text[] NOT NULL DEFAULT '{}',
  notes            text,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX calendar_trips_dates ON calendar_trips (end_date, start_date);

-- What's booked, or planned: a way of getting somewhere (flight, train, bus,
-- ferry, drive, other), a rental car, or a stay. A piece is usually an event
-- on the calendar with details the event doesn't carry (the confirmation
-- code, the seat, the door code). It can also stand alone: "We're driving",
-- "Staying with Grandma".
--
-- event_id has no foreign key: a re-sync can replace an event's row, and
-- event_google_id finds it again (as calendar_event_hides.target does).
CREATE TABLE calendar_trip_pieces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid NOT NULL REFERENCES calendar_trips (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('flight', 'train', 'bus', 'ferry', 'drive', 'car', 'stay', 'other')),
  -- For a way of getting somewhere: which slot it fills. Null for a stay or car.
  leg              text CHECK (leg IN ('out', 'between', 'back')),
  -- False: planned but not locked in, which leaves its slot open.
  booked           boolean NOT NULL DEFAULT true,
  event_id         uuid,
  event_google_id  text,
  title            text NOT NULL DEFAULT '',
  -- Departure and arrival; check-in and check-out; pickup and drop-off.
  starts_at        timestamptz,
  ends_at          timestamptz,
  from_place       text,
  to_place         text,
  -- IANA zones ("America/Costa_Rica") for each end, so each time reads in
  -- its own place's clock. A stay's zone is to_zone.
  from_zone        text,
  to_zone          text,
  confirmation     text,
  -- Kind-specific details as strings: airline, flight_number, seat,
  -- terminal, address, phone, door_code, wifi, company, notes…
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Null: everyone on the trip.
  traveler_emails  text[],
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendar_trip_pieces_trip ON calendar_trip_pieces (trip_id);

-- The trip's own to-dos, beside the built-in slots: rental car, tournament
-- registration, dog sitter.
CREATE TABLE calendar_trip_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid NOT NULL REFERENCES calendar_trips (id) ON DELETE CASCADE,
  title       text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendar_trip_items_trip ON calendar_trip_items (trip_id);

-- Suggested trips a member said no to: their own rows, as hides are. key is
-- the suggestion's ("away:America/Costa_Rica:2026-11-22", "event:<id>").
CREATE TABLE calendar_trip_dismissals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  key         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

ALTER TABLE calendar_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_trip_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_trip_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_trip_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family" ON calendar_trips FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Family" ON calendar_trip_pieces FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Family" ON calendar_trip_items FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Own dismissals" ON calendar_trip_dismissals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
