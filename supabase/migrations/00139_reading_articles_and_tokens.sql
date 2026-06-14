-- Web articles as a content type in the reader + personal API tokens for the
-- Chrome extension that saves them (/api/reading/ingest).
--
-- The reader was book-only (PDF/EPUB upload -> reflowable HTML). This adds a
-- `type` discriminator to reading_books and the article-specific metadata the
-- list/card needs, reusing the existing reading_book_content + reading-books
-- storage bucket to hold the cleaned article HTML (source_format = 'article',
-- status = 'ready' immediately — no server-side conversion step).
--
-- Tokens mirror todo_api_tokens (00131): the raw token is shown once, only its
-- SHA-256 hex digest is stored, and the ingest route verifies with the service-
-- role client. The policy below lets members manage their own tokens' metadata
-- from the reader settings page.

-- ============================================================
-- 1. Article columns on reading_books
-- ============================================================
ALTER TABLE reading_books
  ADD COLUMN type       text NOT NULL DEFAULT 'book'
               CHECK (type IN ('book', 'article')),
  ADD COLUMN source_url text,   -- canonical URL of the saved article
  ADD COLUMN site_name  text,   -- e.g. "The New Yorker"
  ADD COLUMN excerpt    text,   -- short readability excerpt for the card
  ADD COLUMN word_count int;    -- drives the "N min read" estimate

-- One saved article per URL per user; re-saving updates in place. Partial so it
-- never constrains books (which have a NULL source_url).
CREATE UNIQUE INDEX idx_reading_books_user_source_url
  ON reading_books (user_id, source_url)
  WHERE type = 'article';

-- ============================================================
-- 2. Allow 'article' as a content source format
-- ============================================================
ALTER TABLE reading_book_content
  DROP CONSTRAINT reading_book_content_source_format_check;
ALTER TABLE reading_book_content
  ADD CONSTRAINT reading_book_content_source_format_check
    CHECK (source_format IN ('pdf', 'epub', 'article'));

-- ============================================================
-- 3. Personal API tokens for the reading ingest endpoint
-- ============================================================
CREATE TABLE reading_api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email text NOT NULL REFERENCES family_members(email)
                 ON UPDATE CASCADE ON DELETE CASCADE,
  name         text NOT NULL,            -- e.g. "Chrome — MacBook"
  token_hash   text NOT NULL UNIQUE,     -- hex sha256 of the raw token
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

ALTER TABLE reading_api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own tokens" ON reading_api_tokens FOR ALL
  USING (EXISTS (
    SELECT 1 FROM family_members m
    WHERE m.user_id = auth.uid() AND m.email = reading_api_tokens.member_email
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM family_members m
    WHERE m.user_id = auth.uid() AND m.email = reading_api_tokens.member_email
  ));
