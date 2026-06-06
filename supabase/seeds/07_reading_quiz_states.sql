-- Reading-quiz demo states + flows (companion to 07_reading.sql, runs right after
-- it so Sebastian and his Hunger Games book already exist).
--
-- 07_reading.sql already gives Sebastian ONE state: a published, unattempted
-- check-in quiz on The Hunger Games. This file adds the rest so every state and
-- flow the quiz feature supports is visible after a `db reset`, all on Sebastian
-- so you can see them together by viewing his reading as the owner (andrew) or by
-- signing in as sebastian@mason.io. View the owner dashboard at /reader/quizzes.
--
--   STATE                          WHERE TO SEE IT
--   ── Due now (Fri–Sun) ───────── The Hunger Games card + dashboard (from 07).
--      Quiz ready (Mon–Thu)        The "Due now" badge only shows Fri–Sun; the
--                                  rest of the week the same quiz reads as ready.
--   ── Needs retake (failed) ───── Wonder card ("Needs retake") + dashboard.
--   ── Passed ──────────────────── Bridge to Terabithia: no quiz CTA on the card
--                                  (it disappears once passed) + "Passed" on the
--                                  dashboard.
--   ── Draft (owner only) ──────── A next-stretch draft on The Hunger Games:
--                                  hidden from Sebastian, "Draft" on the dashboard.
--   ── Generate quiz flow ──────── The Mapmaker's Lantern: an original demo book
--                                  with ready converted content. Owner can open
--                                  the card menu -> Generate quiz -> review ->
--                                  publish. Storage content is uploaded by
--                                  supabase/seed-journal-photos.mjs after reset.
--
--   FLOWS
--   ── Retake only the missed questions ── Open Wonder's quiz and retake: only the
--      two questions failed last time come back; the right ones carry forward.
--   ── Directional essay feedback ──────── Wonder's results page shows an amber
--      hint on the failed free-text answer (it nudges, never reveals the answer).
--   ── Take a fresh quiz ───────────────── The Hunger Games quiz, never attempted.
--
-- Fixed uuids keep this idempotent. Blocks by entity: 8001 books, 8002 quizzes,
-- 8003 questions, 8004 submissions, 8005 answers.

DO $$
DECLARE
  andrew    uuid := (SELECT id FROM auth.users WHERE email = 'andrew@mason.io');
  sebastian uuid := (SELECT id FROM auth.users WHERE email = 'sebastian@mason.io');

  hunger_book uuid := 'a0000003-0004-4001-8001-000000000001'; -- from 07_reading.sql
  wonder_book uuid := 'a0000003-0004-4001-8001-000000000009';
  bridge_book uuid := 'a0000003-0004-4001-8001-000000000010';
  generate_book uuid := 'a0000003-0004-4001-8001-000000000011';

  wonder_quiz uuid := 'a0000003-0004-4001-8002-000000000002';
  bridge_quiz uuid := 'a0000003-0004-4001-8002-000000000003';
  draft_quiz  uuid := 'a0000003-0004-4001-8002-000000000004';

  wonder_sub uuid := 'a0000003-0004-4001-8004-000000000001';
  bridge_sub uuid := 'a0000003-0004-4001-8004-000000000002';

  baseline date := date_trunc('week', current_date)::date - 7; -- prior Monday
