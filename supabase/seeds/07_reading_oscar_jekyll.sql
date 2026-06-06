-- Oscar's content-bearing demo book: "The Strange Case of Dr. Jekyll and Mr.
-- Hyde" (public domain, Project Gutenberg #43). Unlike the hand-seeded quizzes on
-- Sebastian's books, this one has REAL converted text with a page map, so it
-- exercises the full progression: pass/close a stretch quiz -> the next stretch's
-- quiz is generated from the actual book text. Runs after 07_reading.sql.
--
-- The book row, reading state, baseline check-in, and an active (published,
-- unattempted) check-in quiz live here. The converted content.html + page-map
-- rows are uploaded by supabase/seed-journal-photos.mjs after reset (storage
-- objects can't be seeded from SQL), keyed to the same fixed book id.
--
-- Mid-book state: Oscar is on p.40 of 148, aiming for p.90, with a check-in quiz
-- ready for the 40-90 stretch. The quiz's created_at is backdated to the prior
-- week so it reads as "Due now" in the Fri-Sun window (a stretch that began this
-- week isn't due until the next Friday — see lib/reading/quiz-due.ts).

DO $$
DECLARE
  andrew uuid := (SELECT id FROM auth.users WHERE email = 'andrew@mason.io');
  oscar  uuid := (SELECT id FROM auth.users WHERE email = 'oscar@mason.io');
  jekyll_book uuid := 'a0000003-0005-4001-8001-000000000001';
  jekyll_quiz uuid := 'a0000003-0005-4001-8002-000000000001';
  baseline date := date_trunc('week', current_date)::date - 7; -- prior Monday
BEGIN
  IF andrew IS NULL OR oscar IS NULL THEN
    RAISE NOTICE 'Family members not found; skipping Oscar reading seed.';
    RETURN;
  END IF;

  -- Idempotent: the book delete cascades to its content/pages/quiz/questions and
  -- check-ins; settings are keyed by email, so clear Oscar's separately.
  DELETE FROM reading_books WHERE id = jekyll_book;
  DELETE FROM reading_settings WHERE member_email = 'oscar@mason.io';

  INSERT INTO reading_settings (member_email, weekly_page_goal) VALUES
    ('oscar@mason.io', 50);

  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, target_page,
     target_locked, status, cover_image_url, started_at)
  VALUES
    (jekyll_book, oscar, 'The Strange Case of Dr. Jekyll and Mr. Hyde',
     'Robert Louis Stevenson', 148, 40, 90, false, 'in_progress',
     'https://covers.openlibrary.org/b/isbn/9780553212778-L.jpg?default=false',
     baseline);

  -- Baseline check-in (page at the start of the week) so "pages read this week"
  -- starts at 0.
  INSERT INTO reading_checkins (user_id, book_id, checked_on, page) VALUES
    (oscar, jekyll_book, baseline, 40);

  -- Active check-in quiz for the current 40-90 stretch. created_at is backdated
  -- so the stretch counts as begun before this week's Friday (reads "Due now").
  INSERT INTO reading_quizzes
    (id, user_id, book_id, from_page, through_page, status, title,
     created_by_email, source, published_at, created_at)
  VALUES
    (jekyll_quiz, oscar, jekyll_book, 40, 90, 'published',
     'The Strange Case of Dr. Jekyll and Mr. Hyde: pages 40-90',
     'andrew@mason.io', 'checkin', now(), baseline);

  -- Original comprehension questions about the public-domain story (the answer
  -- keys are written here, not extracted from the text).
  INSERT INTO reading_quiz_questions
    (id, quiz_id, user_id, position, type, prompt, options, correct_index,
     explanation, grading_rubric, sample_answer)
  VALUES
    (
      'a0000003-0005-4001-8003-000000000001',
      jekyll_quiz, oscar, 0, 'multiple_choice',
      'What is Mr. Utterson, the man whose point of view opens the story?',
      '["A lawyer", "A police detective", "A newspaper reporter", "A ship''s captain"]'::jsonb,
      0,
      'Utterson is a reserved lawyer; his loyalty to his friend Dr. Jekyll is what drives him to investigate.',
      NULL, NULL
    ),
    (
      'a0000003-0005-4001-8003-000000000002',
      jekyll_quiz, oscar, 1, 'multiple_choice',
      'What first makes Mr. Hyde seem sinister to the people who encounter him?',
      '["He tramples a young child in the street and coldly pays to hush it up", "He is unusually tall and loud", "He refuses to ever speak to anyone", "He gives away large sums of money"]'::jsonb,
      0,
      'The trampling of the child, and the calm payoff that follows, is the first sign of his cruelty.',
      NULL, NULL
    ),
    (
      'a0000003-0005-4001-8003-000000000003',
      jekyll_quiz, oscar, 2, 'multiple_choice',
      'Why is Mr. Utterson so disturbed by Dr. Jekyll''s will?',
      '["It leaves everything to Mr. Hyde if Jekyll dies or disappears", "It gives the estate away to strangers", "It has gone missing", "It names Utterson as the only heir"]'::jsonb,
      0,
      'The will''s bequest to the disreputable Hyde makes Utterson fear his friend is being threatened or blackmailed.',
      NULL, NULL
    ),
    (
      'a0000003-0005-4001-8003-000000000004',
      jekyll_quiz, oscar, 3, 'multiple_choice',
      'What violent event in the middle of the story alarms the whole city?',
      '["Mr. Hyde murders the elderly Sir Danvers Carew", "Dr. Jekyll''s house burns down", "Mr. Utterson is robbed", "A riot breaks out in the laboratory"]'::jsonb,
      0,
      'Carew''s murder by Hyde turns a private worry into a public manhunt.',
      NULL, NULL
    ),
    (
      'a0000003-0005-4001-8003-000000000005',
      jekyll_quiz, oscar, 4, 'free_text',
      'As the story goes on, how does Dr. Jekyll start to behave toward his old friends, and why does it worry them?',
      NULL, NULL, NULL,
      'A good answer notes that Jekyll withdraws and isolates himself, shutting himself away in his laboratory/cabinet and avoiding visitors, and seems anxious, secretive, or unwell — which makes friends like Utterson (and Lanyon) fear something is seriously wrong.',
      'Jekyll begins shutting himself away in his laboratory and avoiding his friends, acting nervous and secretive, which makes them afraid that something has gone badly wrong with him.'
    );
END $$;
