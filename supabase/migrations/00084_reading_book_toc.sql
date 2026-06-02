-- Table of contents for an uploaded book: an ordered list of
-- { title, anchorId, level, page } extracted during conversion (from PDF
-- heading detection or EPUB headings). Stored as JSON on the content row since
-- the reader loads it whole for its "Contents" navigation — it's never queried
-- by range the way reading_book_pages is.
ALTER TABLE reading_book_content ADD COLUMN toc jsonb NOT NULL DEFAULT '[]'::jsonb;
