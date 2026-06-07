-- Seed the owner's real historical lifting log (exported from Notion) into the
-- Workouts app so the strength stat sheet and per-movement history start with
-- years of data instead of empty.
--
-- Each Notion row becomes a strength set (movement + load × reps) under a session
-- dated to when it was logged; lifts logged the same day share one session. e1RM
-- is computed with the same Epley rule the app uses (a 1-rep set equals its load).
--
-- Guarded two ways so it is safe everywhere: it no-ops if andrew@mason.io has no
-- auth user yet (e.g. during a local `db reset`, where dev users are created by
-- seeds that run AFTER migrations), and it skips if it has already run (so a
-- re-run never duplicates). On production deploy the owner exists, so it populates.

DO $$
DECLARE
  v_user   uuid;
  v_session uuid;
  v_block  uuid;
  v_entry  uuid;
  v_mid    uuid;
  v_e1rm   numeric;
  v_curdate date := NULL;
  v_entrypos int := 0;
  r record;
  i int;
  v_total_note text :=
    'Squat 245/260/265. Press 120; failed 130 by bending a leg but recovered it (tweaked back). '
    || 'Deadlift 315/335; failed 345, could not break the floor.';
BEGIN
  SELECT id INTO v_user FROM auth.users WHERE email = 'andrew@mason.io';
  IF v_user IS NULL THEN
    RAISE NOTICE 'Lifting seed: andrew@mason.io has no auth user yet; skipping.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM workout_sessions
    WHERE user_id = v_user AND parse_model = 'seed:notion-lifting'
  ) THEN
    RAISE NOTICE 'Lifting seed: already present; skipping.';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- date,        daypos, day_title,                            day_notes,    slug,             load, reps, sets, raw_name,                       entry_notes
      ('2026-05-12'::date, 0, 'Back squat 1RM 235',                 NULL,         'back-squat',      225,   1,   1, 'Back squat 1RM 235',             'Feels good not trying to max out today'),
      ('2025-12-02'::date, 0, 'Strict press 1RM 115',               NULL,         'strict-press',    115,   1,   1, 'Strict press 1rm 115',           NULL),
      ('2025-11-25'::date, 0, 'Strict press 3x3 105lbs',            NULL,         'strict-press',    105,   3,   3, 'Strict press 3x3 105lbs',        NULL),
      ('2024-09-04'::date, 0, 'Push Press / Front Squat',           NULL,         'push-press',      135,   3,   1, 'Push press 3x',                  NULL),
      ('2024-09-04'::date, 1, 'Push Press / Front Squat',           NULL,         'front-squat',     205,   3,   1, 'Front squat 3x 205',             NULL),
      ('2024-08-20'::date, 0, 'Squat clean 1x 195',                 NULL,         'squat-clean',     195,   1,   1, 'Squat clean 1x 195',             NULL),
      ('2024-05-10'::date, 0, 'Back squat: 3x3 then max 6 at 205',  NULL,         'back-squat',      205,   6,   1, '3X3 and then max 6 at 205',      NULL),
      ('2024-04-01'::date, 0, 'Front squat 6x 185',                 NULL,         'front-squat',     185,   6,   1, '185 6x front squat',             NULL),
      ('2024-02-16'::date, 0, 'Hang squat clean 2x 165',            NULL,         'hang-clean',      165,   2,   1, '16x 2x hang squat clean',        NULL),
      ('2024-02-14'::date, 0, 'Push jerk 3x 135',                   NULL,         'push-jerk',       135,   3,   1, 'Push jerk 3x @ 155',             NULL),
      ('2024-01-10'::date, 0, 'Front rack lunge 6x 155',            NULL,         'front-rack-lunge',155,   6,   1, '6x 155',                         NULL),
      ('2024-01-08'::date, 0, 'Push press 3x 135',                  NULL,         'push-press',      135,   3,   1, '135 push press 3x',              NULL),
      ('2023-12-02'::date, 0, 'CrossFit Total 2024',                'TOTAL',      'back-squat',      265,   1,   1, 'CrossFit Total - Back Squat',    NULL),
      ('2023-12-02'::date, 1, 'CrossFit Total 2024',                'TOTAL',      'strict-press',    120,   1,   1, 'CrossFit Total - Strict Press',  NULL),
      ('2023-12-02'::date, 2, 'CrossFit Total 2024',                'TOTAL',      'deadlift',        335,   1,   1, 'CrossFit Total - Deadlift',      NULL),
      ('2023-11-08'::date, 0, 'Deadlift 5x 275',                    NULL,         'deadlift',        275,   5,   1, 'Deadlift 5x',                    NULL),
      ('2023-11-06'::date, 0, 'Back squat 3x 225',                  NULL,         'back-squat',      225,   3,   1, '3x back squat',                  NULL),
      ('2023-08-09'::date, 0, 'Split jerk 4x 115',                  NULL,         'split-jerk',      115,   4,   1, 'Split Jerk 4x',                  NULL),
      ('2023-06-19'::date, 0, 'Front squat 3x 170',                 NULL,         'front-squat',     170,   3,   1, '3x front squat',                 NULL),
      ('2023-04-26'::date, 0, 'Strict press 6x 95',                 NULL,         'strict-press',     95,   6,   1, '6x strict press max reps',       NULL),
      ('2023-04-09'::date, 0, 'Deadlift 3x 285',                    NULL,         'deadlift',        285,   3,   1, '285 3x to failure',              NULL),
      ('2023-03-10'::date, 0, 'Push press 3x 135',                  NULL,         'push-press',      135,   3,   1, '3x push press',                  NULL),
      ('2023-03-08'::date, 0, 'Barbell testing day',                NULL,         'bench-press',     155,   5,   1, '5x bench press',                 NULL),
      ('2023-03-08'::date, 1, 'Barbell testing day',                NULL,         'strict-press',    125,   1,   1, '1x strict press',                NULL),
      ('2023-03-08'::date, 2, 'Barbell testing day',                NULL,         'power-snatch',    115,   3,   1, '3x power snatch',                NULL),
      ('2023-03-08'::date, 3, 'Barbell testing day',                NULL,         'power-clean',     155,   1,   1, '1x power clean',                 NULL),
      ('2023-03-08'::date, 4, 'Barbell testing day',                NULL,         'front-squat',     155,   2,   1, '2x front squat',                 NULL),
      ('2023-03-08'::date, 5, 'Barbell testing day',                NULL,         'deadlift',        325,   1,   1, '1x deadlift',                    NULL),
      ('2023-03-08'::date, 6, 'Barbell testing day',                NULL,         'back-squat',      255,   1,   1, '1x back squat',                  NULL),
      ('2023-03-08'::date, 7, 'Barbell testing day',                NULL,         'power-snatch',    105,   5,   1, '5x power snatch',                NULL)
    ) AS t(d, daypos, day_title, day_notes, slug, load, reps, sets, raw_name, entry_notes)
    ORDER BY d, daypos
  LOOP
    SELECT id INTO v_mid FROM movements WHERE slug = r.slug;
    IF v_mid IS NULL THEN
      RAISE NOTICE 'Lifting seed: movement % not found; skipping row.', r.slug;
      CONTINUE;
    END IF;

    -- New calendar day → new session + its single strength block.
    IF v_curdate IS DISTINCT FROM r.d THEN
      INSERT INTO workout_sessions
        (user_id, session_date, title, source, notes, parsed_at, parse_model, completed_at)
        VALUES (
          v_user, r.d, r.day_title, 'manual',
          CASE WHEN r.day_notes = 'TOTAL' THEN v_total_note ELSE r.day_notes END,
          now(), 'seed:notion-lifting', now()
        )
        RETURNING id INTO v_session;

      INSERT INTO workout_blocks
        (user_id, session_id, position, block_type, score_type)
        VALUES (v_user, v_session, 0, 'strength', 'none')
        RETURNING id INTO v_block;

      v_curdate := r.d;
      v_entrypos := 0;
    END IF;

    INSERT INTO workout_movement_entries
      (user_id, block_id, movement_id, raw_name, position, notes)
      VALUES (v_user, v_block, v_mid, r.raw_name, v_entrypos, NULLIF(r.entry_notes, ''))
      RETURNING id INTO v_entry;
    v_entrypos := v_entrypos + 1;

    -- Epley e1RM; a 1-rep set equals its load (matches the app's e1rm.ts).
    v_e1rm := CASE
      WHEN r.reps <= 1 THEN r.load
      ELSE round(r.load * (1 + r.reps::numeric / 30), 1)
    END;

    FOR i IN 1..r.sets LOOP
      INSERT INTO workout_sets
        (user_id, entry_id, position, metric_type, context,
         prescribed_reps, prescribed_load, prescribed_unit,
         actual_reps, actual_load, actual_unit, e1rm, e1rm_is_loose)
        VALUES (
          v_user, v_entry, i - 1, 'load_reps', 'strength',
          r.reps, r.load, 'lb',
          r.reps, r.load, 'lb', v_e1rm, r.reps > 12
        );
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Lifting seed: imported historical lifts for andrew@mason.io.';
END $$;
