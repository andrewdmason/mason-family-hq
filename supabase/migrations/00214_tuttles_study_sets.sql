-- Tuttles study sets: something a kid is getting ready for (a science quiz, a
-- vocab quiz, a trimester math test, the ISEE), the material for it, the
-- topics it covers, and every question Tuttles has quizzed them with
-- (src/lib/tuttles/study.ts). How well each topic is known is worked out from
-- the questions' results, never stored, so the rules can change and the
-- levels follow.
--
-- Everything is written by the website with the service role. The kid and the
-- parents read sets, topics and sources; questions hold their answers, so
-- they're read through the website only (/tuttles/api/quiz).

CREATE TABLE IF NOT EXISTS tutor_study_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The kid it's for (a parent can make one for them).
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  -- The class (a Canvas course id) and the Canvas quiz or test it's for, if any.
  course_id bigint,
  assignment_id bigint,
  -- The day of the test; null for open-ended prep.
  test_date date,
  -- A built-in outline it started from ('isee'), whose topics it took.
  template text,
  -- What the real test asks, in a sentence or two, so practice questions
  -- look like it ("mostly multiple choice, plus two short answers").
  format text,
  -- Study notes Tuttles keeps from the material it's been given (photos,
  -- notes, Canvas), rewritten as more comes in. Quiz questions come from it.
  material text NOT NULL DEFAULT '',
  -- How well the material covers what's on the test, and what's missing.
  coverage text NOT NULL DEFAULT 'thin' CHECK (coverage IN ('thin', 'okay', 'good')),
  coverage_note text,
  created_by uuid REFERENCES auth.users(id),
  created_by_parent boolean NOT NULL DEFAULT false,
  -- Put away after the test (or by hand). Its results stay.
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutor_study_sets_student_idx ON tutor_study_sets (student_id, archived_at);

CREATE TABLE IF NOT EXISTS tutor_study_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES tutor_study_sets(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- How much of the test it is: 1 a little, 2 a fair share, 3 a big part.
  weight smallint NOT NULL DEFAULT 2 CHECK (weight BETWEEN 1 AND 3),
  position integer NOT NULL DEFAULT 0,
  -- Taken off the list (by the kid, or when the material moved on). Its
  -- questions keep pointing at it.
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutor_study_topics_set_idx ON tutor_study_topics (set_id, position);

CREATE TABLE IF NOT EXISTS tutor_study_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES tutor_study_sets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo', 'note', 'canvas')),
  -- A note's text, or what a photo or Canvas item was, in a few words.
  body text NOT NULL DEFAULT '',
  -- A photo: its path in the tuttles bucket.
  image_path text,
  assignment_id bigint,
  -- The chat it came in through, if it did.
  thread_id uuid,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutor_study_sources_set_idx ON tutor_study_sources (set_id, created_at);

-- A quiz is a chat of its own kind, tied to its set. `quiz` holds how it was
-- started and the plan of topics worked out for it:
-- {mode: 'practice'|'test', count, plan: [{topicId, name, reason, difficulty}], finishedAt?}
ALTER TABLE tutor_threads DROP CONSTRAINT IF EXISTS tutor_threads_kind_check;
ALTER TABLE tutor_threads ADD CONSTRAINT tutor_threads_kind_check CHECK (kind IN ('student', 'briefing', 'quiz'));
ALTER TABLE tutor_threads ADD COLUMN IF NOT EXISTS study_set_id uuid REFERENCES tutor_study_sets(id) ON DELETE SET NULL;
ALTER TABLE tutor_threads ADD COLUMN IF NOT EXISTS quiz jsonb;

CREATE TABLE IF NOT EXISTS tutor_quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES tutor_threads(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES tutor_study_sets(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES tutor_study_topics(id) ON DELETE SET NULL,
  -- 1, 2, 3… within its quiz.
  number integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('choice', 'short', 'fill', 'math', 'truefalse')),
  prompt text NOT NULL,
  -- Multiple choice: the options, in order, and which is right.
  choices jsonb,
  answer_index integer,
  -- The right answer in words (any kind), and why, for going over it.
  answer text NOT NULL DEFAULT '',
  explanation text,
  -- How it went: right first time, right after a hint, wrong, or skipped.
  result text CHECK (result IN ('correct', 'hinted', 'wrong', 'skipped')),
  -- What they answered: the choice's index, or their words.
  chosen_index integer,
  response text,
  -- A parent trying the app as the kid: their answers don't count toward the kid's levels.
  counts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  UNIQUE (thread_id, number)
);
CREATE INDEX IF NOT EXISTS tutor_quiz_questions_set_idx ON tutor_quiz_questions (set_id, answered_at);

ALTER TABLE tutor_study_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_study_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_study_sources ENABLE ROW LEVEL SECURITY;
-- No policies: the website reads and grades questions; the phone never sees an answer it hasn't earned.
ALTER TABLE tutor_quiz_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Study sets: own or parent" ON tutor_study_sets;
CREATE POLICY "Study sets: own or parent" ON tutor_study_sets FOR SELECT USING (
  student_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
DROP POLICY IF EXISTS "Study topics: own or parent" ON tutor_study_topics;
CREATE POLICY "Study topics: own or parent" ON tutor_study_topics FOR SELECT USING (
  EXISTS (SELECT 1 FROM tutor_study_sets s WHERE s.id = set_id AND s.student_id = auth.uid())
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
DROP POLICY IF EXISTS "Study sources: own or parent" ON tutor_study_sources;
CREATE POLICY "Study sources: own or parent" ON tutor_study_sources FOR SELECT USING (
  EXISTS (SELECT 1 FROM tutor_study_sets s WHERE s.id = set_id AND s.student_id = auth.uid())
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
