-- Reader picks one of three essay prompts.
--
-- A generated essay quiz now carries THREE candidate prompts (three 'essay'
-- question rows) instead of one. The reader reads all three and commits to one
-- before writing; the commitment is final — they can't switch, even on a retake.
--
-- The pick is recorded here: chosen_question_id points at the question row the
-- reader committed to. While it's null the reader still sees the chooser; once
-- set, every take/retake shows only that prompt's writing surface, and grading,
-- the results view, and the journal share all key off it. Scoring stays "one
-- essay": the chosen prompt is the only one answered and graded.
--
-- ON DELETE SET NULL so regenerating/replacing a draft's questions (which deletes
-- the rows) can't leave a dangling reference; a draft is never chosen anyway.

ALTER TABLE reading_quizzes
  ADD COLUMN chosen_question_id uuid
    REFERENCES reading_quiz_questions(id) ON DELETE SET NULL;
