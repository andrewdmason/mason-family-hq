-- ============================================================
-- The reader's own front and back matter
-- ============================================================
-- Two documents bracket a book: a PREFACE written before reading it (why you're
-- reading this, what you want from it) and an AFTERWORD written after finishing
-- (what it argued, and what you actually took from it, evidenced by your own
-- highlights). Both are reached only from the Contents, where they sit above and
-- below the book's own table of contents.
--
-- Modelled the way chapter summaries were (migration 00171): an ordinary
-- reading_annotations row with one column saying what it is about. A chapter
-- summary is about a chapter; these are about the whole book. That single column
-- buys the transcript table, the streaming contract the panel already renders,
-- follow-up questions that reach the ordinary chat route and simply work, and
-- deletion — none of which is worth reimplementing against a second table.
--
-- The one thing a book-scoped annotation must NOT do is paint anything in the
-- page. It has no passage; its anchor is a formality the NOT NULL columns
-- require. getAnnotationData keeps these rows out of the list the margin, the
-- gutter and the marks index are all drawn from, and nothing downstream should
-- ever identify one by its offset — the scope column is the only truth here.
ALTER TABLE reading_annotations ADD COLUMN book_scope text
  CHECK (book_scope IN ('preface', 'afterword'));

-- One of each per book per reader. Opening the preface twice must reopen the
-- same thread rather than quietly starting a second one, and this is what makes
-- that a guarantee rather than a client-side convention — two devices opening it
-- at once can't both win. Partial, so the ordinary passage annotations (which
-- all carry NULL here) are unaffected.
CREATE UNIQUE INDEX idx_reading_annotations_book_scope
  ON reading_annotations (user_id, book_id, book_scope)
  WHERE book_scope IS NOT NULL;

-- ============================================================
-- The document is a message
-- ============================================================
-- A finished preface or afterword lands in its own thread as a message, beside
-- the conversation that produced it. That keeps one artifact in one place: the
-- interview, the document, and every follow-up question you ever ask about it.
--
-- A role rather than a column on the annotation, even though a thread holds
-- exactly one of these: a column would have to be written at a different time
-- from the conversation it belongs to, and would lose its place in the order
-- things were actually said. There is no regenerate — wanting a different
-- preface means deleting the row and starting over — so the second one that
-- this shape permits is a possibility rather than a feature.
--
-- Same shape as the role additions in 00167 and 00172: drop the constraint,
-- widen it, add it back. Nothing to backfill this time.
ALTER TABLE reading_annotation_messages
  DROP CONSTRAINT reading_annotation_messages_role_check;

ALTER TABLE reading_annotation_messages
  ADD CONSTRAINT reading_annotation_messages_role_check
  CHECK (role IN ('user', 'assistant', 'notice', 'note', 'document'));
