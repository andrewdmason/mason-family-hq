-- Starring a mark: the reader saying "come back to this one".
--
-- The marks panel is the retrieval surface for a book, and it works until a
-- book has a few dozen marks in it — at which point reading order stops being
-- useful, because the reader is no longer walking the book, they are looking
-- for the ten passages that mattered. Nothing today can say one mark matters
-- more than another.
--
-- A star is a fact about a READER, not about a mark, and this column can be a
-- plain boolean only because of the split in 00180: the two people in a shared
-- conversation hold two rows on one thread, one placement each. So starring a
-- passage somebody showed you writes to YOUR row and is invisible on theirs,
-- with no extra table and no extra policy. The existing "Own rows" FOR ALL
-- already says a reader may write only their own placement, and 00183's
-- participant access is a SELECT, so it cannot leak a write.
--
-- The other half of that privacy guarantee lives in share-placement.ts, which
-- builds a recipient's placement by naming its columns explicitly — a new
-- column is simply not among them, so a star never travels with a share. That
-- is load-bearing and invisible, hence this note.
--
-- Three things read it: the gutter (a starred highlight of your own gets a
-- margin marker, which no other highlight of your own does — see
-- gutter-placement.ts), the marks panel's starred-only filter, and
-- getReaderMarks, where a starred mark is exempt from the prompt's character
-- budget. It is meaningless on book_scope rows (prefaces and afterwords), which
-- are filtered out of all three surfaces on purpose.
--
-- Idempotent throughout: one local Supabase instance is shared across Conductor
-- workspaces, so a migration can be re-applied against a database that already
-- has it.

ALTER TABLE reading_annotations
  ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN reading_annotations.starred IS
  'This reader kept this passage. Per-placement and therefore per-person: the '
  'other participant in a shared thread has their own row and their own answer, '
  'and neither can see the other''s. Read by the marks panel filter, the gutter, '
  'and getReaderMarks (starred marks are exempt from the prompt char budget). '
  'Meaningless on book_scope rows, which never reach any of those surfaces.';

-- No index on purpose. Every read of this column already sits inside a query
-- bounded by (book_id, user_id), which idx_reading_annotations_order covers, and
-- the panel's filter runs in the browser over marks that are already in memory.
-- A partial index would only pay off for a cross-book "everything I starred"
-- query, which does not exist yet; add it with the feature that needs it.

NOTIFY pgrst, 'reload schema';
