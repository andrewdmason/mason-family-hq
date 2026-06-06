-- Background calendar sync: pg_cron + pg_net, ported from KidCalendar's
-- 00006_background_sync. Every 15 minutes the database POSTs to the app's
-- /api/cron/calendar-sync route, which runs the same sync the page-load trigger
-- and the manual "Sync" button use — so an RSVP changed directly in TeamSnap (or
-- an event added there) shows up here without anyone opening the page.
--
-- The app URL and shared secret are read from Supabase Vault rather than
-- ALTER DATABASE settings: hosted Supabase denies the `postgres` role permission
-- to set custom database parameters, but it can read/write Vault secrets. Vault
-- also keeps the secret encrypted at rest instead of sitting in plaintext in the
-- cron job definition.
--
-- pg_cron, pg_net, and Vault only exist on Supabase, so the whole block is
-- wrapped to no-op where they're missing or the secrets aren't set (e.g. local
-- `supabase db reset`).
--
-- Production setup (once):
--   1. Dashboard > Database > Extensions: enable `pg_cron` and `pg_net`.
--   2. Store the URL and the shared secret in Vault (the secret must match the
--      app's CRON_SECRET env var):
--        SELECT vault.create_secret('https://family.mason.io', 'calendar_sync_app_url');
--        SELECT vault.create_secret('<CRON_SECRET>',           'calendar_sync_cron_secret');
--   3. Apply this migration (or just re-run the DO block) — it schedules the job
--      once both secrets exist. Re-running replaces the schedule safely.

DO $outer$
DECLARE
  app_url     text;
  cron_secret text;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  SELECT decrypted_secret INTO app_url
    FROM vault.decrypted_secrets WHERE name = 'calendar_sync_app_url';
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'calendar_sync_cron_secret';

  IF app_url IS NULL OR cron_secret IS NULL THEN
    RAISE NOTICE 'calendar_sync Vault secrets not set; skipping cron schedule';
  ELSE
    -- Read the secrets from Vault at run time too, so rotating a secret doesn't
    -- require rescheduling. cron.schedule upserts by name, so re-applying is safe.
    PERFORM cron.schedule(
      'calendar-teamsnap-sync',
      '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'calendar_sync_app_url') || '/api/cron/calendar-sync',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'calendar_sync_cron_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
    RAISE NOTICE 'calendar background sync job scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net/Vault not available (expected in local dev): %', SQLERRM;
END $outer$;
