-- Workouts (CrossFit/strength logger) — part 1 of 3: the GLOBAL movement library.
--
-- Unlike every other app table, the movement vocabulary is shared knowledge, not
-- per-user data: "Push Press" means the same thing for everyone, and a member's
-- history must join across days on a stable canonical movement. So these tables
-- carry no user_id. They get RLS with an authenticated *read* policy and no write
-- policy at all — the only writer is the service-role canonicalize path
-- (src/lib/supabase/admin.ts), which bypasses RLS. This is the first
-- authenticated-read-everywhere table in the schema; it's intentional and narrow.
--
-- Each movement belongs to a FAMILY (press, clean, squat, …) so we can roll up
-- progress across variants and estimate one variant from a sibling. The seed
-- ratios below are "typical/approximate" lifting norms, shown as ranges in the
-- UI; per-user personalized ratios (computed from the member's own cross-variant
-- e1RM) are layered on later and preferred when available.

-- ============================================================
-- 1. Families
-- ============================================================
CREATE TYPE workout_movement_family AS ENUM (
  'squat', 'hinge', 'press', 'jerk', 'pull', 'clean', 'snatch',
  'lunge', 'carry', 'gymnastics', 'monostructural', 'core', 'other'
);

CREATE TABLE movement_families (
  id          workout_movement_family PRIMARY KEY,
  label       text NOT NULL,
  description text
);

INSERT INTO movement_families (id, label, description) VALUES
  ('squat',          'Squat',          'Knee-dominant: back/front/overhead squats and variants'),
  ('hinge',          'Hinge',          'Hip-dominant pulls from the floor: deadlifts, swings, good mornings'),
  ('press',          'Press',          'Vertical and horizontal pressing: strict/push press, bench, thruster'),
  ('jerk',           'Jerk',           'Overhead from the rack with leg drive: push and split jerk'),
  ('pull',           'Pull',           'Upper-body pulling: rows and pull-up variants'),
  ('clean',          'Clean',          'Olympic clean family: power/squat/hang cleans'),
  ('snatch',         'Snatch',         'Olympic snatch family: power/squat/hang snatches'),
  ('lunge',          'Lunge',          'Single-leg loaded stepping'),
  ('carry',          'Carry',          'Loaded carries'),
  ('gymnastics',     'Gymnastics',     'Bodyweight skill movements'),
  ('monostructural', 'Monostructural', 'Cardio: run, row, bike, ski, swim'),
  ('core',           'Core',           'Midline holds and trunk work'),
  ('other',          'Other',          'Uncategorized');

