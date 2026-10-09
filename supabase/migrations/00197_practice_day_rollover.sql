-- Day rollover for the practice log.
--
-- Nothing stays open past its day any more. Once a day is over, every item
-- still unfinished on it is archived, and the repeating ones schedule their next
-- occurrence exactly as archiving one by hand does. That retires the leftovers
-- pile and the "when should this pick back up?" question: the board each
-- morning is just today.
--
-- The day ends at 3am Pacific rather than midnight, so a late session isn't
-- archived out from under the timer. pg_cron runs the sweep hourly and the
-- function itself works out which day has ended, which keeps the 3am boundary
-- right across daylight-saving changes. The app also runs the same sweep when
-- the log loads (with the cutoff in the viewer's timezone), so a missed night
-- never shows stale items.

-- "Practiced" now means time actually went in. Archiving used to count on its
-- own, but with every item archived nightly that would mark every piece as
-- played every day.
drop index if exists practice_tasks_practiced_idx;
create index practice_tasks_practiced_idx
  on practice_tasks (piece_id, date desc)
  where timer_seconds > timer_remaining_seconds;

create or replace function piece_last_practiced(as_of_dates date[])
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
   and t.timer_seconds > t.timer_remaining_seconds
  group by d.as_of, t.piece_id;
$$;

comment on function piece_last_practiced(date[]) is
  'Per (as-of day, piece), the most recent day practice time went in. Archiving alone does not count. Security invoker: both tables carry the blanket authenticated-access policy.';

-- Archive everything unfinished dated before `cutoff` and schedule the next
-- occurrence of each repeating item: one cadence after the day it was down
-- for, or the cutoff day itself if that has already gone by. Returns how many
-- items were archived.
--
-- An item whose timer is running right now (started, not stopped, within the
-- last 12 hours) is left for the next sweep. Idempotent: a source that already
-- has an occurrence on the board doesn't get a second.
--
-- Security invoker: the app calls it as the signed-in user, pg_cron as the
-- owner, and practice_tasks carries the blanket authenticated-access policy.
create or replace function practice_rollover(cutoff date)
returns integer
language sql
set search_path = public, pg_temp
as $$
  with stale as (
    select id
    from practice_tasks
    where not completed
      and date < cutoff
      and not (
        started_at is not null
        and (ended_at is null or ended_at < started_at)
        and started_at > now() - interval '12 hours'
      )
    for update skip locked
  ),
  rolled as (
    update practice_tasks t
    set completed = true, completed_at = now()
    from stale
    where t.id = stale.id
    returning t.*
  ),
  next_up as (
    select r.*, greatest(r.date + r.repeat_interval_days, cutoff) as next_date
    from rolled r
    where r.repeat_interval_days is not null
      and not exists (
        select 1 from practice_tasks c where c.repeat_source_task_id = r.id
      )
  ),
  spawned as (
    insert into practice_tasks (
      piece_id, section_id, date, text, metronome_speed,
      timer_seconds, timer_remaining_seconds, session_number, sort_order,
      repeat_interval_days, repeat_source_task_id
    )
    select
      n.piece_id, n.section_id, n.next_date, n.text, n.metronome_speed,
      n.timer_seconds, n.timer_seconds, n.session_number,
      coalesce(
        (select max(o.sort_order) + 1 from practice_tasks o where o.date = n.next_date),
        0
      ) + (row_number() over (partition by n.next_date order by n.date, n.sort_order))::int - 1,
      n.repeat_interval_days, n.id
    from next_up n
    returning 1
  )
  select count(*)::int from rolled;
$$;

comment on function practice_rollover(date) is
  'Archive unfinished practice items dated before the cutoff and schedule the next occurrence of repeating ones. Run hourly by pg_cron (3am Pacific boundary) and on log load.';

-- Hourly; the function only archives days that have ended, so the job is a
-- no-op 23 hours a day. pg_cron only exists on Supabase, hence the guard.
do $outer$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'practice-day-rollover',
    '5 * * * *',
    $cron$
    select public.practice_rollover(
      ((now() at time zone 'America/Los_Angeles') - interval '3 hours')::date
    );
    $cron$
  );
exception when others then
  raise notice 'pg_cron not available (expected in local dev): %', sqlerrm;
end $outer$;
