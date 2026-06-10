-- Dev-only Todos data: a believable week of family to-dos so every view has
-- content for every member — Inbox (incl. unseen tasks from others), Today,
-- Anytime/Someday (grouped by project), Snoozed (relative future wakes),
-- Delegated (cross-assigned tasks), and the Logbook (recent completions plus
-- one completed project).
--
-- Like the other seeds this never reaches prod (seeds run only on local
-- `supabase db reset` / CI), and it's safe to apply directly with psql on a
-- running local DB: every row has a fixed uuid and inserts are ON CONFLICT DO
-- NOTHING, so re-runs are no-ops and existing rows are never touched.
--
-- Dates are RELATIVE to now() so the data always looks fresh: snoozes wake
-- tomorrow/next week, completions happened over the past few days.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM family_members WHERE email = 'andrew@mason.io') THEN
    RAISE NOTICE 'Todos seed: family members missing (run 00_dev_family first); skipping.';
    RETURN;
  END IF;

  -- ── Areas ────────────────────────────────────────────────────────────────
  INSERT INTO todo_areas (id, name, sort_order) VALUES
    ('dd000000-0000-4000-8000-00000000a001', 'Home',   1),
    ('dd000000-0000-4000-8000-00000000a002', 'Kids',   2),
    ('dd000000-0000-4000-8000-00000000a003', 'Travel', 3)
  ON CONFLICT (id) DO NOTHING;

  -- ── Projects ─────────────────────────────────────────────────────────────
  INSERT INTO todo_projects (id, name, area_id, sort_order, completed_at, completed_by_email) VALUES
    ('dd000000-0000-4000-8000-00000000b001', 'Kitchen Remodel',
      'dd000000-0000-4000-8000-00000000a001', 1, NULL, NULL),
    ('dd000000-0000-4000-8000-00000000b002', 'Spring Yard Cleanup',
      'dd000000-0000-4000-8000-00000000a001', 2, NULL, NULL),
    ('dd000000-0000-4000-8000-00000000b003', 'Oscar''s Science Fair',
      'dd000000-0000-4000-8000-00000000a002', 3, NULL, NULL),
    ('dd000000-0000-4000-8000-00000000b004', 'Sebastian''s Birthday Party',
      'dd000000-0000-4000-8000-00000000a002', 4, NULL, NULL),
    ('dd000000-0000-4000-8000-00000000b005', 'Tahoe Summer Trip',
      'dd000000-0000-4000-8000-00000000a003', 5, NULL, NULL),
    -- Completed project → files into the Logbook alongside completed tasks.
    ('dd000000-0000-4000-8000-00000000b006', 'File 2025 Taxes',
      'dd000000-0000-4000-8000-00000000a001', 6, now() - interval '5 days', 'andrew@mason.io')
  ON CONFLICT (id) DO NOTHING;

  -- Membership = whose sidebar it's on + the assignable set.
  INSERT INTO todo_project_members (project_id, member_email) VALUES
    ('dd000000-0000-4000-8000-00000000b001', 'andrew@mason.io'),
    ('dd000000-0000-4000-8000-00000000b001', 'jenny@mason.io'),
    ('dd000000-0000-4000-8000-00000000b002', 'andrew@mason.io'),
    ('dd000000-0000-4000-8000-00000000b002', 'jenny@mason.io'),
    ('dd000000-0000-4000-8000-00000000b002', 'oscar@mason.io'),
    ('dd000000-0000-4000-8000-00000000b002', 'sebastian@mason.io'),
    ('dd000000-0000-4000-8000-00000000b003', 'andrew@mason.io'),
    ('dd000000-0000-4000-8000-00000000b003', 'oscar@mason.io'),
    ('dd000000-0000-4000-8000-00000000b004', 'jenny@mason.io'),
    ('dd000000-0000-4000-8000-00000000b004', 'andrew@mason.io'),
    ('dd000000-0000-4000-8000-00000000b004', 'sebastian@mason.io'),
    ('dd000000-0000-4000-8000-00000000b005', 'andrew@mason.io'),
    ('dd000000-0000-4000-8000-00000000b005', 'jenny@mason.io'),
    ('dd000000-0000-4000-8000-00000000b005', 'oscar@mason.io'),
    ('dd000000-0000-4000-8000-00000000b005', 'sebastian@mason.io'),
    ('dd000000-0000-4000-8000-00000000b006', 'andrew@mason.io'),
    ('dd000000-0000-4000-8000-00000000b006', 'jenny@mason.io')
  ON CONFLICT DO NOTHING;

  -- ── Tasks ────────────────────────────────────────────────────────────────
  -- (id suffix, title, notes, bucket, assignee, creator, project, snoozed_until,
  --  completed_at, seen) — assignee_seen_at NULL on fresh cross-assigned inbox
  -- tasks drives the "new from <person>" treatment + bell.
  INSERT INTO todo_tasks (
    id, title, notes_html, bucket, assignee_email, creator_email, project_id,
    snoozed_until, completed_at, completed_by_email, sort_order,
    assignee_seen_at, created_at
  ) VALUES

  -- ── Andrew ── Inbox
  ('dd000000-0000-4000-8000-00000000c001', 'Call the dentist about Oscar''s retainer',
    NULL, 'inbox', 'andrew@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 1, NULL, now() - interval '2 hours'),
  ('dd000000-0000-4000-8000-00000000c002', 'RSVP to the Hendersons'' BBQ',
    NULL, 'inbox', 'andrew@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 2, NULL, now() - interval '1 day'),
  ('dd000000-0000-4000-8000-00000000c003', 'Renew car registration before end of month',
    NULL, 'inbox', 'andrew@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 3, now(), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-00000000c004', 'Research e-bikes',
    '<p>Rad Power vs Aventon — swing by the local shop before ordering online.</p>',
    'inbox', 'andrew@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 4, now(), now() - interval '3 days'),

  -- ── Andrew ── Today
  ('dd000000-0000-4000-8000-00000000c005', 'Book Tahoe cabin for July',
    '<p>Aim for the week of the 4th. Dog-friendly if possible.</p>',
    'today', 'andrew@mason.io', 'jenny@mason.io',
    'dd000000-0000-4000-8000-00000000b005',
    NULL, NULL, NULL, 5, now(), now() - interval '1 day'),
  ('dd000000-0000-4000-8000-00000000c006', 'Pick up paint samples',
    NULL, 'today', 'andrew@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b001',
    NULL, NULL, NULL, 6, now(), now() - interval '1 day'),
  ('dd000000-0000-4000-8000-00000000c007', 'Fix the gate latch',
    NULL, 'today', 'andrew@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 7, now(), now() - interval '4 days'),
  ('dd000000-0000-4000-8000-00000000c008', 'Take out recycling',
    NULL, 'today', 'andrew@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 8, now(), now() - interval '6 hours'),

  -- ── Andrew ── Anytime
  ('dd000000-0000-4000-8000-00000000c009', 'Get quotes from two contractors',
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Call Hartman Bros</p></li><li data-type="taskItem" data-checked="false"><p>Call Rivera Construction</p></li></ul>',
    'anytime', 'andrew@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b001',
    NULL, NULL, NULL, 9, now(), now() - interval '6 days'),
  ('dd000000-0000-4000-8000-00000000c010', 'Measure for the new island',
    NULL, 'anytime', 'andrew@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b001',
    NULL, NULL, NULL, 10, now(), now() - interval '6 days'),
  ('dd000000-0000-4000-8000-00000000c011', 'Service the lawn mower',
    NULL, 'anytime', 'andrew@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b002',
    NULL, NULL, NULL, 11, now(), now() - interval '5 days'),
  ('dd000000-0000-4000-8000-00000000c012', 'Clean out the garage shelves',
    NULL, 'anytime', 'andrew@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 12, now(), now() - interval '8 days'),

  -- ── Andrew ── Someday
  ('dd000000-0000-4000-8000-00000000c013', 'Plan a Japan trip for spring break',
    '<p>Aim for cherry blossom season. Oscar wants the Kyoto train museum.</p>',
    'someday', 'andrew@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 13, now(), now() - interval '20 days'),
  ('dd000000-0000-4000-8000-00000000c014', 'Build a backyard pizza oven',
    NULL, 'someday', 'andrew@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 14, now(), now() - interval '30 days'),

  -- ── Andrew ── Snoozed (wakes pop into Today)
  ('dd000000-0000-4000-8000-00000000c015', 'Submit FSA receipts',
    NULL, 'today', 'andrew@mason.io', 'andrew@mason.io', NULL,
    date_trunc('day', now()) + interval '1 day 9 hours', NULL, NULL, 15,
    now(), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-00000000c016', 'Check on passport renewals',
    NULL, 'today', 'andrew@mason.io', 'andrew@mason.io', NULL,
    date_trunc('day', now()) + interval '14 days 8 hours', NULL, NULL, 16,
    now(), now() - interval '3 days'),

  -- ── Andrew ── Logbook
  ('dd000000-0000-4000-8000-00000000c017', 'Install new smoke detector batteries',
    NULL, 'today', 'andrew@mason.io', 'andrew@mason.io', NULL,
    NULL, now() - interval '1 day', 'andrew@mason.io', 17,
    now(), now() - interval '4 days'),
  ('dd000000-0000-4000-8000-00000000c018', 'Pay Oscar''s soccer registration',
    NULL, 'today', 'andrew@mason.io', 'jenny@mason.io', NULL,
    NULL, now() - interval '3 days', 'andrew@mason.io', 18,
    now(), now() - interval '6 days'),

  -- ── Jenny ── Inbox
  ('dd000000-0000-4000-8000-00000000c019', 'Find a plumber for the upstairs sink',
    NULL, 'inbox', 'jenny@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 19, NULL, now() - interval '3 hours'),
  ('dd000000-0000-4000-8000-00000000c020', 'Sign Sebastian up for swim lessons',
    NULL, 'inbox', 'jenny@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 20, now(), now() - interval '1 day'),

  -- ── Jenny ── Today
  ('dd000000-0000-4000-8000-00000000c021', 'Order Sebastian''s birthday cake',
    '<p>Dinosaur theme. Half chocolate, half vanilla.</p>',
    'today', 'jenny@mason.io', 'jenny@mason.io',
    'dd000000-0000-4000-8000-00000000b004',
    NULL, NULL, NULL, 21, now(), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-00000000c022', 'Call grandma about visit dates',
    NULL, 'today', 'jenny@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 22, now(), now() - interval '1 day'),
  ('dd000000-0000-4000-8000-00000000c023', 'Pack snacks for the soccer tournament',
    NULL, 'today', 'jenny@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 23, now(), now() - interval '5 hours'),

  -- ── Jenny ── Anytime
  ('dd000000-0000-4000-8000-00000000c024', 'Make the party guest list',
    '<p>Cap at 10 kids. Check with room parents about allergies.</p>',
    'anytime', 'jenny@mason.io', 'jenny@mason.io',
    'dd000000-0000-4000-8000-00000000b004',
    NULL, NULL, NULL, 24, now(), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-00000000c025', 'Buy decorations and goody bags',
    NULL, 'anytime', 'jenny@mason.io', 'jenny@mason.io',
    'dd000000-0000-4000-8000-00000000b004',
    NULL, NULL, NULL, 25, now(), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-00000000c026', 'Plan meals for the cabin week',
    NULL, 'anytime', 'jenny@mason.io', 'jenny@mason.io',
    'dd000000-0000-4000-8000-00000000b005',
    NULL, NULL, NULL, 26, now(), now() - interval '4 days'),
  ('dd000000-0000-4000-8000-00000000c027', 'Pick the backsplash tile',
    NULL, 'anytime', 'jenny@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b001',
    NULL, NULL, NULL, 27, now(), now() - interval '5 days'),

  -- ── Jenny ── Someday / Snoozed / Logbook
  ('dd000000-0000-4000-8000-00000000c028', 'Reupholster the reading chair',
    NULL, 'someday', 'jenny@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 28, now(), now() - interval '25 days'),
  ('dd000000-0000-4000-8000-00000000c029', 'Schedule the kids'' flu shots',
    NULL, 'today', 'jenny@mason.io', 'jenny@mason.io', NULL,
    date_trunc('day', now()) + interval '30 days 9 hours', NULL, NULL, 29,
    now(), now() - interval '3 days'),
  ('dd000000-0000-4000-8000-00000000c030', 'Book hotel for anniversary weekend',
    NULL, 'today', 'jenny@mason.io', 'jenny@mason.io', NULL,
    NULL, now() - interval '2 days', 'jenny@mason.io', 30,
    now(), now() - interval '7 days'),

  -- ── Oscar ── Inbox / Today
  ('dd000000-0000-4000-8000-00000000c031', 'Bring the permission slip back to school',
    NULL, 'inbox', 'oscar@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 31, NULL, now() - interval '5 hours'),
  ('dd000000-0000-4000-8000-00000000c032', 'Practice trumpet 20 minutes',
    NULL, 'today', 'oscar@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 32, now(), now() - interval '1 day'),
  ('dd000000-0000-4000-8000-00000000c033', 'Finish science fair hypothesis',
    NULL, 'today', 'oscar@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b003',
    NULL, NULL, NULL, 33, now(), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-00000000c034', 'Empty the dishwasher',
    NULL, 'today', 'oscar@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 34, now(), now() - interval '8 hours'),

  -- ── Oscar ── Anytime / Someday / Snoozed / Logbook
  ('dd000000-0000-4000-8000-00000000c035', 'Build the display board',
    NULL, 'anytime', 'oscar@mason.io', 'oscar@mason.io',
    'dd000000-0000-4000-8000-00000000b003',
    NULL, NULL, NULL, 35, now(), now() - interval '3 days'),
  ('dd000000-0000-4000-8000-00000000c036', 'Run the plant experiment trials',
    '<p>Water group A daily, group B every other day. Photo each morning.</p>',
    'anytime', 'oscar@mason.io', 'oscar@mason.io',
    'dd000000-0000-4000-8000-00000000b003',
    NULL, NULL, NULL, 36, now(), now() - interval '3 days'),
  ('dd000000-0000-4000-8000-00000000c037', 'Rake the side yard',
    NULL, 'anytime', 'oscar@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b002',
    NULL, NULL, NULL, 37, now(), now() - interval '4 days'),
  ('dd000000-0000-4000-8000-00000000c038', 'Save up for a new skateboard',
    NULL, 'someday', 'oscar@mason.io', 'oscar@mason.io', NULL,
    NULL, NULL, NULL, 38, now(), now() - interval '15 days'),
  ('dd000000-0000-4000-8000-00000000c039', 'Return library books',
    NULL, 'today', 'oscar@mason.io', 'jenny@mason.io', NULL,
    date_trunc('day', now()) + interval '3 days 10 hours', NULL, NULL, 39,
    now(), now() - interval '2 days'),
  ('dd000000-0000-4000-8000-00000000c040', 'Math homework p. 47',
    NULL, 'today', 'oscar@mason.io', 'jenny@mason.io', NULL,
    NULL, now() - interval '1 day', 'oscar@mason.io', 40,
    now(), now() - interval '2 days'),

  -- ── Sebastian ── everything
  ('dd000000-0000-4000-8000-00000000c041', 'Pick a theme for your party',
    NULL, 'inbox', 'sebastian@mason.io', 'jenny@mason.io',
    'dd000000-0000-4000-8000-00000000b004',
    NULL, NULL, NULL, 41, NULL, now() - interval '4 hours'),
  ('dd000000-0000-4000-8000-00000000c042', 'Feed the goldfish',
    NULL, 'today', 'sebastian@mason.io', 'andrew@mason.io', NULL,
    NULL, NULL, NULL, 42, now(), now() - interval '10 hours'),
  ('dd000000-0000-4000-8000-00000000c043', 'Reading log: 20 minutes',
    NULL, 'today', 'sebastian@mason.io', 'jenny@mason.io', NULL,
    NULL, NULL, NULL, 43, now(), now() - interval '1 day'),
  ('dd000000-0000-4000-8000-00000000c044', 'Pull weeds in the flower bed',
    NULL, 'anytime', 'sebastian@mason.io', 'andrew@mason.io',
    'dd000000-0000-4000-8000-00000000b002',
    NULL, NULL, NULL, 44, now(), now() - interval '4 days'),
  ('dd000000-0000-4000-8000-00000000c045', 'Choose three toys to pack for Tahoe',
    NULL, 'anytime', 'sebastian@mason.io', 'jenny@mason.io',
    'dd000000-0000-4000-8000-00000000b005',
    NULL, NULL, NULL, 45, now(), now() - interval '4 days'),
  ('dd000000-0000-4000-8000-00000000c046', 'Learn to ride without training wheels',
    NULL, 'someday', 'sebastian@mason.io', 'sebastian@mason.io', NULL,
    NULL, NULL, NULL, 46, now(), now() - interval '18 days'),
  ('dd000000-0000-4000-8000-00000000c047', 'Clean your room',
    NULL, 'today', 'sebastian@mason.io', 'jenny@mason.io', NULL,
    NULL, now() - interval '2 days', 'sebastian@mason.io', 47,
    now(), now() - interval '4 days')

  ON CONFLICT (id) DO NOTHING;
END $$;
