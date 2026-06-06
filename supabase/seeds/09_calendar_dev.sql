-- Local-dev only: fake calendars + events so the Calendar app (and especially the
-- per-member columns agenda) has something to render without TeamSnap or Google
-- ever being connected. Nobody has to sign in or sync.
--
-- Everything is anchored to NOW at reset time: dates are computed relative to
-- "today" so the agenda always opens onto a populated couple of weeks. The spread
-- is intentionally lopsided — dense for the next two weeks, thinner out to ~a
-- month, plus a handful of past/far-future rows so week/month views and back-
-- scrolling aren't empty.
--
-- Times are written in America/Los_Angeles (the family's timezone — note the
-- Berkeley/Oakland locations) so they render at sensible clock times in the
-- browser regardless of the database session timezone. Each row carries a day
-- offset + wall-clock time; the timestamptz is built inline as:
--   (((today_pacific + day_offset) + clock) AT TIME ZONE 'America/Los_Angeles')
-- where today_pacific = (now() AT TIME ZONE 'America/Los_Angeles')::date.
-- (No helper functions — Supabase's batched seeding runs across connections, so
-- temp/session functions aren't reliably visible.)
--
-- Source colors are left NULL on purpose: the agenda falls back to each member's
-- deterministic color (src/lib/calendar/calendar-utils.ts#memberColor), so every
-- person's column reads as a single hue. Seeded rows are tagged with a
-- 'seeddev:' external_id prefix and fixed source uuids so this file is idempotent
-- across resets.

-- ---------------------------------------------------------------------------
-- Clean any prior run (idempotent reset).
-- ---------------------------------------------------------------------------
DELETE FROM calendar_events WHERE external_id LIKE 'seeddev:%';
DELETE FROM calendar_sources WHERE id IN (
  'c0000109-0000-4001-8001-000000000001',
  'c0000109-0000-4001-8001-000000000002',
  'c0000109-0000-4001-8001-000000000003',
  'c0000109-0000-4001-8001-000000000004',
  'c0000109-0000-4001-8001-000000000005',
  'c0000109-0000-4001-8001-000000000006',
  'c0000109-0000-4001-8001-000000000007',
  'c0000109-0000-4001-8001-000000000008',
  'c0000109-0000-4001-8001-000000000009'
);

-- ---------------------------------------------------------------------------
-- Calendars: one or two per person plus a shared family calendar. Color NULL so
-- events inherit each member's column color.
-- ---------------------------------------------------------------------------
INSERT INTO calendar_sources
  (id, member_email, source_type, nickname,
   google_calendar_id, google_connection_email,
   ics_url, teamsnap_team_id, teamsnap_team_name, teamsnap_player_member_id)
VALUES
  ('c0000109-0000-4001-8001-000000000001', 'andrew@mason.io', 'google', 'Personal',
   'andrew@mason.io', 'andrew@mason.io', NULL, NULL, NULL, NULL),
  ('c0000109-0000-4001-8001-000000000002', 'andrew@mason.io', 'google', 'Work',
   'andrew.work@example.com', 'andrew@mason.io', NULL, NULL, NULL, NULL),
  ('c0000109-0000-4001-8001-000000000003', 'jenny@mason.io', 'google', 'Personal',
   'jenny@mason.io', 'jenny@mason.io', NULL, NULL, NULL, NULL),
  ('c0000109-0000-4001-8001-000000000004', 'jenny@mason.io', 'google', 'Work',
   'jenny.work@example.com', 'jenny@mason.io', NULL, NULL, NULL, NULL),
  ('c0000109-0000-4001-8001-000000000005', 'oscar@mason.io', 'teamsnap', 'Thunder FC',
   NULL, NULL, NULL, 900001, 'Thunder FC U12', 800001),
  ('c0000109-0000-4001-8001-000000000006', 'oscar@mason.io', 'ics', 'Berkeley Elementary',
   NULL, NULL, 'https://example.com/oscar-school.ics', NULL, NULL, NULL),
  ('c0000109-0000-4001-8001-000000000007', 'sebastian@mason.io', 'teamsnap', 'Bay Bombers',
   NULL, NULL, NULL, 900002, 'Bay Bombers 10U', 800002),
  ('c0000109-0000-4001-8001-000000000008', 'sebastian@mason.io', 'ics', 'Berkeley Elementary',
   NULL, NULL, 'https://example.com/sebastian-school.ics', NULL, NULL, NULL),
  ('c0000109-0000-4001-8001-000000000009', NULL, 'manual', 'Family',
   NULL, NULL, NULL, NULL, NULL, NULL);

-- ===========================================================================
-- Recurring backbone (generate_series) — gives each column a steady rhythm.
-- ===========================================================================

-- Andrew: CrossFit, Mon/Wed/Fri mornings (dow 1,3,5).
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, source_type, external_id)
SELECT 'andrew@mason.io', 'c0000109-0000-4001-8001-000000000001', 'CrossFit', 'CrossFit Berkeley',
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '06:00') AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '07:00') AT TIME ZONE 'America/Los_Angeles'),
       'google', 'seeddev:a-crossfit:' || d
