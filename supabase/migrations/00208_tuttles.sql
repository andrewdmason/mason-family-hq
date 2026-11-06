-- Tuttles: the kids' homework tutor, a native iPhone app (ios/Tuttles). A
-- student's chats are threads of messages; the tutor's replies come from the
-- website's chat route (/tuttles/api/chat), which holds the model key and
-- writes both sides of every turn with the service role. The phone reads its
-- own threads directly, and the parents read everyone's on the website.
--
-- Nothing is ever deleted: a student can archive a thread to tidy their list,
-- but it stays readable to the parents.

CREATE TABLE IF NOT EXISTS tutor_threads (
  -- Made on the phone, so a new chat has its id before the first reply.
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Written by the chat route after the first reply; null until then.
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The last message's time, for ordering the list.
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS tutor_threads_student_idx ON tutor_threads (student_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tutor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES tutor_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'tutor')),
  -- Markdown, with LaTeX math and ```visual blocks (src/lib/tuttles/prompt.ts).
  content text NOT NULL DEFAULT '',
  -- Photos sent with a student message: paths in the tuttles bucket.
  images text[] NOT NULL DEFAULT '{}',
  -- Tutor replies only: which model answered, and its token counts.
  model text,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutor_messages_thread_idx ON tutor_messages (thread_id, created_at);

ALTER TABLE tutor_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages ENABLE ROW LEVEL SECURITY;

-- The student reads their own threads and can rename or archive them (the
-- route does all inserts). Parents read everything.
DROP POLICY IF EXISTS "Tutor threads: own or parent" ON tutor_threads;
CREATE POLICY "Tutor threads: own or parent" ON tutor_threads FOR SELECT
  USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
  );
DROP POLICY IF EXISTS "Tutor threads: own update" ON tutor_threads;
CREATE POLICY "Tutor threads: own update" ON tutor_threads FOR UPDATE
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Tutor messages: own or parent" ON tutor_messages;
CREATE POLICY "Tutor messages: own or parent" ON tutor_messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM tutor_threads t WHERE t.id = thread_id AND t.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
  );

-- Photos of homework, uploaded by the phone before it sends the message that
-- carries them. Paths: {student_id}/{thread_id}/{photo id}.jpg.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tuttles', 'tuttles', false, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "tuttles own insert" ON storage.objects;
DROP POLICY IF EXISTS "tuttles own or parent select" ON storage.objects;
CREATE POLICY "tuttles own insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tuttles' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "tuttles own or parent select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'tuttles' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
    )
  );
