-- Uploaded book files + the Kindle-like reading experience.
--
-- A member can upload a PDF/EPUB to one of their books; we convert it server-
-- side into reflowable HTML with <span id="page-N"> anchors at every page
-- boundary, so the reader can show "Page X of Y" and future comprehension
-- quizzes can scope to a page range. Mirrors the reading app's per-user own-rows
-- RLS (see 00073). Storage/RLS pattern copied from journal-photos (00043).

-- ============================================================
-- 1. Private bucket for source files + converted content
-- ============================================================
-- Path convention:
--   {user_id}/{book_id}/source.{pdf|epub}
--   {user_id}/{book_id}/content.html
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reading-books',
  'reading-books',
  false,
  100 * 1024 * 1024,
  ARRAY[
    'application/pdf',
    'application/epub+zip',
    'application/octet-stream',
    'text/html'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "reading-books owner select" ON storage.objects;
DROP POLICY IF EXISTS "reading-books owner insert" ON storage.objects;
DROP POLICY IF EXISTS "reading-books owner update" ON storage.objects;
DROP POLICY IF EXISTS "reading-books owner delete" ON storage.objects;

CREATE POLICY "reading-books owner select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'reading-books'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-books owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'reading-books'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-books owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'reading-books'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-books owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'reading-books'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 2. Converted content + processing status (1:1 with a book)
-- ============================================================
-- Kept off reading_books so the hot reading-home query stays lean and content
-- has its own upload/convert lifecycle. The reflowed HTML lives in storage
-- (content_path); only metadata lives here.
CREATE TABLE reading_book_content (
  book_id        uuid PRIMARY KEY REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_format  text NOT NULL CHECK (source_format IN ('pdf', 'epub')),
  source_path    text NOT NULL,
  content_path   text,
  status         text NOT NULL DEFAULT 'uploaded'
                   CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  error_message  text,
  page_count     int,
  -- TRUE  = real page numbers (PDF pages, or EPUB with a page-list).
  -- FALSE = no source pagination; the reader falls back to % progress.
  has_real_pages boolean NOT NULL DEFAULT false,
  char_count     int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER reading_book_content_updated_at
  BEFORE UPDATE ON reading_book_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_book_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_book_content FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 3. Page map: original page number -> anchor + char range
-- ============================================================
-- One row per source page. char_start/char_end give the cumulative character
-- range of each page in the reflowed text — the substrate for future "quiz me
-- up to page N" features (resolve the char range, slice the content).
CREATE TABLE reading_book_pages (
  book_id     uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_number int NOT NULL,
  anchor_id   text NOT NULL,
  char_start  int NOT NULL,
  char_end    int,
  PRIMARY KEY (book_id, page_number)
);

CREATE INDEX idx_reading_book_pages_book ON reading_book_pages (book_id, page_number);

ALTER TABLE reading_book_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_book_pages FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4. Per-book reading state (resume position)
-- ============================================================
-- Deliberately separate from reading_books.current_page: the reader persists
-- where you left off WITHOUT touching the manual check-in progress. A later
-- feature can copy last_page_number into a check-in to auto-track progress.
CREATE TABLE reading_book_state (
  book_id           uuid PRIMARY KEY REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_anchor_id    text,
  last_scroll_ratio real,
  last_page_number  int,
  last_read_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER reading_book_state_updated_at
  BEFORE UPDATE ON reading_book_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_book_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_book_state FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
