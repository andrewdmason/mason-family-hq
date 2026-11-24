-- Words: boss rounds. The Tuttles app lays the words out as a path of stages,
-- 25 words each, and a stage ends in a boss round: a short timed session on
-- that stage's words with no "Don't know". It's played on the phone and sent
-- up like any other session (src/lib/words/offline.ts); this says which
-- stage's boss a session was, so the phone can tell which have been beaten.
-- Null for an ordinary session.
ALTER TABLE words_sessions ADD COLUMN IF NOT EXISTS boss smallint CHECK (boss BETWEEN 1 AND 100);
