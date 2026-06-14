-- Reader quizzes become a single longform essay.
--
-- The multiple-choice + short-answer quiz is retired in favor of ONE essay prompt
-- per assignment: an opening that proves the kid did the reading (the "anchor"),
-- then a pivot into a broader theme that rewards real, creative thinking. It's
-- graded the way a middle-school English teacher would — comprehension of the
-- reading, writing mechanics, and quality of thinking — each scored 1–4. "Meets
-- standard" (every dimension >= 2) is the pass that advances the book, exactly
-- like a perfect quiz used to; below that, the kid revises and resubmits.
--
-- Modeled as a SINGLE question of a new type 'essay' so submissions, numbered
-- attempts/retakes, and the parent override all keep working unchanged. Any
-- legacy 'multiple_choice'/'free_text' rows still in flight grade through the
-- old path.

-- 1. Allow the essay question type and its extra fields.
ALTER TABLE reading_quiz_questions
  DROP CONSTRAINT reading_quiz_questions_type_check;
ALTER TABLE reading_quiz_questions
  ADD CONSTRAINT reading_quiz_questions_type_check
    CHECK (type IN ('multiple_choice', 'free_text', 'essay'));

ALTER TABLE reading_quiz_questions
  -- essay only: the concrete reading detail the opening must demonstrate. Internal
  -- (grader-facing) — never sent to the reader's browser, so it can't be gamed.
  ADD COLUMN anchor_summary text,
  -- essay only: the per-dimension rubric the grader scores against, shaped
  -- { comprehension, mechanics, thinking } as short strings.
  ADD COLUMN essay_rubric jsonb,
  -- essay only: the soft minimum word count, baked in at generation time.
  ADD COLUMN min_words int;

-- 2. Carry the essay's rubric breakdown on the graded answer row, shaped
--    { comprehension, mechanics, thinking } each { score 1-4, note }.
ALTER TABLE reading_quiz_answers
  ADD COLUMN rubric_scores jsonb;

-- 3. Per-reader essay floor, owner-tunable so a younger reader (Oscar) can sit
--    below an older one (Sebastian). Generation bakes the current value into the
--    quiz; the rubric — not length — does the real grading work.
ALTER TABLE reading_settings
  ADD COLUMN essay_min_words int NOT NULL DEFAULT 150;
