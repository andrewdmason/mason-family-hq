-- Math in the Tuttles app: an endless runner in which the kids answer ISEE
-- math questions (src/lib/tuttles/math.ts). The game is played on the phone,
-- with or without a connection, and the questions live there too; these tables
-- hold only what each kid has done, sent up when the phone can reach the
-- website (/tuttles/api/math/sync).
--
-- Every row's id is the phone's, so the same run or answer sent twice makes
-- one. Everything is written by the website with the service role. A person
-- reads their own rows and the parents read everyone's, as with Words.

-- One go at the game, from the first step to the fall.
CREATE TABLE IF NOT EXISTS tuttles_math_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The test the kid was practising for when it was sent.
  level text NOT NULL CHECK (level IN ('lower', 'middle')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  -- Metres run.
  distance integer NOT NULL DEFAULT 0 CHECK (distance >= 0),
  waves integer NOT NULL DEFAULT 0 CHECK (waves >= 0),
  -- The furthest zone reached: 0 is the first.
  depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0),
  stars integer NOT NULL DEFAULT 0 CHECK (stars >= 0),
  answered integer NOT NULL DEFAULT 0 CHECK (answered >= 0),
  correct integer NOT NULL DEFAULT 0 CHECK (correct >= 0),
  -- The most answered right in a row.
  best_streak integer NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tuttles_math_runs_user_idx ON tuttles_math_runs (user_id, started_at);

-- One question answered. Its run isn't a foreign key: the phone can send the
-- answers of a run that's still going, before there's a run to point at.
CREATE TABLE IF NOT EXISTS tuttles_math_answers (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  level text NOT NULL CHECK (level IN ('lower', 'middle')),
  -- The question's id in the phone's bank: 'L-0001'.
  question text NOT NULL,
  topic text NOT NULL,
  -- Quantitative Reasoning or Mathematics Achievement.
  section text NOT NULL CHECK (section IN ('qr', 'ma')),
  difficulty smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  -- Which of the four they picked; null when the clock ran out.
  chosen smallint CHECK (chosen BETWEEN 0 AND 3),
  correct boolean NOT NULL,
  ms integer NOT NULL DEFAULT 0 CHECK (ms >= 0),
  answered_at timestamptz NOT NULL,
  -- The day that was, in the family's time zone: what the daily goal counts by.
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tuttles_math_answers_user_time_idx ON tuttles_math_answers (user_id, answered_at);
CREATE INDEX IF NOT EXISTS tuttles_math_answers_user_day_idx ON tuttles_math_answers (user_id, day);
CREATE INDEX IF NOT EXISTS tuttles_math_answers_run_idx ON tuttles_math_answers (run_id);

-- What the phone keeps for the kid between runs (stars, what's been bought,
-- what's on, how they look). It's the phone's to make sense of: only the
-- newest is kept here, so another phone can pick it up.
CREATE TABLE IF NOT EXISTS tuttles_math_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rev integer NOT NULL CHECK (rev >= 0),
  json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tuttles_math_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuttles_math_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuttles_math_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tuttles math runs: own or parent" ON tuttles_math_runs;
CREATE POLICY "Tuttles math runs: own or parent" ON tuttles_math_runs FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
DROP POLICY IF EXISTS "Tuttles math answers: own or parent" ON tuttles_math_answers;
CREATE POLICY "Tuttles math answers: own or parent" ON tuttles_math_answers FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
DROP POLICY IF EXISTS "Tuttles math state: own or parent" ON tuttles_math_state;
CREATE POLICY "Tuttles math state: own or parent" ON tuttles_math_state FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
