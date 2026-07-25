-- Reader annotations: one row per marked-up passage.
--
-- Supersedes reading_chats (migration 00166). An annotation has three states,
-- DERIVED rather than stored:
--   note IS NULL and no messages   -> plain highlight   (yellow background)
--   note IS NOT NULL               -> note              (yellow underline)
--   any 'user'/'assistant' message -> chat              (purple; wins the treatment)
-- Promotion happens on THIS row (UPDATE / message insert), never as a second row.
-- That is what keeps two annotations from ever painting the same passage twice,
-- and it is why the old "delete the chat if it's empty" rule had to be tightened:
-- under this model an empty annotation is a legitimate highlight, not garbage.
--
-- Rename-and-extend rather than drop-and-recreate. Production had no rows when
-- this was written, but local dev does, and a chat created between now and merge
-- must survive. Postgres does NOT carry a table's indexes, triggers or
-- constraints across a rename, so the ones worth keeping legible are renamed
-- explicitly. The "Own rows" policies need no change: the name is still right and
-- the USING/WITH CHECK clauses follow the table.
--
-- Anchors (jsonb, v2) address both converted books and saved web articles; see
-- src/lib/reading/annotation-anchors.ts. anchor_char_offset means two different
-- things by design, and anyone adding a consumer must branch on content type:
--   books    -> the conversion character space (convert.ts advance(), the same
--               space as reading_book_pages.char_start/char_end)
--   articles -> a DOM text-stream offset over the rendered container, used ONLY
--               for reading-order sorting. Articles have no page map, so it is
--               never resolved to a page and never used to cut spoiler context.

-- ============================================================
-- 1. Rename the table and its dependents
-- ============================================================
ALTER TABLE reading_chats          RENAME TO reading_annotations;
ALTER TABLE reading_chat_messages  RENAME TO reading_annotation_messages;

ALTER TABLE reading_annotation_messages RENAME COLUMN chat_id TO annotation_id;
ALTER TABLE reading_annotations RENAME COLUMN forked_from_chat_id
                                  TO forked_from_annotation_id;

ALTER INDEX idx_reading_chats_book
  RENAME TO idx_reading_annotations_book;
ALTER INDEX idx_reading_chat_messages_chat
  RENAME TO idx_reading_annotation_messages_annotation;
ALTER TRIGGER reading_chats_updated_at ON reading_annotations
  RENAME TO reading_annotations_updated_at;

-- ============================================================
-- 2. The two new columns
-- ============================================================
-- The reader's own words about this passage. NULL = a plain highlight (or a
-- chat-only annotation). Deliberately distinct from the 'notice' message role
-- below, which is app-authored thread furniture, not the reader's writing.
ALTER TABLE reading_annotations ADD COLUMN note text;

-- Yellow is the only colour shipping; the column exists so adding more later is
-- a UI change rather than a migration. Widen the CHECK when that day comes.
ALTER TABLE reading_annotations
  ADD COLUMN color text NOT NULL DEFAULT 'yellow'
  CHECK (color IN ('yellow'));

-- ============================================================
-- 3. Free the word "note" for the reader
-- ============================================================
-- role 'note' has always meant an APP-authored line in the thread (e.g. "answered
-- with the Deep model because this book is too long for Fast") and is never sent
-- to the model. With reader-authored notes arriving, that name is ambiguous, so
-- the system line becomes 'notice' and the good name goes to the product concept.
UPDATE reading_annotation_messages SET role = 'notice' WHERE role = 'note';

ALTER TABLE reading_annotation_messages
  DROP CONSTRAINT reading_chat_messages_role_check;
ALTER TABLE reading_annotation_messages
  ADD CONSTRAINT reading_annotation_messages_role_check
  CHECK (role IN ('user', 'assistant', 'notice'));

-- ============================================================
-- 4. Reading-order index
-- ============================================================
-- The annotations list and the gutter both want "every annotation in this book,
-- in reading order". idx_reading_annotations_book covers the filter; this covers
-- the sort with it.
CREATE INDEX idx_reading_annotations_order
  ON reading_annotations (book_id, user_id, anchor_char_offset);