-- ============================================================
-- 2. Canonical movements
-- ============================================================
-- is_loaded marks barbell/dumbbell-style strength lifts that are eligible for
-- estimated-1RM tracking. Bodyweight gymnastics, cardio, and fixed-implement
-- conditioning movements (wall ball, KB swing) are is_loaded = false: they still
-- log load/reps, but we don't draw an e1RM strength curve for them.
CREATE TABLE movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL UNIQUE,
  slug           text NOT NULL UNIQUE,
  family         workout_movement_family NOT NULL REFERENCES movement_families(id),
  is_loaded      boolean NOT NULL DEFAULT true,
  default_unit   text NOT NULL DEFAULT 'lb' CHECK (default_unit IN ('lb', 'kg')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movements_family ON movements (family);

CREATE TRIGGER movements_updated_at
  BEFORE UPDATE ON movements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO movements (canonical_name, slug, family, is_loaded) VALUES
  -- Squat
  ('Back Squat',               'back-squat',               'squat',          true),
  ('Front Squat',              'front-squat',              'squat',          true),
  ('Overhead Squat',           'overhead-squat',           'squat',          true),
  ('Air Squat',                'air-squat',                'squat',          false),
  ('Goblet Squat',             'goblet-squat',             'squat',          true),
  ('Pistol',                   'pistol',                   'squat',          false),
  ('Wall Ball',                'wall-ball',                'squat',          false),
  -- Hinge
  ('Deadlift',                 'deadlift',                 'hinge',          true),
  ('Sumo Deadlift',            'sumo-deadlift',            'hinge',          true),
  ('Romanian Deadlift',        'romanian-deadlift',        'hinge',          true),
  ('Sumo Deadlift High Pull',  'sumo-deadlift-high-pull',  'hinge',          true),
  ('Good Morning',             'good-morning',             'hinge',          true),
  ('Kettlebell Swing',         'kettlebell-swing',         'hinge',          false),
  ('Back Extension',           'back-extension',           'hinge',          false),
  -- Press
  ('Strict Press',             'strict-press',             'press',          true),
  ('Push Press',               'push-press',               'press',          true),
  ('Bench Press',              'bench-press',              'press',          true),
  ('Thruster',                 'thruster',                 'press',          true),
  ('Dumbbell Press',           'dumbbell-press',           'press',          true),
  ('Handstand Push-Up',        'handstand-push-up',        'press',          false),
  ('Push-Up',                  'push-up',                  'press',          false),
  ('Ring Dip',                 'ring-dip',                 'press',          false),
  -- Jerk
  ('Push Jerk',                'push-jerk',                'jerk',           true),
  ('Split Jerk',               'split-jerk',               'jerk',           true),
  -- Pull
  ('Pull-Up',                  'pull-up',                  'pull',           false),
  ('Chest-to-Bar Pull-Up',     'chest-to-bar-pull-up',     'pull',           false),
  ('Strict Pull-Up',           'strict-pull-up',           'pull',           false),
  ('Bent-Over Row',            'bent-over-row',            'pull',           true),
  ('Ring Row',                 'ring-row',                 'pull',           false),
  -- Clean
  ('Clean',                    'clean',                    'clean',          true),
  ('Power Clean',              'power-clean',              'clean',          true),
  ('Hang Power Clean',         'hang-power-clean',         'clean',          true),
  ('Hang Clean',               'hang-clean',               'clean',          true),
  ('Squat Clean',             'squat-clean',               'clean',          true),
  ('Clean and Jerk',           'clean-and-jerk',           'clean',          true),
  -- Snatch
  ('Snatch',                   'snatch',                   'snatch',         true),
  ('Power Snatch',             'power-snatch',             'snatch',         true),
  ('Hang Power Snatch',        'hang-power-snatch',        'snatch',         true),
  ('Hang Snatch',              'hang-snatch',              'snatch',         true),
  ('Squat Snatch',             'squat-snatch',             'snatch',         true),
  -- Lunge
  ('Lunge',                    'lunge',                    'lunge',          false),
  ('Walking Lunge',            'walking-lunge',            'lunge',          false),
  ('Front Rack Lunge',         'front-rack-lunge',         'lunge',          true),
  -- Carry
  ('Farmers Carry',            'farmers-carry',            'carry',          true),
  -- Gymnastics
  ('Muscle-Up',                'muscle-up',                'gymnastics',     false),
  ('Bar Muscle-Up',            'bar-muscle-up',            'gymnastics',     false),
  ('Ring Muscle-Up',           'ring-muscle-up',           'gymnastics',     false),
  ('Toes-to-Bar',              'toes-to-bar',              'gymnastics',     false),
  ('Handstand Walk',           'handstand-walk',           'gymnastics',     false),
  ('Box Jump',                 'box-jump',                 'gymnastics',     false),
  ('Burpee',                   'burpee',                   'gymnastics',     false),
  ('Double-Under',             'double-under',             'gymnastics',     false),
  ('Single-Under',             'single-under',             'gymnastics',     false),
  ('Rope Climb',               'rope-climb',               'gymnastics',     false),
  -- Monostructural
  ('Run',                      'run',                      'monostructural', false),
  ('Row',                      'row',                      'monostructural', false),
  ('Assault Bike',             'assault-bike',             'monostructural', false),
  ('Echo Bike',                'echo-bike',                'monostructural', false),
  ('Bike Erg',                 'bike-erg',                 'monostructural', false),
  ('Ski Erg',                  'ski-erg',                  'monostructural', false),
  ('Swim',                     'swim',                     'monostructural', false),
  -- Core
  ('Plank',                    'plank',                    'core',           false),
  ('Side Plank',               'side-plank',               'core',           false),
  ('Chinese Plank',            'chinese-plank',            'core',           false),
  ('Hollow Hold',              'hollow-hold',              'core',           false),
  ('L-Sit',                    'l-sit',                    'core',           false),
  ('Sit-Up',                   'sit-up',                   'core',           false),
  ('GHD Sit-Up',               'ghd-sit-up',               'core',           false),
  ('V-Up',                     'v-up',                     'core',           false);

-- ============================================================
-- 3. Aliases — raw strings the parser maps to a canonical movement
-- ============================================================
-- alias_norm is the lookup key (lowercased, non-alphanumerics stripped); it is
-- globally unique so the canonicalize step is a single indexed probe. The library
-- self-grows: when the parser meets a movement no alias matches, it inserts the
-- raw spelling here pointing at the (possibly brand-new) canonical movement, so
-- the next time that wording appears it resolves instantly.
CREATE TABLE movement_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  alias_norm  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movement_aliases_movement ON movement_aliases (movement_id);

-- Seed common abbreviations and spellings. alias_norm is computed here the same
-- way canonicalize.ts computes it: lower-case, strip everything but [a-z0-9].
INSERT INTO movement_aliases (movement_id, alias, alias_norm)
SELECT m.id, a.alias, regexp_replace(lower(a.alias), '[^a-z0-9]', '', 'g')
FROM (VALUES
  ('strict-press',        'Shoulder Press'),
  ('strict-press',        'Overhead Press'),
  ('strict-press',        'Military Press'),
  ('strict-press',        'Press'),
  ('strict-press',        'Strict Shoulder Press'),
  ('push-press',          'Push Presses'),
  ('overhead-squat',      'OHS'),
  ('back-squat',          'Back Squats'),
  ('front-squat',         'Front Squats'),
  ('handstand-push-up',   'HSPU'),
  ('handstand-push-up',   'Handstand Pushup'),
  ('handstand-walk',      'HS Walk'),
  ('toes-to-bar',         'T2B'),
  ('toes-to-bar',         'TTB'),
  ('toes-to-bar',         'Toes To Bar'),
  ('chest-to-bar-pull-up','C2B'),
  ('chest-to-bar-pull-up','CTB'),
  ('chest-to-bar-pull-up','Chest to Bar'),
  ('double-under',        'DU'),
  ('double-under',        'Dubs'),
  ('double-under',        'Double Unders'),
  ('single-under',        'Singles'),
  ('pull-up',             'Pullup'),
  ('pull-up',             'Pull Ups'),
  ('power-clean',         'Power Cleans'),
  ('hang-power-clean',    'HPC'),
  ('hang-power-snatch',   'HPS'),
  ('clean-and-jerk',      'C&J'),
  ('clean-and-jerk',      'Clean & Jerk'),
  ('kettlebell-swing',    'KB Swing'),
  ('kettlebell-swing',    'KBS'),
  ('kettlebell-swing',    'Russian Swing'),
  ('kettlebell-swing',    'American Swing'),
  ('wall-ball',           'Wall Balls'),
  ('wall-ball',           'Wall Ball Shot'),
  ('wall-ball',           'WB'),
  ('assault-bike',        'Air Bike'),
  ('assault-bike',        'AB'),
  ('sumo-deadlift-high-pull', 'SDHP'),
  ('muscle-up',           'MU'),
  ('bar-muscle-up',       'BMU'),
  ('ring-muscle-up',      'RMU'),
  ('chinese-plank',       'Chinese Back Plank'),
  ('thruster',            'Thrusters'),
  ('ring-dip',            'Ring Dips'),
  ('ring-dip',            'Dips'),
  ('run',                 'Running'),
  ('row',                 'Rowing'),
  ('romanian-deadlift',   'RDL'),
  ('box-jump',            'Box Jumps'),
  ('burpee',              'Burpees'),
  ('rope-climb',          'Rope Climbs')
) AS a(slug, alias)
JOIN movements m ON m.slug = a.slug;

-- ============================================================
-- 4. Seed cross-movement conversion ratios (typical, approximate)
-- ============================================================
-- Directional: a lifter's `to_movement` e1RM ≈ `from_movement` e1RM × [low, high].
-- Used only as a fallback for sibling estimates until the member has logged both
-- variants, at which point their personal ratio (a per-user table, added in code)
-- takes over. Always rendered as a range with a "typical" basis label.
CREATE TABLE movement_family_ratios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_movement uuid NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  to_movement   uuid NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  ratio_low     numeric(5,3) NOT NULL,
  ratio_high    numeric(5,3) NOT NULL,
  basis         text NOT NULL DEFAULT 'typical',
  UNIQUE (from_movement, to_movement)
);

