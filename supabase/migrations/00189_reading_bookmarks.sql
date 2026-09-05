-- Bookmarks: a named PLACE in a book, as distinct from a marked passage.
--
-- The reader already has starring (00187), and it is not this. A star is a fact
-- about a passage — "these words mattered" — and it needs a selection to exist
-- at all. A bookmark is a fact about a spot: "I want to get back here", with no
-- claim that the sentence under it is worth quoting. Folding the two together
-- would have cost nothing in schema and everything in the marks panel, which is
-- a curated list of sentences and would have filled up with paragraph-openers
-- somebody saved to find their place.
--
-- Anchored by char_offset, the conversion character space (block-stream.ts) that
-- already holds reading position, chapter starts and the narration's timing map.
-- Everything a bookmark has to survive — a font-size change, a switch between
-- scrolling and pages, a Plain English swap, another device — is already true of
-- that space, so the jump is the reader's existing goToChar and none of it is
-- this feature's problem.
--
-- block_index and excerpt ride along for DISPLAY only. The contents dialog lists
-- bookmarks before the book's text is anything the dialog could read, and
-- fetching a book to render a list of four rows would be absurd; the excerpt is
-- captured at save time and stored as the row's own fallback label.
--
-- page_number is resolved server-side at save time, the way an annotation's
-- anchor_page is. Null when the book has no page map, which is most of them —
-- the UI then names the place by percentage instead.
--
-- Unique per spot: bookmarking the same block twice is the same bookmark, not
-- two. The header ribbon already renders solid when you are standing on one, so
-- this is the guard rather than the mechanism.
--
-- Idempotent throughout: one local Supabase instance is shared across Conductor
-- workspaces, so a migration can be re-applied against a database that already
-- has it.

CREATE TABLE IF NOT EXISTS reading_bookmarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Where, in the conversion char space. Snapped to the start of the block the
  -- reader was standing on, so two bookmarks made a scroll apart on the same
  -- paragraph are one bookmark.
  char_offset int NOT NULL,
  block_index int NOT NULL,

  -- Display only; see above.
  page_number int,
  excerpt     text,

  -- The reader's own name for the place. NULL is ordinary and expected: the
  -- dialog opens with an empty field and Enter saves it, which is the fast path.
  -- An unnamed bookmark is labelled by its excerpt.
  name        text,

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The list is always "this book, mine, in reading order".
CREATE INDEX IF NOT EXISTS idx_reading_bookmarks_order
  ON reading_bookmarks (book_id, user_id, char_offset);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_bookmarks_spot
  ON reading_bookmarks (book_id, user_id, char_offset);

ALTER TABLE reading_bookmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own rows" ON reading_bookmarks;
CREATE POLICY "Own rows" ON reading_bookmarks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE reading_bookmarks IS
  'A named place in a book, saved from the reading header. Distinct from a '
  'starred annotation: no selection, no text, never shown in the marks panel '
  'and never fed to the chat. Anchored by conversion char offset.';
