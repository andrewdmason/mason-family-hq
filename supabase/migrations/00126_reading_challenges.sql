-- Reading challenges: a parent-created, time-boxed "read as many pages as you
-- can" goal for one kid, with prizes described in free-form markdown. The point
-- is to reward TOTAL PAGES over a window so a kid (Sebastian) stops picking books
-- by how short they are.
--
-- We deliberately don't model tiers/prizes structurally — that all lives in the
-- markdown `description` a parent edits in the UI. The app derives progress
-- (pages read in the window, a per-week breakdown vs. the weekly baseline, and a
-- running "token" count) from the existing reading_checkins log, so there's
-- nothing extra to track by hand.
--
-- Scope/RLS mirrors school_assignments (00100): a kid reads only their OWN
-- challenge; a parent/owner reads and manages every kid's. Keyed by kid_email
-- (like school_assignments.kid_email) so a challenge can be set up before the kid
-- has signed in. One ACTIVE challenge per kid; finished ones are archived, not
-- deleted, so the history stays.

CREATE TABLE reading_challenges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_email        text NOT NULL
                     REFERENCES family_members(email) ON UPDATE CASCADE ON DELETE CASCADE,
  created_by_email text NOT NULL
                     REFERENCES family_members(email) ON UPDATE CASCADE ON DELETE CASCADE,

  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',   -- markdown (tiptap-markdown), the prize write-up

  start_date       date NOT NULL,
  end_date         date NOT NULL,
  page_goal        int  NOT NULL,              -- total pages target (drives the progress bar)
  pages_per_token  int  NOT NULL DEFAULT 30,   -- pages per batting-cage token (0 = no tokens)

  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_challenges_kid ON reading_challenges (kid_email);
-- At most one active challenge per kid; archived ones don't count, so a new
-- season can start once the prior one is archived.
CREATE UNIQUE INDEX uq_active_challenge_per_kid
  ON reading_challenges (kid_email) WHERE status = 'active';

CREATE TRIGGER reading_challenges_updated_at
  BEFORE UPDATE ON reading_challenges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS: a kid sees only their own challenge; a parent/owner sees and manages all.
-- Parent/owner writes also go through the service role in the actions, which
-- bypasses RLS — these policies gate direct session access.
-- ---------------------------------------------------------------------------
ALTER TABLE reading_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own (kid) or all (parent/owner)" ON reading_challenges FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM family_members m
    WHERE m.user_id = auth.uid()
      AND (m.role IN ('owner', 'parent') OR m.email = reading_challenges.kid_email)
  ));

CREATE POLICY "Manage for parents" ON reading_challenges FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

-- ---------------------------------------------------------------------------
-- Seed Sebastian's first challenge. Idempotent (fixed id + ON CONFLICT), and a
-- no-op on any DB that doesn't have these members yet, so it's safe in prod (on
-- merge) and locally (db reset). The whole prize structure is markdown the parent
-- can fine-tune in the UI; this is just the starting point.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM family_members WHERE email = 'sebastian@mason.io')
     OR NOT EXISTS (SELECT 1 FROM family_members WHERE email = 'andrew@mason.io') THEN
    RETURN;
  END IF;

  INSERT INTO reading_challenges
    (id, kid_email, created_by_email, title, description,
     start_date, end_date, page_goal, pages_per_token, status)
  VALUES (
    '0000000c-0000-0000-0000-000000000001',
    'sebastian@mason.io',
    'andrew@mason.io',
    'Sebastian''s Summer Reading Challenge',
    $md$# Sebastian's Summer Reading Challenge ⚾📚

**The deal:** read as many pages as you can between **June 7** and **August 25** (when Bentley reopens). It's all about *pages*, not how long or short a book is — so pick books you actually want to read.

Your baseline is **50 pages a week**. Everything below rewards going *above and beyond* that.

## 🎟️ Batting-cage tokens

Every **30 pages** you read earns **1 batting-cage token**. Keep reading, keep stacking them up — the app counts them for you.

## 🏆 Prize tiers

- **350 pages — a hobby box to rip.** A sealed box of cards, all yours to open.
- **700 pages — a new glove.** Something special and a little exotic — think Nokona American-buffalo leather, not the usual.
- **1,000 pages — a pro wood bat.** A real custom wood bat: your name engraved, your colors.

## 📖 What to read

Anything counts. But if you want to mix it up, try:

- A book published in the last year
- A genre you don't usually read — horror, historical, sci-fi, mystery, memoir
- Something from the *NYT Best Books of the 21st Century*
- Something really short **or** really long — under 150 pages, or over 500
- A classic you've been meaning to read (*The Hobbit*, *The Outsiders*)
- A book set in summer (*Holes*, *Bridge to Terabithia*)
- A book in translation (*Inkheart*, *Persepolis*)
- A book that's been made into a movie or show
- An audiobook
- A library checkout

Not sure what's next? Use **Discover** in the reader for picks made just for you.
$md$,
    '2026-06-07',
    '2026-08-25',
    1000,
    30,
    'active'
  )
  ON CONFLICT (id) DO NOTHING;
END $do$;
