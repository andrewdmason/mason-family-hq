-- Todo sections — Things-style headings inside a project.
--
-- A section is a *container*, not an interleaved heading row: tasks point at
-- one via section_id, and the tasks above the first section (section_id NULL)
-- render as the project's unsectioned top area. Membership therefore survives
-- everything position can't express — a task that snoozes and wakes, gets
-- reassigned, or is completed and un-completed lands back in its section.
--
-- Sections live only on the project page (see the grouping in
-- components/todos/task-list.tsx). The bucket views still group by project
-- alone; a to-do captured from outside (quick-add, ingest, the agent API)
-- arrives unsectioned and gets filed by hand.
--
-- Ordering reuses the fractional index the rest of the app uses (lib/todos/
-- sort.ts): sections order among themselves, tasks order within their section.

CREATE TABLE todo_sections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES todo_projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order double precision NOT NULL DEFAULT 0,
  -- Soft delete, like tasks and projects: the undo toast clears it. Deleting
  -- a section never takes its to-dos with it — the app re-points them at the
  -- preceding section (or the unsectioned area) first, and the undo puts them
  -- back. The FK's ON DELETE SET NULL below is only a backstop for a hard
  -- delete that the app never performs.
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_todo_sections_project
  ON todo_sections (project_id, sort_order)
  WHERE deleted_at IS NULL;

ALTER TABLE todo_tasks
  ADD COLUMN section_id uuid REFERENCES todo_sections(id) ON DELETE SET NULL;

CREATE INDEX idx_todo_tasks_section
  ON todo_tasks (section_id)
  WHERE section_id IS NOT NULL;

CREATE TRIGGER todo_sections_updated_at
  BEFORE UPDATE ON todo_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE todo_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family access" ON todo_sections FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
