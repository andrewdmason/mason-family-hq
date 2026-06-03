-- Per-book reading targets, replacing the single global weekly page goal.
--
-- Each in-progress book aims for its own page. The member's reading_settings
-- weekly_page_goal is reinterpreted as the default *increment* (target_page =
-- current_page + increment). target_locked records an explicit owner override for
-- the current stretch so auto-tracking (when current_page changes) doesn't clobber
-- it; the system clears it whenever it advances a stretch (on a passed quiz).
--
-- target_page is only meaningful while status = 'in_progress'; null = no target
-- (queued/paused/archived, or an increment of 0). No CHECK on the value — it may
-- transiently exceed total_pages and is capped in application logic.
ALTER TABLE reading_books ADD COLUMN target_page   int;
ALTER TABLE reading_books ADD COLUMN target_locked boolean NOT NULL DEFAULT false;

-- Backfill a sensible target for books already in progress: current_page + the
-- member's weekly increment, capped at the last page. Members with a 0 goal (or
-- no goal row) keep a null target.
UPDATE reading_books b
SET target_page = CASE
    WHEN b.total_pages IS NOT NULL
      THEN LEAST(b.current_page + s.weekly_page_goal, b.total_pages)
    ELSE b.current_page + s.weekly_page_goal
  END
FROM journal_members m
JOIN reading_settings s ON s.member_email = m.email
WHERE b.user_id = m.user_id
  AND b.status = 'in_progress'
  AND b.target_page IS NULL
  AND s.weekly_page_goal > 0;
