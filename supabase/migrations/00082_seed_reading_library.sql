-- Populate the curated reading library (Andrew's + Sebastian's books, ratings,
-- and the one cross-recommendation) into any environment where those accounts
-- exist — i.e. production. This mirrors supabase/seeds/07_reading.sql, but as a
-- production-safe one-shot rather than a dev reseed:
--   * keyed off the accounts by email; skipped entirely if they haven't signed in
--   * ON CONFLICT (id) DO NOTHING, so re-runs / overlap are harmless
--   * fixed UUIDs match the dev seed, so the two environments stay consistent
--
-- Locally this is a no-op: at migration time the dev family doesn't exist yet
-- (00_dev_family.sql runs later, in the seed phase), so the lookups are NULL and
-- 07_reading.sql owns the local data. Covers are Open Library URLs (by cover-id
-- where resolved via title/author search, by ISBN for the rest).

DO $$
DECLARE
  andrew    uuid := (SELECT id FROM auth.users WHERE email = 'andrew@mason.io');
  sebastian uuid := (SELECT id FROM auth.users WHERE email = 'sebastian@mason.io');
BEGIN
  IF andrew IS NOT NULL THEN
    INSERT INTO reading_books
      (id, user_id, title, author, total_pages, current_page, status, cover_image_url, finished_at, rating)
    VALUES
      ('a0000003-0001-4001-8001-000000000001', andrew, 'Demon Copperhead', 'Barbara Kingsolver', 548, 0, 'in_progress', 'https://covers.openlibrary.org/b/isbn/9780063251922-L.jpg?default=false', NULL, NULL),
      ('a0000003-0001-4001-8001-000000000002', andrew, 'Good to Great', 'Jim Collins', 320, 320, 'archive', 'https://covers.openlibrary.org/b/isbn/9780066620992-L.jpg?default=false', '2024-03-15', 'neutral'),
      ('a0000003-0001-4001-8001-000000000003', andrew, 'Of Mice and Men', 'John Steinbeck', 107, 107, 'archive', 'https://covers.openlibrary.org/b/isbn/9780140177398-L.jpg?default=false', '2024-06-02', 'loved'),
      ('a0000003-0001-4001-8001-000000000004', andrew, 'East of Eden', 'John Steinbeck', 601, 601, 'archive', 'https://covers.openlibrary.org/b/isbn/9780142004234-L.jpg?default=false', '2024-09-20', 'loved'),
      ('a0000003-0001-4001-8001-000000000005', andrew, 'The Three-Body Problem', 'Cixin Liu', 400, 400, 'archive', 'https://covers.openlibrary.org/b/isbn/9780765382030-L.jpg?default=false', '2025-01-10', 'loved'),
      ('a0000003-0001-4001-8001-000000000006', andrew, 'The Dark Forest', 'Cixin Liu', 512, 512, 'archive', 'https://covers.openlibrary.org/b/isbn/9780765386694-L.jpg?default=false', '2025-03-05', 'loved'),
      ('a0000003-0001-4001-8001-000000000007', andrew, 'Death''s End', 'Cixin Liu', 604, 604, 'archive', 'https://covers.openlibrary.org/b/isbn/9780765377104-L.jpg?default=false', '2025-05-18', 'loved'),
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
      ('a0000003-0001-4001-8001-000000000026', andrew, 'Children of Time', 'Adrian Tchaikovsky', 600, 180, 'archive', 'https://covers.openlibrary.org/b/id/8264706-L.jpg', NULL, 'didnt_finish')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF sebastian IS NOT NULL THEN
    INSERT INTO reading_books
      (id, user_id, title, author, total_pages, current_page, status, cover_image_url, finished_at, rating)
    VALUES
      ('a0000003-0004-4001-8001-000000000001', sebastian, 'The Hunger Games', 'Suzanne Collins', 374, 80, 'in_progress', 'https://covers.openlibrary.org/b/isbn/9780439023481-L.jpg?default=false', NULL, NULL),
      ('a0000003-0004-4001-8001-000000000003', sebastian, 'Dog Man', 'Dav Pilkey', 240, 240, 'archive', 'https://covers.openlibrary.org/b/id/7894142-L.jpg', '2022-06-15', 'loved'),
      ('a0000003-0004-4001-8001-000000000004', sebastian, 'Diary of a Wimpy Kid', 'Jeff Kinney', 217, 217, 'archive', 'https://covers.openlibrary.org/b/id/14376136-L.jpg', '2022-09-10', 'loved'),
      ('a0000003-0004-4001-8001-000000000005', sebastian, 'The Bad Guys: Episode 1', 'Aaron Blabey', 144, 144, 'archive', 'https://covers.openlibrary.org/b/id/14420613-L.jpg', '2023-03-20', 'liked'),
      ('a0000003-0004-4001-8001-000000000006', sebastian, 'Percy Jackson: The Lightning Thief', 'Rick Riordan', 377, 377, 'archive', 'https://covers.openlibrary.org/b/id/7239831-L.jpg', '2024-08-01', 'loved'),
      ('a0000003-0004-4001-8001-000000000007', sebastian, 'The Hobbit', 'J.R.R. Tolkien', 310, 310, 'archive', 'https://covers.openlibrary.org/b/id/14627509-L.jpg', '2026-04-12', 'loved'),
      ('a0000003-0004-4001-8001-000000000008', sebastian, 'Holes', 'Louis Sachar', 233, 233, 'archive', 'https://covers.openlibrary.org/b/id/19797-L.jpg', '2026-05-20', 'liked')
    ON CONFLICT (id) DO NOTHING;

    -- A recommendation in Sebastian's queue from Dad (Andrew).
    INSERT INTO reading_books
      (id, user_id, title, author, total_pages, current_page, status, cover_image_url,
       recommended_by_email, recommended_by_label, recommendation_note)
    VALUES
      ('a0000003-0004-4001-8001-000000000002', sebastian, 'Project Hail Mary', 'Andy Weir', 496, 0, 'queued',
        'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg?default=false',
        'andrew@mason.io', 'Dad',
        'You loved The Martian — this one''s even better, and the science is wild.')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Stamp when each rating was formed (recency signal for the recommender):
  -- their finish date, or — for unfinished "didn't like"/"didn't finish" — today.
  UPDATE reading_books
    SET rated_at = COALESCE(finished_at, created_at::date)
    WHERE rating IS NOT NULL AND rated_at IS NULL
      AND user_id IN (andrew, sebastian);
END $$;
