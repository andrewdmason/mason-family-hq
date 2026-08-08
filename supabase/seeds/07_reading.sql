-- Reading app demo data: the books Andrew and Sebastian are currently reading,
-- Andrew's finished shelf, their weekly page goals, and a baseline check-in for
-- each active book so weekly progress has an anchor. The members' auth users +
-- membership rows come from 00_dev_family.sql.
--
-- Fixed uuids keep this idempotent. Baseline check-ins for in-progress books are
-- dated to the Monday before the current reset week so "pages read this week"
-- starts at 0. Sebastian intentionally has a stale/urgent Hunger Games target
-- and a published, unpassed check-in quiz for that stretch:
--   Sebastian — The Hunger Games, on p.80, target p.130, quiz ready.
--   Andrew    — Demon Copperhead, on p.0,  target p.10.
-- Covers are Open Library by-ISBN URLs (default=false → 404 if missing, so the
-- UI falls back to a placeholder).

DO $$
DECLARE
  andrew    uuid := (SELECT id FROM auth.users WHERE email = 'andrew@mason.io');
  sebastian uuid := (SELECT id FROM auth.users WHERE email = 'sebastian@mason.io');
  andrew_book    uuid := 'a0000003-0001-4001-8001-000000000001';
  sebastian_book uuid := 'a0000003-0004-4001-8001-000000000001';
  sebastian_quiz uuid := 'a0000003-0004-4001-8002-000000000001';
  baseline date := date_trunc('week', current_date)::date - 7; -- prior Monday
  next_friday date := current_date
    + ((((5 - extract(dow FROM current_date)::int + 6) % 7) + 1)); -- first Friday after today
