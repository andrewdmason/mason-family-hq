-- WHOOP integration — part 2 of 3: which movements get pushed, and how they map
-- to WHOOP's Strength Trainer exercise catalog.
--
-- Two concerns, both layered onto the GLOBAL movement library (00118):
--
--   1. whoop_push_eligible — does this movement count as resistance work WHOOP's
--      muscular-load model can use? True for every loaded lift (is_loaded), plus a
--      hand-picked allowlist of bodyweight strength/gymnastics (pull-ups, push-ups,
--      dips, muscle-ups, toes-to-bar, ring rows) that meaningfully load muscle even
--      though we don't draw an e1RM curve for them. Pure conditioning (run/row/bike),
--      mobility, and skill work stay false and are never pushed.
--
--   2. whoop_exercise_map — the crosswalk from our canonical movement to a WHOOP
--      exercise_id. Seeded here for the movements we ship (source='static'); the
--      push resolver caches future auto-resolutions here too (source='auto'). The
--      full WHOOP metadata for each id lives in a bundled catalog in code
--      (src/lib/whoop/exercise-catalog.ts) — this table only holds the id pointer.
--      A movement with no row is simply skipped from the push (noted in sync error),
--      never blocking the rest of the session.
--
-- Like movements itself, these are shared (no user_id): authenticated read, and
-- writes only through the service role (the push resolver's auto-cache path).

-- ---------------------------------------------------------------------------
-- 1. Eligibility flag
-- ---------------------------------------------------------------------------
ALTER TABLE movements ADD COLUMN whoop_push_eligible boolean NOT NULL DEFAULT false;

-- Every loaded lift is eligible.
UPDATE movements SET whoop_push_eligible = true WHERE is_loaded = true;

-- Plus bodyweight strength / gymnastics that load muscle but aren't is_loaded.
UPDATE movements SET whoop_push_eligible = true WHERE slug IN (
  'pull-up', 'chest-to-bar-pull-up', 'strict-pull-up', 'push-up',
  'handstand-push-up', 'ring-dip', 'muscle-up', 'bar-muscle-up',
  'ring-muscle-up', 'toes-to-bar', 'ring-row'
);

-- ---------------------------------------------------------------------------
-- 2. Crosswalk table
-- ---------------------------------------------------------------------------
CREATE TABLE whoop_exercise_map (
  movement_id       uuid PRIMARY KEY REFERENCES movements(id) ON DELETE CASCADE,
  whoop_exercise_id text NOT NULL,
  is_custom         boolean NOT NULL DEFAULT false,  -- true = a custom exercise we created in WHOOP
  source            text NOT NULL DEFAULT 'static' CHECK (source IN ('static', 'auto')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER whoop_exercise_map_updated_at
  BEFORE UPDATE ON whoop_exercise_map
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE whoop_exercise_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON whoop_exercise_map FOR SELECT
  TO authenticated USING (true);

-- Seed the static crosswalk. WHOOP exercise_ids verified against the captured
-- catalog (373 official exercises). Movements deliberately left unmapped because
-- WHOOP has no faithful equivalent (sumo-deadlift-high-pull, dumbbell-press) are
-- skipped at push time rather than mapped to something wrong.
INSERT INTO whoop_exercise_map (movement_id, whoop_exercise_id, source)
SELECT m.id, x.whoop_id, 'static'
FROM (VALUES
  -- Squat
  ('back-squat',            'BACKSQUAT_BARBELL'),
  ('front-squat',           'FRONTSQUAT_BARBELL'),
  ('overhead-squat',        'OVERHEADSQUAT_BARBELL'),
  ('goblet-squat',          'GOBLETSQUAT_DUMBBELL'),
  -- Hinge
  ('deadlift',              'DEADLIFT_BARBELL'),
  ('sumo-deadlift',         'SUMODEADLIFT_BARBELL'),
  ('romanian-deadlift',     'ROMANIANDEADLIFT_BARBELL'),
  ('good-morning',          'GOODMORNING_BARBELL'),
  -- Press
  ('strict-press',          'OVERHEADPRESS_BARBELL'),
  ('push-press',            'PUSHPRESS_BARBELL'),
  ('bench-press',           'BENCHPRESS_BARBELL'),
  ('thruster',              'THRUSTER_BARBELL'),
  ('handstand-push-up',     'HANDSTAND_PUSH-UPS'),
  ('push-up',               'PUSHUP_CLASSIC'),
  ('ring-dip',              'TRICEPDIP_DIPBAR'),
  -- Jerk
  ('push-jerk',             'PUSHJERK_BARBELL'),
  ('split-jerk',            'SPLITJERK_BARBELL'),
  -- Pull
  ('pull-up',               'OVERHANDGRIPPULLUPS'),
  ('chest-to-bar-pull-up',  'CHESTTOBARPULLUPS'),
  ('strict-pull-up',        'OVERHANDGRIPPULLUPS'),
  ('bent-over-row',         'BENTOVERROW_BARBELL'),
  ('ring-row',              'INVERTEDROW_RINGS'),
  -- Clean
  ('clean',                 'CLEAN_BARBELL'),
  ('power-clean',           'POWERCLEAN_BARBELL'),
  ('hang-power-clean',      'HANGPOWERCLEAN_BARBELL'),
  ('hang-clean',            'HANGCLEAN_BARBELL'),
  ('squat-clean',           'CLEAN_BARBELL'),
  ('clean-and-jerk',        'CLEANJERK_BARBELL'),
  -- Snatch
  ('snatch',                'SNATCH_BARBELL'),
  ('power-snatch',          'POWERSNATCH_BARBELL'),
  ('hang-power-snatch',     'HANGPOWERSNATCH_BARBELL'),
  ('hang-snatch',           'HANGSNATCH_BARBELL'),
  ('squat-snatch',          'SNATCH_BARBELL'),
  -- Lunge / Carry
  ('front-rack-lunge',      'ALTERNATINGFRONTRACKLUNGES_BARBELL'),
  ('farmers-carry',         'FARMERSWALK_DUMBBELL'),
  -- Gymnastics
  ('muscle-up',             'MUSCLEUPS'),
  ('bar-muscle-up',         'MUSCLEUPS'),
  ('ring-muscle-up',        'RING_MUSCLE-UPS'),
  ('toes-to-bar',           'HANGINGTOESTOBAR')
) AS x(slug, whoop_id)
JOIN movements m ON m.slug = x.slug;
