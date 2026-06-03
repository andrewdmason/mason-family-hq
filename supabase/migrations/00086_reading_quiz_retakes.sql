-- Let kids retake a quiz, keeping every attempt's outcome.
--
-- Previously a quiz allowed a single submission (UNIQUE on quiz_id). Now each
-- attempt is its own submission row (with its own answers + score), numbered so
-- we can show "how many tries it took" and the score for each one. Attempts stay
-- distinct per quiz via UNIQUE(quiz_id, attempt_number); existing single
-- submissions become attempt 1 via the default.

ALTER TABLE reading_quiz_submissions
  DROP CONSTRAINT reading_quiz_submissions_quiz_id_key;

ALTER TABLE reading_quiz_submissions
  ADD COLUMN attempt_number int NOT NULL DEFAULT 1;

ALTER TABLE reading_quiz_submissions
  ADD CONSTRAINT reading_quiz_submissions_quiz_attempt_key
  UNIQUE (quiz_id, attempt_number);
