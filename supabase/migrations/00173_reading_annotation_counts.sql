-- How much you've marked up each book, as one row per book you've marked.
--
-- The shelf wants a count per book for every cover on screen at once, and it
-- wants nothing else about the annotations themselves. Doing that by fetching
-- the ids and counting them in JavaScript would ship one row per marked passage
-- across the wire — thousands, for a library worth counting — and would quietly
-- undercount the day that list outgrew PostgREST's row cap, which is the worst
-- possible failure for a number whose whole job is to be trusted at a glance.
--
-- security_invoker, so the caller's RLS on reading_annotations applies
-- unchanged: this view is exactly as self-scoped as the table underneath it,
-- and user_id is projected so a query can still say whose shelf it means.
--
-- Every annotation counts the same, whether it's a bare highlight, a note, or a
-- conversation. Those are one row and one passage under the model established in
-- migration 00167; splitting them into three numbers would put a dashboard on a
-- book cover to answer a question nobody asked.
CREATE VIEW reading_annotation_counts
  WITH (security_invoker = on) AS
SELECT
  user_id,
  book_id,
  count(*)::int AS annotation_count
FROM reading_annotations
GROUP BY user_id, book_id;

COMMENT ON VIEW reading_annotation_counts IS
  'Annotations per book, for the Reader shelf''s per-cover count.';
