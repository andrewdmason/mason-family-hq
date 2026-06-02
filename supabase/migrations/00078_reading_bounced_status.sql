-- Repurpose the "archived" book status as "bounced" — books the reader started
-- but didn't finish. Abandoning a book is a meaningful taste signal (a soft "not
-- for me"), so the recommender treats bounced titles as something to steer away
-- from, distinct from a low rating on a book that was actually finished.
--
-- status is a text column with a CHECK constraint (see 00074), so this is just a
-- data migration + constraint swap — no enum surgery.

UPDATE reading_books SET status = 'bounced' WHERE status = 'archived';

ALTER TABLE reading_books DROP CONSTRAINT reading_books_status_check;
ALTER TABLE reading_books ADD CONSTRAINT reading_books_status_check
  CHECK (status IN ('in_progress', 'completed', 'paused', 'bounced', 'queued'));
