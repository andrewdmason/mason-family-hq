-- Let a parent close a quiz without the kid passing it.
--
-- Sometimes a parent wants to move a kid on past a quiz they can't (or needn't)
-- pass — book set aside, edge-case questions, "close enough". Closing records a
-- synthetic, perfect submission so every "is it passed?" check, badge, and the
-- active-quiz filter treat the stretch as done (and the book advances + the next
-- quiz generates, exactly like a real pass). closed_by_email marks that override
-- so the UI can label it honestly ("Closed by a parent") instead of pretending
-- the kid aced it. Null for every normal kid-taken attempt.

ALTER TABLE reading_quiz_submissions
  ADD COLUMN closed_by_email text;