INSERT INTO movement_family_ratios (from_movement, to_movement, ratio_low, ratio_high)
SELECT mf.id, mt.id, r.lo, r.hi
FROM (VALUES
  -- Press family (base: strict press)
  ('strict-press',  'push-press',       1.150, 1.300),
  ('strict-press',  'push-jerk',        1.300, 1.450),
  ('strict-press',  'split-jerk',       1.350, 1.500),
  ('push-press',    'push-jerk',        1.050, 1.150),
  -- Squat family (base: back squat)
  ('back-squat',    'front-squat',      0.800, 0.880),
  ('back-squat',    'overhead-squat',   0.550, 0.680),
  ('front-squat',   'overhead-squat',   0.680, 0.800),
  -- Hinge family (base: deadlift)
  ('deadlift',      'sumo-deadlift',    0.950, 1.050),
  ('deadlift',      'romanian-deadlift',0.600, 0.720),
  -- Clean family (base: power clean)
  ('power-clean',   'hang-power-clean', 0.850, 0.950),
  ('power-clean',   'squat-clean',      1.100, 1.200),
  ('power-clean',   'clean',            1.100, 1.200),
  ('squat-clean',   'hang-clean',       0.850, 0.950),
  -- Snatch family (base: power snatch)
  ('power-snatch',  'hang-power-snatch',0.850, 0.950),
  ('power-snatch',  'squat-snatch',     1.050, 1.150),
  ('power-snatch',  'snatch',           1.050, 1.150)
) AS r(from_slug, to_slug, lo, hi)
JOIN movements mf ON mf.slug = r.from_slug
JOIN movements mt ON mt.slug = r.to_slug;

-- ============================================================
-- 5. RLS: authenticated read-only; writes only via the service role
-- ============================================================
ALTER TABLE movement_families ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON movement_families FOR SELECT
  TO authenticated USING (true);

ALTER TABLE movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON movements FOR SELECT
  TO authenticated USING (true);

ALTER TABLE movement_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON movement_aliases FOR SELECT
  TO authenticated USING (true);

ALTER TABLE movement_family_ratios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON movement_family_ratios FOR SELECT
  TO authenticated USING (true);
