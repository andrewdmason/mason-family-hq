-- Private bucket for parent-uploaded milestone reward images (e.g. a photo of the
-- baseball bat a kid is reading toward). One image per milestone.
--
-- Per-user own-rows storage RLS, same pattern as reading-books (00083): the path
-- is {user_id}/{milestone_id}.{ext}, so the owning kid can read their reward image
-- and the owner uploads on their behalf via the service role (which bypasses RLS).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reading-milestones',
  'reading-milestones',
  false,
  10 * 1024 * 1024,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "reading-milestones owner select" ON storage.objects;
DROP POLICY IF EXISTS "reading-milestones owner insert" ON storage.objects;
DROP POLICY IF EXISTS "reading-milestones owner update" ON storage.objects;
DROP POLICY IF EXISTS "reading-milestones owner delete" ON storage.objects;

CREATE POLICY "reading-milestones owner select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'reading-milestones'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-milestones owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'reading-milestones'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-milestones owner update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'reading-milestones'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "reading-milestones owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'reading-milestones'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
