-- Book categorization: a trustworthy fiction flag and one genre per book.
--
-- Why a new `fiction` column when `spoiler_free` already exists: spoiler_free was
-- seeded from the add-book AI lookup's fiction guess, but in practice it tracks
-- HOW a book was added rather than what it is. Everything added before 00166
-- inherited the DEFAULT false (so every Ishiguro and Steinbeck reads as
-- "not a story"); everything from the bulk Calibre import came in true (so
-- Thinking, Fast and Slow reads as one). The preface/afterword interviews branch
-- on it, which means ~100 books are currently interviewed through the wrong lens.
--
-- The two flags now have two jobs and must not be re-merged:
--   fiction      — descriptive truth. NULL is a real state ("genuinely unclear",
--                  e.g. autofiction). This is what the chat prompts branch on.
--   spoiler_free — a conservative safety default seeding each NEW chat's frozen
--                  boundary. Stays protective unless we positively know a book is
--                  non-fiction, because the harm is asymmetric: a spoiled novel
--                  can't be un-spoiled, an over-narrow non-fiction chat is one
--                  toggle away.
--
-- `genres text[]` (00166) is left alone: it stays the AI lookup's informational
-- free-text output. The shelf filters on the single constrained `genre` below,
-- because a free-form tag set on a 124-book library produces mostly singletons.
--
-- Idempotent throughout: one local Supabase instance is shared across Conductor
-- workspaces, so a migration can be re-applied against a database that already
-- has it.

ALTER TABLE reading_books ADD COLUMN IF NOT EXISTS fiction boolean;
ALTER TABLE reading_books ADD COLUMN IF NOT EXISTS genre text;
ALTER TABLE reading_books ADD COLUMN IF NOT EXISTS genre_source text;

-- The fixed taxonomy, fiction side first so grouping by genre reads as two
-- blocks. Kept in lockstep with src/lib/reading/book-genres.ts — that module is
-- the one the app and the classifier read; this constraint is the backstop.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reading_books_genre_check'
  ) THEN
    ALTER TABLE reading_books ADD CONSTRAINT reading_books_genre_check
      CHECK (genre IS NULL OR genre IN (
        'literary_fiction',
        'science_fiction',
        'fantasy',
        'mystery_thriller',
        'horror',
        'classics',
        'short_stories',
        'middle_grade_ya',
        'psychology_self',
        'spirituality_religion',
        'philosophy',
        'science',
        'history_politics',
        'business_leadership',
        'biography_memoir',
        'arts_music',
        'health_mortality'
      ));
  END IF;
END $$;

-- 'ai' = the classifier guessed it, 'manual' = the reader corrected it by hand.
-- The backfill refuses to overwrite 'manual', so a re-run never clobbers a fix.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reading_books_genre_source_check'
  ) THEN
    ALTER TABLE reading_books ADD CONSTRAINT reading_books_genre_source_check
      CHECK (genre_source IS NULL OR genre_source IN ('ai', 'manual'));
  END IF;
END $$;

-- The shelf loads every book and filters client-side, so this index is for the
-- backfill's "what's still unclassified" scan rather than for page loads.
CREATE INDEX IF NOT EXISTS idx_reading_books_user_genre
  ON reading_books (user_id, genre);
