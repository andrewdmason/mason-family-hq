-- Tuttles' parent view: what each kid is learning this week, per class, for
-- the parents (src/lib/tuttles/week.ts), and the parents' own "brief me"
-- chats about it.

-- One brief per kid per day, worked out from their Canvas (the current unit,
-- this week's assignments, announcements) and what Tuttles knows of them:
-- {classes: [{courseId, name, topics: [{id, title, summary, doing, talk[],
--   assignmentIds[]}]}], comingUp: [...]}
CREATE TABLE IF NOT EXISTS tutor_week_briefs (
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generated_on date NOT NULL,
  brief jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, generated_on)
);
ALTER TABLE tutor_week_briefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Week briefs: parents" ON tutor_week_briefs;
CREATE POLICY "Week briefs: parents" ON tutor_week_briefs FOR SELECT USING (
  EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);

-- A parent's briefing chat is theirs (student_id is the parent), taught to an
-- adult without the tutoring rules, about one of a kid's topics. It never
-- shows as the kid's or feeds the kid's memory (which reads the kid's own
-- threads only).
ALTER TABLE tutor_threads ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'student'
  CHECK (kind IN ('student', 'briefing'));
-- For a briefing: {kidId, courseId, title, summary}.
ALTER TABLE tutor_threads ADD COLUMN IF NOT EXISTS topic jsonb;

-- Each kid's brief, every morning at 5:10am Pacific (13:10/12:10 UTC), through
-- the website, with the same Vault secrets as the other sweeps. Skipped where
-- pg_cron, pg_net or the secrets aren't there.
DO $outer$
DECLARE
  app_url text;
  cron_secret text;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  SELECT decrypted_secret INTO app_url
    FROM vault.decrypted_secrets WHERE name = 'reading_notify_app_url';
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'reading_notify_cron_secret';

  IF app_url IS NULL OR cron_secret IS NULL THEN
    RAISE NOTICE 'reading_notify Vault secrets not set; skipping tutor-week cron schedule';
  ELSE
    PERFORM cron.unschedule('tutor-week')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tutor-week');
    PERFORM cron.schedule(
      'tutor-week',
      '10 13 * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'reading_notify_app_url') || '/api/cron/tutor-week',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'reading_notify_cron_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 290000
      );
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net/Vault not available (expected in local dev): %', SQLERRM;
END $outer$;
