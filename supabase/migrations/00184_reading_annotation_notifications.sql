-- ============================================================
-- Telling somebody a passage is waiting for them
-- ============================================================
-- The bell alone is not enough for this feature and it is worth saying why.
-- Reading happens away from the app — on a Boox, on a phone, in a chair — so a
-- badge in a tab nobody has open is a message that arrives a week late. A mark
-- left for somebody who never sees it is the failure mode this whole thing has
-- to avoid, so it also becomes an email, from the person who wrote it.
--
-- This table is the outbox. It exists rather than the sweep reading messages
-- directly because "has this been sent" is a fact about the sending, not about
-- the message, and it is the only thing standing between one flurry of typing
-- and five emails.

CREATE TABLE reading_annotation_notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         uuid NOT NULL REFERENCES reading_annotation_threads(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id        uuid REFERENCES reading_annotation_messages(id) ON DELETE CASCADE,
  actor_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'mention' is being brought into a conversation; 'reply' is one you are
  -- already in carrying on. Different sentences in the email, same machinery.
  kind              text NOT NULL CHECK (kind IN ('mention', 'reply')),

  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Claimed before the send, not stamped after it. At-most-once is the right
  -- failure mode for email: losing one costs a notification, sending twice costs
  -- the credibility of every notification after it.
  emailed_at        timestamptz
);

CREATE INDEX idx_reading_annotation_notifications_pending
  ON reading_annotation_notifications (recipient_user_id, thread_id, created_at)
  WHERE emailed_at IS NULL;

-- Service role only. RLS on with no policies at all is a deny: nothing about the
-- outbox is anybody's to read, and the bell reads participants and threads.
ALTER TABLE reading_annotation_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- The sweep
-- ============================================================
-- Cron rather than a debounce, because there is no timer infrastructure in this
-- app and a debounce inside a serverless function means either holding a request
-- open or keeping state that does not survive the instance. The quiet period the
-- route enforces IS the debounce: anything written in the last few minutes is
-- left alone, so a burst of typing in one thread collapses into one email.
--
-- Same shape as the calendar sync in 00106, including its production setup:
--   SELECT vault.create_secret('https://family.mason.io', 'reading_notify_app_url');
--   SELECT vault.create_secret('<CRON_SECRET>',           'reading_notify_cron_secret');
DO $outer$
DECLARE
  app_url     text;
  cron_secret text;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  SELECT decrypted_secret INTO app_url
    FROM vault.decrypted_secrets WHERE name = 'reading_notify_app_url';
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'reading_notify_cron_secret';

  IF app_url IS NULL OR cron_secret IS NULL THEN
    RAISE NOTICE 'reading_notify Vault secrets not set; skipping cron schedule';
  ELSE
    PERFORM cron.schedule(
      'reading-annotation-emails',
      '*/5 * * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'reading_notify_app_url') || '/api/cron/reading-annotation-emails',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'reading_notify_cron_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
    RAISE NOTICE 'reading annotation email job scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net/Vault not available (expected in local dev): %', SQLERRM;
END $outer$;
