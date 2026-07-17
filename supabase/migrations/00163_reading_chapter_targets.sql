-- Weekly reading goals snapped to chapter boundaries.
--
-- Many EPUBs (especially commercial ones with image-based chapter headers) have
-- no real page numbers, so their "pages" are synthetic and drift with font/device.
-- Word count is the stable unit: we define a page as 280 words, and snap the
-- weekly goal to a chapter boundary. Chapter word-offsets ride inside the existing
-- reading_book_content.toc jsonb (each entry gains a startWord); the two columns
-- below are all the new state we need.

-- Total body words of a converted book — the source of truth behind page estimates
-- and chapter targets. Null until (re)converted; a null falls back to page goals.
ALTER TABLE reading_book_content ADD COLUMN word_count int;

-- The current stretch's target expressed as a chapter, for display alongside the
-- resolved target_page. Shape: { "title": "Chapter 8", "kind": "chapter_end" |
-- "chapter_fraction", "fraction": 0.5 | null }. Null when the goal is a plain page
-- target (articles, page-list EPUBs/PDFs, books not yet reconverted, owner overrides).
ALTER TABLE reading_books ADD COLUMN target_chapter jsonb;
