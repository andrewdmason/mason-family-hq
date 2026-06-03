-- The shared family Timeline: a structured replacement for the private "Past" doc.
--
-- Where the Past doc was one free-text markdown blob per user (private, invisible
-- to the rest of the family), the Timeline is a set of dated life events that the
-- whole family can see. Each event carries a category and a prominence (the two
-- orthogonal axes the visualization renders from), normalized dates with an
-- explicit precision (so "1986" renders as 1986, never "Jan 1 1986"), and tagged
-- people.
--
-- Four design choices worth calling out:
--
--   * No owner column on timeline_entries. "Whose life this is" lives entirely in
--     timeline_entry_people with role='subject'. A single canonical "Moved to
--     Berkeley" row therefore shows on Andrew's, Jenny's, Sebastian's and Oscar's
--     timelines via four subject rows — one row, no duplication.
--
--   * people is a registry shared across the app (timeline entries today, journal
--     posts designed-in via journal_entry_people). family_members stays the
--     authority on identity/roles; people.member_email is a plain-text bridge
--     (NOT an FK) so seeding never depends on a member having been added/signed in
--     yet — "My timeline" matches member_email to family_members.email at read
--     time, when auth.uid() is known.
--
--   * Elaboration is computed, not stored: a timeline entry is "elaborated" when
--     journal entries link to it (journal_entries.timeline_entry_id), counted at
--     read time. No status column to drift.
--
--   * All four tables are family-shared READ (any provisioned member) with NO
--     session-side write policies: every row is written by the seed below / future
--     seed migrations under the service role, exactly like the reading library.
--     "My timeline" vs "Family timeline" is a query filter, not an RLS boundary.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

-- Canonical person registry. Family people carry member_email (matched to
-- family_members.email); external people (Vince, Luke, Tim) leave it NULL.
CREATE TABLE people (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,        -- canonical display name; deduped at seed
  member_email text,                        -- bridge to family_members.email; NULL for non-family
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_people_member_email ON people (member_email) WHERE member_email IS NOT NULL;

-- The events themselves.
CREATE TABLE timeline_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text NOT NULL,             -- the 1-3 sentence at-a-glance caption
  category        text NOT NULL CHECK (category IN (
                    'origins','childhood','education','career','recognition',
                    'relationships','children_family','homes','travel',
                    'music_hobbies','health_hard_times')),
  prominence      text NOT NULL DEFAULT 'medium' CHECK (prominence IN ('major','medium','minor')),
  location        text,
  -- start_date is normalized to the first day of the stated period so ordering is
  -- correct; start_precision governs how it is RENDERED (year / month / day).
  start_date      date NOT NULL,
  start_precision text NOT NULL CHECK (start_precision IN ('year','month','day')),
  -- end_date NULL => a point event (marker); non-NULL => a period (span).
  end_date        date,
  end_precision   text CHECK (end_precision IN ('year','month','day')),
  approximate     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeline_entries_start ON timeline_entries (start_date);

-- People tagged on an entry. role='subject' => it's that person's life event (it
-- appears on their timeline); role='mention' => merely named. Shared events have
-- several subject rows.
CREATE TABLE timeline_entry_people (
  timeline_entry_id uuid NOT NULL REFERENCES timeline_entries(id) ON DELETE CASCADE,
  person_id         uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'mention' CHECK (role IN ('subject','mention')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (timeline_entry_id, person_id)
);

CREATE INDEX idx_tep_person ON timeline_entry_people (person_id);
CREATE INDEX idx_tep_subject ON timeline_entry_people (timeline_entry_id) WHERE role = 'subject';

-- Designed-in second consumer of the people registry: tag people on journal posts.
-- Shipped now so "search by person" can span both surfaces later without another
-- migration. No tagging UI in v1.
CREATE TABLE journal_entry_people (
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  person_id        uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journal_entry_id, person_id)
);

CREATE INDEX idx_jep_person ON journal_entry_people (person_id);

-- The link that makes a journal reflection "about" a timeline event. ON DELETE SET
-- NULL (not CASCADE): deleting an event must not delete the reflection (mirrors
-- reading_book_id in 00091).
ALTER TABLE journal_entries
  ADD COLUMN timeline_entry_id uuid REFERENCES timeline_entries(id) ON DELETE SET NULL;

CREATE INDEX idx_journal_entries_timeline_entry ON journal_entries (timeline_entry_id);

CREATE TRIGGER people_updated_at
  BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER timeline_entries_updated_at
  BEFORE UPDATE ON timeline_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS: family-shared read for any provisioned member; writes are service-role only
-- (no policies => only the seed / future seed migrations write).
-- ---------------------------------------------------------------------------

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON people FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));