FROM generate_series(0, 28) g(d)
WHERE extract(dow from ((now() AT TIME ZONE 'America/Los_Angeles')::date + d)) IN (1, 3, 5);

-- Andrew: work standup, weekdays (dow 1-5).
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, start_time, end_time, source_type, external_id)
SELECT 'andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', 'Standup',
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '09:30') AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '09:45') AT TIME ZONE 'America/Los_Angeles'),
       'google', 'seeddev:a-standup:' || d
FROM generate_series(0, 18) g(d)
WHERE extract(dow from ((now() AT TIME ZONE 'America/Los_Angeles')::date + d)) IN (1, 2, 3, 4, 5);

-- Jenny: yoga, Tue/Thu mornings (dow 2,4).
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, source_type, external_id)
SELECT 'jenny@mason.io', 'c0000109-0000-4001-8001-000000000003', 'Yoga', 'Namaste Studio',
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '07:00') AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '08:00') AT TIME ZONE 'America/Los_Angeles'),
       'google', 'seeddev:j-yoga:' || d
FROM generate_series(0, 28) g(d)
WHERE extract(dow from ((now() AT TIME ZONE 'America/Los_Angeles')::date + d)) IN (2, 4);

-- Oscar: soccer practice, Tue/Thu afternoons. RSVP varies so the agenda shows a
-- "needs RSVP" pill on the nearest sessions and answered states later.
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, source_type, external_id, teamsnap_rsvp, teamsnap_is_game)
SELECT 'oscar@mason.io', 'c0000109-0000-4001-8001-000000000005', 'Soccer Practice', 'Cedar Rose Park',
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '16:30') AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '18:00') AT TIME ZONE 'America/Los_Angeles'),
       'teamsnap', 'seeddev:o-soccer-practice:' || d,
       (CASE WHEN d <= 3 THEN 'no_reply' WHEN d <= 12 THEN 'going' ELSE 'maybe' END)::teamsnap_rsvp_status, false
FROM generate_series(0, 21) g(d)
WHERE extract(dow from ((now() AT TIME ZONE 'America/Los_Angeles')::date + d)) IN (2, 4);

-- Sebastian: baseball practice, Mon/Wed afternoons.
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, source_type, external_id, teamsnap_rsvp, teamsnap_is_game)
SELECT 'sebastian@mason.io', 'c0000109-0000-4001-8001-000000000007', 'Baseball Practice', 'San Pablo Park',
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '16:00') AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '17:30') AT TIME ZONE 'America/Los_Angeles'),
       'teamsnap', 'seeddev:s-baseball-practice:' || d,
       (CASE WHEN d <= 2 THEN 'no_reply' ELSE 'going' END)::teamsnap_rsvp_status, false
FROM generate_series(0, 21) g(d)
WHERE extract(dow from ((now() AT TIME ZONE 'America/Los_Angeles')::date + d)) IN (1, 3);

-- Family: Sunday dinner (dow 0).
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, source_type, external_id)
SELECT NULL, 'c0000109-0000-4001-8001-000000000009', 'Family Dinner', 'Home',
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '18:00') AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + time '19:30') AT TIME ZONE 'America/Los_Angeles'),
       'manual', 'seeddev:family-dinner:' || d
FROM generate_series(0, 28) g(d)
WHERE extract(dow from ((now() AT TIME ZONE 'America/Los_Angeles')::date + d)) IN (0);

-- ===========================================================================
-- One-off, single-day events. Each VALUES row is compact (day offset + clock);
-- the SELECT builds the timestamps once. all_day rows use noon + NULL end so day
-- bucketing is timezone-stable.
-- Tuple shape: (member, source, title, location, day, start_clk, end_clk, all_day, source_type, ext)
-- ===========================================================================
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, all_day, source_type, external_id)
SELECT m, src::uuid, title, loc,
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + cs) AT TIME ZONE 'America/Los_Angeles'),
       CASE WHEN ce IS NULL THEN NULL
            ELSE ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + ce) AT TIME ZONE 'America/Los_Angeles') END,
       ad, st::calendar_source_type, ext
