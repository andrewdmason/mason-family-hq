-- Import destinations: turn the app into a TeamSnap/ICS → Google Calendar
-- importer. Until now calendar_events was the source of truth and we served
-- per-kid ICS feeds. We're inverting that: source events (TeamSnap, ICS) get
-- materialized as REAL Google events on the owning kid's Google calendar, so
-- they carry native identity (per-kid color via calendar sharing, native guest
-- invites for the "going" feature, and no duplicate entries). calendar_events
-- becomes a cache + augmentation sidecar + import ledger.
--
-- Each source records WHERE it materializes:
--   * import_destination_calendar_id — the Google calendar id to write into. A
--     kid's primary calendar id is simply their email (oscar@mason.io), which is
--     the sensible automatic default; multiple sources can target one calendar.
--   * import_destination_connection — the @mason.io principal whose calendar this
--     is. The importer impersonates this user via a service account with
--     domain-wide delegation (see src/lib/calendar/google-dwd.ts), so kids never
--     have to sign in or maintain an OAuth grant. Kept explicit (not derived from
--     member_email) so a future picker can override it.
--
-- Materialization is gated behind CALENDAR_IMPORTER_ENABLED; with these columns
-- unset, sync behaves exactly as before (sidecar-only).

ALTER TABLE calendar_sources
  ADD COLUMN import_destination_calendar_id text,
  ADD COLUMN import_destination_connection  text,
  -- A short-lived lease so only one sync run materializes a given source at a
  -- time. The two sync entry points (page-load trigger + 15-min cron) can fire
  -- concurrently; deterministic Google event ids already make CREATE idempotent,
  -- and this claim additionally prevents redundant API work / quota hammering.
  ADD COLUMN materialize_claimed_at timestamptz;

-- Default existing TeamSnap/ICS sources to the owning kid's own calendar (their
-- email is their primary Google calendar id). Google/manual sources are not
-- importers, so they stay null.
UPDATE calendar_sources
  SET import_destination_calendar_id = member_email,
      import_destination_connection  = member_email
  WHERE source_type IN ('teamsnap', 'ics')
    AND member_email IS NOT NULL;
