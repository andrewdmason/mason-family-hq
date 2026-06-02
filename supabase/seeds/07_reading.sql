-- Reading app demo data: the books Andrew and Sebastian are currently reading,
-- Andrew's finished shelf, their weekly page goals, and a baseline check-in for
-- each active book so weekly progress has an anchor. The members' auth users +
-- membership rows come from 00_dev_family.sql.
--
-- Fixed uuids keep this idempotent. Baseline check-ins for in-progress books are
-- dated to the Sunday before the demo week (2026-05-31) so "pages read this week"
-- starts at 0 and the week's target = baseline page + goal:
--   Sebastian — The Hunger Games, on p.80, goal 50 → reach p.130 by Sunday.
--   Andrew    — Demon Copperhead, on p.0,  goal 10 → reach p.10  by Sunday.
-- Covers are Open Library by-ISBN URLs (default=false → 404 if missing, so the
-- UI falls back to a placeholder).

DO $$
DECLARE
  andrew    uuid := (SELECT id FROM auth.users WHERE email = 'andrew@mason.io');
  sebastian uuid := (SELECT id FROM auth.users WHERE email = 'sebastian@mason.io');
  andrew_book    uuid := 'a0000003-0001-4001-8001-000000000001';
  sebastian_book uuid := 'a0000003-0004-4001-8001-000000000001';
  baseline date := '2026-05-31'; -- the Sunday before the demo week
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
    'a0000003-0004-4001-8001-000000000002'
  );
  DELETE FROM reading_settings WHERE member_email IN ('andrew@mason.io', 'sebastian@mason.io');

  -- Weekly page goals (owner-managed, keyed by email).
  INSERT INTO reading_settings (member_email, weekly_page_goal) VALUES
    ('andrew@mason.io', 10),
    ('sebastian@mason.io', 50);

  -- Currently reading.
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, status, cover_image_url, started_at)
  VALUES
    (andrew_book, andrew, 'Demon Copperhead', 'Barbara Kingsolver', 548, 0, 'in_progress',
      'https://covers.openlibrary.org/b/isbn/9780063251922-L.jpg?default=false', baseline),
    (sebastian_book, sebastian, 'The Hunger Games', 'Suzanne Collins', 374, 80, 'in_progress',
      'https://covers.openlibrary.org/b/isbn/9780439023481-L.jpg?default=false', baseline);

  -- Andrew's finished shelf.
  INSERT INTO reading_books
    (id, user_id, title, author, total_pages, current_page, status, cover_image_url, finished_at)
  VALUES
    ('a0000003-0001-4001-8001-000000000002', andrew, 'Good to Great', 'Jim Collins', 320, 320, 'completed',
      'https://covers.openlibrary.org/b/isbn/9780066620992-L.jpg?default=false', '2024-03-15'),
    ('a0000003-0001-4001-8001-000000000003', andrew, 'Of Mice and Men', 'John Steinbeck', 107, 107, 'completed',
      'https://covers.openlibrary.org/b/isbn/9780140177398-L.jpg?default=false', '2024-06-02'),
    ('a0000003-0001-4001-8001-000000000004', andrew, 'East of Eden', 'John Steinbeck', 601, 601, 'completed',
      'https://covers.openlibrary.org/b/isbn/9780142004234-L.jpg?default=false', '2024-09-20'),
    ('a0000003-0001-4001-8001-000000000005', andrew, 'The Three-Body Problem', 'Cixin Liu', 400, 400, 'completed',
      'https://covers.openlibrary.org/b/isbn/9780765382030-L.jpg?default=false', '2025-01-10'),
    ('a0000003-0001-4001-8001-000000000006', andrew, 'The Dark Forest', 'Cixin Liu', 512, 512, 'completed',
      'https://covers.openlibrary.org/b/isbn/9780765386694-L.jpg?default=false', '2025-03-05'),
    ('a0000003-0001-4001-8001-000000000007', andrew, 'Death''s End', 'Cixin Liu', 604, 604, 'completed',
      'https://covers.openlibrary.org/b/isbn/9780765377104-L.jpg?default=false', '2025-05-18');

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

  -- Baseline check-ins (page at the start of the week) for the active books.
  INSERT INTO reading_checkins (user_id, book_id, checked_on, page) VALUES
    (andrew, andrew_book, baseline, 0),
    (sebastian, sebastian_book, baseline, 80);
END $$;
