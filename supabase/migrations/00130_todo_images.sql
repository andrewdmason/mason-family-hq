-- Images attached to a todo task (paste or drag-drop, multiple per task).
--
-- Same original/display pair as journal photos (00043), but the storage path is
-- task-scoped rather than uid-scoped: tasks are shared household objects, so any
-- family member may attach to (and view images on) any task. Path convention:
--   {task_id}/{image_id}-original.{ext}
--   {task_id}/{image_id}-display.jpg

CREATE TABLE todo_task_images (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid NOT NULL REFERENCES todo_tasks(id) ON DELETE CASCADE,
  original_path     text NOT NULL,
  display_path      text NOT NULL,
  uploaded_by_email text REFERENCES family_members(email) ON UPDATE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_todo_task_images_task
  ON todo_task_images (task_id, created_at);

ALTER TABLE todo_task_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family access" ON todo_task_images FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'todo-images',
  'todo-images',
  false,
  25 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "todo-images family select" ON storage.objects;
DROP POLICY IF EXISTS "todo-images family insert" ON storage.objects;
DROP POLICY IF EXISTS "todo-images family update" ON storage.objects;
DROP POLICY IF EXISTS "todo-images family delete" ON storage.objects;

-- Household-wide, not uid-folder-scoped (deliberate divergence from
-- journal-photos): the bucket holds nothing but shared task images.
CREATE POLICY "todo-images family select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'todo-images' AND auth.uid() IS NOT NULL);

CREATE POLICY "todo-images family insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'todo-images' AND auth.uid() IS NOT NULL);

CREATE POLICY "todo-images family update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'todo-images' AND auth.uid() IS NOT NULL);

CREATE POLICY "todo-images family delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'todo-images' AND auth.uid() IS NOT NULL);
