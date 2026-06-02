-- When a rating was given, so the recommender can weight tastes by recency. This
-- matters most for kids, whose taste shifts year to year — a book loved at 8
-- shouldn't anchor recommendations at 12 — while an adult's ratings stay
-- persistent. finished_at alone won't do: "didn't like"/"didn't finish" books
-- have no finish date, and re-rating a book should re-stamp the opinion.
ALTER TABLE reading_books ADD COLUMN rated_at date;

-- Backfill existing ratings: when they finished it, else when the row was created.
UPDATE reading_books
  SET rated_at = COALESCE(finished_at, created_at::date)
  WHERE rating IS NOT NULL;
