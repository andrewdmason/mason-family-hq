-- Reader essays: two-step flow, and a below/meets/exceeds grade.
--
-- Two shifts land together (see lib/reading/essay-scoring.ts, lib/reading/quiz-grade.ts):
--
-- 1. Comprehension (Part 1) becomes a SEPARATE first step, cleared ONCE per quiz and
--    then never shown again. It's a pass/fail gate the kid clears before the essay
--    screen opens; clearing it also locks parent steering (like starting does). We
--    record it on the quiz itself (not per attempt) so revisions are essay-only.
--
-- 2. The essay grade collapses to a single scored dimension — Quality of Thinking, on
--    a below/meets/exceeds band — plus a pass/fail Grammar gate. The old two 1–4
--    dimensions (mechanics + thinking, out of 8) are gone. "meets" passes and advances
--    the book; "exceeds" additionally earns the standout Mason Bucks bonus.

-- 1. The comprehension gate, cleared once per quiz.
ALTER TABLE reading_quizzes
  -- When the kid cleared the Part 1 comprehension gate. Null = not cleared yet; the
  -- taking flow shows the comprehension step until this is set. Also acts as a
  -- "started" signal for the steering lock (see quizIsLocked).
  ADD COLUMN comprehension_cleared_at timestamptz,
  -- The kid's short Part 1 answer that cleared the gate (kept for the record / results).
  ADD COLUMN comprehension_text text;

-- 2. Reshape the graded rubric stored on essay answer rows.
--
--   old: {comprehension:{met,note}, mechanics:{score 1-4,note,fixes}, thinking:{score 1-4,note}}
--   new: {grammar:{met bool,note,fixes}, thinking:{band 'below'|'meets'|'exceeds', note, next[]}}
--
-- Comprehension drops off the answer (it's a quiz-level prerequisite now). Grammar
-- becomes a pass/fail gate (old mechanics >= 3 read as "readable"); thinking becomes a
-- band (old 4 -> exceeds, 3 -> meets, else below). Only rows still in the old shape
-- (identified by the 'mechanics' key) are rewritten, so this is safely re-runnable.
UPDATE reading_quiz_answers
SET rubric_scores = jsonb_build_object(
      'grammar', jsonb_build_object(
        'met',
        CASE
          WHEN (rubric_scores #>> '{mechanics,score}') IS NULL THEN NULL
          WHEN (rubric_scores #>> '{mechanics,score}')::int >= 3 THEN to_jsonb(true)
          ELSE to_jsonb(false)
        END,
        'note', '',
        'fixes', COALESCE(rubric_scores #> '{mechanics,fixes}', '[]'::jsonb)
      ),
      'thinking', jsonb_build_object(
        'band',
        CASE
          WHEN (rubric_scores #>> '{thinking,score}') IS NULL THEN NULL
          WHEN (rubric_scores #>> '{thinking,score}')::int >= 4 THEN to_jsonb('exceeds'::text)
          WHEN (rubric_scores #>> '{thinking,score}')::int >= 3 THEN to_jsonb('meets'::text)
          ELSE to_jsonb('below'::text)
        END,
        'note', COALESCE(rubric_scores #> '{thinking,note}', '""'::jsonb),
        'next', '[]'::jsonb
      )
    )
WHERE rubric_scores IS NOT NULL
  AND rubric_scores ? 'mechanics';
