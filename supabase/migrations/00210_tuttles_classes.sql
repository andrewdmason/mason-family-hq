-- Tuttles knows which class each chat is about, and which teacher feedback a
-- student has already looked at in the app.

-- The class a chat is about (a Canvas course id), or null for anything else.
-- Set from the assignment a chat was started from, or worked out when the
-- chat is named; the student can change it. And the assignment a chat was
-- started from, so the tutor keeps its instructions in view.
ALTER TABLE tutor_threads ADD COLUMN IF NOT EXISTS course_id bigint;
ALTER TABLE tutor_threads ADD COLUMN IF NOT EXISTS assignment_id bigint;

-- Graded work whose feedback someone has opened in the app, so the class page
-- can mark the rest as new. Per viewer: a parent trying the app doesn't clear
-- what's new for the kid.
CREATE TABLE IF NOT EXISTS tutor_feedback_seen (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  assignment_id bigint NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, assignment_id)
);
ALTER TABLE tutor_feedback_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own feedback seen" ON tutor_feedback_seen;
CREATE POLICY "Own feedback seen" ON tutor_feedback_seen FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
