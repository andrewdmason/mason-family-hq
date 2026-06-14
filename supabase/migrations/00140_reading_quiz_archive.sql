-- One live reading quiz per book.
--
-- Generating a fresh quiz used to leave the previous one published, so a book
-- could end up with two open quizzes for the same stretch (and the reader only
-- ever saw the newest). This adds an 'archived' status: publishing a quiz retires
-- any other open quiz for that book to history (handled in app code), and the
-- backfill below settles any duplicates that already exist.

-- 1. Allow the archived status.
ALTER TABLE reading_quizzes
  DROP CONSTRAINT reading_quizzes_status_check;
ALTER TABLE reading_quizzes
  ADD CONSTRAINT reading_quizzes_status_check
    CHECK (status IN ('draft', 'published', 'archived'));

-- 2. One-time cleanup: for each (reader, book), keep the newest OPEN quiz —
--    published and not yet passed — and archive the older open ones. Passed
--    quizzes and drafts are left as-is; they're already inert or in review.
WITH passed AS (
  SELECT DISTINCT quiz_id
  FROM reading_quiz_submissions
  WHERE score_total > 0 AND score_correct = score_total
),
open_quizzes AS (
  SELECT
    q.id,
    row_number() OVER (
      PARTITION BY q.user_id, q.book_id
      ORDER BY q.created_at DESC
    ) AS rn
  FROM reading_quizzes q
  WHERE q.status = 'published'
    AND q.id NOT IN (SELECT quiz_id FROM passed)
)
UPDATE reading_quizzes
SET status = 'archived', updated_at = now()
WHERE id IN (SELECT id FROM open_quizzes WHERE rn > 1);
