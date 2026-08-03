-- Listening to a book: text-to-speech narration, one chapter at a time.
--
-- The unit of work is a CHAPTER, never a book. Voicing a whole novel costs real
-- money (tens of dollars), so nothing is ever synthesized that the reader hasn't
-- asked to hear: pressing play prepares the chapter you are in and, once that is
-- playing, the one after it. Abandon a book at chapter three and you have paid
-- for three chapters.
--
-- Everything here lives in the conversion CHARACTER SPACE — the same space as
-- reading_book_pages.char_start/char_end, reading_annotations.anchor_char_offset
-- and reading_book_state.last_char_offset. That is the whole design: a spoken
-- position and a read position are the same number, so listening and reading are
-- one position rather than two that have to be reconciled. See block-stream.ts.

-- ============================================================
-- 1. The voice a book is narrated in
-- ============================================================
-- Locked per book rather than per playback. Once chapters 1-6 exist in one
-- voice, switching narrators mid-book either sounds broken or means paying for
-- everything again — so the choice is made once, on first play, and re-voicing
-- is a deliberate act that discards the existing audio.
--
-- NULL means "not chosen yet"; the first prepare stamps it from the app default.
ALTER TABLE reading_books ADD COLUMN audio_voice_id text;

-- ============================================================
-- 2. Chapters
-- ============================================================
-- Rows are DERIVED, not authored: plan.ts walks the book's table of contents and
-- writes one row per chapter (splitting any chapter too long to synthesize in a
-- single request into parts). The derivation is idempotent and keyed by
-- content_version, so a re-conversion of the book rebuilds the plan rather than
-- leaving chapters pointing at character ranges that have moved.
CREATE TABLE reading_audio_chapters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Position in the book, 0-based. Stable for a given content_version.
  chapter_index  int NOT NULL,
  title          text NOT NULL,

  -- Half-open range in the conversion char space. Everything the player knows
  -- about where it is comes back to these two numbers.
  char_start     int NOT NULL,
  char_end       int NOT NULL,

  -- reading_book_content.updated_at at the time the plan was derived. A book
  -- re-converted after this was written has a different character space, so any
  -- audio recorded against it is stale and the plan is rebuilt from scratch.
  content_version text NOT NULL,

  -- pending   - planned, never synthesized
  -- preparing - a prepare request holds this row (claimed by a conditional
  --             UPDATE, which is what stops two tabs from paying twice for the
  --             same chapter)
  -- ready     - audio_path and timings_path are populated and playable
  -- failed    - error_message says why; retrying is just another prepare
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'preparing', 'ready', 'failed')),

  -- What actually produced the audio, recorded so a chapter voiced under an
  -- older default is identifiable rather than silently mixed in.
  voice_id       text,
  model          text,

  -- {user_id}/{book_id}/ch{index}.mp3 and .timings.json in the reading-audio
  -- bucket. Served through a same-origin proxy route, never a raw signed URL —
  -- see the content route for why that matters for caching and offline.
  audio_path     text,
  timings_path   text,

  duration_ms    int,

  -- Characters actually sent to the narration API, which is what ElevenLabs
  -- bills on. Summed across rows for the "spend this month" readout — there is
  -- no separate ledger because a chapter is synthesized exactly once.
  billed_chars   int,

  error_message  text,
  -- When the row last entered `preparing`, so a request that died mid-flight
  -- (a function timeout, a deploy) can be re-claimed instead of wedging the
  -- chapter in `preparing` forever.
  claimed_at     timestamptz,
  prepared_at    timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_reading_audio_chapters_book_index
  ON reading_audio_chapters (book_id, chapter_index);

CREATE INDEX idx_reading_audio_chapters_user
  ON reading_audio_chapters (user_id, prepared_at);

CREATE TRIGGER reading_audio_chapters_updated_at
  BEFORE UPDATE ON reading_audio_chapters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_audio_chapters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_audio_chapters FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 3. Storage
-- ============================================================
-- Per-user own-rows storage RLS, the same {user_id}/… path convention as
-- reading-books (00083). Audio is bulky — a chapter is 20-40MB — so the limit is
-- generous, but a single chapter is bounded by MAX_CHAPTER_CHARS on the way in.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reading-audio',
  'reading-audio',
  false,
  200 * 1024 * 1024,
  ARRAY['audio/mpeg', 'application/json']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "reading-audio owner select" ON storage.objects;
DROP POLICY IF EXISTS "reading-audio owner insert" ON storage.objects;
DROP POLICY IF EXISTS "reading-audio owner update" ON storage.objects;
DROP POLICY IF EXISTS "reading-audio owner delete" ON storage.objects;

CREATE POLICY "reading-audio owner select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'reading-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-audio owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'reading-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-audio owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'reading-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-audio owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'reading-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
