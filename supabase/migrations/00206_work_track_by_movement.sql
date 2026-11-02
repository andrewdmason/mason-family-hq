-- Track a multi-movement work by movement, or as a whole.
--
-- While a work (the Brahms trio: a `works` row with a `pieces` row per
-- movement) is being learned, its practice is logged movement by movement and
-- the quick log shows a segment per movement. Once it's known, logging per
-- movement is a chore: the switch below folds the movements into one card
-- that logs to the work as a whole.
--
-- "The whole work" is an ordinary piece, flagged `whole_work`, rather than a
-- practice item that belongs to a work. That keeps every reader of practice
-- time (totals, last-practiced, the rotation, reports, the timer) working
-- unchanged: whole-work time is a piece's time like any other. The movements'
-- items are never touched, so switching back on brings them back as they were.
--
-- Which pieces show follows the switch, on the website and the phone alike:
-- with it on, the movements and not the whole-work piece; with it off, the
-- whole-work piece and not the movements.

alter table works
  add column track_by_movement boolean not null default true;

comment on column works.track_by_movement is
  'On: practice is logged per movement (each piece of the work). Off: the movements are hidden and the work''s whole_work piece is logged instead.';

alter table pieces
  add column whole_work boolean not null default false,
  add constraint pieces_whole_work_needs_work check (not whole_work or work_id is not null);

comment on column pieces.whole_work is
  'Stands for its whole work while the work is not tracked by movement. At most one per work; made the first time the switch goes off.';

create unique index pieces_one_whole_work on pieces (work_id) where whole_work;

-- Flip the switch. Turning it off makes the whole-work piece the first time,
-- and brings it in step with the movements each time: active, and in the
-- rotation only when every active movement is. Returns the whole-work piece,
-- or null when switching back on.
create function set_work_track_by_movement(target_work_id uuid, track boolean)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  whole_id uuid;
  rotation boolean;
begin
  update works set track_by_movement = track, updated_at = now()
  where id = target_work_id;
  if not found then
    raise exception 'work % not found', target_work_id;
  end if;

  if track then
    return null;
  end if;

  select coalesce(bool_and(maintenance), false) into rotation
  from pieces
  where work_id = target_work_id and not whole_work and status = 'active';

  select id into whole_id from pieces where work_id = target_work_id and whole_work;
  if whole_id is null then
    insert into pieces (work_id, name, composer, kind, status, maintenance, whole_work)
    select w.id, w.name, w.composer, 'piece', 'active', rotation, true
    from works w where w.id = target_work_id
    returning id into whole_id;
  else
    update pieces set status = 'active', maintenance = rotation, updated_at = now()
    where id = whole_id;
  end if;
  return whole_id;
end;
$$;

comment on function set_work_track_by_movement(uuid, boolean) is
  'The long-press "Track by movement" switch. Security invoker: works and pieces carry the blanket authenticated-access policy.';
