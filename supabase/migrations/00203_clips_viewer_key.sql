-- Watch-only access to Baseball Clips for the Clips Camera app, so a coach on
-- TestFlight can see the videos without a Family HQ account. The app carries
-- this key and sends it to /clips/api/viewer, which reads clips with the
-- service role and hands back short-lived video links — nothing else.
--
-- The key is generated here, in the database, so it never appears in the
-- (public) repo; scripts/release.sh reads it with the service role and builds
-- it into the app. Only the service role can read it: RLS is on with no
-- policies, and the API roles have no grants.
--
-- To cut off every copy of the app that has it, give it a new key and ship a
-- new build:  UPDATE clips_viewer_keys SET key = DEFAULT, created_at = now();
CREATE TABLE IF NOT EXISTS clips_viewer_keys (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  key text NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clips_viewer_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clips_viewer_keys FROM PUBLIC, anon, authenticated;

INSERT INTO clips_viewer_keys (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
