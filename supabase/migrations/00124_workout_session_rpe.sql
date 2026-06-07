-- Workouts: RPE (perceived effort) moves to the session/day level — one rating
-- per workout, not per block. A single "how hard was today" number is the only
-- granularity that maps to a real use (session-load / effort trends over time);
-- per-block effort was an awkward middle ground. workout_blocks.rpe is left in
-- place but unused (reversible).
ALTER TABLE workout_sessions
  ADD COLUMN rpe numeric(3,1) CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10));
