-- Workouts: mark a session done. The home widget focuses on today's workout only
-- until it's completed, then shifts focus to the next scheduled workout (showing a
-- "today ✓" indicator). Completion is an explicit, user-set timestamp.
ALTER TABLE workout_sessions ADD COLUMN completed_at timestamptz;
