-- The Home dashboard's per-person AI cache.
--
-- The Home page (the new default landing) shows two kinds of AI-generated copy
-- per person: a one-line greeting/commentary on their day, and three journal
-- opening-question suggestions (one set framed for the personal journal, one for
-- the family journal). Both are expensive to generate and should be stable for
-- the day — regenerating on every page load would be slow and burn tokens.
--
-- This table caches each generated payload keyed by (user, day, widget). The
-- widgets render instantly from the cache; generation fires lazily, at most once
-- per day per widget, the first time a given widget is missing for today (see
-- src/lib/home/cache.ts and the home/api routes). Stale rows from past days are
-- harmless — nothing reads them once the date rolls over — so there's no cleanup
-- job; the (user, day, widget) key naturally partitions by day.
--
-- widget_key is an open text column (e.g. 'greeting', 'journal_personal',
-- 'journal_family') rather than an enum, so adding a future cached widget needs
-- no migration. payload is jsonb so each widget can store whatever shape it
-- needs (a string for the greeting, an array of candidates for suggestions).

CREATE TABLE home_ai_cache (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_date   date NOT NULL,
  widget_key   text NOT NULL,
  payload      jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cache_date, widget_key)
);

-- Own rows only: the cache holds one person's personalized copy, scoped exactly
-- like every other per-user table in the schema (auth.uid() = user_id). The
-- WITH CHECK clause rejects an insert that stamps someone else's user_id.
ALTER TABLE home_ai_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON home_ai_cache FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
