-- Repeating practice items.
--
-- Until now the only way to keep working on something day after day was the
-- row's "archive and repeat tomorrow" button, which cloned the item once and
-- forgot it had ever done so. A cadence ("touch this every third day") had to
-- be re-cloned by hand forever.
--
-- `repeat_interval_days` makes the cadence a property of the item and rides
-- forward onto each copy, so it is set once. The cadence is *rolling*: the next
-- occurrence is scheduled N days from when the item is archived, not from a
-- fixed calendar anchor, so skipping a few days slides the whole chain rather
-- than piling up missed copies.
--
-- `repeat_source_task_id` points back at the occurrence that spawned this one.
-- It exists so un-archiving can take back the copy it just put on the board,
-- and so re-archiving replaces that copy instead of stacking a second one.

alter table practice_tasks
  add column repeat_interval_days integer
    check (repeat_interval_days is null or repeat_interval_days > 0),
  add column repeat_source_task_id uuid
    references practice_tasks(id) on delete set null;

create index practice_tasks_repeat_source_idx
  on practice_tasks (repeat_source_task_id)
  where repeat_source_task_id is not null;

comment on column practice_tasks.repeat_interval_days is
  'Rolling cadence in days. NULL = one-off. Archiving schedules the next copy this many days out and carries the interval forward.';
comment on column practice_tasks.repeat_source_task_id is
  'The occurrence that spawned this one, so un-archiving can withdraw it.';
