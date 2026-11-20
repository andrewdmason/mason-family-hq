-- Words: a word answered right the first time it's asked is one they knew
-- already, and is never asked again. Until now it was checked once more a few
-- days later; the ones still waiting on that check are done with too.
-- (`fast` is cleared by a miss, so these have never been missed.)
UPDATE words_progress
SET stage = 3,
    mastered_at = COALESCE(mastered_at, now()),
    due_on = GREATEST(due_on, CURRENT_DATE + 365),
    updated_at = now()
WHERE fast
  AND removed_at IS NULL
  AND wrong_count = 0
  AND dontknow_count = 0
  AND (stage < 3 OR due_on < CURRENT_DATE + 300);
