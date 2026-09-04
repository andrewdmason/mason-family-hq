-- ============================================================
-- Plain English: the book, paragraph for paragraph, without the ornament
-- ============================================================
-- Some nonfiction is written so ornately that the reader spends their effort
-- decoding sentences rather than weighing ideas. A summary is the wrong relief —
-- it compresses, and the reader wants every idea at the author's granularity.
-- So the book is TRANSLATED: one plain paragraph per original paragraph, same
-- length, same person and tense, ornament removed. The original is one tap away.
--
-- Everything here is keyed by reading_book_content.content_hash, not by book.
-- Every family member holds their own copy of a book and its own converted
-- file, and a translation is a per-paragraph map into one particular
-- conversion. Two copies with the same hash have byte-identical block indices
-- (see 00182), so one translation serves them both; a copy from a different
-- file does not share paragraph boundaries and is simply untranslated.
--
-- The block index is the coordinate. Nothing about position, progress, anchors
-- or the spoiler boundary ever sees plain text — the original block map stays
-- the character space, and the plain face is a rendered substitution.

-- ============================================================
-- 1. Chapters: the unit of generation, and the claim that stops double-paying
-- ============================================================
-- Rows are DERIVED once per hash from the table of contents with the audio
-- planner's merge/split rules (audio/chapters.ts), so "chapter 4 of 21" means
-- the same thing here as in Listen.
--
--   pending   - planned, not started
--   preparing - a live request holds this row (claimed by a conditional UPDATE;
--               two readers enabling at once produce exactly one translation)
--   batched   - submitted in a Message Batch; batch_id says which
--   ready     - every block in the chapter is stored
--   failed    - error_message says why; the reader can retry from the marker
CREATE TABLE IF NOT EXISTS reading_plain_chapters (
  content_hash   text NOT NULL,
  chapter_index  int  NOT NULL,
  title          text NOT NULL,
  -- The heading's sec-N id, when the chapter starts at one. Null for the
  -- even slices an unchaptered book is cut into.
  anchor_id      text,
  -- Half-open block range and the matching half-open char range.
  block_start    int  NOT NULL,
  block_end      int  NOT NULL,
  char_start     int  NOT NULL,
  char_end       int  NOT NULL,

  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'preparing', 'batched', 'ready', 'failed')),
  attempts       int  NOT NULL DEFAULT 0,
  batch_id       text,
  -- Set when a batch result came back errored or refused: the next live
  -- prepare goes straight to the fallback model instead of retrying Fable.
  fallback_next  boolean NOT NULL DEFAULT false,
  model_used     text,
  -- Actual usage, summed over the chapter's chunks and reruns. This is what
  -- calibrates the cost estimate shown before a whole-book run.
  input_tokens   int,
  output_tokens  int,
  error_message  text,
  claimed_at     timestamptz,
  ready_at       timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_hash, chapter_index)
);

CREATE INDEX IF NOT EXISTS idx_reading_plain_chapters_batch
  ON reading_plain_chapters (batch_id) WHERE batch_id IS NOT NULL;

DROP TRIGGER IF EXISTS reading_plain_chapters_updated_at ON reading_plain_chapters;
CREATE TRIGGER reading_plain_chapters_updated_at
  BEFORE UPDATE ON reading_plain_chapters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Blocks: one row per translated paragraph
-- ============================================================
-- `kept` marks a paragraph the translator left alone on purpose — a quotation
-- of another writer, verse, an epigraph. Its text is NULL: the reader shows the
-- original slice, and the model never has to echo a long passage byte-for-byte.
CREATE TABLE IF NOT EXISTS reading_plain_blocks (
  content_hash   text NOT NULL,
  block_index    int  NOT NULL,
  chapter_index  int  NOT NULL,
  kept           boolean NOT NULL DEFAULT false,
  text           text,
  model          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_hash, block_index)
);

CREATE INDEX IF NOT EXISTS idx_reading_plain_blocks_chapter
  ON reading_plain_blocks (content_hash, chapter_index);

COMMENT ON COLUMN reading_plain_blocks.kept IS
  'True when the translator kept the original paragraph (quotation, verse, epigraph). text is NULL and the reader renders the original.';

-- ============================================================
-- 3. Terms: the words the translator deliberately left in the original
-- ============================================================
-- Returned by the same pass that decided to keep them, with a definition
-- grounded in this book. first_chapter_index gates where the underline may
-- appear: a term defined by chapter 20's pass must not be glossed in chapter 2.
CREATE TABLE IF NOT EXISTS reading_plain_terms (
  content_hash        text NOT NULL,
  term_key            text NOT NULL,
  term                text NOT NULL,
  definition          text NOT NULL,
  first_chapter_index int  NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_hash, term_key)
);

