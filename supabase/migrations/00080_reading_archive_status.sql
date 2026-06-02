-- Collapse "completed" and the old "bounced" status into a single "archive"
-- status: the shelf of books you're done with, finished or not. Your verdict now
-- lives entirely in the rating — books you abandoned ('bounced') carry the new
-- 'didnt_finish' rating (added in 00079); finished books keep their emoji rating.
-- This removes the "completed but didn't finish" contradiction.

UPDATE reading_books SET rating = 'didnt_finish' WHERE status = 'bounced';
UPDATE reading_books SET status = 'archive' WHERE status IN ('completed', 'bounced');

ALTER TABLE reading_books DROP CONSTRAINT reading_books_status_check;
ALTER TABLE reading_books ADD CONSTRAINT reading_books_status_check
  CHECK (status IN ('in_progress', 'archive', 'paused', 'queued'));
