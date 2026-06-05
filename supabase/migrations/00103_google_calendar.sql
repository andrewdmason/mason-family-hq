-- Google Calendar: full read/write sync via OAuth, replacing the read-only ICS
-- feed subscription the calendar used for personal Google calendars (00098).
--
-- Sign-in now happens through Google (Supabase's Google provider), and the same
-- consent grants calendar scope. The provider refresh token captured at login is
-- stored here, keyed by member_email, exactly like teamsnap_connections — Supabase
-- doesn't refresh provider tokens, so the app owns refresh (src/lib/calendar/google.ts).
--
-- A connected member can then pick which of their Google calendars to include
-- (one calendar_sources row per calendar, source_type='google'), and events sync
-- both ways: pulled into calendar_events on load, and created/edited/deleted in the
-- app are written straight back to Google.

-- ---------------------------------------------------------------------------
-- Google OAuth tokens, one per connecting member (mirrors teamsnap_connections).
-- ---------------------------------------------------------------------------
CREATE TABLE google_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email     text NOT NULL UNIQUE REFERENCES family_members(email) ON DELETE CASCADE,
  access_token     text NOT NULL,
  refresh_token    text,
  token_expires_at timestamptz,
  google_email     text,
  scopes           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER google_connections_updated_at
  BEFORE UPDATE ON google_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
-- A member can only see/manage their own connection. Sync and the callback write
-- through the service role, which bypasses RLS.
CREATE POLICY "Own connection" ON google_connections FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.email = google_connections.member_email))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.email = google_connections.member_email));

-- ---------------------------------------------------------------------------
-- 'google' source type + the columns a Google source needs.
--   * google_calendar_id     — the Google calendar's id (e.g. "primary" or an
--                              address); identifies which calendar to sync/write.
--   * google_connection_email — whose token reaches this calendar (analogous to
--                              teamsnap_connection_email). Usually the same member,
--                              but a shared/family calendar may be reached through
--                              a parent's account while scoped to member_email NULL.
-- ---------------------------------------------------------------------------
ALTER TYPE calendar_source_type ADD VALUE 'google';

ALTER TABLE calendar_sources
  ADD COLUMN google_calendar_id text,
  ADD COLUMN google_connection_email text
    REFERENCES family_members(email) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Retire the seeded ICS subscription of Andrew's personal Google calendar (00098).
-- It becomes a first-class Google source once he picks "Personal" from his Google
-- calendar list; removing it now prevents duplicate events. Its synced events go
-- first (calendar_source_id is ON DELETE SET NULL, so they'd otherwise linger).
-- ---------------------------------------------------------------------------
DELETE FROM calendar_events
  WHERE calendar_source_id = 'c0000098-0000-4001-8001-000000000001';
DELETE FROM calendar_sources
  WHERE id = 'c0000098-0000-4001-8001-000000000001';
