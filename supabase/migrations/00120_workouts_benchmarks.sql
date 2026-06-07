-- Workouts — part 3 of 3: benchmarks + the read-side views.
--
-- A benchmark (Fran, Murph, …) is an immutable named definition — like a git ref.
-- The seeded "Girls"/"Heroes"/etc. rows are global (user_id NULL); a member may
-- also define their own custom benchmark (user_id set). An *attempt* is not a row
-- here — it's any workout_block that points at the benchmark, so the attempt
-- timeline is derived, and PRs fall out of the same blocks segmented by rx_level.

CREATE TYPE workout_benchmark_category AS ENUM
  ('girls', 'heroes', 'games', 'gymnastics', 'notable', 'custom');

CREATE TABLE workout_benchmarks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  category     workout_benchmark_category NOT NULL,
  score_type   workout_score_type NOT NULL,
  prescription text NOT NULL,
  is_custom    boolean NOT NULL DEFAULT false,
  -- NULL for the global library; the owning member for a custom benchmark.
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One global benchmark per name (custom ones are namespaced by user_id).
CREATE UNIQUE INDEX idx_benchmark_name_global
  ON workout_benchmarks (lower(name)) WHERE user_id IS NULL;
CREATE INDEX idx_benchmark_user ON workout_benchmarks (user_id);

INSERT INTO workout_benchmarks (name, slug, category, score_type, prescription) VALUES
  ('Fran',      'fran',      'girls',  'time',
    '21-15-9 Thrusters (95/65 lb) and Pull-ups, for time.'),
  ('Grace',     'grace',     'girls',  'time',
    '30 Clean and Jerks (135/95 lb), for time.'),
  ('Isabel',    'isabel',    'girls',  'time',
    '30 Snatches (135/95 lb), for time.'),
  ('Diane',     'diane',     'girls',  'time',
    '21-15-9 Deadlifts (225/155 lb) and Handstand Push-ups, for time.'),
  ('Elizabeth', 'elizabeth', 'girls',  'time',
    '21-15-9 Cleans (135/95 lb) and Ring Dips, for time.'),
  ('Helen',     'helen',     'girls',  'time',
    '3 rounds for time: 400-m run, 21 kettlebell swings (1.5/1 pood), 12 pull-ups.'),
  ('Annie',     'annie',     'girls',  'time',
    '50-40-30-20-10 Double-unders and Sit-ups, for time.'),
  ('Karen',     'karen',     'girls',  'time',
    '150 Wall-ball shots (20/14 lb), for time.'),
  ('Cindy',     'cindy',     'girls',  'rounds_reps',
    'AMRAP 20: 5 pull-ups, 10 push-ups, 15 air squats.'),
  ('Mary',      'mary',      'girls',  'rounds_reps',
    'AMRAP 20: 5 handstand push-ups, 10 pistols, 15 pull-ups.'),
  ('Angie',     'angie',     'girls',  'time',
    'For time: 100 pull-ups, 100 push-ups, 100 sit-ups, 100 air squats.'),
  ('Murph',     'murph',     'heroes', 'time',
    'For time: 1-mile run, 100 pull-ups, 200 push-ups, 300 air squats, 1-mile run. Wear a 20/14-lb vest.'),
  ('DT',        'dt',        'heroes', 'time',
    '5 rounds for time: 12 deadlifts, 9 hang power cleans, 6 push jerks (155/105 lb).'),
  ('Fight Gone Bad', 'fight-gone-bad', 'notable', 'reps',
    '3 rounds, 1:00 at each station (wall ball, SDHP, box jump, push press, row), 1:00 rest. Score = total reps/calories.');

-- ============================================================
-- Attach the benchmark link to blocks (table now exists).
-- ============================================================
ALTER TABLE workout_blocks
  ADD CONSTRAINT fk_block_benchmark FOREIGN KEY (benchmark_id)
  REFERENCES workout_benchmarks(id) ON DELETE SET NULL;
ALTER TABLE workout_blocks
  ADD COLUMN is_benchmark boolean NOT NULL DEFAULT false;
CREATE INDEX idx_workout_blocks_benchmark
  ON workout_blocks (benchmark_id) WHERE benchmark_id IS NOT NULL;

-- ============================================================
-- RLS: read the global library + your own custom; write only your own.
-- ============================================================
ALTER TABLE workout_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read global and own" ON workout_benchmarks FOR SELECT
  TO authenticated USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "Manage own custom" ON workout_benchmarks FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_custom = true);

-- ============================================================
-- Read-side views. security_invoker = on is REQUIRED: without it the views run
-- as their (superuser) owner and would bypass the per-user RLS on the underlying
-- tables. With it, each view sees only the querying member's own rows.
-- ============================================================

-- Best estimated 1RM per movement, split by context (strength charts default to
-- the strict, non-loose value). One row per (member, movement, context).
CREATE VIEW workout_movement_e1rm_best
  WITH (security_invoker = on) AS
SELECT
  s.user_id,
  e.movement_id,
  s.context,
  max(s.e1rm) FILTER (WHERE NOT s.e1rm_is_loose) AS best_e1rm_strict,
  max(s.e1rm)                                    AS best_e1rm_any,
  count(*)                                       AS set_count,
  max(ses.session_date)                          AS last_session_date
FROM workout_sets s
JOIN workout_movement_entries e ON e.id = s.entry_id
JOIN workout_blocks b           ON b.id = e.block_id
JOIN workout_sessions ses       ON ses.id = b.session_id
WHERE s.e1rm IS NOT NULL
GROUP BY s.user_id, e.movement_id, s.context;

-- The single best e1RM set per movement per rx_level — the PR record.
CREATE VIEW workout_movement_pr
  WITH (security_invoker = on) AS
SELECT DISTINCT ON (s.user_id, e.movement_id, s.rx_level)
  s.user_id,
  e.movement_id,
  s.rx_level,
  s.e1rm,
  s.actual_load,
  s.actual_reps,
  ses.session_date,
  s.id AS set_id
FROM workout_sets s
JOIN workout_movement_entries e ON e.id = s.entry_id
JOIN workout_blocks b           ON b.id = e.block_id
JOIN workout_sessions ses       ON ses.id = b.session_id
WHERE s.e1rm IS NOT NULL
ORDER BY s.user_id, e.movement_id, s.rx_level, s.e1rm DESC, ses.session_date ASC;

-- Volume rolled up to the family level (sessions touched, total reps, tonnage).
CREATE VIEW workout_family_volume
  WITH (security_invoker = on) AS
SELECT
  ses.user_id,
  m.family,
  count(DISTINCT ses.id)                                              AS session_count,
  sum(coalesce(s.actual_reps, 0))                                     AS total_reps,
  sum(coalesce(s.actual_load, 0) * coalesce(s.actual_reps, 0))        AS total_volume_load,
  max(ses.session_date)                                              AS last_session_date
FROM workout_sets s
JOIN workout_movement_entries e ON e.id = s.entry_id
JOIN movements m                ON m.id = e.movement_id
JOIN workout_blocks b           ON b.id = e.block_id
JOIN workout_sessions ses       ON ses.id = b.session_id
GROUP BY ses.user_id, m.family;
