-- Reader essays become a two-part exercise.
--
-- Part 1 is a short comprehension check that proves the kid read the pages; Part 2
-- is a longer, personal question that bridges a theme from the reading to something
-- the kid actually cares about (from their journal Present doc). Comprehension is
-- demoted to a light pass/fail gate; the earned grade comes from the thinking and
-- writing in Part 2 (see lib/reading/essay-scoring.ts).
--
-- The three generated candidates stay as reading_quiz_questions rows selected via
-- reading_quizzes.chosen_question_id (00146); the kid-facing chooser is retired and
-- a parent curates the single published question. Existing essay rows keep working:
-- the new columns are nullable and a null comprehension_prompt renders as a
-- single-part essay.

-- 1. Part 1 (comprehension) prompt on the question; Part 1 answer on the row.
ALTER TABLE reading_quiz_questions
  -- essay only: the short Part 1 prompt that proves the kid read the pages. The
  -- existing `prompt` column now holds the Part 2 (personal) question.
  ADD COLUMN comprehension_prompt text;

ALTER TABLE reading_quiz_answers
  -- essay only: the kid's short Part 1 answer. The existing `response_text` now
  -- holds the Part 2 essay.
  ADD COLUMN comprehension_text text;

-- 2. Parent ↔ AI steering conversation for a quiz's question candidates.
--
-- Mirrors journal_messages (00034): an ordered role/content thread. user_id is the
-- KID who owns the reading (so the reading's own-rows RLS and the everywhere-used
-- .eq("user_id", scope.userId) filter hold) — NOT the turn author. The parent who
-- authored a turn is recorded in created_by_email. Parent writes/reads go through
-- the service-role member-mode admin client gated by an adult check (see scope.ts /
-- quiz-steer.ts), so there is intentionally no parent-scoped policy.
CREATE TABLE reading_quiz_steering_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id          uuid NOT NULL REFERENCES reading_quizzes(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The parent (owner or parent role) who authored a 'user' turn; null on the
  -- assistant's regenerated turns.
  created_by_email text,
  role             text NOT NULL CHECK (role IN ('user', 'assistant')),
  content          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_quiz_steering_messages_quiz
  ON reading_quiz_steering_messages (quiz_id, created_at);

ALTER TABLE reading_quiz_steering_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_quiz_steering_messages FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