DROP TRIGGER IF EXISTS reading_plain_terms_updated_at ON reading_plain_terms;
CREATE TRIGGER reading_plain_terms_updated_at
  BEFORE UPDATE ON reading_plain_terms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. Peeks: a short-lived claim for on-demand paragraph translation
-- ============================================================
-- Selecting a passage in an untranslated book and asking for Plain English
-- translates just those paragraphs. Two identical requests in flight (a slow
-- connection and a second tap) would pay twice; this row is what makes the
-- second one wait for the first.
CREATE TABLE IF NOT EXISTS reading_plain_peeks (
  content_hash text NOT NULL,
  block_start  int  NOT NULL,
  block_end    int  NOT NULL,
  claimed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_hash, block_start, block_end)
);

-- ============================================================
-- 5. Who may read a translation
-- ============================================================
-- Anyone who owns a copy of the book with that hash. The predicate lives in a
-- SECURITY DEFINER function for the same reason as 00183: it reads other
-- tables from inside a policy, and pinning search_path is what makes that safe.
-- Nobody writes from the client: generation runs on the server with the admin
-- client after the caller has been checked against their own book row.
CREATE OR REPLACE FUNCTION reading_owns_content_hash(h text, u uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM reading_book_content c
    WHERE c.content_hash = h AND c.user_id = u
  );
$$;

REVOKE ALL ON FUNCTION reading_owns_content_hash(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reading_owns_content_hash(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION reading_owns_content_hash(text, uuid) TO authenticated;

ALTER TABLE reading_plain_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_plain_blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_plain_terms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_plain_peeks    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner of a copy reads" ON reading_plain_chapters;
CREATE POLICY "Owner of a copy reads" ON reading_plain_chapters FOR SELECT
  USING (reading_owns_content_hash(content_hash, auth.uid()));

DROP POLICY IF EXISTS "Owner of a copy reads" ON reading_plain_blocks;
CREATE POLICY "Owner of a copy reads" ON reading_plain_blocks FOR SELECT
  USING (reading_owns_content_hash(content_hash, auth.uid()));

DROP POLICY IF EXISTS "Owner of a copy reads" ON reading_plain_terms;
CREATE POLICY "Owner of a copy reads" ON reading_plain_terms FOR SELECT
  USING (reading_owns_content_hash(content_hash, auth.uid()));

-- Peeks are server bookkeeping only: RLS on with no policies is a deny.

-- ============================================================
-- 6. The reader's own face, and the plain sentence behind a mark
-- ============================================================
-- Per reader, per book. The translation is the family's; which face you read
-- in is yours. Text rather than an enum so a future 'side_by_side' is a data
-- change, but CHECKed so a stray value cannot reach the renderer.
ALTER TABLE reading_book_state
  ADD COLUMN IF NOT EXISTS reading_face text NOT NULL DEFAULT 'original';

DO $$
BEGIN
  ALTER TABLE reading_book_state
    ADD CONSTRAINT reading_book_state_reading_face_check
    CHECK (reading_face IN ('original', 'plain'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN reading_book_state.reading_face IS
  'Which face this reader sees this book in: original or plain. The translation itself is shared by content_hash.';

-- A mark made in the plain face keeps the AUTHOR's paragraph as quoted_text —
-- that is what relocation, read-back and shares search for — and the plain
-- sentence the reader actually selected here, shown beneath it.
ALTER TABLE reading_annotations
  ADD COLUMN IF NOT EXISTS plain_quoted_text text;

COMMENT ON COLUMN reading_annotations.plain_quoted_text IS
  'The plain-English sentence the reader selected when the mark was made in the plain face. quoted_text always holds the original paragraph.';

-- ============================================================
-- 7. The sweep that finishes a batch nobody is watching
-- ============================================================
-- Most of a book is translated as a Message Batch, which can take hours. While
-- someone is reading in plain mode the reader polls and ingests results itself;
-- this is the backstop for the batch that finishes overnight, so the book is
-- ready before anyone opens it. Same shape and the same Vault secrets as the
-- annotation email sweep in 00184.
DO $outer$
DECLARE
  app_url     text;
  cron_secret text;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  SELECT decrypted_secret INTO app_url
    FROM vault.decrypted_secrets WHERE name = 'reading_notify_app_url';
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'reading_notify_cron_secret';

  IF app_url IS NULL OR cron_secret IS NULL THEN
    RAISE NOTICE 'reading_notify Vault secrets not set; skipping plain-english cron schedule';
  ELSE
    PERFORM cron.unschedule('reading-plain-reconcile')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reading-plain-reconcile');
    PERFORM cron.schedule(
      'reading-plain-reconcile',
      '*/10 * * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'reading_notify_app_url') || '/api/cron/reading-plain-reconcile',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'reading_notify_cron_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
    RAISE NOTICE 'plain english reconcile job scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net/Vault not available (expected in local dev): %', SQLERRM;
END $outer$;
