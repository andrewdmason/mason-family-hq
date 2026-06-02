-- Reading tracker: the family's third app. Family-wide like the journal, so
-- every table is scoped per-user with own-rows RLS (mirroring 00052). A member
-- tracks the book(s) they're currently reading; the account owner sets each
-- member's weekly page goal from the Family tab in settings.
--
-- Weeks run Mon–Sun. Progress is derived from an append-only check-in log:
-- "pages read this week" = current page minus the page at the start of the week.

-- ============================================================
-- 1. Books a member is tracking
-- ============================================================
CREATE TABLE reading_books (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  author       text,
  total_pages  int,
  current_page int NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'reading' CHECK (status IN ('reading', 'finished')),
  started_at   date,
  finished_at  date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_books_user_status ON reading_books (user_id, status);

CREATE TRIGGER reading_books_updated_at
  BEFORE UPDATE ON reading_books
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_books FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 2. Check-in log: what page on what date (basis for weekly math)
-- ============================================================
CREATE TABLE reading_checkins (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id    uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  checked_on date NOT NULL,
  page       int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_checkins_book_date ON reading_checkins (book_id, checked_on);

ALTER TABLE reading_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_checkins FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 3. Per-member weekly page goal
-- ============================================================
-- Keyed by email (like journal_members) so the owner can set a goal before the
-- member has ever signed in. Isolated from the journal tables for the multi-app
-- future. ON UPDATE CASCADE keeps the goal attached when the owner edits a
-- member's email in the roster (mirrors 00064 for member photos).
CREATE TABLE reading_settings (
  member_email     text PRIMARY KEY
    REFERENCES journal_members(email) ON UPDATE CASCADE ON DELETE CASCADE,
  weekly_page_goal int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER reading_settings_updated_at
  BEFORE UPDATE ON reading_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_settings ENABLE ROW LEVEL SECURITY;

-- A member may read their own goal (the reading home shows it). All writes go
-- through the owner's service-role path in the family-settings actions, never a
-- user session.
CREATE POLICY "Read own goal" ON reading_settings FOR SELECT
  USING (member_email = (SELECT email FROM journal_members WHERE user_id = auth.uid()));
