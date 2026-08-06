-- ============================================================
-- Notes become entries in the thread
-- ============================================================
-- A note used to be a single text column on the annotation: one per passage,
-- overwritten by the next thought, and written in a box that sat above the
-- conversation rather than in it. It becomes a message role instead, which buys
-- three things the column could not: more than one note per passage, notes and
-- questions interleaved in the order you actually had them, and one composer at
-- the bottom of the panel instead of two text fields with no visible difference.
--
-- Migration 00167 renamed the app-authored role to 'notice' precisely to free
-- this word for the reader. This is that.

ALTER TABLE reading_annotation_messages
  DROP CONSTRAINT reading_annotation_messages_role_check;

ALTER TABLE reading_annotation_messages
  ADD CONSTRAINT reading_annotation_messages_role_check
  CHECK (role IN ('user', 'assistant', 'notice', 'note'));

-- Every note ever written moves into the thread, dated to the annotation that
-- carried it so it sorts to the top of its own conversation. Whitespace-only
-- notes are dropped rather than migrated: they were never content.
INSERT INTO reading_annotation_messages (annotation_id, user_id, role, content, created_at)
SELECT id, user_id, 'note', btrim(note), created_at
FROM reading_annotations
WHERE note IS NOT NULL AND btrim(note) <> '';

-- reading_annotations.note is deliberately left in place and left populated.
-- Nothing reads it after this migration — the rows above are the live copy — but
-- keeping it costs nothing and makes the move reversible for as long as anyone
-- might want to reverse it.
COMMENT ON COLUMN reading_annotations.note IS
  'Superseded by role=''note'' rows in reading_annotation_messages (migration 00172). Retained as a backup of the pre-migration state; not read by the app.';