ALTER TABLE timeline_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON timeline_entries FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));

ALTER TABLE timeline_entry_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON timeline_entry_people FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));

ALTER TABLE journal_entry_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON journal_entry_people FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Seed: Andrew's timeline. Account-independent (no auth.users / user_id lookups),
-- so it runs identically in dev (at migration time) and prod, and is idempotent
-- via ON CONFLICT DO NOTHING. Generated from scripts/timeline-seed-source.json by
-- scripts/gen-timeline-seed.mjs — edit the data there and regenerate, don't
-- hand-edit the rows below.
-- ---------------------------------------------------------------------------

INSERT INTO people (id, name, member_email) VALUES
  ('b0000094-0001-4001-8001-000000000001', 'Andrew Mason', 'andrew@mason.io'),
  ('b0000094-0001-4001-8001-000000000002', 'Jessica Mason', NULL),
  ('b0000094-0001-4001-8001-000000000003', 'Vince Leschade', NULL),
  ('b0000094-0001-4001-8001-000000000004', 'Luke', NULL),
  ('b0000094-0001-4001-8001-000000000005', 'Tim', NULL),
  ('b0000094-0001-4001-8001-000000000006', 'Mark Roberts', NULL),
  ('b0000094-0001-4001-8001-000000000007', 'Doug Torrance', NULL),
  ('b0000094-0001-4001-8001-000000000008', 'Aaron With', NULL),
  ('b0000094-0001-4001-8001-000000000009', 'Jenny Gillespie', 'jenny@mason.io'),
  ('b0000094-0001-4001-8001-000000000010', 'Eric Lefkofsky', NULL),
  ('b0000094-0001-4001-8001-000000000011', 'Sebastian Mason', 'sebastian@mason.io'),
  ('b0000094-0001-4001-8001-000000000012', 'Oscar Mason', 'oscar@mason.io'),
  ('b0000094-0001-4001-8001-000000000013', 'Rob', NULL),
  ('b0000094-0001-4001-8001-000000000014', 'Nabeel', NULL),
  ('b0000094-0001-4001-8001-000000000015', 'Yoshi Nagai', NULL),
  ('b0000094-0001-4001-8001-000000000016', 'Jyri', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO timeline_entries
  (id, title, description, category, prominence, location, start_date, start_precision, end_date, end_precision, approximate) VALUES
  ('b0000094-0000-4001-8001-000000000001', 'Born in Pittsburgh', 'Born in Pittsburgh, Pennsylvania, and raised in the suburb of Mt. Lebanon. Both parents were entrepreneurs — father a diamond salesman, mother a photographer.', 'origins', 'major', 'Pittsburgh, PA', '1980-10-22', 'day', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000002', 'Sister Jessica born', 'Younger sister, Jessica.', 'origins', 'minor', 'Pittsburgh, PA', '1982-09-26', 'day', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000003', 'Started piano at age six', 'Began piano lessons via the Suzuki method.', 'music_hobbies', 'medium', 'Mt. Lebanon, PA', '1986-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000004', 'Studied with Vince Leschade', 'Took piano lessons with Vince Leschade, organist for the Pirates and Penguins, from around age nine through late high school, with a fading interest toward the end.', 'music_hobbies', 'minor', 'Pittsburgh, PA', '1989-01-01', 'year', '1996-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000005', 'Little League: All-Star and Travel teams', 'Played youth baseball; made both the All-Star team and the Travel team.', 'childhood', 'minor', 'Mt. Lebanon, PA', '1990-01-01', 'year', '1993-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000006', 'Childhood entrepreneurial hustles', 'A string of small kid ventures: the Bagel Express bagel-delivery service at age 15, selling candy in the school cafeteria until getting shut down, and painting house numbers on curbs with his friend Luke.', 'childhood', 'minor', 'Mt. Lebanon, PA', '1993-01-01', 'year', '1998-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000007', 'Got into Fugazi, followed them on tour', 'Musical taste evolved from Billy Joel to Elton John before Fugazi became his favorite band; followed them around on tour.', 'music_hobbies', 'minor', NULL, '1996-01-01', 'year', '1999-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000008', 'Piano reignites via a Steinway-store teacher', 'Late in high school, a teacher at the Steinway store rekindled his interest, introducing Chopin études — his first real pull toward classical music after years of Billy Joel and the Rhapsody in Blue transcription.', 'music_hobbies', 'medium', 'Pittsburgh, PA', '1998-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000009', 'Graduated Mt. Lebanon High School', 'Finished high school in Mt. Lebanon.', 'education', 'medium', 'Mt. Lebanon, PA', '1999-06-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000010', 'Started at Northwestern in materials science engineering', 'Entered Northwestern University as a materials science engineering major; first year lived in the performing-arts residential college (Jones).', 'education', 'medium', 'Evanston, IL', '1999-09-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000011', 'Carnegie Mellon summer internship', 'An internship at Carnegie Mellon made clear he didn''t want engineering and wanted to stay in music — the pivot point back toward a music path.', 'education', 'minor', 'Pittsburgh, PA', '2000-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000012', 'Transferred into the Northwestern School of Music', 'Sophomore year, switched into the Bienen School of Music, studying music technology with a minor in piano.', 'education', 'medium', 'Evanston, IL', '2000-09-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000013', 'WWOOF in New Zealand', 'Spent about two and a half months doing WWOOF (Willing Workers on Organic Farms) in New Zealand with his friend Tim.', 'travel', 'minor', 'New Zealand', '2001-06-01', 'month', '2001-08-01', 'month', false),
  ('b0000094-0000-4001-8001-000000000014', 'Chicago-area apartment years', 'A run of post–freshman-year housing: off-campus on Clark Street in Evanston (rooming with Mark Roberts, then Doug Torrance, then Aaron With), then Rogers Park, Bucktown, and Lincoln Park.', 'homes', 'minor', 'Chicago area, IL', '2000-01-01', 'year', '2006-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000015', 'Graduated Northwestern with a music degree', 'Earned a B.A. from the Bienen School of Music (music technology).', 'education', 'medium', 'Evanston, IL', '2003-06-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000016', 'Odd-jobs era', 'A cluster of early jobs: Apple specialist at Knobbies, waiter at Blind Faith Café (eventually fired), computer repair at Howard Brown Health Center, and an at-home Apple consulting gig advertised in the Chicago Reader and on Craigslist.', 'career', 'minor', 'Chicago, IL', '2000-01-01', 'year', '2005-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000017', 'LSAT and the almost-law-school detour', 'Considered law school and took the LSAT; strong on practice tests but landed in the 160s on the real one.', 'education', 'minor', 'Chicago, IL', '2005-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000018', 'Built Policy Tree', 'Created Policy Tree, a visualization tool for policy debates — the project that led him toward the Harris School.', 'career', 'medium', 'Chicago, IL', '2005-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000019', 'Met and started dating Jenny', 'Met Jenny Gillespie at Hungry Brain and started dating on St. Patrick''s Day 2006.', 'relationships', 'medium', 'Chicago, IL', '2006-03-17', 'day', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000020', 'Bought a Hyde Park condo for grad school', 'Purchased a ~$120K condo in Hyde Park when starting graduate school nearby — a decision he later judged ill-advised.', 'homes', 'minor', 'Hyde Park, Chicago, IL', '2006-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000021', 'Harris School, then dropped out', 'Enrolled at the University of Chicago''s Harris School of Public Policy to work on ideas like Policy Tree, then dropped out about a quarter in to start The Point.', 'education', 'medium', 'Chicago, IL', '2006-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000022', 'Founded The Point', 'Started The Point, a grassroots collective-action platform, seeded with roughly $1M from Eric Lefkofsky.', 'career', 'medium', 'Chicago, IL', '2007-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000023', 'Founded Groupon', 'Pivoted The Point''s collective-buying mechanic into Groupon, becoming founding CEO.', 'career', 'major', 'Chicago, IL', '2008-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000024', 'Turned down Google''s ~$6B offer', 'Declined Google''s roughly $6 billion acquisition offer for Groupon.', 'career', 'medium', 'Chicago, IL', '2010-12-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000025', 'Forbes cover / fastest-growing-company moment', 'Public peak of the Groupon era, with Groupon framed as one of the fastest-growing companies ever and Mason on the cover of Forbes.', 'recognition', 'medium', NULL, '2010-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000026', 'Bought the Ukrainian Village place', 'Bought a beloved home in Ukrainian Village where he and Jenny lived and were married.', 'homes', 'medium', 'Ukrainian Village, Chicago, IL', '2010-01-01', 'year', '2012-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000027', 'Married Jenny Gillespie', 'Married Jenny at Dunton Springs.', 'relationships', 'major', 'Dunton Springs', '2011-10-01', 'day', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000028', 'Groupon IPO', 'Groupon went public, raising roughly $700M at a ~$12.7B valuation.', 'career', 'major', 'Chicago, IL', '2011-11-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000029', 'Honeymoon in South Africa', 'Honeymoon trip to South Africa over the winter holidays.', 'travel', 'medium', 'South Africa', '2011-12-19', 'day', '2012-01-01', 'day', false),
  ('b0000094-0000-4001-8001-000000000030', 'Bought the Evanston lakefront house', 'In the roughly six months before being fired, bought a beautiful house in Evanston right on the lake.', 'homes', 'medium', 'Evanston, IL', '2012-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000031', 'Ousted as Groupon CEO', 'Fired as CEO of Groupon, marked by an unusually candid goodbye memo.', 'career', 'major', 'Chicago, IL', '2013-02-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000032', 'Phat Camp and Pritikin Camp', 'Back-to-back stays at Phat Camp and the Pritikin program in Florida in early 2013.', 'travel', 'minor', 'Florida', '2013-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000033', 'South Asia trip', 'Traveled through South Asia just after leaving Groupon.', 'travel', 'minor', 'South Asia', '2013-03-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000034', 'Recorded a motivational business album', 'Made a motivational/business-themed music album in the wake of the Groupon departure.', 'recognition', 'medium', NULL, '2013-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000035', 'Cross-country road trip to San Francisco', 'Drove from the Midwest to San Francisco with Jenny (pregnant with Sebastian), stopping at national parks along the way.', 'travel', 'medium', 'United States', '2013-07-10', 'day', '2013-07-21', 'day', false),
  ('b0000094-0000-4001-8001-000000000036', 'Moved to San Francisco (Presidio Heights)', 'Settled in Presidio Heights on Pacific Avenue (3577 Pacific), along the Presidio wall, until the move to Berkeley.', 'homes', 'medium', 'San Francisco, CA', '2013-07-01', 'month', '2019-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000037', 'Founded Detour', 'Started Detour, a self-funded GPS-triggered audio walking-tour app, launching first in San Francisco.', 'career', 'medium', 'San Francisco, CA', '2013-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000038', 'Sebastian born', 'First son, Sebastian.', 'children_family', 'major', 'San Francisco, CA', '2013-12-19', 'day', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000039', 'Bought a place in Big Sur', 'Acquired a home in Big Sur.', 'homes', 'medium', 'Big Sur, CA', '2014-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000040', 'Aspen trip', 'Summer trip to Aspen. (Photo library labels this 2018 — worth a quick double-check.)', 'travel', 'minor', 'Aspen, CO', '2014-07-01', 'month', NULL, NULL, true),
  ('b0000094-0000-4001-8001-000000000041', 'Sweden / Finland / Russia trip', 'Travel through Sweden, Finland, and Russia.', 'travel', 'minor', 'Sweden, Finland, Russia', '2015-07-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000042', 'Oscar born', 'Second son, Oscar.', 'children_family', 'major', 'San Francisco, CA', '2016-07-14', 'day', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000043', 'Founded Descript', 'Spun Descript out of Detour''s transcription-based editing tech (which had emerged ~late 2016), building an AI-powered audio/video editing platform as CEO.', 'career', 'major', 'San Francisco, CA', '2017-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000044', 'Los Cabos at Christmas', 'Holiday trip to Los Cabos.', 'travel', 'minor', 'Los Cabos, Mexico', '2017-12-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000045', 'Wirikuta Gardens trip', 'A trip to Wirikuta with friends Tim and Rob.', 'travel', 'minor', 'Wirikuta, Mexico', '2018-03-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000046', 'Detour acquired by Bose', 'Bose acquired Detour''s software and tour content; the team moved on to Descript.', 'career', 'medium', 'San Francisco, CA', '2018-04-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000047', 'Hawaii trip', 'Trip to Hawaii.', 'travel', 'minor', 'Hawaii', '2019-03-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000048', 'Tahoe trip', 'Trip to Lake Tahoe.', 'travel', 'minor', 'Lake Tahoe, CA', '2019-03-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000049', 'Moved to Berkeley', 'Relocated to Berkeley as Sebastian was entering kindergarten.', 'homes', 'major', 'Berkeley, CA', '2019-08-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000050', 'Kids'' schooling: Berkwood Hedge to Bentley', 'Both sons attended Berkwood Hedge School, then transferred to Bentley School around when Sebastian was in third grade and Oscar in first.', 'children_family', 'minor', 'Berkeley, CA', '2019-01-01', 'year', '2022-01-01', 'year', false),
  ('b0000094-0000-4001-8001-000000000051', 'Tulum at Christmas', 'Holiday trip to Tulum.', 'travel', 'minor', 'Tulum, Mexico', '2022-12-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000052', 'Costa Rica trip', 'Trip to Costa Rica.', 'travel', 'minor', 'Costa Rica', '2023-12-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000053', 'Hawaii trip', 'Return trip to Hawaii.', 'travel', 'minor', 'Hawaii', '2024-01-01', 'year', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000054', 'Europe family vacation', 'Family vacation in Europe.', 'travel', 'minor', 'Europe', '2024-08-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000055', 'Founded Tabletop Library', 'Co-founded Tabletop Library, a membership-based board game club, with Nabeel. (February 2025 is a placeholder date.)', 'career', 'major', 'Berkeley, CA', '2025-02-01', 'month', NULL, NULL, true),
  ('b0000094-0000-4001-8001-000000000056', 'Dolomites trip', 'Trip to the Dolomites while the kids were at their first sleepaway camp in the Santa Cruz Mountains.', 'travel', 'minor', 'Dolomites, Italy', '2025-07-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000057', 'Stepped down as Descript CEO', 'Stepped down from the Descript CEO role.', 'career', 'major', 'Berkeley, CA', '2025-09-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000058', 'Returned to serious piano study', 'Resumed serious piano lessons (the SFCM / Yoshi Nagai chapter). (~December 2025 is a placeholder date.)', 'music_hobbies', 'medium', 'San Francisco, CA', '2025-12-01', 'month', NULL, NULL, true),
  ('b0000094-0000-4001-8001-000000000059', 'Niseko ski trip', 'Skied in Niseko, Japan, with friends Tim, Rob, and Jyri.', 'travel', 'minor', 'Niseko, Japan', '2026-02-01', 'month', NULL, NULL, false),
  ('b0000094-0000-4001-8001-000000000060', 'Tabletop Library launch', 'Planned public launch of Tabletop Library. (Upcoming/forward-looking — the only future-dated entry.)', 'career', 'major', 'Berkeley, CA', '2026-09-01', 'month', NULL, NULL, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO timeline_entry_people (timeline_entry_id, person_id, role) VALUES
  ('b0000094-0000-4001-8001-000000000001', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000002', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000002', 'b0000094-0001-4001-8001-000000000002', 'mention'),
  ('b0000094-0000-4001-8001-000000000003', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000004', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000004', 'b0000094-0001-4001-8001-000000000003', 'mention'),
  ('b0000094-0000-4001-8001-000000000005', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000006', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000006', 'b0000094-0001-4001-8001-000000000004', 'mention'),
  ('b0000094-0000-4001-8001-000000000007', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000008', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000009', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000010', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000011', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000012', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000013', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000013', 'b0000094-0001-4001-8001-000000000005', 'mention'),
  ('b0000094-0000-4001-8001-000000000014', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000014', 'b0000094-0001-4001-8001-000000000006', 'mention'),
  ('b0000094-0000-4001-8001-000000000014', 'b0000094-0001-4001-8001-000000000007', 'mention'),
  ('b0000094-0000-4001-8001-000000000014', 'b0000094-0001-4001-8001-000000000008', 'mention'),
  ('b0000094-0000-4001-8001-000000000015', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000016', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000017', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000018', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000019', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000019', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000020', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000021', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000022', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000022', 'b0000094-0001-4001-8001-000000000010', 'mention'),
  ('b0000094-0000-4001-8001-000000000023', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000023', 'b0000094-0001-4001-8001-000000000010', 'mention'),
  ('b0000094-0000-4001-8001-000000000024', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000025', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000026', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000026', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000027', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000027', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000028', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000029', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000029', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000030', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000030', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000031', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000032', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000033', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000034', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000035', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000035', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000036', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000036', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000037', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000038', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000038', 'b0000094-0001-4001-8001-000000000011', 'subject'),
  ('b0000094-0000-4001-8001-000000000039', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000040', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000041', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000042', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000042', 'b0000094-0001-4001-8001-000000000012', 'subject'),
  ('b0000094-0000-4001-8001-000000000043', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000044', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000045', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000045', 'b0000094-0001-4001-8001-000000000005', 'mention'),
  ('b0000094-0000-4001-8001-000000000045', 'b0000094-0001-4001-8001-000000000013', 'mention'),
  ('b0000094-0000-4001-8001-000000000046', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000047', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000048', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000049', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000049', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000049', 'b0000094-0001-4001-8001-000000000011', 'subject'),
  ('b0000094-0000-4001-8001-000000000049', 'b0000094-0001-4001-8001-000000000012', 'subject'),
  ('b0000094-0000-4001-8001-000000000050', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000050', 'b0000094-0001-4001-8001-000000000011', 'subject'),
  ('b0000094-0000-4001-8001-000000000050', 'b0000094-0001-4001-8001-000000000012', 'subject'),
  ('b0000094-0000-4001-8001-000000000051', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000052', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000053', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000054', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000054', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000094-0000-4001-8001-000000000054', 'b0000094-0001-4001-8001-000000000011', 'subject'),
  ('b0000094-0000-4001-8001-000000000054', 'b0000094-0001-4001-8001-000000000012', 'subject'),
  ('b0000094-0000-4001-8001-000000000055', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000055', 'b0000094-0001-4001-8001-000000000014', 'mention'),
  ('b0000094-0000-4001-8001-000000000056', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000057', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000058', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000058', 'b0000094-0001-4001-8001-000000000015', 'mention'),
  ('b0000094-0000-4001-8001-000000000059', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000059', 'b0000094-0001-4001-8001-000000000005', 'mention'),
  ('b0000094-0000-4001-8001-000000000059', 'b0000094-0001-4001-8001-000000000013', 'mention'),
  ('b0000094-0000-4001-8001-000000000059', 'b0000094-0001-4001-8001-000000000016', 'mention'),
  ('b0000094-0000-4001-8001-000000000060', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000094-0000-4001-8001-000000000060', 'b0000094-0001-4001-8001-000000000014', 'mention')
ON CONFLICT (timeline_entry_id, person_id) DO NOTHING;
