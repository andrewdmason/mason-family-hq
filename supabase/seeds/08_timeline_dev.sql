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
