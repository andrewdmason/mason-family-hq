-- Tuttles on a parent's phone, used by a kid without a phone of their own (the
-- app's "Oscar" view, src/lib/tuttles/tutoring-as.ts). The kid's chats are the
-- kid's: the website routes save them under the kid with the service role, but
-- the phone writes a few things itself, signed in as the parent. These let a
-- parent do those for a kid: upload photos into the kid's folder, archive or
-- refile the kid's chats, and mark the kid's feedback seen.

DROP POLICY IF EXISTS "tuttles parent insert for kid" ON storage.objects;
CREATE POLICY "tuttles parent insert for kid" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'tuttles'
    AND EXISTS (SELECT 1 FROM public.family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
    AND EXISTS (
      SELECT 1 FROM public.family_members
      WHERE user_id::text = (storage.foldername(name))[1] AND role = 'kid'
    )
  );

DROP POLICY IF EXISTS "Tutor threads: parent update for kid" ON tutor_threads;
CREATE POLICY "Tutor threads: parent update for kid" ON tutor_threads FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
    AND EXISTS (SELECT 1 FROM family_members WHERE user_id = tutor_threads.student_id AND role = 'kid')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
    AND EXISTS (SELECT 1 FROM family_members WHERE user_id = tutor_threads.student_id AND role = 'kid')
  );

DROP POLICY IF EXISTS "Feedback seen: parent for kid" ON tutor_feedback_seen;
CREATE POLICY "Feedback seen: parent for kid" ON tutor_feedback_seen FOR ALL
  USING (
    EXISTS (SELECT 1 FROM family_members WHERE family_members.user_id = auth.uid() AND role IN ('owner', 'parent'))
    AND EXISTS (SELECT 1 FROM family_members k WHERE k.user_id = tutor_feedback_seen.user_id AND k.role = 'kid')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM family_members WHERE family_members.user_id = auth.uid() AND role IN ('owner', 'parent'))
    AND EXISTS (SELECT 1 FROM family_members k WHERE k.user_id = tutor_feedback_seen.user_id AND k.role = 'kid')
  );
