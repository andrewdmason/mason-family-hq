-- Chapter summaries: an annotation that is about a CHAPTER rather than a passage.
--
-- A summary is an ordinary reading_annotations row — same anchor, same
-- transcript, same margin marker, same list entry — distinguished only by the
-- chapter it was asked about. Modelling it as one column rather than a second
-- table is what lets it show up in the marks list, paint a gutter icon, take
-- follow-up questions, and be deleted, with no new plumbing for any of it.
--
-- The value is the heading's id in the converted HTML ("sec-42"), which is also
-- what reading_book_content.toc entries point at. That is the only durable name
-- a chapter has: its title repeats across books and often IS just "1", its
-- character offset moves if the book is reconverted, and its position in the
-- contents shifts if the TOC is rebuilt.
ALTER TABLE reading_annotations ADD COLUMN chapter_anchor_id text;

-- One summary per chapter per reader. Tapping a chapter title that already has a
-- summary must reopen it rather than quietly starting a second one, and this is
-- what makes that a guarantee rather than a client-side convention — two devices
-- tapping the same heading at once can't both win.
CREATE UNIQUE INDEX idx_reading_annotations_chapter
  ON reading_annotations (user_id, book_id, chapter_anchor_id)
  WHERE chapter_anchor_id IS NOT NULL;
