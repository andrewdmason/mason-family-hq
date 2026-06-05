-- The Calendar app: a native, robust replacement for the handful of iCal feed
-- URLs the Journal used to read (journal_calendar_sources, 00040). Ported from the
-- standalone KidCalendar product and collapsed onto Family Mason HQ's single
-- family.
--
-- Design choices worth calling out:
--
--   * Sources and events are scoped to a family MEMBER, not to a separate kid/
--     parent table. calendar_sources.member_email -> family_members.email: a
--     source attached to a kid is their sports/school calendar; attached to an
--     adult, it's their personal calendar; NULL = a family-level calendar. This
--     is what lets adult personal calendars (Andrew + Jenny) become first-class
--     sources later with no schema change, and collapses KidCalendar's
--     personal_ics-vs-ics distinction into "which member is this attached to".
--
--   * member_email is a real FK to family_members.email (text PK), ON DELETE
--     CASCADE: removing a member takes their calendars and events with them.
--     family-level rows (member_email NULL) are unaffected.
--
--   * Unified events table. TeamSnap and ICS rows are written by the sync code
--     under the service role (which bypasses RLS); manual events are written by
--     parents through the app under the parent/owner write policy below. Dedup is
--     external_id ('ts:{id}' for TeamSnap, the ICS UID otherwise).
--
--   * The attendance/involvement, drive-time/geocoding, carpool, multi-family,
--     and kid-login machinery from KidCalendar is intentionally NOT ported.
--     TeamSnap's own synced RSVP is kept as a passive read-only field.
--
--   * RLS mirrors the rest of the schema: family-shared READ for any provisioned
--     member; manage (INSERT/UPDATE/DELETE) limited to owner/parent roles
--     (00090). Kids see the calendar read-only.

-- ---------------------------------------------------------------------------
-- Enums (text + CHECK is used elsewhere for status columns; these are small,
-- closed sets shared by two tables, so real Postgres enums earn their keep.)
-- ---------------------------------------------------------------------------
CREATE TYPE calendar_source_type AS ENUM ('teamsnap', 'ics', 'manual');
CREATE TYPE calendar_recurrence AS ENUM ('none', 'weekly', 'biweekly');
CREATE TYPE teamsnap_rsvp_status AS ENUM ('going', 'maybe', 'not_going', 'no_reply');

-- ---------------------------------------------------------------------------
-- Sources: TeamSnap teams, ICS subscriptions, and manual markers.
-- ---------------------------------------------------------------------------
CREATE TABLE calendar_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Whose calendar this is. NULL = a family-level source.
  member_email text REFERENCES family_members(email) ON DELETE CASCADE,
  source_type  calendar_source_type NOT NULL,

  -- TeamSnap
  teamsnap_team_id          bigint,
  teamsnap_team_name        text,
  teamsnap_player_member_id bigint,

  -- ICS subscription
  ics_url      text,

  -- Display
  nickname     text,
  color        text,
  is_active    boolean NOT NULL DEFAULT true,

  -- Sync bookkeeping
  last_synced_at timestamptz,
  sync_error     text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_sources_member ON calendar_sources (member_email);

-- ---------------------------------------------------------------------------
-- Events: unified table for every source.
-- ---------------------------------------------------------------------------
CREATE TABLE calendar_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email       text REFERENCES family_members(email) ON DELETE CASCADE,
  calendar_source_id uuid REFERENCES calendar_sources(id) ON DELETE SET NULL,

  title       text NOT NULL,
  description text,
  location    text,
  start_time  timestamptz NOT NULL,
  end_time    timestamptz,
  all_day     boolean NOT NULL DEFAULT false,

  source_type calendar_source_type NOT NULL DEFAULT 'manual',
  external_id text,  -- 'ts:{teamsnap_event_id}' or ICS UID, for dedup

  -- TeamSnap passive (synced from the team; read-only here)
  teamsnap_opponent     text,
  teamsnap_arrival_time timestamptz,
  teamsnap_is_game      boolean,
  teamsnap_rsvp         teamsnap_rsvp_status,

  recurrence           calendar_recurrence NOT NULL DEFAULT 'none',
  recurrence_parent_id uuid REFERENCES calendar_events(id) ON DELETE CASCADE,

  is_canceled boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_events_member_start ON calendar_events (member_email, start_time);
CREATE INDEX idx_calendar_events_start ON calendar_events (start_time);
CREATE INDEX idx_calendar_events_external_id ON calendar_events (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_calendar_events_source ON calendar_events (calendar_source_id);

-- ---------------------------------------------------------------------------
-- TeamSnap OAuth tokens, one per connecting member (only adults connect).
-- ---------------------------------------------------------------------------
CREATE TABLE teamsnap_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email     text NOT NULL UNIQUE REFERENCES family_members(email) ON DELETE CASCADE,
  access_token     text NOT NULL,
  refresh_token    text,
  token_expires_at timestamptz,
  teamsnap_user_id bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Outbound ICS feed tokens: one per kid (all of that kid's events). The public
-- feed route resolves the token under the service role; parents read these rows
-- to show the subscribe URL.
-- ---------------------------------------------------------------------------
CREATE TABLE ical_feed_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email text NOT NULL REFERENCES family_members(email) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_ical_feed_member UNIQUE (member_email)
);

CREATE INDEX idx_ical_feed_token ON ical_feed_tokens (token);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse the shared function used everywhere else).
-- ---------------------------------------------------------------------------
CREATE TRIGGER calendar_sources_updated_at
  BEFORE UPDATE ON calendar_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER teamsnap_connections_updated_at
  BEFORE UPDATE ON teamsnap_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS. Read for any provisioned member; manage for owner/parent. Sync writes go
-- through the service role and bypass these. TeamSnap tokens are visible only to
-- the member who owns them.
-- ---------------------------------------------------------------------------

ALTER TABLE calendar_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON calendar_sources FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Manage for parents" ON calendar_sources FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON calendar_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Manage for parents" ON calendar_events FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

ALTER TABLE teamsnap_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own connection" ON teamsnap_connections FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.email = teamsnap_connections.member_email))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.email = teamsnap_connections.member_email));

ALTER TABLE ical_feed_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage for parents" ON ical_feed_tokens FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

-- ---------------------------------------------------------------------------
-- Retire the old journal feed list. The Journal's recent-calendar question now
-- reads native calendar_events instead (see src/lib/journal/calendar/).
-- ---------------------------------------------------------------------------
DROP TABLE journal_calendar_sources;

-- ---------------------------------------------------------------------------
-- Seed: carry Andrew's Personal Google Calendar across as a personal ICS source
-- so the Journal's calendar context keeps it. The two former "Kids" feeds
-- (which pointed back at KidCalendar) become native once TeamSnap/school-ICS
-- sources are re-added through the app. Idempotent via fixed id + ON CONFLICT.
-- ---------------------------------------------------------------------------
INSERT INTO calendar_sources (id, member_email, source_type, ics_url, nickname, color) VALUES
  ('c0000098-0000-4001-8001-000000000001',
   'andrew@mason.io',
   'ics',
   'https://calendar.google.com/calendar/ical/andrew%40mason.io/private-5b46badb9ec8a99c13b1a553fef3bca7/basic.ics',
   'Personal',
   '#4285F4')
ON CONFLICT (id) DO NOTHING;
