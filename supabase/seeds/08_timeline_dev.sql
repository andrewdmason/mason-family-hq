-- Local-dev only: timeline events for Jenny and the kids, so the Family timeline
-- shows more than just Andrew's life, plus journal entries linked to some of them
-- to demo how reflections (and their photos) surface on an event's detail page and
-- as cover images on the timeline.
--
-- This is a SEED (runs only on `supabase db reset`, never on a prod deploy) — the
-- production timeline lives in migration 00094. The `people` rows it references
-- (Jenny Gillespie, Sebastian/Oscar Mason) are created by 00094, which runs first.
--
-- Photos are uploaded separately by seed-journal-photos.mjs (storage objects can't
-- be created from SQL); this file just links posts to events. Fixed uuids +
-- idempotent deletes make it safe to re-run. Skips cleanly if members are absent.

DO $$
DECLARE
  jenny     uuid := (SELECT id FROM auth.users WHERE email = 'jenny@mason.io');
  oscar     uuid := (SELECT id FROM auth.users WHERE email = 'oscar@mason.io');
  sebastian uuid := (SELECT id FROM auth.users WHERE email = 'sebastian@mason.io');
  p_jenny     uuid := (SELECT id FROM people WHERE name = 'Jenny Gillespie');
  p_oscar     uuid := (SELECT id FROM people WHERE name = 'Oscar Mason');
  p_sebastian uuid := (SELECT id FROM people WHERE name = 'Sebastian Mason');
