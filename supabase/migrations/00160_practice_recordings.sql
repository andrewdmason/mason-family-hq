-- Unified practice recording model (plan U1,
-- docs/plans/2026-07-02-001-feat-practice-capture-merge-plan.md).
--
-- One table for every captured take, with a kind that distinguishes how it was
-- born (KTD1):
--   auto        — timer-captured segment (one per task-run)
--   manual      — user-initiated take from a task row
--   performance — deliberate performance; the only kind the Recordings tab shows
--
-- Per-segment status machine (KTD6; extends practice_sessions' machine, 00144):
--   recorded -> uploaded -> processing -> ready | failed
--                        \-> skipped   (too short to be worth a worker job)
-- `recorded` = row exists but the blob still lives only in the client's
-- IndexedDB buffer; a sweep re-uploads or fails it. Audio is NEVER deleted by
-- the pipeline (KTD8) — `failed`/`skipped` rows keep their audio and are
-- reprocessable (reset to 'uploaded', then re-claim).
--
-- Audio object path convention (task-audio bucket): {uid}/recordings/{recordingId}.{ext}
-- Transcription MIDI path (practice-session-midi bucket): {uid}/recordings/{recordingId}.mid
--
-- `alignment` jsonb shape (KTD4; TS types in src/lib/types.ts):
--   { spans: [{ startSec, endSec, measureStart, measureEnd, confidence }],
--     totalMeasures: number }
--
-- Legacy single-slot columns on practice_tasks (audio_path / audio_trim_* /
-- audio_title, 00027/00029/00031) are frozen and readable, NOT dropped; their
-- rows are backfilled below as kind='performance' so the Recordings tab's
-- contents are identical on day one (R13).
--
-- Idempotent throughout — the local Supabase stack is shared across Conductor
-- workspaces, so re-applying must be harmless (see 00147).

CREATE TABLE IF NOT EXISTS practice_recordings (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  kind               text NOT NULL
                       CHECK (kind IN ('auto', 'manual', 'performance')),
  task_id            uuid REFERENCES practice_tasks(id) ON DELETE SET NULL,
  session_id         uuid REFERENCES practice_sessions(id) ON DELETE SET NULL,
  piece_id           uuid REFERENCES pieces(id) ON DELETE SET NULL,
  date               date NOT NULL DEFAULT CURRENT_DATE,
  audio_path         text,
  duration_seconds   integer,
  trim_start         numeric,          -- playback trim, seconds (manual/performance)
  trim_end           numeric,
  title              text,
  status             text NOT NULL DEFAULT 'recorded'
                       CHECK (status IN ('recorded', 'uploaded', 'processing', 'ready', 'failed', 'skipped')),
  error_message      text,
  transcription_path text,             -- performance MIDI in practice-session-midi
  alignment          jsonb,            -- measure spans + totalMeasures (see header)
  claimed_at         timestamptz,      -- processing lease (see claim_practice_recording)
  created_at         timestamptz DEFAULT now() NOT NULL,
  updated_at         timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_practice_recordings_task_id ON practice_recordings(task_id);
CREATE INDEX IF NOT EXISTS idx_practice_recordings_session_id ON practice_recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_practice_recordings_status ON practice_recordings(status);

DROP TRIGGER IF EXISTS practice_recordings_updated_at ON practice_recordings;
CREATE TRIGGER practice_recordings_updated_at
  BEFORE UPDATE ON practice_recordings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE practice_recordings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated access" ON practice_recordings;
CREATE POLICY "Authenticated access" ON practice_recordings FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Idempotency lease: atomically move a recording uploaded -> processing,
-- returning whether THIS caller won the claim (clone of claim_practice_session,
-- 00144). Duplicate/concurrent kickoffs get false and must no-op, so one worker
-- job runs per segment. Reprocessing a failed/skipped row resets it to
-- 'uploaded' first, then claims again. SECURITY DEFINER + a single
-- UPDATE...WHERE avoids the supabase-js .or()-on-mutation 42703 trap.
CREATE OR REPLACE FUNCTION claim_practice_recording(p_recording_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed boolean;
BEGIN
  UPDATE practice_recordings
     SET status = 'processing', claimed_at = now()
   WHERE id = p_recording_id
     AND status = 'uploaded'
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION claim_practice_recording(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_practice_recording(uuid) TO authenticated, service_role;

-- Raise the task-audio bucket cap 150MB -> 500MB (KTD7) so 90-minute auto
-- segments and 2-hour open sessions fit. Effective only up to the Supabase
-- project's GLOBAL upload limit — a dashboard setting that must be checked
-- (>= 500MB) manually; agents cannot mutate project settings.
UPDATE storage.buckets
SET file_size_limit = 500 * 1024 * 1024
WHERE id = 'task-audio';

-- Backfill: every legacy single-slot task recording becomes a kind='performance'
-- row (they were deliberate takes — keeps the Recordings tab identical, KTD1).
-- Legacy columns stay untouched. NOT EXISTS on (task_id, kind, audio_path)
-- makes re-apply insert nothing.
INSERT INTO practice_recordings
  (kind, task_id, piece_id, date, audio_path, duration_seconds,
   trim_start, trim_end, title, status)
SELECT
  'performance', t.id, t.piece_id, t.date, t.audio_path, t.audio_duration_seconds,
  t.audio_trim_start_seconds, t.audio_trim_end_seconds, t.audio_title, 'ready'
FROM practice_tasks t
WHERE t.audio_path IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM practice_recordings r
    WHERE r.task_id = t.id
      AND r.kind = 'performance'
      AND r.audio_path = t.audio_path
  );