FROM (VALUES
  -- Andrew (work + personal). Budget Review + Pickup deliberately overlap → conflict badge.
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', 'Quarterly Board Meeting', '101 California St, SF', 1, time '10:00', time '12:00', false, 'google', 'seeddev:a-board'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', '1:1 with Priya', NULL, 2, time '11:00', time '11:30', false, 'google', 'seeddev:a-1on1'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', 'Budget Review', NULL, 3, time '14:00', time '15:00', false, 'google', 'seeddev:a-budget'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000001', 'Pick up kids from school', 'Berkeley Elementary', 3, time '14:30', time '15:15', false, 'google', 'seeddev:a-pickup'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000001', 'Dentist', 'Berkeley Dental Care', 5, time '08:00', time '09:00', false, 'google', 'seeddev:a-dentist'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', 'Investor lunch', 'Chez Panisse', 8, time '12:30', time '14:00', false, 'google', 'seeddev:a-investor'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000001', 'Haircut', NULL, 11, time '17:30', time '18:00', false, 'google', 'seeddev:a-haircut'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', 'Offsite planning', 'Tahoe', 24, time '09:00', time '17:00', false, 'google', 'seeddev:a-offsite'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', 'Q2 Planning', NULL, -9, time '13:00', time '15:00', false, 'google', 'seeddev:a-q2'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000001', 'Half marathon', 'Golden Gate Park', -23, time '08:00', time '11:00', false, 'google', 'seeddev:a-marathon'),
  ('andrew@mason.io', 'c0000109-0000-4001-8001-000000000002', 'Conference: AI Summit', 'Las Vegas', 45, time '09:00', time '17:00', false, 'google', 'seeddev:a-conf'),

  -- Jenny (work + personal).
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000004', 'Client workshop', 'Downtown Oakland', 1, time '13:00', time '16:00', false, 'google', 'seeddev:j-workshop'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000003', 'OB-GYN appointment', 'Alta Bates', 2, time '09:30', time '10:30', false, 'google', 'seeddev:j-dr'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000003', 'Coffee with Megan', 'Philz Coffee', 4, time '10:00', time '11:00', false, 'google', 'seeddev:j-coffee'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000004', 'Design review', NULL, 6, time '15:00', time '16:00', false, 'google', 'seeddev:j-design'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000003', 'Book club', 'Lucy''s house', 9, time '19:00', time '21:00', false, 'google', 'seeddev:j-bookclub'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000003', 'Parent-teacher conference', 'Berkeley Elementary', 12, time '16:00', time '16:30', false, 'google', 'seeddev:j-ptc'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000004', 'Team retro', NULL, 13, time '11:00', time '12:00', false, 'google', 'seeddev:j-retro'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000003', 'Hair appointment', NULL, 20, time '14:00', time '15:30', false, 'google', 'seeddev:j-hair'),
  ('jenny@mason.io', 'c0000109-0000-4001-8001-000000000003', 'Girls'' weekend', 'Sonoma', -15, time '10:00', time '18:00', false, 'google', 'seeddev:j-getaway'),

  -- Oscar (school + activities).
  ('oscar@mason.io', 'c0000109-0000-4001-8001-000000000006', 'Field trip: Exploratorium', 'San Francisco', 4, time '09:00', time '14:00', false, 'ics', 'seeddev:o-fieldtrip'),
  ('oscar@mason.io', 'c0000109-0000-4001-8001-000000000006', 'Spring concert', 'Berkeley Elementary', 10, time '18:30', time '19:30', false, 'ics', 'seeddev:o-concert'),
  ('oscar@mason.io', NULL, 'Piano lesson', 'Ms. Tanaka''s', 2, time '17:00', time '17:45', false, 'manual', 'seeddev:o-piano-1'),
  ('oscar@mason.io', NULL, 'Piano lesson', 'Ms. Tanaka''s', 9, time '17:00', time '17:45', false, 'manual', 'seeddev:o-piano-2'),
  ('oscar@mason.io', NULL, 'Birthday party (Liam)', 'Adventure Playground', 7, time '14:00', time '16:00', false, 'manual', 'seeddev:o-bday'),
  ('oscar@mason.io', NULL, 'Dentist checkup', 'Berkeley Dental Care', 15, time '15:30', time '16:15', false, 'manual', 'seeddev:o-dentist'),

  -- Sebastian (school + activities).
  ('sebastian@mason.io', 'c0000109-0000-4001-8001-000000000008', 'Picture day', 'Berkeley Elementary', 3, time '08:30', time '09:00', false, 'ics', 'seeddev:s-pictureday'),
  ('sebastian@mason.io', 'c0000109-0000-4001-8001-000000000008', 'Early dismissal', 'Berkeley Elementary', 8, time '12:00', time '12:30', false, 'ics', 'seeddev:s-earlyout'),
  ('sebastian@mason.io', NULL, 'Swim lesson', 'Berkeley Y', 1, time '16:30', time '17:15', false, 'manual', 'seeddev:s-swim-1'),
  ('sebastian@mason.io', NULL, 'Swim lesson', 'Berkeley Y', 8, time '16:30', time '17:15', false, 'manual', 'seeddev:s-swim-2'),
  ('sebastian@mason.io', NULL, 'Playdate with Theo', 'Home', 5, time '15:30', time '17:30', false, 'manual', 'seeddev:s-playdate'),
  ('sebastian@mason.io', NULL, 'Cub Scouts', 'Live Oak Park', 11, time '17:00', time '18:30', false, 'manual', 'seeddev:s-scouts'),

  -- Family (shared) — timed outings.
  (NULL, 'c0000109-0000-4001-8001-000000000009', 'Costco run', 'Richmond', 6, time '09:00', time '10:30', false, 'manual', 'seeddev:fam-costco'),
  (NULL, 'c0000109-0000-4001-8001-000000000009', 'Pizza & movie night', 'Home', 5, time '18:30', time '21:00', false, 'manual', 'seeddev:fam-movie'),
  (NULL, 'c0000109-0000-4001-8001-000000000009', 'Farmers market', 'Downtown Berkeley', 7, time '09:00', time '10:30', false, 'manual', 'seeddev:fam-market'),
  (NULL, 'c0000109-0000-4001-8001-000000000009', 'Memorial Day BBQ', 'Backyard', -12, time '12:00', time '16:00', false, 'manual', 'seeddev:fam-bbq'),

  -- Family (shared) — all-day markers (noon + NULL end).
  (NULL, 'c0000109-0000-4001-8001-000000000009', 'Oscar''s birthday', NULL, 9, time '12:00', NULL, true, 'manual', 'seeddev:fam-oscar-bday'),
  (NULL, 'c0000109-0000-4001-8001-000000000009', 'School holiday — no school', NULL, 12, time '12:00', NULL, true, 'manual', 'seeddev:fam-noschool'),
  (NULL, 'c0000109-0000-4001-8001-000000000009', 'Anniversary', NULL, 16, time '12:00', NULL, true, 'manual', 'seeddev:fam-anniv')
) v(m, src, title, loc, d, cs, ce, ad, st, ext);

