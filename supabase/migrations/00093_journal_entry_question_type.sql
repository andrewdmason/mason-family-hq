-- Tag a journal entry with the question category it was answered from.
--
-- The opening-question picker shows each candidate under a small category label
-- ("Recent calendar", "Historical followup", …) derived from its question type.
-- That type lived only in `opening_candidates` (jsonb) and was dropped the moment
-- a question was picked. Persisting it on the entry lets the journal feed show
-- the same category label on each finished post.
--
-- Stores the question type's kebab-case `name` (e.g. "recent-calendar") — not a
-- FK, since question types are per-user, renameable, and may be deleted while
-- the entry's category label should still stand on its own.
--
-- Nullable: freeform, quote, and recap entries never go through the picker, and
-- entries written before this column simply carry no category — all of them just
-- show no label. No RLS change is needed; the existing journal_entries policies
-- already gate the row.

ALTER TABLE journal_entries
  ADD COLUMN question_type text;