BEGIN
  IF jenny IS NULL OR oscar IS NULL OR sebastian IS NULL THEN
    RAISE NOTICE 'Family members not found; skipping dev timeline seed.';
    RETURN;
  END IF;

  -- Idempotent: clear prior versions of the dev timeline events and new posts.
  DELETE FROM timeline_entries WHERE id IN (
    'c0000094-0000-4001-8001-000000000001','c0000094-0000-4001-8001-000000000002',
    'c0000094-0000-4001-8001-000000000003','c0000094-0000-4001-8001-000000000004',
    'c0000094-0000-4001-8001-000000000005','c0000094-0000-4001-8001-000000000006',
    'c0000094-0000-4001-8001-000000000007','c0000094-0000-4001-8001-000000000008',
    'c0000094-0000-4001-8001-000000000009'
  );
  DELETE FROM journal_entries WHERE id IN (
    'c0000002-0001-4001-8001-000000000002',
    'c0000002-0003-4001-8001-000000000002'
  );

  -- Timeline events. (category is the slug; prominence + precision drive rendering.)
  INSERT INTO timeline_entries
    (id, title, description, category, prominence, location, start_date, start_precision, end_date, end_precision, approximate) VALUES
    ('c0000094-0000-4001-8001-000000000001', 'Jenny born', 'Born in the Chicago area.', 'origins', 'major', 'Chicago, IL', '1982-01-01', 'year', NULL, NULL, false),
    ('c0000094-0000-4001-8001-000000000002', 'Released her debut album', 'Put out her first full-length record after years of writing and playing around the city.', 'recognition', 'medium', 'Chicago, IL', '2009-09-01', 'month', NULL, NULL, false),
    ('c0000094-0000-4001-8001-000000000003', 'Big Basin family camping trip', 'A weekend camping among the redwoods — cold mornings, a smoky dinner, the kids feral in the best way.', 'travel', 'minor', 'Big Basin, CA', '2026-05-23', 'day', '2026-05-25', 'day', false),
    ('c0000094-0000-4001-8001-000000000004', 'Oscar starts kindergarten', 'First day of kindergarten in Berkeley.', 'children_family', 'medium', 'Berkeley, CA', '2021-08-01', 'month', NULL, NULL, false),
    ('c0000094-0000-4001-8001-000000000005', 'Won the school science fair', 'His baking-soda volcano took first place at the school science fair.', 'recognition', 'medium', 'Berkeley, CA', '2026-05-26', 'day', NULL, NULL, false),
    ('c0000094-0000-4001-8001-000000000006', 'Lost his first tooth', 'The first wobbly tooth finally came out.', 'childhood', 'minor', 'Berkeley, CA', '2023-02-01', 'month', NULL, NULL, false),
    ('c0000094-0000-4001-8001-000000000007', 'First day at Bentley', 'Started at Bentley School after Berkwood Hedge.', 'education', 'medium', 'Berkeley, CA', '2022-08-01', 'month', NULL, NULL, false),
    ('c0000094-0000-4001-8001-000000000008', 'Scored his first soccer goal', 'Scored his first goal of the season and the whole team ran at him.', 'children_family', 'medium', 'Berkeley, CA', '2026-05-28', 'day', NULL, NULL, false),
    ('c0000094-0000-4001-8001-000000000009', 'Finished his first chapter book', 'Read all the way through his first real chapter book on his own.', 'childhood', 'minor', 'Berkeley, CA', '2024-11-01', 'month', NULL, NULL, false);

  -- Subjects: whose life each event belongs to (drives My/Family timelines).
  INSERT INTO timeline_entry_people (timeline_entry_id, person_id, role) VALUES
    ('c0000094-0000-4001-8001-000000000001', p_jenny, 'subject'),
    ('c0000094-0000-4001-8001-000000000002', p_jenny, 'subject'),
    ('c0000094-0000-4001-8001-000000000003', p_jenny, 'subject'),
    ('c0000094-0000-4001-8001-000000000003', p_sebastian, 'subject'),
    ('c0000094-0000-4001-8001-000000000003', p_oscar, 'subject'),
    ('c0000094-0000-4001-8001-000000000004', p_oscar, 'subject'),
    ('c0000094-0000-4001-8001-000000000005', p_oscar, 'subject'),
    ('c0000094-0000-4001-8001-000000000006', p_oscar, 'subject'),
    ('c0000094-0000-4001-8001-000000000007', p_sebastian, 'subject'),
    ('c0000094-0000-4001-8001-000000000008', p_sebastian, 'subject'),
    ('c0000094-0000-4001-8001-000000000009', p_sebastian, 'subject');

  -- Link the existing photo'd family posts (06_family_journal.sql) to events, so
  -- those events show a cover photo and list the reflection under "Written about".
  UPDATE journal_entries SET timeline_entry_id = 'c0000094-0000-4001-8001-000000000003'
    WHERE id = 'a0000002-0001-4001-8001-000000000001'; -- Jenny — camping
  UPDATE journal_entries SET timeline_entry_id = 'c0000094-0000-4001-8001-000000000005'
    WHERE id = 'a0000002-0002-4001-8001-000000000001'; -- Oscar — volcano
  UPDATE journal_entries SET timeline_entry_id = 'c0000094-0000-4001-8001-000000000008'
    WHERE id = 'a0000002-0003-4001-8001-000000000001'; -- Sebastian — soccer

  -- Two new posts, each linked to an event, that get their own photos.
  INSERT INTO journal_entries
    (id, user_id, entry_date, status, entry_type, visibility, opening_question, summary, title, pull_quote, summary_stale, timeline_entry_id, closed_at, created_at, updated_at) VALUES
    ('c0000002-0001-4001-8001-000000000002', jenny, '2009-09-20', 'closed', 'standard', 'family',
     'The record is finally out — how does it feel?',
     'Releasing the first album after years of writing it in the margins of everything else.',
     'the record is out',
     'It''s strange to hand people something you made in private and watch them carry it around.',
     false, 'c0000094-0000-4001-8001-000000000002',
     '2009-09-20 18:05:00+00', '2009-09-20 18:00:00+00', '2009-09-20 18:05:00+00'),
    ('c0000002-0003-4001-8001-000000000002', sebastian, '2024-11-10', 'closed', 'standard', 'family',
     'You finished your first big chapter book — what was it like?',
     'Read a whole chapter book by himself for the first time.',
     'finished my first big book',
     'The end made my chest feel big. I want to read the next one tonight.',
     false, 'c0000094-0000-4001-8001-000000000009',
     '2024-11-10 02:05:00+00', '2024-11-10 02:00:00+00', '2024-11-10 02:05:00+00');

  INSERT INTO journal_messages (entry_id, user_id, role, content, created_at) VALUES
    ('c0000002-0001-4001-8001-000000000002', jenny, 'assistant', 'The record is finally out — how does it feel?', '2009-09-20 18:01:30+00'),
    ('c0000002-0001-4001-8001-000000000002', jenny, 'user', 'It''s strange to hand people something you made in private and watch them carry it around. Proud and a little exposed all at once.', '2009-09-20 18:03:00+00'),
    ('c0000002-0003-4001-8001-000000000002', sebastian, 'assistant', 'You finished your first big chapter book — what was it like?', '2024-11-10 02:01:30+00'),
    ('c0000002-0003-4001-8001-000000000002', sebastian, 'user', 'The end made my chest feel big. I want to read the next one tonight!', '2024-11-10 02:03:00+00');
