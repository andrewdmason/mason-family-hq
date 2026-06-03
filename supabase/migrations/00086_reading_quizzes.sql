-- Reading comprehension quizzes.
--
-- The account owner generates a quiz for a kid's uploaded+converted book,
-- scoped to "through page N" (cumulative from the start). Claude writes a mix of
-- multiple-choice and free-text writing questions plus an answer key and a
-- grading rubric. The owner reviews/edits the DRAFT, then PUBLISHES it. The kid
-- takes it from the reader home; on submit it's auto-graded (MC deterministically,
-- free-text by AI) and they see full feedback immediately.
--
-- Rows belong to the KID (user_id), exactly like reading_books — so the kid reads
-- and takes their own quizzes under normal own-rows RLS, while the owner manages
-- them through the service-role admin client in member mode (see scope.ts). The
-- owner's cross-kid "all quizzes" list also goes through the admin client, gated
-- by getIsOwner() — there is intentionally no cross-user SELECT policy.

-- ============================================================
-- 1. Quizzes (draft → published), one per generation
-- ============================================================
CREATE TABLE reading_quizzes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id          uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  -- Cumulative coverage: the quiz draws on the book from the start through here.
  through_page     int NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published')),
  title            text,
  -- The owner who generated it (from the session), for audit. Not the reader.
  created_by_email text NOT NULL,
  -- 'manual' now; a future check-in job will generate with 'checkin'.
  source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'checkin')),
  -- Last generation failure, surfaced in the draft editor's "Try again".
  generation_error text,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_quizzes_user_book ON reading_quizzes (user_id, book_id);
CREATE INDEX idx_reading_quizzes_user_status ON reading_quizzes (user_id, status);

CREATE TRIGGER reading_quizzes_updated_at
  BEFORE UPDATE ON reading_quizzes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_quizzes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_quizzes FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 2. Questions (multiple_choice | free_text)
-- ============================================================
-- user_id is denormalized from the parent quiz so own-rows RLS applies directly.
-- Regenerating a draft deletes-and-replaces this set (like reading_book_pages).
CREATE TABLE reading_quiz_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES reading_quizzes(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position       int NOT NULL,
  type           text NOT NULL CHECK (type IN ('multiple_choice', 'free_text')),
  prompt         text NOT NULL,
  -- MC only: ordered array of option strings. Null for free_text.
  options        jsonb,
  -- MC only: index into options of the correct choice. Null for free_text.
  correct_index  int,
  -- MC only: one sentence on why the answer is right (shown in results).
  explanation    text,
  -- free_text only: the points a correct answer must make (grader + owner ref).
  grading_rubric text,
  -- free_text only: a concise model answer, to ground the grader.
  sample_answer  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_quiz_questions_quiz ON reading_quiz_questions (quiz_id, position);

ALTER TABLE reading_quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_quiz_questions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 3. Submissions (one per quiz — single attempt)
-- ============================================================
CREATE TABLE reading_quiz_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE enforces single attempt: a retake insert hits the constraint.
  quiz_id          uuid NOT NULL UNIQUE REFERENCES reading_quizzes(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  score_correct    int NOT NULL DEFAULT 0,
  score_total      int NOT NULL DEFAULT 0,
  -- False when an AI free-text grade failed, leaving an ungraded answer.
  grading_complete boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_quiz_submissions_user ON reading_quiz_submissions (user_id);

ALTER TABLE reading_quiz_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_quiz_submissions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4. Answers (one per question per submission)
-- ============================================================
CREATE TABLE reading_quiz_answers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES reading_quiz_submissions(id) ON DELETE CASCADE,
  question_id    uuid NOT NULL REFERENCES reading_quiz_questions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- MC: the chosen option index. Null for free_text.
  selected_index int,
  -- free_text: the kid's written answer. Null for MC.
  response_text  text,
  -- Null = ungraded (an AI grade failed); shown gently in results.
  is_correct     boolean,
  -- free_text: the AI's warm note on why the answer was good/bad.
  ai_notes       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, question_id)
);

ALTER TABLE reading_quiz_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_quiz_answers FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
