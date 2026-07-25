-- Reading position as a character offset into the converted book.
--
-- The reader used to persist a scroll ratio, which only means anything in a
-- continuously-scrolling document of a particular width. Paged mode has no
-- scroll height, and font size / column count / device all change how much text
-- fits on screen — so the only unit that survives is the character offset in the
-- conversion char space (see src/lib/reading/block-stream.ts).
--
-- last_scroll_ratio is kept and still written (as charOffset/totalChars) because
-- the bookshelf reads it for each book's percent-complete label.
alter table reading_book_state
  add column if not exists last_char_offset integer;

comment on column reading_book_state.last_char_offset is
  'Resume point as an offset into the conversion character space (block-stream.ts). Preferred over last_anchor_id/last_scroll_ratio, which remain for older rows and for the shelf percent.';
