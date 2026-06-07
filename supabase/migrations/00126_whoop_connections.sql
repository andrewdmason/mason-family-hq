-- WHOOP integration — part 1 of 3: the connection (auth tokens + device identity).
--
-- One-way push only: when a workout session is marked complete, its resistance
-- work is sent into WHOOP's Strength Trainer so WHOOP's muscular load / recovery
-- accounts for it. WHOOP's *public* API is read-only, so the push goes through
-- WHOOP's unofficial private iOS API (same surface as github.com/briangaoo/totem).
-- This is a deliberate, owner-only, single-account integration; the ToS risk is
-- accepted and lands on the owner's own WHOOP account.
--
-- Auth is NOT OAuth-redirect like Google/TeamSnap: the owner logs in once with
-- their WHOOP email + password (+ MFA if challenged) through WHOOP's Cognito
-- proxy, and we keep only the refresh token (+ a short-lived access token), then
-- mint fresh access tokens on demand (src/lib/whoop/auth.ts). Tokens are stored
-- plaintext behind RLS, matching google_connections / teamsnap_connections — the
-- boundary is RLS + service-role access, not column encryption.
--
-- The device-identity columns persist the per-install values the private API
-- expects on every request (so our traffic looks like one stable iOS install
-- across token refreshes and restarts).

CREATE TABLE whoop_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email            text NOT NULL UNIQUE REFERENCES family_members(email) ON DELETE CASCADE,
  access_token            text NOT NULL,
  refresh_token           text NOT NULL,
  token_expires_at        timestamptz,
  -- Device identity sent on every private-API request. installation_identifier is
  -- a stable per-install uppercase UUID; the iOS version/build are bumped in code
  -- when re-captured but stored here so a connection keeps a consistent identity.
  installation_identifier uuid NOT NULL DEFAULT gen_random_uuid(),
  ios_app_version         text,
  ios_build_number        text,
  time_zone               text,              -- IANA name for x-whoop-time-zone
  whoop_user_id           text,              -- from the id token, informational
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER whoop_connections_updated_at
  BEFORE UPDATE ON whoop_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE whoop_connections ENABLE ROW LEVEL SECURITY;
-- A member can only see/manage their own connection. The push path and token
-- refresh write through the service role, which bypasses RLS.
CREATE POLICY "Own connection" ON whoop_connections FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.email = whoop_connections.member_email))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.email = whoop_connections.member_email));
