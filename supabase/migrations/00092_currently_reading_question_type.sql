-- Add the `currently-reading` built-in journal question type for every user.
--
-- It asks about the specific book you're reading right now (status in_progress
-- in the Reader app), grounding the question in that book. Like family-followup,
-- it only fires when its source exists (you have a book in progress) — that drop
-- happens in code (opening-candidates.ts), not here.
--
-- Seeded live at a weekly cadence (weight 3, enabled) so it starts appearing;
-- users can re-dial it in Settings → Questions. Keep this in sync with the code
-- seed (BUILTIN_QUESTION_TYPES in seeds/defaults.ts).

INSERT INTO journal_question_types
  (user_id, name, base_description, weight, enabled, is_builtin, sort_order)
SELECT
  u.user_id,
  'currently-reading',
  'Asks about a book from your reading life — a character, an idea, a passage that''s stayed with you, or how it landed. Grounded in a specific book from your Reading list, whether you''re partway through it or finished it a while ago.',
  3,
  true,
  true,
  21
FROM (SELECT DISTINCT user_id FROM journal_question_types) u
ON CONFLICT (user_id, name) DO NOTHING;
