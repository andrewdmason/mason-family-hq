-- This Week: a fifth bucket between Today and Anytime — "soon, but on no
-- particular day." Filed by hand and kept until moved; nothing resets it when
-- the week turns over.

ALTER TABLE todo_tasks DROP CONSTRAINT todo_tasks_bucket_check;

ALTER TABLE todo_tasks ADD CONSTRAINT todo_tasks_bucket_check
  CHECK (bucket IN ('inbox', 'today', 'week', 'anytime', 'someday'));
