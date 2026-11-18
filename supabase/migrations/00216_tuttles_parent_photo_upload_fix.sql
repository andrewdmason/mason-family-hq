-- A parent's phone used as a kid couldn't send photos: every upload into the
-- kid's folder was refused, so the chat route answered "photo not uploaded".
--
-- 00213's policy looked the kid up with `storage.foldername(name)` inside a
-- subquery on family_members, where a bare `name` is the member's own name
-- ("Sebastian"), not the object's path. It compared the kid's id to a folder
-- of their first name, which never matches. Name the object's column.

DROP POLICY IF EXISTS "tuttles parent insert for kid" ON storage.objects;
CREATE POLICY "tuttles parent insert for kid" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'tuttles'
    AND EXISTS (SELECT 1 FROM public.family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
    AND EXISTS (
      SELECT 1 FROM public.family_members kid
      WHERE kid.user_id::text = (storage.foldername(storage.objects.name))[1] AND kid.role = 'kid'
    )
  );
