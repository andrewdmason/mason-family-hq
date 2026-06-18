-- Practice listening sessions: a recorded sitting that the alignment worker
-- processes into per-piece practice_tasks (see plan unit U4,
-- docs/plans/2026-06-18-001-feat-listen-auto-log-practice-plan.md).
--
-- Lifecycle (mirrors reading_book_content's status machine, 00083):
--   uploaded -> processing -> ready | failed
-- The recording lives in storage; only metadata + the worker's result live here.

CREATE TABLE practice_sessions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date            date NOT NULL DEFAULT CURRENT_DATE,
  session_number  integer NOT NULL DEFAULT 1,
  recording_path  text,            -- nulled once the audio is deleted post-processing
  status          text NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  error_message   text,
  confidence      numeric,         -- overall best-match confidence (0..1)
  audio_retained  boolean NOT NULL DEFAULT false,  -- true when kept for low-confidence review
  result          jsonb,           -- raw worker output (segments[]), for debugging/retry
  claimed_at      timestamptz,     -- processing lease (see claim_practice_session)
  created_at      timestamptz DEFAULT now() NOT NULL,
  updated_at      timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_practice_sessions_date ON practice_sessions(date);

CREATE TRIGGER practice_sessions_updated_at
  BEFORE UPDATE ON practice_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON practice_sessions FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Trace auto-logged tasks back to their session; lets the fan-out write be
-- idempotent per session. SET NULL so deleting a session keeps the tasks.
ALTER TABLE practice_tasks
  ADD COLUMN session_id uuid REFERENCES practice_sessions(id) ON DELETE SET NULL;
CREATE INDEX idx_practice_tasks_session_id ON practice_tasks(session_id);

-- Idempotency lease: atomically move a session uploaded -> processing, returning
-- whether THIS caller won the claim. A retried/duplicate processing trigger gets
-- false and must no-op, so per-session tasks are never written twice. SECURITY
-- DEFINER + a single UPDATE...WHERE avoids the supabase-js .or()-on-mutation 42703
-- trap (see memory: postgrest-or-on-mutation).
CREATE OR REPLACE FUNCTION claim_practice_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed boolean;
BEGIN
  UPDATE practice_sessions
     SET status = 'processing', claimed_at = now()
   WHERE id = p_session_id
     AND status = 'uploaded'
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION claim_practice_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_practice_session(uuid) TO authenticated, service_role;
