-- Generalize task images into task ATTACHMENTS: any file type (PDFs, docs…)
-- can now ride on a task, alongside images. Images keep their downscaled
-- display copy; other files store just the original and render as a named
-- chip that opens via a signed URL.
--
-- The storage bucket keeps its 'todo-images' id (buckets can't be renamed in
-- place and nothing user-facing shows it) but drops the image-only MIME
-- allowlist.

ALTER TABLE todo_task_images RENAME TO todo_task_attachments;

ALTER TABLE todo_task_attachments
  ALTER COLUMN display_path DROP NOT NULL;

ALTER TABLE todo_task_attachments
  ADD COLUMN kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'file')),
  ADD COLUMN file_name text,
  ADD COLUMN mime_type text;

ALTER INDEX idx_todo_task_images_task RENAME TO idx_todo_task_attachments_task;

UPDATE storage.buckets
SET allowed_mime_types = NULL,
    file_size_limit = 50 * 1024 * 1024
WHERE id = 'todo-images';
