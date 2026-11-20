-- Words: sorting out the words someone knows already. They go through the
-- list a page at a time, commonest first, and say which they're not sure of;
-- the rest are skipped (words_progress.removed_at) and never asked.
ALTER TABLE words_profiles
  -- How far down the list they've looked: the rank of the last word shown.
  ADD COLUMN IF NOT EXISTS sorted_through integer NOT NULL DEFAULT 0,
  -- When they reached the words they mostly don't know, and stopped.
  ADD COLUMN IF NOT EXISTS sorted_at timestamptz;
