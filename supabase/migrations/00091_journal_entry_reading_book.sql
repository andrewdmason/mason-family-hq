-- Structurally link a journal entry to the book it's about.
--
-- The new `currently-reading` question type asks about the one book you're
-- reading right now; when you answer, the entry is tagged with that book so the
-- Reading list can show "entries about this book" on each book card.
--
-- ON DELETE SET NULL (not CASCADE): deleting a book must not delete the journal
-- entry — the reflection stands on its own; it just loses its book link.
-- Nullable: almost every entry has no book. No RLS change is needed — entry and
-- book are scoped by the same user_id, and the existing journal_entries policies
-- already gate the row.

ALTER TABLE journal_entries
  ADD COLUMN reading_book_id uuid REFERENCES reading_books(id) ON DELETE SET NULL;

CREATE INDEX idx_journal_entries_reading_book ON journal_entries(reading_book_id);
