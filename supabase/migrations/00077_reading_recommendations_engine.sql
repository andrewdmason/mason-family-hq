-- Book recommender ("Discover").
--
-- Two pieces fuel a per-member recommender that learns over time:
--
-- 1. reading_books.rating — an emoji rating (❤️/👍/😐/👎) on books a member has
--    read. This is the positive/negative taste signal the engine leans on.
--
-- 2. reading_recommendations — the on-demand suggestions Claude generates for a
--    member, which doubles as the feedback log. Each row starts 'pending' (shown
--    on the Discover page) and transitions as the member acts:
--      queued        → added to their reading list
--      already_read  → they'd read it; logged as a completed, rated book
--      not_for_me    → permanent "no" + a strong negative signal to future passes
--      not_now       → soft defer; suppressed_until hides it for ~60 days
--    Generation is stateless replay: each pass re-reads ratings + these rows, so
--    acted-on titles are excluded and the suggestions improve.

-- 1. Ratings on read books.
CREATE TYPE reading_rating AS ENUM ('loved', 'liked', 'neutral', 'disliked');
ALTER TABLE reading_books ADD COLUMN rating reading_rating;

-- 2. Generated recommendations + feedback log.
CREATE TYPE reading_rec_status AS ENUM (
  'pending', 'queued', 'already_read', 'not_for_me', 'not_now'
);

CREATE TABLE reading_recommendations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  author text,
  total_pages int,
  cover_image_url text,
  isbn text,
  rationale text,
  status reading_rec_status NOT NULL DEFAULT 'pending',
  -- For 'not_now': the date this title may resurface. Null for every other status.
  suppressed_until date,
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The Discover page reads pending rows; generation reads the whole history.
CREATE INDEX idx_reading_recommendations_user_status
  ON reading_recommendations (user_id, status);

CREATE TRIGGER reading_recommendations_updated_at
  BEFORE UPDATE ON reading_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_recommendations ENABLE ROW LEVEL SECURITY;

-- Own rows only. Owner-acting-as-member writes go through the service role
-- (which bypasses RLS) scoped by user_id, mirroring the rest of the reading app.
CREATE POLICY "Own rows" ON reading_recommendations FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