END $$;

-- More photo'd reflections, weighted to the EARLY events, so the left end of the
-- timeline has images too. Andrew's reflections link to his early-life events
-- (born, piano, the hustles, Fugazi, high-school graduation); one Jenny post links
-- to her birth. Photos are attached by seed-journal-photos.mjs.
DO $$
DECLARE
  andrew uuid := (SELECT id FROM auth.users WHERE email = 'andrew@mason.io');
  jenny  uuid := (SELECT id FROM auth.users WHERE email = 'jenny@mason.io');
BEGIN
  IF andrew IS NULL OR jenny IS NULL THEN
    RAISE NOTICE 'Members not found; skipping early timeline reflections.';
    RETURN;
  END IF;

  DELETE FROM journal_entries WHERE id IN (
    'c0000002-0000-4001-8001-000000000001','c0000002-0000-4001-8001-000000000002',
    'c0000002-0000-4001-8001-000000000003','c0000002-0000-4001-8001-000000000004',
    'c0000002-0000-4001-8001-000000000005','c0000002-0001-4001-8001-000000000003'
  );

  INSERT INTO journal_entries
    (id, user_id, entry_date, status, entry_type, visibility, opening_question, summary, title, pull_quote, summary_stale, timeline_entry_id, closed_at, created_at, updated_at) VALUES
    -- Andrew → Born in Pittsburgh (major)
    ('c0000002-0000-4001-8001-000000000001', andrew, '2024-02-10', 'closed', 'standard', 'family',
     'What do you carry from where you were born?',
     'Pittsburgh roots — the hills, the bridges, and two entrepreneur parents.',
     'where I started',
     'Two parents who made their own way taught me you could just build the life you wanted.',
     false, 'b0000094-0000-4001-8001-000000000001',
     '2024-02-10 17:05:00+00', '2024-02-10 17:00:00+00', '2024-02-10 17:05:00+00'),
    -- Andrew → Started piano at age six (medium)
    ('c0000002-0000-4001-8001-000000000002', andrew, '2024-03-04', 'closed', 'standard', 'family',
     'What was it like sitting down at the piano as a kid?',
     'The half-hour-a-day battle with the piano that somehow never let go of me.',
     'half an hour a day',
     'I thought I was good and couldn''t practice — both things stayed true for decades.',
     false, 'b0000094-0000-4001-8001-000000000003',
     '2024-03-04 17:05:00+00', '2024-03-04 17:00:00+00', '2024-03-04 17:05:00+00'),
    -- Andrew → Childhood entrepreneurial hustles (minor)
    ('c0000002-0000-4001-8001-000000000003', andrew, '2024-03-18', 'closed', 'standard', 'family',
     'Tell me about one of your little kid businesses.',
     'Bagel Express, cafeteria candy, and painting house numbers on curbs with Luke.',
     'the bagel years',
     'Selling candy until they shut me down — that was the first taste of building something.',
     false, 'b0000094-0000-4001-8001-000000000006',
     '2024-03-18 17:05:00+00', '2024-03-18 17:00:00+00', '2024-03-18 17:05:00+00'),
    -- Andrew → Got into Fugazi (minor)
    ('c0000002-0000-4001-8001-000000000004', andrew, '2024-04-01', 'closed', 'standard', 'family',
     'What did following Fugazi around mean to you?',
     'Billy Joel to Elton John to Fugazi — and chasing them from show to show.',
     'following Fugazi',
     'Their whole way of doing things on their own terms got into me early.',
     false, 'b0000094-0000-4001-8001-000000000007',
     '2024-04-01 17:05:00+00', '2024-04-01 17:00:00+00', '2024-04-01 17:05:00+00'),
    -- Andrew → Graduated Mt. Lebanon High School (medium)
    ('c0000002-0000-4001-8001-000000000005', andrew, '2024-04-15', 'closed', 'standard', 'family',
     'What were you like the day you finished high school?',
     'Walking out of Mt. Lebanon, restless and ready to leave Pittsburgh.',
     'leaving Mt. Lebanon',
     'I couldn''t wait to get out and find out who I''d be somewhere else.',
     false, 'b0000094-0000-4001-8001-000000000009',
     '2024-04-15 17:05:00+00', '2024-04-15 17:00:00+00', '2024-04-15 17:05:00+00'),
    -- Jenny → Jenny born (major)
    ('c0000002-0001-4001-8001-000000000003', jenny, '2024-05-06', 'closed', 'standard', 'family',
     'What do you know about the world you were born into?',
     'Chicago beginnings — the city that shaped her ear and her restlessness.',
     'a Chicago kid',
     'The city was loud and full of music before I ever picked an instrument.',
     false, 'c0000094-0000-4001-8001-000000000001',
     '2024-05-06 17:05:00+00', '2024-05-06 17:00:00+00', '2024-05-06 17:05:00+00');

  INSERT INTO journal_messages (entry_id, user_id, role, content, created_at) VALUES
    ('c0000002-0000-4001-8001-000000000001', andrew, 'assistant', 'What do you carry from where you were born?', '2024-02-10 17:01:00+00'),
    ('c0000002-0000-4001-8001-000000000001', andrew, 'user', 'Two parents who made their own way taught me you could just build the life you wanted.', '2024-02-10 17:03:00+00'),
    ('c0000002-0000-4001-8001-000000000002', andrew, 'assistant', 'What was it like sitting down at the piano as a kid?', '2024-03-04 17:01:00+00'),
    ('c0000002-0000-4001-8001-000000000002', andrew, 'user', 'I thought I was good and couldn''t practice more than a half hour a day. Both things stayed true for decades.', '2024-03-04 17:03:00+00'),
    ('c0000002-0000-4001-8001-000000000003', andrew, 'assistant', 'Tell me about one of your little kid businesses.', '2024-03-18 17:01:00+00'),
    ('c0000002-0000-4001-8001-000000000003', andrew, 'user', 'Bagel Express, candy in the cafeteria until they shut me down, painting house numbers on curbs with Luke.', '2024-03-18 17:03:00+00'),
    ('c0000002-0000-4001-8001-000000000004', andrew, 'assistant', 'What did following Fugazi around mean to you?', '2024-04-01 17:01:00+00'),
    ('c0000002-0000-4001-8001-000000000004', andrew, 'user', 'Their whole way of doing things on their own terms got into me early.', '2024-04-01 17:03:00+00'),
    ('c0000002-0000-4001-8001-000000000005', andrew, 'assistant', 'What were you like the day you finished high school?', '2024-04-15 17:01:00+00'),
    ('c0000002-0000-4001-8001-000000000005', andrew, 'user', 'Restless. I couldn''t wait to get out and find out who I''d be somewhere else.', '2024-04-15 17:03:00+00'),
    ('c0000002-0001-4001-8001-000000000003', jenny, 'assistant', 'What do you know about the world you were born into?', '2024-05-06 17:01:00+00'),
    ('c0000002-0001-4001-8001-000000000003', jenny, 'user', 'Chicago was loud and full of music before I ever picked an instrument.', '2024-05-06 17:03:00+00');
END $$;
