-- Store a session's transcribed performance MIDI (plan U11). With this, we keep
-- a tiny, less-sensitive MIDI of the notes played and ALWAYS delete the audio
-- recording after processing (the low-confidence audio-retention branch is gone).
--
-- The per-window debug trace lives in practice_sessions.result (jsonb), so no
-- column is needed for it.

-- Private bucket for transcribed MIDIs. Path: {user_id}/sessions/{session_id}.mid
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'practice-session-midi',
  'practice-session-midi',
  false,
  5 * 1024 * 1024,
  ARRAY['audio/midi', 'audio/x-midi', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "session-midi owner select" ON storage.objects;
DROP POLICY IF EXISTS "session-midi owner insert" ON storage.objects;
DROP POLICY IF EXISTS "session-midi owner update" ON storage.objects;
DROP POLICY IF EXISTS "session-midi owner delete" ON storage.objects;

CREATE POLICY "session-midi owner select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'practice-session-midi' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "session-midi owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'practice-session-midi' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "session-midi owner update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'practice-session-midi' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "session-midi owner delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'practice-session-midi' AND (storage.foldername(name))[1] = auth.uid()::text);

ALTER TABLE practice_sessions ADD COLUMN transcription_path text;
