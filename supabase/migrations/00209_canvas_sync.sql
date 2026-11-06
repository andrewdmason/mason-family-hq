-- Canvas (the kids' school coursework) synced into Family HQ, so the Tuttles
-- tutor knows what each student is working on, and the family site can show
-- it. src/lib/canvas/sync.ts pulls from the Canvas API with a student's own
-- access key, which a parent pastes on /tuttles. The school caps those keys at
-- 30 days, so a parent renews it monthly (Tuttles reminds them); the calendar
-- feed, which never expires, keeps due dates coming in the meantime.
--
-- Everything is keyed by student and by Canvas's own ids, and every sync
-- upserts what Canvas returns, so a sync can be re-run at any time.

-- The access key. No policies: only the service role (the sync, and the
-- parents' connect action on the server) ever reads it.
CREATE TABLE IF NOT EXISTS canvas_connections (
  student_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  token text NOT NULL,
  -- When the key stops working: what the parent entered (the school's maximum
  -- is 30 days), corrected to now if Canvas starts refusing it.
  token_expires_at timestamptz,
  canvas_user_id bigint,
  canvas_name text,
  connected_by uuid REFERENCES auth.users(id),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  last_error text,
  -- When the expiry reminder last went out, so it goes once per key.
  reminded_at timestamptz
);
ALTER TABLE canvas_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS canvas_courses (
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id bigint NOT NULL,
  name text NOT NULL,
  course_code text,
  -- The syllabus as plain text, when the teacher wrote one in Canvas.
  syllabus text,
  -- Canvas's course card color, when the student set one.
  color text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, id)
);

CREATE TABLE IF NOT EXISTS canvas_assignments (
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id bigint NOT NULL,
  course_id bigint NOT NULL,
  name text NOT NULL,
  -- The teacher's instructions, as plain text (links and images dropped).
  description text,
  due_at timestamptz,
  unlock_at timestamptz,
  lock_at timestamptz,
  points_possible double precision,
  submission_types text[] NOT NULL DEFAULT '{}',
  is_quiz boolean NOT NULL DEFAULT false,
  html_url text,
  -- The unit it sits in, from the course's modules.
  module_name text,
  -- [{description, points, ratings: [{description, points}]}]
  rubric jsonb,
  -- Files the instructions link to (readings, worksheets): [{id, name, content_type, size}]
  files jsonb NOT NULL DEFAULT '[]',
  -- The student's submission.
  workflow_state text,
  submitted_at timestamptz,
  graded_at timestamptz,
  score double precision,
  grade text,
  late boolean NOT NULL DEFAULT false,
  missing boolean NOT NULL DEFAULT false,
  excused boolean NOT NULL DEFAULT false,
  -- What they typed in, as plain text.
  answer text,
  -- Uploaded files: [{id, name, content_type, size}]
  answer_files jsonb NOT NULL DEFAULT '[]',
  -- Teacher comments: [{author, comment, created_at}]
  comments jsonb NOT NULL DEFAULT '[]',
  -- Rubric scores: [{criterion, points, comments}]
  rubric_scores jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, id)
);
CREATE INDEX IF NOT EXISTS canvas_assignments_due_idx ON canvas_assignments (student_id, due_at);

-- Unit overview pages and announcements: what the class is doing, in the
-- teacher's words.
CREATE TABLE IF NOT EXISTS canvas_items (
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'page:<url slug>' or 'announcement:<id>'.
  key text NOT NULL,
  course_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('page', 'announcement')),
  title text NOT NULL,
  body text,
  module_name text,
  -- The module's place in the course, for finding the current unit.
  module_position integer,
  posted_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, key)
);

-- The modules themselves, in course order, so "which unit is current" can be
-- read off the assignments in them.
CREATE TABLE IF NOT EXISTS canvas_modules (
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id bigint NOT NULL,
  course_id bigint NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  item_count integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, id)
);

ALTER TABLE canvas_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_modules ENABLE ROW LEVEL SECURITY;

-- The student reads their own coursework (the iPhone app's class pages);
-- parents read everyone's. Only the sync writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canvas_courses', 'canvas_assignments', 'canvas_items', 'canvas_modules'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Canvas: own or parent" ON %I', t);
    EXECUTE format($p$
      CREATE POLICY "Canvas: own or parent" ON %I FOR SELECT USING (
        student_id = auth.uid()
        OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
      )$p$, t);
  END LOOP;
END $$;

-- Every two hours, through the website's sweep (the same Vault secrets as the
-- reader's sweeps). Skipped where pg_cron, pg_net or the secrets aren't there.
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
    RAISE NOTICE 'reading_notify Vault secrets not set; skipping canvas-sync cron schedule';
  ELSE
    PERFORM cron.unschedule('canvas-sync')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'canvas-sync');
    PERFORM cron.schedule(
      'canvas-sync',
      '17 */2 * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'reading_notify_app_url') || '/api/cron/canvas-sync',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'reading_notify_cron_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net/Vault not available (expected in local dev): %', SQLERRM;
END $outer$;
