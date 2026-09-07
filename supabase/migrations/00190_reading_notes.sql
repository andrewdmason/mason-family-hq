-- Notes: one free-form document per reader per book.
--
-- The third thing the reader can write in a book, after marks and the two
-- interviewed documents, and unlike either of them. A mark is anchored to a
-- passage and can't exist without one; the preface and afterword are written
-- BY the app from a conversation. This is a page of the reader's own, written
-- by hand, tied to nothing in particular — the flyleaf, where a thought goes
-- when it isn't about the sentence under the cursor.
--
-- Places in the book are inline tokens inside the text, not columns here. The
-- text is markdown, and a place is a link in it of the form
-- [p. 41](place:12345) — see notes.ts — which is what lets the reader move,
-- cut and reorder around one like any other word. Anchoring rows to positions
-- was considered and rejected: it makes a log, and the point of a document is
-- that you can go back and rework it.
--
-- One row per (book, reader), and the unique index is the whole model: there
-- is nothing to list, nothing to name, and opening the notepad is opening THE
-- notepad. Private to the reader — never shared, never emailed, and read by the
-- assistant only as background.
--
-- Idempotent throughout: one local Supabase instance is shared across Conductor
-- workspaces, so a migration can be re-applied against a database that already
-- has it.

CREATE TABLE IF NOT EXISTS reading_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Markdown, with place links inline. Empty is a legitimate state: opening
  -- the notepad creates the row, and a reader who typed nothing has a note
  -- that says nothing.
  content     text NOT NULL DEFAULT '',

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_notes_book
  ON reading_notes (book_id, user_id);

DROP TRIGGER IF EXISTS reading_notes_updated_at ON reading_notes;
CREATE TRIGGER reading_notes_updated_at
  BEFORE UPDATE ON reading_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own rows" ON reading_notes;
CREATE POLICY "Own rows" ON reading_notes FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE reading_notes IS
  'The reader''s own notepad for a book: one markdown document per reader per '
  'book, with places in the book as inline [label](place:CHAR) links. Private; '
  'never shared. Read by the assistant as background only.';

NOTIFY pgrst, 'reload schema';
