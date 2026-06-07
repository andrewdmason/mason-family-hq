-- Workouts — part 2 of 3: the per-user log.
--
-- A SESSION is one day's training. It holds ordered BLOCKS (the pre-workout /
-- workout / post-workout segments that show up in the calendar text), each of
-- which can carry its own score — fixing the thing SugarWOD can't do, where a
-- strength block and a metcon in the same session need separate results.
--
-- A block holds MOVEMENT ENTRIES (one per distinct movement), and an entry holds
-- ordered SETS. A barbell lift is one entry with several sets; a metcon is several
-- entries plus a block-level score. Every set carries a flexible metric_type, so
-- "Thruster 55 lb × 9" and "Run 400 m" and "Plank :30" coexist in one block.
--
-- Prescribed vs. actual live as parallel columns on the same set row: the parse
-- fills prescribed_*, actual_* is seeded equal to it on insert, and the member
-- edits only what differed. e1RM and PRs are computed from the actual_* values.
--
-- user_id is denormalized onto every table (not just the session) so each RLS
-- policy stays a trivial single-column check with no joins, matching the rest of
-- the schema (00073 reading). Template: own-rows RLS + the shared updated_at
-- trigger from 00001.

-- ============================================================
-- Enums
-- ============================================================
CREATE TYPE workout_block_type  AS ENUM
  ('warmup', 'strength', 'metcon', 'accessory', 'cooldown', 'skill');
CREATE TYPE workout_metric_type AS ENUM
  ('load_reps', 'distance', 'duration', 'calories', 'reps');
CREATE TYPE workout_set_context AS ENUM
  ('strength', 'metcon', 'warmup', 'accessory');
CREATE TYPE workout_rx_level    AS ENUM ('scaled', 'rx', 'rx_plus');
CREATE TYPE workout_score_type  AS ENUM
  ('time', 'rounds_reps', 'reps', 'load', 'distance', 'calories', 'none');

-- ============================================================
-- 1. Sessions
-- ============================================================
CREATE TABLE workout_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date      date NOT NULL,
  title             text,
  source            text NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual', 'calendar')),
  -- The CFO calendar event this was parsed from (NULL for ad-hoc entries). The
  -- event is member-scoped, not user-scoped, so this is just a provenance link.
  calendar_event_id uuid REFERENCES calendar_events(id) ON DELETE SET NULL,
  raw_description   text,            -- the source text, kept verbatim for re-parse
  notes             text,            -- session-level freeform notes
  parsed_at         timestamptz,     -- NULL => structured data not generated yet
  parse_model       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One parsed session per CFO event per member: guards the parse-on-open race
  -- where two requests try to materialize the same event at once.
  UNIQUE (user_id, calendar_event_id)
);

CREATE INDEX idx_workout_sessions_user_date
  ON workout_sessions (user_id, session_date DESC);

CREATE TRIGGER workout_sessions_updated_at
  BEFORE UPDATE ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON workout_sessions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 2. Blocks (each separately scored)
-- ============================================================
-- benchmark_id intentionally has no FK yet — workout_benchmarks is created in
-- 00120, which adds the constraint and the is_benchmark column.
CREATE TABLE workout_blocks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id     uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  position       int  NOT NULL DEFAULT 0,
  block_type     workout_block_type NOT NULL DEFAULT 'metcon',
  title          text,
  -- Block-level score. score_type picks which score_* column is meaningful.
  score_type     workout_score_type NOT NULL DEFAULT 'none',
  score_seconds  int,             -- 'time'
  score_rounds   int,             -- 'rounds_reps'
  score_reps     int,             -- 'rounds_reps' / 'reps'
  score_load     numeric(7,2),    -- 'load'
  score_distance numeric(8,2),    -- 'distance' (meters)
  score_calories int,             -- 'calories'
  rx_level       workout_rx_level,
  rpe            numeric(3,1) CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  notes          text,
  benchmark_id   uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workout_blocks_session ON workout_blocks (session_id, position);

CREATE TRIGGER workout_blocks_updated_at
  BEFORE UPDATE ON workout_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workout_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON workout_blocks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 3. Movement entries
-- ============================================================
-- movement_id may be NULL only transiently (an entry the parser couldn't
-- canonicalize); raw_name always preserves exactly what the source said.
CREATE TABLE workout_movement_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_id    uuid NOT NULL REFERENCES workout_blocks(id) ON DELETE CASCADE,
  movement_id uuid REFERENCES movements(id),
  raw_name    text NOT NULL,
  position    int  NOT NULL DEFAULT 0,
  rpe         numeric(3,1) CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workout_entries_block    ON workout_movement_entries (block_id, position);
CREATE INDEX idx_workout_entries_movement ON workout_movement_entries (movement_id);

CREATE TRIGGER workout_entries_updated_at
  BEFORE UPDATE ON workout_movement_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workout_movement_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON workout_movement_entries FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4. Sets (prescribed + actual, flexible metric)
-- ============================================================
CREATE TABLE workout_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id      uuid NOT NULL REFERENCES workout_movement_entries(id) ON DELETE CASCADE,
  position      int  NOT NULL DEFAULT 0,
  metric_type   workout_metric_type NOT NULL,
  context       workout_set_context NOT NULL DEFAULT 'strength',
  rx_level      workout_rx_level,

  -- Prescribed (filled by the parse; the immutable plan record).
  prescribed_reps     int,
  prescribed_load     numeric(7,2),
  prescribed_unit     text CHECK (prescribed_unit IN ('lb', 'kg')),
  prescribed_distance numeric(8,2),   -- meters
  prescribed_duration int,            -- seconds
  prescribed_calories int,

  -- Actual (seeded from prescribed on insert; the member edits only what differed).
  actual_reps         int,
  actual_load         numeric(7,2),
  actual_unit         text CHECK (actual_unit IN ('lb', 'kg')),
  actual_distance     numeric(8,2),
  actual_duration     int,
  actual_calories     int,

  -- Estimated 1RM (Epley on the actual load×reps). Recomputable from the raw
  -- actual_* columns, so a later formula change needs no migration.
  e1rm          numeric(7,2),
  e1rm_is_loose boolean NOT NULL DEFAULT false,   -- true when actual_reps > 12

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A load_reps set must carry a rep count somewhere; other metrics are free to
  -- live in their own typed column.
  CONSTRAINT chk_load_reps_has_reps CHECK (
    metric_type <> 'load_reps'
    OR actual_reps IS NOT NULL
    OR prescribed_reps IS NOT NULL
  )
);

CREATE INDEX idx_workout_sets_entry ON workout_sets (entry_id, position);
-- Powers the per-movement e1RM trend and history card (the gym-time lookup).
CREATE INDEX idx_workout_sets_e1rm ON workout_sets (user_id, entry_id)
  WHERE e1rm IS NOT NULL;

CREATE TRIGGER workout_sets_updated_at
  BEFORE UPDATE ON workout_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON workout_sets FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