-- ===========================================================================
-- Multi-day all-day spanners (separate start + end day).
-- Tuple shape: (title, location, start_day, end_day, ext)
-- ===========================================================================
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, all_day, source_type, external_id)
SELECT NULL, 'c0000109-0000-4001-8001-000000000009', title, loc,
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + sd) + time '12:00') AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + ed) + time '12:00') AT TIME ZONE 'America/Los_Angeles'),
       true, 'manual', ext
FROM (VALUES
  ('Tahoe weekend', 'Lake Tahoe', 17, 18, 'seeddev:fam-tahoe'),
  ('Grandma & Grandpa visit', NULL, 22, 24, 'seeddev:fam-grandparents')
) v(title, loc, sd, ed, ext);

-- ===========================================================================
-- TeamSnap games (extra columns: opponent, arrival, is_game, rsvp).
-- Tuple shape: (member, source, title, location, day, start_clk, end_clk, arrival_clk, opponent, rsvp, ext)
-- ===========================================================================
INSERT INTO calendar_events
  (member_email, calendar_source_id, title, location, start_time, end_time, source_type, external_id,
   teamsnap_opponent, teamsnap_arrival_time, teamsnap_is_game, teamsnap_rsvp)
SELECT m, src::uuid, title, loc,
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + cs) AT TIME ZONE 'America/Los_Angeles'),
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + ce) AT TIME ZONE 'America/Los_Angeles'),
       'teamsnap', ext, opp,
       ((((now() AT TIME ZONE 'America/Los_Angeles')::date + d) + ca) AT TIME ZONE 'America/Los_Angeles'),
       true, rsvp::teamsnap_rsvp_status
FROM (VALUES
  ('oscar@mason.io', 'c0000109-0000-4001-8001-000000000005', 'Soccer Game vs Lightning United', 'Gilman Fields', 6, time '10:00', time '11:30', time '09:15', 'Lightning United', 'no_reply', 'seeddev:o-game1'),
  ('oscar@mason.io', 'c0000109-0000-4001-8001-000000000005', 'Soccer Game vs Earthquakes Jr', 'Albany High', 13, time '09:00', time '10:30', time '08:15', 'Earthquakes Jr', 'going', 'seeddev:o-game2'),
  ('sebastian@mason.io', 'c0000109-0000-4001-8001-000000000007', 'Baseball Game vs Oakland Oaks', 'Bushrod Park', 7, time '11:00', time '13:00', time '10:00', 'Oakland Oaks', 'no_reply', 'seeddev:s-game1'),
  ('sebastian@mason.io', 'c0000109-0000-4001-8001-000000000007', 'Baseball Game vs Richmond Rockets', 'Nicholl Park', 14, time '12:00', time '14:00', time '11:00', 'Richmond Rockets', 'going', 'seeddev:s-game2')
) v(m, src, title, loc, d, cs, ce, ca, opp, rsvp, ext);
