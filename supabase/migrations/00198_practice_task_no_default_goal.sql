-- New practice items start with no time goal. A goal of 0 means "no limit":
-- the timer just counts up, and a goal can still be set per item. Existing
-- rows keep whatever goal they already have.
alter table practice_tasks
  alter column timer_seconds set default 0,
  alter column timer_remaining_seconds set default 0;
