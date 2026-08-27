-- ============================================================
-- The compatibility column goes
-- ============================================================
-- reading_annotation_messages.annotation_id survived migration 00180 for one
-- reason: the database migrates before the code deploys, and in that window the
-- running app still wrote messages keyed by mark. That window has closed.
--
-- Nothing has read this column since 00180 and the trigger's only job was to
-- keep filling thread_id for writers that didn't know about it. Both go.

DROP TRIGGER IF EXISTS reading_annotation_messages_thread_fill
  ON reading_annotation_messages;
DROP FUNCTION IF EXISTS reading_annotation_message_thread_fill();

ALTER TABLE reading_annotation_messages DROP COLUMN annotation_id;

-- Its index went with the column; the thread index from 00180 is the live one.
