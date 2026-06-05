-- Background calendar sync: pg_cron + pg_net, ported from KidCalendar's
-- 00006_background_sync. Every 15 minutes the database POSTs to the app's
-- /api/cron/calendar-sync route, which runs the same sync the page-load trigger
-- and the manual "Sync" button use — so an RSVP changed directly in TeamSnap (or
-- an event added there) shows up here without anyone opening the page.
--
-- pg_cron and pg_net only exist on hosted Supabase, so the whole block is
-- wrapped to no-op locally (where `supabase db reset` would otherwise fail).
--
-- Production setup (once):
--   1. Dashboard > Database > Extensions: enable `pg_cron` and `pg_net`.
--   2. Point the job at the app and give it the shared secret:
--        ALTER DATABASE postgres SET app.settings.app_url = 'https://family.mason.io';
--        ALTER DATABASE postgres SET app.settings.cron_secret = '<same value as CRON_SECRET env>';
--   3. Apply this migration (re-running it just replaces the schedule).

DO $outer$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  -- Only schedule once the app URL is configured (production). Without it the
  -- job would fire every 15 minutes and fail on a missing setting, so locally
  -- (where the setting is absent) we skip scheduling entirely.
  IF current_setting('app.settings.app_url', true) IS NULL THEN
    RAISE NOTICE 'app.settings.app_url not set; skipping calendar sync schedule';
  ELSE
    -- cron.schedule upserts by job name, so re-applying this migration is safe.
    PERFORM cron.schedule(
      'calendar-teamsnap-sync',
      '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.app_url') || '/api/cron/calendar-sync',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
    RAISE NOTICE 'calendar background sync job scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net not available (expected in local dev): %', SQLERRM;
END $outer$;
