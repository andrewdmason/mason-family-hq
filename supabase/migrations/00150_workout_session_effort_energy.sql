-- Workouts: effort and energy become simple "flag the unusual" toggles, not a
-- numeric scale. A normal CrossFit session is hard by default, so a 1–10 RPE was
-- more precision than gets used — in practice the only signal worth capturing is
-- "today was easier/harder than normal" and "I felt low/high". Each is a nullable
-- two-state flag; null means normal (the common case, left unselected).
--
-- effort supersedes workout_sessions.rpe. We backfill from rpe, then leave the
-- rpe column in place (unused, reversible) rather than dropping it.
ALTER TABLE workout_sessions
  ADD COLUMN effort text CHECK (effort IN ('easier', 'harder')),
  ADD COLUMN energy text CHECK (energy IN ('low', 'high'));

UPDATE workout_sessions
  SET effort = CASE
    WHEN rpe IS NULL THEN NULL
    WHEN rpe <= 6 THEN 'easier'
    WHEN rpe >= 9 THEN 'harder'
    ELSE NULL
  END
  WHERE rpe IS NOT NULL;
