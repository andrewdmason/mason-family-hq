-- ============================================================
-- A book can arrive on your shelf because somebody showed you a passage in it
-- ============================================================
-- Mentioning someone in a mark puts that mark in THEIR margin, which means it
-- has to be in their copy of the book, which means they have to have one. If
-- they don't, they get one — the same file, copied.
--
-- Copying the file rather than telling them to go and find it is not a
-- convenience, it is the mechanism. An anchor is an offset into a particular
-- conversion of a particular set of bytes; two people who bought the same title
-- from different places do not share that space, and the mark would land in the
-- wrong sentence or nowhere. Copy the artifact and the offsets transfer exactly.

-- Which book this one was copied from. Also the idempotency arbiter: the partial
-- unique index means a second attempt loses on the insert rather than producing
-- a second copy, and losing that race is how the winner's work gets waited for.
ALTER TABLE reading_books ADD COLUMN copied_from_book_id uuid
  REFERENCES reading_books(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_reading_books_copy_of
  ON reading_books (user_id, copied_from_book_id)
  WHERE copied_from_book_id IS NOT NULL;

-- sha256 of the CONVERTED html, not of the source file.
--
-- The converted text is what the character space is made of, so this is the
-- exact question worth asking: two books with the same hash have byte-identical
-- offsets, and an anchor can move between them untouched. Two books with the
-- same source bytes would also usually match — but "usually" is the wrong word
-- for the thing every shared mark's position depends on, and the conversion is
-- what actually gets read.
ALTER TABLE reading_book_content ADD COLUMN content_hash text;

CREATE INDEX idx_reading_book_content_hash
  ON reading_book_content (content_hash) WHERE content_hash IS NOT NULL;

COMMENT ON COLUMN reading_book_content.content_hash IS
  'sha256 of the converted content.html. Equal hashes mean equal character spaces, which is what lets a shared anchor transfer verbatim.';
