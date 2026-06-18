-- Reference MIDI per piece — the "answer key" the listen-and-auto-log pipeline
-- aligns recorded practice audio against (see
-- docs/plans/2026-06-18-001-feat-listen-auto-log-practice-plan.md, unit U2).
--
-- A piece optionally has one reference MIDI. With one, the piece is
-- "recognizable" — the alignment worker can identify it in a recording.
-- Without one, the piece is simply absent from the recognition set.
--
-- Storage/RLS pattern copied from reading-books (00083) / journal-photos (00043):
-- per-user folder on the object, even though the table row is family-shared
-- (matching the practice-table convention — pieces are shared across the family).

-- ============================================================
-- 1. Private bucket for reference MIDI files
-- ============================================================
-- Path convention: {user_id}/{piece_id}.mid
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'piece-midi',
  'piece-midi',
  false,
  5 * 1024 * 1024,
  ARRAY[
    'audio/midi',
    'audio/x-midi',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "piece-midi owner select" ON storage.objects;
DROP POLICY IF EXISTS "piece-midi owner insert" ON storage.objects;
DROP POLICY IF EXISTS "piece-midi owner update" ON storage.objects;
DROP POLICY IF EXISTS "piece-midi owner delete" ON storage.objects;

CREATE POLICY "piece-midi owner select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'piece-midi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "piece-midi owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'piece-midi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "piece-midi owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'piece-midi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "piece-midi owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'piece-midi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 2. Reference MIDI metadata (1:1 with a piece)
-- ============================================================
-- The MIDI bytes live in storage (midi_path); only metadata + parse status live
-- here. measure_count / ppq are cached on a successful parse so the UI can show
-- a recognizability badge without re-reading the file.
CREATE TABLE practice_reference_midis (
  piece_id       uuid PRIMARY KEY REFERENCES pieces(id) ON DELETE CASCADE,
  midi_path      text NOT NULL,
  status         text NOT NULL DEFAULT 'uploaded'
                   CHECK (status IN ('uploaded', 'ready', 'failed')),
  measure_count  int,
  ppq            int,
  note_count     int,
  error_message  text,
  uploaded_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now() NOT NULL,
  updated_at     timestamptz DEFAULT now() NOT NULL
);

CREATE TRIGGER practice_reference_midis_updated_at
  BEFORE UPDATE ON practice_reference_midis
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE practice_reference_midis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON practice_reference_midis FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
