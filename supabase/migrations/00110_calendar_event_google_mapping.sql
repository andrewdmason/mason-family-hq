-- The import ledger: maps each sidecar event row to the real Google event the
-- importer created for it, so later syncs can patch/cancel that same event rather
-- than duplicating it.
--
--   * google_event_id    — the real Google event's id. DETERMINISTIC: derived
--                          from external_id hashed into Google's base32hex id
--                          charset, so a concurrent or retried events.insert 409s
--                          ("already exists") instead of creating a second copy.
--                          This is what makes CREATE idempotent under the two
--                          concurrent sync entry points (page-load + cron) and
--                          after a partial failure.
--   * google_calendar_id — the destination calendar it was written to.
--   * google_sync_hash    — hash of the materialized core fields (title/start/end/
--                          location/all_day). The importer patches Google only
--                          when this changes → no redundant API writes.
--   * google_synced_at    — last successful materialize.
--   * google_missing_since — first sync at which the source stopped returning this
--                          event. Drives a miss-count guard: we only soft-cancel
--                          the Google event after it has been absent for several
--                          consecutive syncs, never on a single transient miss
--                          (which would otherwise delete the event + its guest
--                          list and re-invite everyone when it reappears).
--
-- Note external_id stays the source key ('ts:{id}', ICS UID); the Google id is a
-- separate column so a TeamSnap row can carry both.

ALTER TABLE calendar_events
  ADD COLUMN google_event_id      text,
  ADD COLUMN google_calendar_id   text,
  ADD COLUMN google_sync_hash     text,
  ADD COLUMN google_synced_at     timestamptz,
  ADD COLUMN google_missing_since timestamptz;

CREATE INDEX idx_calendar_events_google_event
  ON calendar_events (google_event_id)
  WHERE google_event_id IS NOT NULL;
