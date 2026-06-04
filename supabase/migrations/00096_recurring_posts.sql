-- Recurring posts: custom question types the user commits to making on a rolling
-- cadence (e.g. a monthly "calendar recap", a weekly "what happened at school").
--
-- A recurring post is just a custom journal_question_types row with two extra
-- bits of state, so it reuses candidate generation, the picker, and question_type
-- tagging on entries:
--   * recurrence_days — the rolling interval. NULL = an ordinary rotation type;
--     > 0 = a recurring post that's "due" when the newest closed entry of this
--     type is older than this many days (or none exists yet). This column is also
--     the marker that excludes a type from the random daily sampler.
--   * context_spec — the user's chosen context sources for this type, overriding
--     the name-based default (see src/lib/journal/question-sources.ts). NULL falls
--     back to that default.

ALTER TABLE journal_question_types
  ADD COLUMN recurrence_days int
    CHECK (recurrence_days IS NULL OR recurrence_days > 0),
  ADD COLUMN context_spec jsonb;
