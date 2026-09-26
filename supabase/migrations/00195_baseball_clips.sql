-- Baseball Clips: at-bat videos from the stands, each with a marker per pitch.
--
-- A game (kid + name + date) holds at-bats; one uploaded video is exactly one
-- at-bat. The original iPhone file is kept as-is; the clips worker makes a
-- seek-friendly playback copy (short keyframe interval, so frame-stepping and
-- scrubbing are instant) plus a poster frame. Pitches are single markers at the
-- moment the ball reaches the plate, labeled swing/take and contact/miss; the
-- terminal pitch is simply the last one. Exports are rendered "quick versions"
-- (an at-bat, or a whole game's reel) for sharing with the hitting coach.
--
-- Everyone in the family — kids included — can watch, upload, mark and export,
-- so every table carries the family-wide policy the baseball stats tables use.

CREATE TABLE IF NOT EXISTS clip_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id uuid NOT NULL REFERENCES baseball_people(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  played_on date NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clip_games_kid_played_idx ON clip_games (kid_id, played_on DESC);

CREATE TABLE IF NOT EXISTS clip_at_bats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES clip_games(id) ON DELETE CASCADE,
  -- uploading → processing (worker making the playback copy) → ready | failed.
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  error_message text,
  original_path text NOT NULL,
  original_name text,
  original_bytes bigint,
  -- Filled by the worker. playback_path is null until the copy exists; the
  -- player falls back to the original meanwhile.
  playback_path text,
  poster_path text,
  duration_s double precision,
  fps double precision,
  width integer,
  height integer,
  codec text,
  -- When the phone recorded it (from the file's metadata) — orders a game's
  -- at-bats even when they're uploaded in several batches.
  recorded_at timestamptz,
  result text CHECK (result IN (
    'K', 'KL', 'BB', 'HBP', '1B', '2B', '3B', 'HR', 'GO', 'FO', 'LO', 'ROE'
  )),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clip_at_bats_game_idx ON clip_at_bats (game_id);

CREATE TABLE IF NOT EXISTS clip_pitches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at_bat_id uuid NOT NULL REFERENCES clip_at_bats(id) ON DELETE CASCADE,
  -- Seconds into the original video: the moment the ball reaches the plate
  -- (mitt, past the catcher, or bat on ball).
  t double precision NOT NULL CHECK (t >= 0),
  swing boolean NOT NULL DEFAULT false,
  contact boolean NOT NULL DEFAULT false,
  -- 'auto' is reserved for the detection pass that comes later.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clip_pitches_at_bat_idx ON clip_pitches (at_bat_id, t);

CREATE TABLE IF NOT EXISTS clip_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at_bat_id uuid REFERENCES clip_at_bats(id) ON DELETE CASCADE,
  game_id uuid REFERENCES clip_games(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'rendering'
    CHECK (status IN ('rendering', 'ready', 'failed')),
  error_message text,
  path text,
  -- The rendered segment list, as sent to the worker (for debugging/tuning).
  plan jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((at_bat_id IS NULL) <> (game_id IS NULL))
);

ALTER TABLE clip_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_at_bats ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family manages clip games" ON clip_games;
CREATE POLICY "Family manages clip games" ON clip_games FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Family manages clip at-bats" ON clip_at_bats;
CREATE POLICY "Family manages clip at-bats" ON clip_at_bats FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Family manages clip pitches" ON clip_pitches;
CREATE POLICY "Family manages clip pitches" ON clip_pitches FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Family manages clip exports" ON clip_exports;
CREATE POLICY "Family manages clip exports" ON clip_exports FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Originals (up to ~1.5GB for a long 4K/60 at-bat), playback copies, posters
-- and exports. Paths: {game_id}/{at_bat_id}/original.<ext> | playback.mp4 |
-- poster.jpg, and exports/{export_id}.mp4. The hosted project's global upload
-- limit must be at least this bucket's limit for big originals to go through.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('baseball-clips', 'baseball-clips', false, 2147483648)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "baseball-clips family select" ON storage.objects;
DROP POLICY IF EXISTS "baseball-clips family insert" ON storage.objects;
DROP POLICY IF EXISTS "baseball-clips family update" ON storage.objects;
DROP POLICY IF EXISTS "baseball-clips family delete" ON storage.objects;
CREATE POLICY "baseball-clips family select" ON storage.objects FOR SELECT
  USING (bucket_id = 'baseball-clips' AND auth.uid() IS NOT NULL);
CREATE POLICY "baseball-clips family insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'baseball-clips' AND auth.uid() IS NOT NULL);
CREATE POLICY "baseball-clips family update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'baseball-clips' AND auth.uid() IS NOT NULL);
CREATE POLICY "baseball-clips family delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'baseball-clips' AND auth.uid() IS NOT NULL);