BEGIN
  IF andrew IS NULL OR sebastian IS NULL THEN
    RAISE NOTICE 'Family members not found; skipping reading seed.';
    RETURN;
  END IF;

  -- Idempotent: drop prior versions. Check-ins cascade off the book delete.
  DELETE FROM reading_books WHERE id IN (
    andrew_book,
    sebastian_book,
    'a0000003-0001-4001-8001-000000000002',
    'a0000003-0001-4001-8001-000000000003',
    'a0000003-0001-4001-8001-000000000004',
    'a0000003-0001-4001-8001-000000000005',
    'a0000003-0001-4001-8001-000000000006',
    'a0000003-0001-4001-8001-000000000007',
    'a0000003-0001-4001-8001-000000000008',
    'a0000003-0001-4001-8001-000000000009',
    'a0000003-0001-4001-8001-000000000010',
    'a0000003-0001-4001-8001-000000000011',
    'a0000003-0001-4001-8001-000000000012',
    'a0000003-0001-4001-8001-000000000013',
    'a0000003-0001-4001-8001-000000000014',
    'a0000003-0001-4001-8001-000000000015',
    'a0000003-0001-4001-8001-000000000016',
    'a0000003-0001-4001-8001-000000000017',
    'a0000003-0001-4001-8001-000000000018',
    'a0000003-0001-4001-8001-000000000019',
    'a0000003-0001-4001-8001-000000000020',
    'a0000003-0001-4001-8001-000000000021',
    'a0000003-0001-4001-8001-000000000022',
    'a0000003-0001-4001-8001-000000000023',
    'a0000003-0001-4001-8001-000000000024',
    'a0000003-0001-4001-8001-000000000025',
    'a0000003-0001-4001-8001-000000000026',
    'a0000003-0004-4001-8001-000000000002',
    'a0000003-0004-4001-8001-000000000003',
    'a0000003-0004-4001-8001-000000000004',
    'a0000003-0004-4001-8001-000000000005',
    'a0000003-0004-4001-8001-000000000006',
    'a0000003-0004-4001-8001-000000000007',
    'a0000003-0004-4001-8001-000000000008'
  );
  DELETE FROM reading_settings WHERE member_email IN ('andrew@mason.io', 'sebastian@mason.io');

  -- Weekly page goals (owner-managed, keyed by email).
  INSERT INTO reading_settings (member_email, weekly_page_goal) VALUES
    ('andrew@mason.io', 10),
    ('sebastian@mason.io', 50);

  -- Currently reading.
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, target_page, target_locked, target_due, status, cover_image_url, started_at)
  VALUES
    (andrew_book, andrew, 'Demon Copperhead', 'Barbara Kingsolver', 548, 0, 10, false, next_friday, 'in_progress',
      'https://covers.openlibrary.org/b/isbn/9780063251922-L.jpg?default=false', baseline),
    (sebastian_book, sebastian, 'The Hunger Games', 'Suzanne Collins', 374, 80, 130, true, next_friday, 'in_progress',
      'https://covers.openlibrary.org/b/isbn/9780439023481-L.jpg?default=false', baseline);

  -- Andrew's finished shelf, with emoji ratings — the taste signal Discover uses
  -- (loves literary Steinbeck + hard sci-fi; lukewarm on business books).
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, status, cover_image_url, finished_at, rating)
  VALUES
    ('a0000003-0001-4001-8001-000000000002', andrew, 'Good to Great', 'Jim Collins', 320, 320, 'archive',
      'https://covers.openlibrary.org/b/isbn/9780066620992-L.jpg?default=false', '2024-03-15', 'neutral'),
    ('a0000003-0001-4001-8001-000000000003', andrew, 'Of Mice and Men', 'John Steinbeck', 107, 107, 'archive',
      'https://covers.openlibrary.org/b/isbn/9780140177398-L.jpg?default=false', '2024-06-02', 'loved'),
    ('a0000003-0001-4001-8001-000000000004', andrew, 'East of Eden', 'John Steinbeck', 601, 601, 'archive',
      'https://covers.openlibrary.org/b/isbn/9780142004234-L.jpg?default=false', '2024-09-20', 'loved'),
    ('a0000003-0001-4001-8001-000000000005', andrew, 'The Three-Body Problem', 'Cixin Liu', 400, 400, 'archive',
      'https://covers.openlibrary.org/b/isbn/9780765382030-L.jpg?default=false', '2025-01-10', 'loved'),
    ('a0000003-0001-4001-8001-000000000006', andrew, 'The Dark Forest', 'Cixin Liu', 512, 512, 'archive',
      'https://covers.openlibrary.org/b/isbn/9780765386694-L.jpg?default=false', '2025-03-05', 'loved'),
    ('a0000003-0001-4001-8001-000000000007', andrew, 'Death''s End', 'Cixin Liu', 604, 604, 'archive',
      'https://covers.openlibrary.org/b/isbn/9780765377104-L.jpg?default=false', '2025-05-18', 'loved');

  -- Andrew's broader reading history, for evaluating the Discover recommender.
  -- Covers are Open Library by-id URLs resolved from a title+author search (more
  -- reliable than guessing ISBNs). "Children of Time" is archived with a
  -- 'didnt_finish' rating — a soft negative signal.
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, status, cover_image_url, finished_at, rating)
  VALUES
    ('a0000003-0001-4001-8001-000000000008', andrew, 'A World Appears', 'Michael Pollan', 300, 300, 'archive', 'https://covers.openlibrary.org/b/id/15182394-L.jpg', '2022-04-10', 'liked'),
    ('a0000003-0001-4001-8001-000000000009', andrew, 'Finding Meaning in the Second Half of Life', 'James Hollis', 288, 288, 'archive', 'https://covers.openlibrary.org/b/id/867931-L.jpg', '2022-08-22', 'loved'),
    ('a0000003-0001-4001-8001-000000000010', andrew, 'The Player of Games', 'Iain M. Banks', 309, 309, 'archive', 'https://covers.openlibrary.org/b/id/44077-L.jpg', '2023-01-15', 'neutral'),
    ('a0000003-0001-4001-8001-000000000011', andrew, 'Atonement', 'Ian McEwan', 351, 351, 'archive', 'https://covers.openlibrary.org/b/id/8381043-L.jpg', '2023-03-30', 'neutral'),
    ('a0000003-0001-4001-8001-000000000012', andrew, 'Flesh', 'David Szalay', 368, 368, 'archive', 'https://covers.openlibrary.org/b/id/15180002-L.jpg', '2025-09-12', 'loved'),
    ('a0000003-0001-4001-8001-000000000013', andrew, 'The City and Its Uncertain Walls', 'Haruki Murakami', 464, 464, 'archive', 'https://covers.openlibrary.org/b/id/14848268-L.jpg', '2025-02-18', 'liked'),
    ('a0000003-0001-4001-8001-000000000014', andrew, 'The Wind-Up Bird Chronicle', 'Haruki Murakami', 607, 607, 'archive', 'https://covers.openlibrary.org/b/isbn/9780679775430-L.jpg', '2021-11-05', 'loved'),
    ('a0000003-0001-4001-8001-000000000015', andrew, 'Never Let Me Go', 'Kazuo Ishiguro', 288, 288, 'archive', 'https://covers.openlibrary.org/b/id/1047334-L.jpg', '2021-06-14', 'loved'),
    ('a0000003-0001-4001-8001-000000000016', andrew, 'The Remains of the Day', 'Kazuo Ishiguro', 258, 258, 'archive', 'https://covers.openlibrary.org/b/id/95742-L.jpg', '2021-09-09', 'loved'),
    ('a0000003-0001-4001-8001-000000000017', andrew, 'The Buried Giant', 'Kazuo Ishiguro', 317, 317, 'archive', 'https://covers.openlibrary.org/b/id/12602978-L.jpg', '2022-02-01', 'loved'),
    ('a0000003-0001-4001-8001-000000000018', andrew, 'Klara and the Sun', 'Kazuo Ishiguro', 303, 303, 'archive', 'https://covers.openlibrary.org/b/id/10648686-L.jpg', '2023-07-19', 'loved'),
    ('a0000003-0001-4001-8001-000000000019', andrew, 'Crossroads', 'Jonathan Franzen', 580, 580, 'archive', 'https://covers.openlibrary.org/b/id/10884246-L.jpg', '2024-01-22', 'loved'),
    ('a0000003-0001-4001-8001-000000000020', andrew, 'The Corrections', 'Jonathan Franzen', 568, 568, 'archive', 'https://covers.openlibrary.org/b/id/9273701-L.jpg', '2024-04-08', 'loved'),
    ('a0000003-0001-4001-8001-000000000021', andrew, 'Great Expectations', 'Charles Dickens', 544, 544, 'archive', 'https://covers.openlibrary.org/b/id/13322313-L.jpg', '2020-12-25', 'loved'),
    ('a0000003-0001-4001-8001-000000000022', andrew, 'Exhalation', 'Ted Chiang', 350, 350, 'archive', 'https://covers.openlibrary.org/b/id/8793546-L.jpg', '2023-10-31', 'loved'),
    ('a0000003-0001-4001-8001-000000000023', andrew, 'Stories of Your Life and Others', 'Ted Chiang', 281, 281, 'archive', 'https://covers.openlibrary.org/b/id/524046-L.jpg', '2023-11-20', 'loved'),
    ('a0000003-0001-4001-8001-000000000024', andrew, 'The Grace in Dying', 'Kathleen Dowling Singh', 320, 320, 'archive', 'https://covers.openlibrary.org/b/id/48813-L.jpg', '2024-08-14', 'loved'),
    ('a0000003-0001-4001-8001-000000000025', andrew, 'My Struggle: Book 1', 'Karl Ove Knausgaard', 441, 441, 'archive', 'https://covers.openlibrary.org/b/id/13779214-L.jpg', '2024-11-03', 'liked'),
    ('a0000003-0001-4001-8001-000000000026', andrew, 'Children of Time', 'Adrian Tchaikovsky', 600, 180, 'archive', 'https://covers.openlibrary.org/b/id/8264706-L.jpg', NULL, 'didnt_finish');

  -- A recommendation in Sebastian's queue from Dad (Andrew), with a note. The
  -- label is resolved from the parent links at recommend time; seeded directly
  -- here to match (Sebastian's father is Andrew per 00075).
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, status, cover_image_url,
     recommended_by_email, recommended_by_label, recommendation_note)
  VALUES
    ('a0000003-0004-4001-8001-000000000002', sebastian, 'Project Hail Mary', 'Andy Weir',
      496, 0, 'queued',
      'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg?default=false',
      'andrew@mason.io', 'Dad',
      'You loved The Martian — this one''s even better, and the science is wild.');

  -- Sebastian's reading history (he's 12, born 2013-12-19), for evaluating the
  -- age-scaled recency weighting: early-childhood favorites he's likely outgrown
  -- (Dog Man / Wimpy Kid, loved at 8) should now carry far less weight than what
  -- he's loved recently at 12 (The Hobbit, Holes). finished_at sets the age then.
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, status, cover_image_url, finished_at, rating)
  VALUES
    ('a0000003-0004-4001-8001-000000000003', sebastian, 'Dog Man', 'Dav Pilkey', 240, 240, 'archive', 'https://covers.openlibrary.org/b/id/7894142-L.jpg', '2022-06-15', 'loved'),
    ('a0000003-0004-4001-8001-000000000004', sebastian, 'Diary of a Wimpy Kid', 'Jeff Kinney', 217, 217, 'archive', 'https://covers.openlibrary.org/b/id/14376136-L.jpg', '2022-09-10', 'loved'),
    ('a0000003-0004-4001-8001-000000000005', sebastian, 'The Bad Guys: Episode 1', 'Aaron Blabey', 144, 144, 'archive', 'https://covers.openlibrary.org/b/id/14420613-L.jpg', '2023-03-20', 'liked'),
    ('a0000003-0004-4001-8001-000000000006', sebastian, 'Percy Jackson: The Lightning Thief', 'Rick Riordan', 377, 377, 'archive', 'https://covers.openlibrary.org/b/id/7239831-L.jpg', '2024-08-01', 'loved'),
    ('a0000003-0004-4001-8001-000000000007', sebastian, 'The Hobbit', 'J.R.R. Tolkien', 310, 310, 'archive', 'https://covers.openlibrary.org/b/id/14627509-L.jpg', '2026-04-12', 'loved'),
    ('a0000003-0004-4001-8001-000000000008', sebastian, 'Holes', 'Louis Sachar', 233, 233, 'archive', 'https://covers.openlibrary.org/b/id/19797-L.jpg', '2026-05-20', 'liked');

  -- Stamp when each seeded rating was formed (recency signal for the recommender).
  -- Migrations run before seeds, so 00081's backfill doesn't see these rows.
  UPDATE reading_books
    SET rated_at = COALESCE(finished_at, created_at::date)
    WHERE rating IS NOT NULL AND rated_at IS NULL;

  -- What kind of book each one is (00177). Stamped here rather than inline in the
  -- INSERTs above, which mirrors how the app actually does it: a book is saved
  -- first and classified straight after, whichever of the six add paths created
  -- it. `genre_source = 'ai'` is what the backfill script checks, so seeded rows
  -- read as classifier output rather than hand corrections.
  --
  -- The spread is deliberate: eleven of the seventeen genres, both sides of the
  -- fiction line, and enough books per bucket that grouping the archive by genre
  -- shows something. Sebastian's shelf is almost entirely middle grade, which is
  -- what makes his Genre filter look different from Andrew's.
  --
  -- Note the two flags are set independently. `fiction` is the descriptive answer
  -- and the one the reader chat branches on; `spoiler_free` is the more cautious
  -- default seeding each new chat, and stays protective unless we positively know
  -- a book is non-fiction — so an unclassified book keeps it on.
  UPDATE reading_books AS b
    SET fiction = c.fiction,
        genre = c.genre,
        genre_source = 'ai',
        spoiler_free = c.fiction IS DISTINCT FROM false
    FROM (VALUES
      -- Currently reading
      (andrew_book,    true,  'literary_fiction'),
      (sebastian_book, true,  'middle_grade_ya'),
      -- Andrew's finished shelf
      ('a0000003-0001-4001-8001-000000000002'::uuid, false, 'business_leadership'),
      ('a0000003-0001-4001-8001-000000000003'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000004'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000005'::uuid, true,  'science_fiction'),
      ('a0000003-0001-4001-8001-000000000006'::uuid, true,  'science_fiction'),
      ('a0000003-0001-4001-8001-000000000007'::uuid, true,  'science_fiction'),
      -- Andrew's broader history
      ('a0000003-0001-4001-8001-000000000008'::uuid, false, 'science'),
      ('a0000003-0001-4001-8001-000000000009'::uuid, false, 'psychology_self'),
      ('a0000003-0001-4001-8001-000000000010'::uuid, true,  'science_fiction'),
      ('a0000003-0001-4001-8001-000000000011'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000012'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000013'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000014'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000015'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000016'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000017'::uuid, true,  'fantasy'),
      ('a0000003-0001-4001-8001-000000000018'::uuid, true,  'science_fiction'),
      ('a0000003-0001-4001-8001-000000000019'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000020'::uuid, true,  'literary_fiction'),
      ('a0000003-0001-4001-8001-000000000021'::uuid, true,  'classics'),
      ('a0000003-0001-4001-8001-000000000022'::uuid, true,  'short_stories'),
      ('a0000003-0001-4001-8001-000000000023'::uuid, true,  'short_stories'),
      ('a0000003-0001-4001-8001-000000000024'::uuid, false, 'health_mortality'),
      -- Autofiction: a life told as a novel. Filed as memoir per the taxonomy's
      -- own note, and marked non-fiction — a defensible call rather than an
      -- obvious one, which is exactly why the edit dialog can override it.
      ('a0000003-0001-4001-8001-000000000025'::uuid, false, 'biography_memoir'),
      ('a0000003-0001-4001-8001-000000000026'::uuid, true,  'science_fiction'),
      -- Sebastian's queue and history
      ('a0000003-0004-4001-8001-000000000002'::uuid, true,  'science_fiction'),
      ('a0000003-0004-4001-8001-000000000003'::uuid, true,  'middle_grade_ya'),
      ('a0000003-0004-4001-8001-000000000004'::uuid, true,  'middle_grade_ya'),
      ('a0000003-0004-4001-8001-000000000005'::uuid, true,  'middle_grade_ya'),
      ('a0000003-0004-4001-8001-000000000006'::uuid, true,  'middle_grade_ya'),
      ('a0000003-0004-4001-8001-000000000007'::uuid, true,  'fantasy'),
      ('a0000003-0004-4001-8001-000000000008'::uuid, true,  'middle_grade_ya')
    ) AS c(id, fiction, genre)
    WHERE b.id = c.id;

  -- Baseline check-ins (page at the start of the week) for the active books.
  INSERT INTO reading_checkins (user_id, book_id, checked_on, page) VALUES
    (andrew, andrew_book, baseline, 0),
    (sebastian, sebastian_book, baseline, 80);

  -- Sebastian has already hit the point where the next check-in is quiz-gated:
  -- a published, unpassed check-in quiz covers the current Hunger Games stretch.
  -- The quiz is seeded directly rather than generated from copyrighted source
  -- text, keeping local resets lightweight while still exercising the quiz flow.
  -- created_at is backdated to the prior week so the stretch counts as begun
  -- before this week's Friday and the quiz reads as "Due now" in the Fri-Sun
  -- window (a stretch begun this week isn't due until the next Friday — see
  -- lib/reading/quiz-due.ts).
  INSERT INTO reading_quizzes
    (id, user_id, book_id, from_page, through_page, status, title,
     created_by_email, source, published_at, created_at)
  VALUES
    (sebastian_quiz, sebastian, sebastian_book, 80, 130, 'published',
     'The Hunger Games: pages 80-130', 'andrew@mason.io', 'checkin', now(), baseline);

  INSERT INTO reading_quiz_questions
    (id, quiz_id, user_id, position, type, prompt, options, correct_index,
     explanation, grading_rubric, sample_answer)
  VALUES
    (
      'a0000003-0004-4001-8003-000000000001',
      sebastian_quiz,
      sebastian,
      0,
      'multiple_choice',
      'Why does Katniss need to become memorable before the Games begin?',
      '["So sponsors and viewers will notice and support her", "So the other tributes will ignore her", "So she can avoid training", "So the Capitol will send her home"]'::jsonb,
      0,
      'Tributes depend on attention and sponsor support, so standing out can become a survival advantage.',
      NULL,
      NULL
    ),
    (
      'a0000003-0004-4001-8003-000000000002',
      sebastian_quiz,
      sebastian,
      1,
      'multiple_choice',
      'What is one reason Katniss and Peeta are careful about what they reveal in training?',
      '["They want to keep some strengths hidden from competitors", "They are not allowed to touch any weapons", "They already know every skill perfectly", "They are trying to be eliminated early"]'::jsonb,
      0,
      'Training is public enough that showing too much can give rivals information they can use later.',
      NULL,
      NULL
    ),
    (
      'a0000003-0004-4001-8003-000000000003',
      sebastian_quiz,
      sebastian,
      2,
      'multiple_choice',
      'What does Katniss''s private session with the Gamemakers show about her?',
      '["She is skilled but also frustrated by being ignored", "She has decided not to compete at all", "She trusts the Capitol completely", "She has forgotten how to use a bow"]'::jsonb,
      0,
      'The scene shows both her ability and her temper when the people judging her treat her as unimportant.',
      NULL,
      NULL
    ),
    (
      'a0000003-0004-4001-8003-000000000004',
      sebastian_quiz,
      sebastian,
      3,
      'free_text',
      'How do Cinna and Haymitch each help Katniss before she enters the arena? Give one example for each.',
      NULL,
      NULL,
      NULL,
      'A strong answer should explain that Cinna helps shape Katniss''s public image and confidence, while Haymitch gives strategy about sponsors, training, or survival.',
      'Cinna helps Katniss look unforgettable and feel steadier in front of the Capitol. Haymitch helps her think strategically, especially about sponsors and how she presents herself.'
    );
END $$;
