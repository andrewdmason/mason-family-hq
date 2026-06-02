-- Reading: richer book statuses + a cover image.
--
-- The first cut had only 'reading'/'finished'. Books now move through a fuller
-- lifecycle (in progress, completed, paused, archived) plus a "queued" list for
-- things to read later. Cover images are pulled when a book is added.

-- Migrate existing rows to the new vocabulary before swapping the constraint.
UPDATE reading_books SET status = 'in_progress' WHERE status = 'reading';
UPDATE reading_books SET status = 'completed'   WHERE status = 'finished';

ALTER TABLE reading_books DROP CONSTRAINT reading_books_status_check;
ALTER TABLE reading_books ALTER COLUMN status SET DEFAULT 'in_progress';
ALTER TABLE reading_books ADD CONSTRAINT reading_books_status_check
  CHECK (status IN ('in_progress', 'completed', 'paused', 'archived', 'queued'));

ALTER TABLE reading_books ADD COLUMN cover_image_url text;
