-- Retire the Todos Today "Write in your journal" nudge. The synthetic row and
-- its per-day dismissals (00138) are gone from the app, so this table no longer
-- backs anything.

DROP TABLE IF EXISTS journal_nudge_dismissals;
