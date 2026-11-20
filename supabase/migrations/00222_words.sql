-- Words: daily ISEE vocabulary practice for the kids (src/lib/words). The words
-- and their questions live in the repo (src/lib/words/content); these tables
-- hold only what each person has done with them.
--
-- Everything is written by the website with the service role. A person reads
-- their own rows and the parents read everyone's; a session's `current` holds
-- the answer to the question on screen, so sessions are read through the
-- website only.

-- Which test someone is practising for, and how long their session is.
CREATE TABLE IF NOT EXISTS words_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('lower', 'middle')),
  -- Questions in one session: paced to the real test (18 Lower, 22 Middle, in ten minutes).
  questions smallint NOT NULL DEFAULT 20 CHECK (questions BETWEEN 5 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Where someone is with one word or word part. A row appears the first time
-- they're asked it; no row means it's still new.
CREATE TABLE IF NOT EXISTS words_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('lower', 'middle')),
  -- 'w:abundant' or 'p:bene'.
  item text NOT NULL,
  -- 0 learning (missed lately), 1 and 2 almost (right, with the gap growing), 3 mastered.
  stage smallint NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 3),
  -- The day it next comes up, in the family's time zone.
  due_on date NOT NULL,
  -- Right the first time it was ever asked, and never missed since: it skips the learning steps.
  fast boolean NOT NULL DEFAULT false,
  first_seen_on date NOT NULL,
  last_seen_on date NOT NULL,
  last_correct_on date,
  -- Different days it's been answered right since its last miss.
  correct_days smallint NOT NULL DEFAULT 0,
  -- The question forms it's been answered right in since its last miss, and the form asked last.
  forms_right text[] NOT NULL DEFAULT '{}',
  last_form text,
  seen integer NOT NULL DEFAULT 0,
  right_count integer NOT NULL DEFAULT 0,
  wrong_count integer NOT NULL DEFAULT 0,
  dontknow_count integer NOT NULL DEFAULT 0,
  mastered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level, item)
);

CREATE TABLE IF NOT EXISTS words_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('lower', 'middle')),
  -- The day it was started, in the family's time zone.
  day date NOT NULL,
  total smallint NOT NULL,
  answered smallint NOT NULL DEFAULT 0,
  correct smallint NOT NULL DEFAULT 0,
  wrong smallint NOT NULL DEFAULT 0,
  dontknow smallint NOT NULL DEFAULT 0,
  -- Time spent answering (not reading the tip after a miss), and the time allowed.
  elapsed_ms integer NOT NULL DEFAULT 0,
  limit_ms integer NOT NULL,
  -- A test-day session: no "Don't know" to fall back on.
  no_dont_know boolean NOT NULL DEFAULT false,
  -- The question on screen, with its answer: {item, form, kind, stem, choices: [{text, trap, why}], correct}.
  current jsonb,
  -- Missed this session and waiting to come round again: [{item, at}].
  requeue jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What the session added up to, for its end screen: new words met, words mastered.
  new_items smallint NOT NULL DEFAULT 0,
  mastered_gained smallint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS words_sessions_user_idx ON words_sessions (user_id, level, day);

CREATE TABLE IF NOT EXISTS words_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES words_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('lower', 'middle')),
  item text NOT NULL,
  form text NOT NULL,
  -- 1, 2, 3… within its session.
  position smallint NOT NULL,
  result text NOT NULL CHECK (result IN ('correct', 'wrong', 'dontknow')),
  -- What they picked, in words; null for "Don't know".
  chosen text,
  -- The kind of trap they fell for, when they picked a wrong answer.
  trap text,
  ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, position)
);
CREATE INDEX IF NOT EXISTS words_answers_user_idx ON words_answers (user_id, level, item, created_at);

ALTER TABLE words_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE words_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE words_answers ENABLE ROW LEVEL SECURITY;
-- No policies: a session carries the answer to its current question.
ALTER TABLE words_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Words profiles: own or parent" ON words_profiles;
CREATE POLICY "Words profiles: own or parent" ON words_profiles FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
DROP POLICY IF EXISTS "Words progress: own or parent" ON words_progress;
CREATE POLICY "Words progress: own or parent" ON words_progress FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
DROP POLICY IF EXISTS "Words answers: own or parent" ON words_answers;
CREATE POLICY "Words answers: own or parent" ON words_answers FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
