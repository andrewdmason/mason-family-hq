-- Maintenance rotation.
--
-- Some pieces are worked every day; others are learned and only need to stay
-- warm. The existing tool for the second group is the repeating-task cadence
-- (00193), which is brittle for them: miss a few days and every maintenance
-- item's rhythm slides at once, so the whole board has to be re-anchored by
-- hand after a vacation.
--
-- `maintenance` marks a piece as belonging to the rotation instead. It is a
-- flag, deliberately *not* a fourth `piece_status` value: a maintenance piece
-- is still active and still appears in every add menu and picker. The flag only
-- decides which pool the log's "add a maintenance task" action draws from —
-- whichever flagged piece has gone longest without real practice.

alter table pieces
  add column maintenance boolean not null default false;

comment on column pieces.maintenance is
  'In the keep-it-warm rotation. Orthogonal to status: a maintenance piece is still active and appears everywhere active pieces do.';

-- The rotation only ever asks for the flagged pieces, ordered by name for a
-- stable tie-break.
create index pieces_maintenance_idx on pieces (name) where maintenance;

-- "Practiced" means time actually went in: the timer ran, or the item was
-- archived as done. Merely queueing a task must not reset a piece's clock, or a
-- day that gets away from you would push that piece to the back of the line.
-- This is the inverse of isUntouchedOccurrence() in src/lib/practice/repeat.ts.
create index practice_tasks_practiced_idx
  on practice_tasks (piece_id, date desc)
  where completed or timer_seconds > timer_remaining_seconds;

-- Last day each piece was really practiced, as of each given day.
--
-- Parameterised by day because the log can be looking at any date, and a piece
-- practiced after the day on screen must not read as fresh on it.
--
-- A function rather than a view or a client-side group-by: the "elapsed > 0"
-- rule compares two columns to each other, which PostgREST filters cannot
-- express, and shipping every task to the browser to group there would silently
-- truncate at PostgREST's 1000-row cap long before anyone noticed.
create function piece_last_practiced(as_of_dates date[])
returns table (as_of date, piece_id uuid, last_practiced date)
language sql
stable
set search_path = public, pg_temp
as $$
  select d.as_of, t.piece_id, max(t.date)
  from unnest(as_of_dates) as d(as_of)
  join practice_tasks t
    on t.piece_id is not null
   and t.date <= d.as_of
   and (t.completed or t.timer_seconds > t.timer_remaining_seconds)
  group by d.as_of, t.piece_id;
$$;

comment on function piece_last_practiced(date[]) is
  'Per (as-of day, piece), the most recent day real practice time went in. Security invoker: both tables carry the blanket authenticated-access policy.';
