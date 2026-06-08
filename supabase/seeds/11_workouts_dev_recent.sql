-- Dev-only recent workout data for the Workouts "Today" tab and history.
--
-- Unlike 10_workouts_lifting.sql (a fixed historical import), these sessions are
-- dated RELATIVE to current_date so they're always "today" / "last week" no
-- matter when the local DB is reset:
--
--   * One OPEN session dated today — fully logged (actuals + effort) and ready to
--     be marked done and sent to WHOOP. This is what the Today tab focuses on.
--   * Four COMPLETED sessions across the last week — strength, a metcon (Fran),
--     and accessory work — so History and the read-only "done" view have content.
--
-- Seed-only (never applied to prod). Guarded by parse_model = 'seed:dev-recent'
-- so a re-run never double-inserts.

DO $$
DECLARE
  v_user      uuid;
  v_session   uuid;
  v_block     uuid;
  v_entry     uuid;
  v_mid       uuid;
  v_e1rm      numeric;
  v_cur_sess  text := NULL;
  v_cur_block int  := NULL;
  i           int;
  r           record;
BEGIN
  SELECT id INTO v_user FROM auth.users WHERE email = 'andrew@mason.io';
  IF v_user IS NULL THEN
    RAISE NOTICE 'Recent workouts seed: andrew@mason.io has no auth user yet; skipping.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM workout_sessions
    WHERE user_id = v_user AND parse_model = 'seed:dev-recent'
  ) THEN
    RAISE NOTICE 'Recent workouts seed: already present; skipping.';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- One movement entry per row. Rows are grouped into sessions by sess_key and
      -- into blocks by (sess_key, block_key). day_offset is days from today.
      -- sess_key, day_off, sess_title,                 sess_notes,                              rpe, done,  blk, block_type,  block_title, score_type,    score_secs, score_rounds, score_reps, e_pos, slug,          raw_name,                  entry_notes,                metric,      context,     n_sets, reps, load
      ('today', 0,  'Back Squat 5×5 + Accessory',       NULL,                                     8,  false, 0, 'strength',  NULL,        'none',        NULL,       NULL,         NULL,       0,  'back-squat',  'Back squat 5x5 @ 225',    'Building back up.',        'load_reps', 'strength',  5, 5, 225),
      ('today', 0,  'Back Squat 5×5 + Accessory',       NULL,                                     8,  false, 0, 'strength',  NULL,        'none',        NULL,       NULL,         NULL,       1,  'bench-press', 'Bench press 3x8 @ 155',   NULL,                       'load_reps', 'strength',  3, 8, 155),
      ('today', 0,  'Back Squat 5×5 + Accessory',       NULL,                                     8,  false, 1, 'accessory', NULL,        'none',        NULL,       NULL,         NULL,       0,  'pull-up',     'Pull-ups 4x8',            NULL,                       'reps',      'accessory', 4, 8, NULL),
      ('today', 0,  'Back Squat 5×5 + Accessory',       NULL,                                     8,  false, 1, 'accessory', NULL,        'none',        NULL,       NULL,         NULL,       1,  'push-up',     'Push-ups 4x12',           NULL,                       'reps',      'accessory', 4, 12, NULL),

      ('s2',    -2, 'Deadlift 5×3',                     'Felt strong — bar speed snappy.',        9,  true,  0, 'strength',  NULL,        'none',        NULL,       NULL,         NULL,       0,  'deadlift',    'Deadlift 5x3 @ 315',      NULL,                       'load_reps', 'strength',  5, 3, 315),

      ('s3',    -3, 'Fran',                             'Thrusters unbroken on the 21. PR by 18s!',10, true,  0, 'metcon',    'Fran',      'time',        252,        NULL,         NULL,       0,  'thruster',    'Thruster 21-15-9 @ 95',   NULL,                       'load_reps', 'metcon',    1, 45, 95),
      ('s3',    -3, 'Fran',                             'Thrusters unbroken on the 21. PR by 18s!',10, true,  0, 'metcon',    'Fran',      'time',        252,        NULL,         NULL,       1,  'pull-up',     'Pull-ups 21-15-9',        NULL,                       'reps',      'metcon',    1, 45, NULL),

      ('s4',    -5, 'Strict Press + Dips',              NULL,                                     7,  true,  0, 'strength',  NULL,        'none',        NULL,       NULL,         NULL,       0,  'strict-press','Strict press 5x5 @ 105',  NULL,                       'load_reps', 'strength',  5, 5, 105),
      ('s4',    -5, 'Strict Press + Dips',              NULL,                                     7,  true,  1, 'accessory', NULL,        'none',        NULL,       NULL,         NULL,       0,  'ring-dip',    'Ring dips 3x10',          NULL,                       'reps',      'accessory', 3, 10, NULL),

      ('s5',    -6, 'Back Squat 3×5 @ 235',             'Last set grindy but clean.',             8,  true,  0, 'strength',  NULL,        'none',        NULL,       NULL,         NULL,       0,  'back-squat',  'Back squat 3x5 @ 235',    NULL,                       'load_reps', 'strength',  3, 5, 235)
    ) AS t(
      sess_key, day_off, sess_title, sess_notes, rpe, done,
      blk, block_type, block_title, score_type, score_secs, score_rounds, score_reps,
      e_pos, slug, raw_name, entry_notes, metric, context, n_sets, reps, load
    )
    ORDER BY day_off DESC, sess_key, blk, e_pos
  LOOP
    SELECT id INTO v_mid FROM movements WHERE slug = r.slug;
    IF v_mid IS NULL THEN
      RAISE NOTICE 'Recent workouts seed: movement % not found; skipping row.', r.slug;
      CONTINUE;
    END IF;

    -- New session.
    IF v_cur_sess IS DISTINCT FROM r.sess_key THEN
      INSERT INTO workout_sessions
        (user_id, session_date, title, source, notes, rpe,
         parsed_at, parse_model, completed_at)
        VALUES (
          v_user, current_date + r.day_off, r.sess_title, 'manual', r.sess_notes, r.rpe,
          now(), 'seed:dev-recent',
          CASE WHEN r.done
               THEN (current_date + r.day_off)::timestamp + time '18:00'
               ELSE NULL END
        )
        RETURNING id INTO v_session;
      v_cur_sess := r.sess_key;
      v_cur_block := NULL;
    END IF;

    -- New block within the session.
    IF v_cur_block IS DISTINCT FROM r.blk THEN
      INSERT INTO workout_blocks
        (user_id, session_id, position, block_type, title, score_type,
         score_seconds, score_rounds, score_reps)
        VALUES (
          v_user, v_session, r.blk, r.block_type::workout_block_type, r.block_title,
          r.score_type::workout_score_type,
          r.score_secs::int, r.score_rounds::int, r.score_reps::int
        )
        RETURNING id INTO v_block;
      v_cur_block := r.blk;
    END IF;

    INSERT INTO workout_movement_entries
      (user_id, block_id, movement_id, raw_name, position, notes)
      VALUES (v_user, v_block, v_mid, r.raw_name, r.e_pos, r.entry_notes)
      RETURNING id INTO v_entry;

    -- e1RM only for true strength/accessory lifts (Epley); metcon load_reps and
    -- bodyweight rep work don't feed the 1RM curve.
    v_e1rm := CASE
      WHEN r.metric <> 'load_reps' OR r.context = 'metcon' THEN NULL
      WHEN r.reps <= 1 THEN r.load
      ELSE round(r.load * (1 + r.reps::numeric / 30), 1)
    END;

    FOR i IN 1..r.n_sets LOOP
      IF r.metric = 'load_reps' THEN
        INSERT INTO workout_sets
          (user_id, entry_id, position, metric_type, context,
           prescribed_reps, prescribed_load, prescribed_unit,
           actual_reps, actual_load, actual_unit, e1rm, e1rm_is_loose)
          VALUES (
            v_user, v_entry, i - 1, 'load_reps', r.context::workout_set_context,
            r.reps, r.load, 'lb',
            r.reps, r.load, 'lb', v_e1rm, r.reps > 12
          );
      ELSE
        INSERT INTO workout_sets
          (user_id, entry_id, position, metric_type, context,
           prescribed_reps, actual_reps)
          VALUES (
            v_user, v_entry, i - 1, 'reps', r.context::workout_set_context,
            r.reps, r.reps
          );
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Recent workouts seed: imported today + last-week sessions for andrew@mason.io.';
END $$;
