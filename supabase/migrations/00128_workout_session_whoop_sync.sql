-- WHOOP integration — part 3 of 3: per-session push state.
--
-- When a session is marked complete it auto-pushes to WHOOP; these columns track
-- the result so the detail view can show a sync chip and offer a re-send.
--
--   whoop_workout_id  — the id WHOOP returns for the created lift activity. Its
--                       presence is the create-vs-update switch: a session that
--                       already has one updates in place instead of double-creating.
--   whoop_sync_status — drives the chip:
--                         synced  — last push succeeded and nothing has changed
--                         dirty   — edited since the last successful push (re-send)
--                         failed  — last push errored (retry; see whoop_sync_error)
--                         syncing — a push is in flight
--   whoop_synced_hash — hash of the pushed payload; an unchanged re-send is a no-op.
--   whoop_synced_at / whoop_sync_error — last success time and last error text.
--
-- NULL status = never pushed (or no WHOOP connection), which the UI renders as
-- "not synced".

ALTER TABLE workout_sessions
  ADD COLUMN whoop_workout_id  text,
  ADD COLUMN whoop_synced_at   timestamptz,
  ADD COLUMN whoop_sync_status text CHECK (whoop_sync_status IN ('synced', 'dirty', 'failed', 'syncing')),
  ADD COLUMN whoop_sync_error  text,
  ADD COLUMN whoop_synced_hash text;
