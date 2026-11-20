-- A loaded movement's reps get a place for the weight. When a workout names no
-- number for the bar ("AMRAP 5: 5 split jerks, 5 overhead squats; use 75% of
-- 1-rep-max split jerk"), the parser filed the sets as plain reps, and plain
-- reps have no weight field on the phone or the website, so what was lifted
-- couldn't be logged. materialize.ts now saves those as load × reps; this does
-- the same for the ones already saved. A set with no rep count stays as it is
-- (chk_load_reps_has_reps).
UPDATE workout_sets s
SET metric_type = 'load_reps'
FROM workout_movement_entries e
JOIN movements m ON m.id = e.movement_id
WHERE e.id = s.entry_id
  AND m.is_loaded
  AND s.metric_type = 'reps'
  AND (s.actual_reps IS NOT NULL OR s.prescribed_reps IS NOT NULL);

-- An AMRAP's rounds aren't known ahead, but the same parse wrote a set for each
-- round it guessed at: five identical "× 5" for each movement above. Where
-- every set of a movement in an AMRAP is the same, as written and as logged,
-- keep the first. A ladder's differing sets, and any set that was changed, are
-- left alone. parse.ts now folds these at parse time.
DELETE FROM workout_sets s
USING workout_movement_entries e, workout_blocks b
WHERE e.id = s.entry_id
  AND b.id = e.block_id
  AND b.score_type = 'rounds_reps'
  AND s.position > (SELECT min(f.position) FROM workout_sets f WHERE f.entry_id = s.entry_id)
  AND NOT EXISTS (
    SELECT 1
    FROM workout_sets o
    WHERE o.entry_id = s.entry_id
      AND (o.metric_type, o.context, o.rx_level,
           o.prescribed_reps, o.prescribed_load, o.prescribed_unit,
           o.prescribed_distance, o.prescribed_duration, o.prescribed_calories,
           o.actual_reps, o.actual_load, o.actual_unit,
           o.actual_distance, o.actual_duration, o.actual_calories)
          IS DISTINCT FROM
          (s.metric_type, s.context, s.rx_level,
           s.prescribed_reps, s.prescribed_load, s.prescribed_unit,
           s.prescribed_distance, s.prescribed_duration, s.prescribed_calories,
           s.actual_reps, s.actual_load, s.actual_unit,
           s.actual_distance, s.actual_duration, s.actual_calories)
  );
