-- When a book's current stretch target is due.
--
-- Until now the "due" label was derived purely from today's day of week (targets
-- were assumed due each Friday), so a target set right after a kid passed their
-- quiz on a Friday read "Due now" instead of giving them the coming week. We now
-- store the deadline per book: the first Friday strictly after the target was set,
-- so finishing a stretch always rolls the deadline to the next Friday.
--
-- target_due is only meaningful while status = 'in_progress' and target_page is
-- set; null otherwise (no target, or a queued/paused/archived book).
ALTER TABLE reading_books ADD COLUMN target_due date;

-- Backfill in-progress books that have a target: due the next Friday strictly
-- after today. extract(dow) is 0=Sun..6=Sat, matching the app's set-time math.
UPDATE reading_books
SET target_due =
  current_date + ((((5 - extract(dow FROM current_date)::int + 6) % 7) + 1))
WHERE status = 'in_progress'
  AND target_page IS NOT NULL;
