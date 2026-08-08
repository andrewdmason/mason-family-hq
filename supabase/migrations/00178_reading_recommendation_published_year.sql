-- Publication year on a suggestion, so the recommendation card can say when the
-- book came out — the difference between "a 2019 thriller" and "a 1927 novel" is
-- half of deciding whether you want it next.
--
-- Books already carry published_year (00085); recommendations never did, so a
-- suggestion that became a queued book arrived on the queue with no year at all.
-- Resolved by the same Open Library lookup that fills in the cover and page
-- count. Nullable: plenty of titles resolve without a year.
ALTER TABLE reading_recommendations ADD COLUMN published_year int;