BEGIN
  IF andrew IS NULL OR sebastian IS NULL THEN
    RAISE NOTICE 'Family members not found; skipping reading-quiz states seed.';
    RETURN;
  END IF;

  -- Idempotent. New books cascade to their quizzes/questions/submissions/answers
  -- and check-ins; the draft lives on the Hunger Games book (owned by 07) so it's
  -- removed by its own id rather than a book cascade.
  DELETE FROM reading_books WHERE id IN (wonder_book, bridge_book, generate_book);
  DELETE FROM reading_quizzes WHERE id = draft_quiz;

  -- Three more in-progress books for Sebastian to hang the remaining states and
  -- the owner generation flow on.
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, target_page, target_locked, status, cover_image_url, started_at)
  VALUES
    (wonder_book, sebastian, 'Wonder', 'R.J. Palacio', 315, 95, 140, true, 'in_progress',
      'https://covers.openlibrary.org/b/isbn/9780375869020-L.jpg?default=false', baseline),
    (bridge_book, sebastian, 'Bridge to Terabithia', 'Katherine Paterson', 190, 120, 160, true, 'in_progress',
      'https://covers.openlibrary.org/b/isbn/9780064401845-L.jpg?default=false', baseline),
    (generate_book, sebastian, 'The Mapmaker''s Lantern', 'Mason Demo Library', 24, 1, 20, true, 'in_progress',
      NULL, baseline);

  -- Baseline check-ins so "pages read this week" anchors at 0 for each.
  INSERT INTO reading_checkins (user_id, book_id, checked_on, page) VALUES
    (sebastian, wonder_book, baseline, 95),
    (sebastian, bridge_book, baseline, 120),
    (sebastian, generate_book, baseline, 1);

  -- ============================================================
  -- Wonder — FAILED attempt (needs retake) + a directional essay hint
  -- ============================================================
  INSERT INTO reading_quizzes
    (id, user_id, book_id, from_page, through_page, status, title,
     created_by_email, source, published_at)
  VALUES
    (wonder_quiz, sebastian, wonder_book, 95, 140, 'published',
     'Wonder: pages 95-140', 'andrew@mason.io', 'checkin', now());

  INSERT INTO reading_quiz_questions
    (id, quiz_id, user_id, position, type, prompt, options, correct_index,
     explanation, grading_rubric, sample_answer)
  VALUES
    ('a0000003-0004-4001-8003-000000000005', wonder_quiz, sebastian, 0,
     'multiple_choice',
     'Why does Auggie love wearing his old astronaut helmet at the start of the school year?',
     '["It hides his face so people cannot stare at him", "It is part of the school uniform", "It helps him see in the dark", "It was a prize from Mr. Tushman"]'::jsonb,
     0,
     'The helmet lets Auggie avoid the stares he dreads, so it is really about hiding.',
     NULL, NULL),
    ('a0000003-0004-4001-8003-000000000006', wonder_quiz, sebastian, 1,
     'multiple_choice',
     'How does Jack''s friendship with Auggie change after the Halloween costumes?',
     '["Jack realizes he was wrong and stands up for Auggie", "Jack stops speaking to Auggie for good", "Jack transfers to another school", "Jack was never really Auggie''s friend"]'::jsonb,
     0,
     'Jack regrets what Auggie overheard and works to repair the friendship, eventually defending him.',
     NULL, NULL),
    ('a0000003-0004-4001-8003-000000000007', wonder_quiz, sebastian, 2,
     'multiple_choice',
     'What is the precept Mr. Browne asks the class to remember?',
     '["When given the choice between being right or being kind, choose kind", "Always finish your homework first", "Never trust a new student", "Winning is everything"]'::jsonb,
     0,
     'Mr. Browne''s precept about choosing kindness is a thread running through the whole book.',
     NULL, NULL),
    ('a0000003-0004-4001-8003-000000000008', wonder_quiz, sebastian, 3,
     'free_text',
     'By the end of the year, how has the way other kids treat Auggie changed? Give one example.',
     NULL, NULL, NULL,
     'A strong answer notes that classmates come to respect and accept Auggie — for example the standing ovation at graduation, or kids who once avoided him now treating him as a friend.',
     'By the end the other kids respect Auggie instead of avoiding him. At graduation he gets a standing ovation and is treated like a real friend.');

  -- One failed attempt: 2 of 4 right. Q1 (MC) and Q4 (free-text) are wrong, so a
  -- retake re-asks exactly those two. The free-text answer carries the directional
  -- hint the new grader produces (it nudges without giving away the answer).
  INSERT INTO reading_quiz_submissions
    (id, quiz_id, user_id, attempt_number, submitted_at, score_correct, score_total, grading_complete)
  VALUES
    (wonder_sub, wonder_quiz, sebastian, 1, now() - interval '1 day', 2, 4, true);

  INSERT INTO reading_quiz_answers
    (id, submission_id, question_id, user_id, selected_index, response_text, is_correct, ai_notes)
  VALUES
    ('a0000003-0004-4001-8005-000000000001', wonder_sub,
     'a0000003-0004-4001-8003-000000000005', sebastian, 0, NULL, true, NULL),
    ('a0000003-0004-4001-8005-000000000002', wonder_sub,
     'a0000003-0004-4001-8003-000000000006', sebastian, 1, NULL, false, NULL),
    ('a0000003-0004-4001-8005-000000000003', wonder_sub,
     'a0000003-0004-4001-8003-000000000007', sebastian, 0, NULL, true, NULL),
    ('a0000003-0004-4001-8005-000000000004', wonder_sub,
     'a0000003-0004-4001-8003-000000000008', sebastian, NULL,
     'He likes outer space and wears a helmet.', false,
     'You are noticing the helmet, which matters early on — but look again at how the kids around Auggie act near the END of the year, especially at the graduation assembly. What is different about the way they treat him then?');

  -- ============================================================
  -- Bridge to Terabithia — PASSED (no quiz CTA on the card; "Passed" on dashboard)
  -- ============================================================
  INSERT INTO reading_quizzes
    (id, user_id, book_id, from_page, through_page, status, title,
     created_by_email, source, published_at)
  VALUES
    (bridge_quiz, sebastian, bridge_book, 120, 160, 'published',
     'Bridge to Terabithia: pages 120-160', 'andrew@mason.io', 'checkin', now());

  INSERT INTO reading_quiz_questions
    (id, quiz_id, user_id, position, type, prompt, options, correct_index,
     explanation, grading_rubric, sample_answer)
  VALUES
    ('a0000003-0004-4001-8003-000000000009', bridge_quiz, sebastian, 0,
     'multiple_choice',
     'What is Terabithia?',
     '["A make-believe kingdom Jess and Leslie rule in the woods", "Leslie''s house", "Their school", "A board game"]'::jsonb,
     0,
     'Terabithia is the imaginary kingdom the two friends create across the creek.',
     NULL, NULL),
    ('a0000003-0004-4001-8003-000000000010', bridge_quiz, sebastian, 1,
     'multiple_choice',
     'How do Jess and Leslie get across to Terabithia?',
     '["They swing over the creek on a rope", "They ride a bus", "They climb a ladder", "They walk through a tunnel"]'::jsonb,
     0,
     'The rope swing over the creek is the only way into Terabithia.',
     NULL, NULL),
    ('a0000003-0004-4001-8003-000000000011', bridge_quiz, sebastian, 2,
     'multiple_choice',
     'How does Leslie most help Jess?',
     '["She gives him confidence in his imagination and his drawing", "She buys him a new bike", "She does his chores", "She teaches him to swim"]'::jsonb,
     0,
     'Leslie opens up Jess''s imagination and encourages his art, which changes how he sees himself.',
     NULL, NULL),
    ('a0000003-0004-4001-8003-000000000012', bridge_quiz, sebastian, 3,
     'free_text',
     'Why is Leslie''s friendship so important to Jess? Give one reason.',
     NULL, NULL, NULL,
     'A strong answer explains that Leslie helps Jess grow — opening his imagination, encouraging his art, and giving him courage and confidence he did not have before.',
     'Leslie helps Jess believe in himself. She shares her imagination, cheers on his drawing, and gives him the courage to be who he really is.');

  INSERT INTO reading_quiz_submissions
    (id, quiz_id, user_id, attempt_number, submitted_at, score_correct, score_total, grading_complete)
  VALUES
    (bridge_sub, bridge_quiz, sebastian, 1, now() - interval '3 days', 4, 4, true);

  INSERT INTO reading_quiz_answers
    (id, submission_id, question_id, user_id, selected_index, response_text, is_correct, ai_notes)
  VALUES
    ('a0000003-0004-4001-8005-000000000005', bridge_sub,
     'a0000003-0004-4001-8003-000000000009', sebastian, 0, NULL, true, NULL),
    ('a0000003-0004-4001-8005-000000000006', bridge_sub,
     'a0000003-0004-4001-8003-000000000010', sebastian, 0, NULL, true, NULL),
    ('a0000003-0004-4001-8005-000000000007', bridge_sub,
     'a0000003-0004-4001-8003-000000000011', sebastian, 0, NULL, true, NULL),
    ('a0000003-0004-4001-8005-000000000008', bridge_sub,
     'a0000003-0004-4001-8003-000000000012', sebastian, NULL,
     'Leslie shares her imagination and cheers on his drawing, so he believes in himself more.',
     true,
     'Exactly right — you captured how Leslie opens up his imagination and gives him confidence. Lovely answer!');

  -- ============================================================
  -- The Hunger Games — DRAFT next-stretch quiz (owner only)
  -- ============================================================
  INSERT INTO reading_quizzes
    (id, user_id, book_id, from_page, through_page, status, title,
     created_by_email, source, published_at)
  VALUES
    (draft_quiz, sebastian, hunger_book, 130, 180, 'draft',
     'The Hunger Games: pages 130-180', 'andrew@mason.io', 'manual', NULL);

  INSERT INTO reading_quiz_questions
    (id, quiz_id, user_id, position, type, prompt, options, correct_index,
     explanation, grading_rubric, sample_answer)
  VALUES
    ('a0000003-0004-4001-8003-000000000013', draft_quiz, sebastian, 0,
     'multiple_choice',
     'What does Katniss''s high training score change for her going into the interviews?',
     '["It draws more attention and raises expectations from sponsors and rivals", "It lets her skip the interviews", "It means she can leave the Games", "It hides her from the other tributes"]'::jsonb,
     0,
     'A surprising score puts a spotlight on her, which cuts both ways before the Games.',
     NULL, NULL),
    ('a0000003-0004-4001-8003-000000000014', draft_quiz, sebastian, 1,
     'free_text',
     'Explain how Katniss''s training score affects how the Capitol and the other tributes see her.',
     NULL, NULL, NULL,
     'A strong answer explains that the high score makes her stand out — sponsors take more interest while rival tributes may see her as a bigger threat.',
     'The high score makes Katniss a standout. Sponsors pay more attention to her, but it also marks her as a threat the other tributes will watch for.');

  RAISE NOTICE 'Seeded reading-quiz states: Wonder (failed/retake), Bridge to Terabithia (passed), Hunger Games draft.';
END $$;
