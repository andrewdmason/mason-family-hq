-- Let a quiz cover a page RANGE, not just "from the start through page N".
--
-- The common case is a weekly check-in: "read pages 80–130, then take a quiz on
-- that stretch." from_page is the start of the covered range (null = from the
-- very beginning, preserving the original cumulative behavior); through_page
-- stays the end of the range.
ALTER TABLE reading_quizzes ADD COLUMN from_page int;
