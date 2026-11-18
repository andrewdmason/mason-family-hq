-- Tuttles takes files, not just photos: a PDF (a handout, a study guide) sent
-- with a message or given to a study set. The phone uploads it to the tuttles
-- bucket beside the photos, as {student_id}/{thread_id}/{file id}.pdf or
-- {student_id}/study/{file id}.pdf, and the tutor reads the PDF itself.

-- Files sent with a student message: [{path, name, pages}], the path in the
-- tuttles bucket, the name it had on the phone, and how many pages it has.
ALTER TABLE tutor_messages ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]';

-- A study set's file: its path in image_path, its name in body.
ALTER TABLE tutor_study_sources DROP CONSTRAINT IF EXISTS tutor_study_sources_kind_check;
ALTER TABLE tutor_study_sources ADD CONSTRAINT tutor_study_sources_kind_check
  CHECK (kind IN ('photo', 'note', 'canvas', 'file'));

-- The bucket took only JPEGs up to 10 MB. PDFs too now, up to 20 MB.
UPDATE storage.buckets
  SET file_size_limit = 20971520, allowed_mime_types = ARRAY['image/jpeg', 'application/pdf']
  WHERE id = 'tuttles';
