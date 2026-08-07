-- Keep every try at the Part 1 comprehension gate, not just the one that passed.
--
-- Until now a missed Part 1 answer was graded and thrown away: only a PASS wrote
-- reading_quizzes.comprehension_text. A kid could get stuck on the gate — insisting
-- they answered correctly — and leave no trace at all: no submission, no answer row,
-- nothing for a parent to look at (the admin card still read "Not started yet").
--
-- Each try is now logged with the grader's verdict and the hint it handed back, which
-- gives a parent the diagnostic AND gives the grader its own history, so a retry is
-- judged as a continuation rather than cold (see lib/reading/quiz-grade.ts).

CREATE TABLE reading_quiz_comprehension_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES reading_quizzes(id) ON DELETE CASCADE,
  -- The essay candidate whose comprehension_prompt they answered. SET NULL rather
  -- than CASCADE: regenerating a draft's questions must not erase the kid's history.
  question_id    uuid REFERENCES reading_quiz_questions(id) ON DELETE SET NULL,
  -- The kid who owns the reading (matches every other reading table's RLS).
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 1-based, per quiz. Not unique: a double-submit racing itself is harmless here
  -- (unlike a graded submission, an attempt at the gate costs nothing).
  attempt_number int NOT NULL,
  answer_text    text NOT NULL,
  -- true = cleared the gate, false = missed it, null = the grader itself failed
  -- (an API error), which also leaves the gate uncleared.
  met            boolean,
  -- The one-sentence note the kid was shown (affirmation or "Try …" hint).
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_quiz_comprehension_attempts_quiz
  ON reading_quiz_comprehension_attempts (quiz_id, attempt_number);

ALTER TABLE reading_quiz_comprehension_attempts ENABLE ROW LEVEL SECURITY;
-- The kid reads/writes their own; parents read through the service-role member-mode
-- admin client behind an adult check, exactly like the steering thread (00161).
CREATE POLICY "Own rows" ON reading_quiz_comprehension_attempts FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- A parent can wave a kid past a Part 1 they're stuck on (a mis-grade, an ambiguous
-- prompt). Recorded so the cleared gate is never mistaken for the kid clearing it —
-- comprehension_text stays null, since they never wrote a passing answer.
ALTER TABLE reading_quizzes
  ADD COLUMN comprehension_cleared_by_email text;
