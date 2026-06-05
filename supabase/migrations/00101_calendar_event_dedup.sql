-- Calendar events were deduped only in application code (read-then-insert per
-- source), with no database constraint. Concurrent syncs (every calendar page
-- load triggers one, so multiple tabs race) could each insert the same event
-- before the other committed, leaving duplicate rows that then persisted.
--
-- This migration removes the existing duplicates and adds a unique constraint so
-- the sync can upsert idempotently and the database rejects any future race.

-- 1. Delete duplicate synced events, keeping the earliest row per
--    (calendar_source_id, external_id). Manual events have a NULL external_id
--    and are left untouched.
DELETE FROM calendar_events e
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY calendar_source_id, external_id
           ORDER BY created_at, id
         ) AS rn
  FROM calendar_events
  WHERE external_id IS NOT NULL
    AND calendar_source_id IS NOT NULL
) d
WHERE e.id = d.id
  AND d.rn > 1;

-- 2. Enforce one row per (source, external_id). Rows with a NULL external_id
--    (manual events) or NULL source are treated as distinct, so they're
--    unaffected. The non-partial shape lets PostgREST use it as an upsert
--    arbiter via onConflict column inference.
ALTER TABLE calendar_events
  ADD CONSTRAINT uq_calendar_events_source_external
  UNIQUE (calendar_source_id, external_id);
