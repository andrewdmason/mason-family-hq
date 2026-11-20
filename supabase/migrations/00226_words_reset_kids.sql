-- Words: start the kids over. Their accounts were used to try the app out
-- while it was being built, so everything they've "done" so far isn't theirs:
-- every session, answer and word's progress goes, and with them the streak.
-- Which test each is practising for (words_profiles) stays. One time only.
DELETE FROM words_answers
WHERE user_id IN (SELECT user_id FROM family_members WHERE role = 'kid' AND user_id IS NOT NULL);

DELETE FROM words_sessions
WHERE user_id IN (SELECT user_id FROM family_members WHERE role = 'kid' AND user_id IS NOT NULL);

DELETE FROM words_progress
WHERE user_id IN (SELECT user_id FROM family_members WHERE role = 'kid' AND user_id IS NOT NULL);

UPDATE words_profiles
SET sorted_through = 0, sorted_at = NULL, updated_at = now()
WHERE user_id IN (SELECT user_id FROM family_members WHERE role = 'kid' AND user_id IS NOT NULL);
