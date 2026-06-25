-- Reader bonus pages + parent milestones.
--
-- Kids can read past their weekly target and bank the extra as "bonus pages",
-- credited only when the covering stretch quiz is passed. Parents set per-kid
-- milestones (a page threshold on bonus or total pages, a title, an uploaded
-- reward image) and award them by hand when reached.
--
-- Per-user own-rows RLS like the rest of the reading app (see 00073): a kid may
-- READ their own ledger + milestones (the dashboard shows them); all writes go
-- through the owner's service-role path (advanceStretch on a pass, the owner
-- managing milestones), never a user session — so there are no user INSERT/UPDATE
-- policies, mirroring reading_settings.

-- ============================================================
-- 1. Stretch-advance ledger (basis for bonus + total-pages math)
-- ============================================================
-- One append-only row per real advance (a passed/closed quiz, or a no-content
-- book's direct advance). pages_advanced is the actual page movement; bonus_pages
-- is the slice beyond the normal weekly target. advanced_on dates each row so a
-- milestone can count "since" a start date with a simple SUM … WHERE advanced_on.
CREATE TABLE reading_stretch_advances (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id        uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  -- The quiz whose pass drove this advance; null for a no-content direct advance.
  quiz_id        uuid REFERENCES reading_quizzes(id) ON DELETE SET NULL,
  pages_advanced int NOT NULL CHECK (pages_advanced >= 0),
  bonus_pages    int NOT NULL DEFAULT 0 CHECK (bonus_pages >= 0),
  advanced_on    date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_stretch_advances_user_date
  ON reading_stretch_advances (user_id, advanced_on);

ALTER TABLE reading_stretch_advances ENABLE ROW LEVEL SECURITY;

-- A member may read their own advances (the reading home sums the bonus total).
-- Writes go through the owner/service-role advance path, never a user session.
CREATE POLICY "Read own advances" ON reading_stretch_advances FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- 2. Parent-set reward milestones
-- ============================================================
-- One row per milestone, owned by the kid (user_id) and authored by a parent.
-- metric picks which ledger sum to threshold against; start_on null = all-time.
-- achieved_at stamps when the count first crossed the threshold; awarded_at marks
-- the parent's real-world handoff (and retires it from the dashboard).
CREATE TABLE reading_milestones (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_email text NOT NULL,
  title            text NOT NULL,
  metric           text NOT NULL DEFAULT 'bonus_pages'
                     CHECK (metric IN ('bonus_pages', 'total_pages')),
  threshold        int NOT NULL CHECK (threshold > 0),
  -- Storage path in the reading-milestones bucket; null until an image is added.
  image_path       text,
  -- null = count from all time; a date = seasonal challenge starting that day.
  start_on         date,
  achieved_at      timestamptz,
  awarded_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_milestones_user ON reading_milestones (user_id);

CREATE TRIGGER reading_milestones_updated_at
  BEFORE UPDATE ON reading_milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_milestones ENABLE ROW LEVEL SECURITY;

-- A member may read their own milestones (the dashboard shows them). All writes
-- go through the owner's service-role path in the parent-admin actions.
CREATE POLICY "Read own milestones" ON reading_milestones FOR SELECT
  USING (user_id = auth.uid());
