-- Stable identifiers and publication year captured when a book is added from the
-- Open Library typeahead. The identifiers let us re-fetch better covers or missing
-- page counts later, dedup ("you already have this"), and link out; published_year
-- is for display and sorting a shelf by era. All nullable — the AI fallback path
-- and pre-existing rows won't have an Open Library key.
ALTER TABLE reading_books ADD COLUMN openlibrary_key text;
ALTER TABLE reading_books ADD COLUMN isbn text;
ALTER TABLE reading_books ADD COLUMN published_year int;
