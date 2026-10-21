-- Music Minus One: play along with recordings whose instruments are separate,
-- time-aligned tracks (the clarinet, cello and piano parts of a trio), muting
-- your own part. Andrew's native iOS app for now.
--
-- One row per song. The phone is the source of truth and works offline; it
-- sends a song's whole state when it changes (last write wins on updated_at,
-- which the phone sets). Tracks and markers ride along as JSON:
--   tracks:  [{id, name, file, uploaded, enabled, volume, pan}]
--   markers: [{id, time, measure}]   time in seconds into the recording
-- A deleted song keeps its row with deleted_at set, so other devices drop it.
--
-- Each person's songs are their own.

CREATE TABLE IF NOT EXISTS music_songs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Composer or performer, optional.
  artist text,
  -- The album or work it's part of (a trio, for its movements), and its
  -- place there. Both optional.
  album text,
  album_number integer,
  -- The recording's tempo at 1.0x, entered by hand.
  tempo_bpm double precision NOT NULL DEFAULT 120 CHECK (tempo_bpm > 0),
  -- Playback speed (pitch kept) and overall volume, remembered per song.
  speed double precision NOT NULL DEFAULT 1,
  volume double precision NOT NULL DEFAULT 1,
  tracks jsonb NOT NULL DEFAULT '[]',
  markers jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS music_songs_owner_idx ON music_songs (owner_id);

ALTER TABLE music_songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own music songs" ON music_songs;
CREATE POLICY "Own music songs" ON music_songs FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- The track audio, as imported (WAV, AIFF, M4A, MP3…). Paths:
-- {owner_id}/{song_id}/{file}, where file is the track's own file name.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('music-minus-one', 'music-minus-one', false, 524288000)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "music-minus-one own select" ON storage.objects;
DROP POLICY IF EXISTS "music-minus-one own insert" ON storage.objects;
DROP POLICY IF EXISTS "music-minus-one own update" ON storage.objects;
DROP POLICY IF EXISTS "music-minus-one own delete" ON storage.objects;
CREATE POLICY "music-minus-one own select" ON storage.objects FOR SELECT
  USING (bucket_id = 'music-minus-one' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "music-minus-one own insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'music-minus-one' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "music-minus-one own update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'music-minus-one' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "music-minus-one own delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'music-minus-one' AND (storage.foldername(name))[1] = auth.uid()::text);
