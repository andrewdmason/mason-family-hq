-- A name for every conversation in the margin.
--
-- Generated from the reader's opening question the moment a thread starts, and
-- refreshed as the conversation moves, so the notepad can show "Why the maestro
-- is late" where it used to show a pill that said "Ask". On the THREAD rather
-- than the placement: a title is a fact about the conversation, and a shared
-- thread has a placement per person (00180) that must all say the same name.
-- Any participant may rename it, under the update policy from 00183.
--
-- `title_pinned` is set when a reader writes the title themselves. The
-- generator leaves a pinned title alone forever; clearing the field unpins it.

ALTER TABLE reading_annotation_threads
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS title_pinned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN reading_annotation_threads.title IS
  'The conversation''s name, generated from its opening and refreshed as it moves. Null until generated.';
COMMENT ON COLUMN reading_annotation_threads.title_pinned IS
  'A reader wrote this title; the generator never replaces a pinned one.';

NOTIFY pgrst, 'reload schema';
