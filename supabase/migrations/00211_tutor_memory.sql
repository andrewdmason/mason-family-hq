-- Tuttles' memory of each student: a small profile of how they learn and
-- where they're strong or shaky, rewritten whole each night they've chatted
-- (src/lib/tuttles/memory.ts), never appended to. Every version is kept, so a
-- parent can see what changed and undo a night. Parents' own notes sit beside
-- it and the nightly rewrite never touches them.

CREATE TABLE IF NOT EXISTS tutor_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  -- {learning: [Item], classes: [{name, strengths: [Item], shaky: [Item]}]}
  -- Item: {text, evidence: [string], lastSeen: 'YYYY-MM-DD'}
  profile jsonb NOT NULL,
  -- One or two sentences on what this version changed, for the parents.
  changes text,
  source text NOT NULL CHECK (source IN ('nightly', 'restore')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, version)
);

CREATE TABLE IF NOT EXISTS tutor_parent_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tutor_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_parent_notes ENABLE ROW LEVEL SECURITY;

-- The student can read their own profile (the app shows it, kindly worded);
-- parents read everything. Parents' notes are for parents and the tutor only.
-- All writes go through the server.
DROP POLICY IF EXISTS "Tutor memory: own or parent" ON tutor_memories;
CREATE POLICY "Tutor memory: own or parent" ON tutor_memories FOR SELECT USING (
  student_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
DROP POLICY IF EXISTS "Tutor notes: parents" ON tutor_parent_notes;
CREATE POLICY "Tutor notes: parents" ON tutor_parent_notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);

-- Nightly at 3:40am Pacific (10:40/11:40 UTC; the hour shifts with daylight
-- time, which doesn't matter here), through the website, with the same Vault
-- secrets as the other sweeps. Skipped where pg_cron, pg_net or the secrets
-- aren't there.
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
    RAISE NOTICE 'reading_notify Vault secrets not set; skipping tutor-memory cron schedule';
  ELSE
    PERFORM cron.unschedule('tutor-memory')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tutor-memory');
    PERFORM cron.schedule(
      'tutor-memory',
      '40 11 * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'reading_notify_app_url') || '/api/cron/tutor-memory',
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
