-- Manual order for the reading shelf.
--
-- The Queue is where you decide what to read next, but it was stuck in the order
-- books happened to be added (oldest first), so a book added this morning sat at
-- the bottom under everything you'd already deferred. This column makes the shelf
-- draggable: the order is yours.
--
-- Fractional index, the same shape todo_tasks uses (see src/lib/todos/sort.ts): a
-- drag writes the midpoint between the row's new neighbours, so one UPDATE moves a
-- row and no siblings shift. The caller renormalizes to 1..n when midpoints run out
-- of float precision.
--
-- The default is a *negative* epoch, which is what makes "new books land at the top"
-- work without touching any of the several places a book can be created (manual add,
-- recommend-to-someone, queue-a-recommendation, save-an-article, bulk import): a row
-- inserted now gets roughly -1.78e9, which sorts above every backfilled row below.
-- clock_timestamp() rather than now() so two rows inserted in one transaction still
-- get distinct positions.
ALTER TABLE reading_books
  ADD COLUMN sort_order double precision NOT NULL
  DEFAULT (-EXTRACT(EPOCH FROM clock_timestamp()));

-- Backfill to exactly what each member sees today — creation order, 1..n per member —
-- so nothing reshuffles the first time the new list loads.
WITH ordered AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
  FROM reading_books
)
UPDATE reading_books b
SET sort_order = ordered.rn
FROM ordered
WHERE b.id = ordered.id;

-- How the shelf reads: one member's books, one tab, in order.
CREATE INDEX idx_reading_books_user_status_sort
  ON reading_books (user_id, status, sort_order);
