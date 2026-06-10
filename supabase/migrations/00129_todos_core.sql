-- Todos — a Things-inspired family to-do list.
--
-- One household, full visibility: every family member can read and write every
-- task and project, so RLS on these tables is a single "any authenticated
-- member" policy (sign-in is allowlisted via family_members, so authenticated
-- == family). What looks like privacy elsewhere is just *decluttering* here:
-- project membership controls whose sidebar a project appears in and who its
-- tasks can be assigned to — never who can see it.
--
-- Tasks are assigned by member EMAIL, not auth user_id, matching the newer
-- member-scoped features (00100 school_assignments, 00103 google_connections):
-- kids exist as members before they ever sign in.
--
-- Scheduling model (deliberately leaner than Things):
--   • bucket: inbox → today / anytime / someday. Cross-cutting — a task in a
--     project still has a bucket.
--   • snoozed_until replaces Things' start date: a snoozed task hides from all
--     active views, and when the time passes it pops into TODAY. The wake is a
--     lazy sweep on page load (no cron): UPDATE ... WHERE snoozed_until <= now().
--   • No deadlines, no recurrence, no tags.

CREATE TABLE todo_areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE todo_projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  area_id            uuid REFERENCES todo_areas(id) ON DELETE SET NULL,
  sort_order         double precision NOT NULL DEFAULT 0,
  -- Project lifecycle mirrors tasks: completing files it in the Logbook,
  -- deleting is a soft delete (undo toast; no Trash UI).
  completed_at       timestamptz,
  completed_by_email text REFERENCES family_members(email) ON UPDATE CASCADE,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Membership = decluttering, not privacy: whose sidebar lists the project, and
-- the assignable set for its tasks. Creator starts as sole member; anyone can
-- add anyone. Removal is blocked in the app while the member still has active
-- assigned tasks in the project.
CREATE TABLE todo_project_members (
  project_id   uuid NOT NULL REFERENCES todo_projects(id) ON DELETE CASCADE,
  member_email text NOT NULL REFERENCES family_members(email)
                 ON UPDATE CASCADE ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, member_email)
);

CREATE TABLE todo_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  -- Sanitized Tiptap HTML (sanitize-html on write). Checklists live in here as
  -- task-list items; there is no separate subtask table.
  notes_html         text,
  bucket             text NOT NULL DEFAULT 'inbox'
                       CHECK (bucket IN ('inbox', 'today', 'anytime', 'someday')),
  assignee_email     text NOT NULL REFERENCES family_members(email) ON UPDATE CASCADE,
  -- Always the real signed-in user, even when adding via the person switcher —
  -- the "from Andrew" chip and the bell stay truthful.
  creator_email      text NOT NULL REFERENCES family_members(email) ON UPDATE CASCADE,
  project_id         uuid REFERENCES todo_projects(id) ON DELETE SET NULL,
  -- Snooze, with time-of-day. NULL = not snoozed. Cleared (and bucket set to
  -- 'today') by the lazy sweep once the moment passes.
  snoozed_until      timestamptz,
  completed_at       timestamptz,
  completed_by_email text REFERENCES family_members(email) ON UPDATE CASCADE,
  deleted_at         timestamptz,
  -- Fractional index: insert = max+1, reorder = midpoint of neighbors, with a
  -- renormalize pass when gaps get too small. One shared order per task.
  sort_order         double precision NOT NULL DEFAULT 0,
  -- Read-state for the assignee only — drives the bell item and the inbox
  -- "new" treatment when someone else put this on your list.
  assignee_seen_at   timestamptz,
  -- Ingest provenance + idempotency (Apple Reminders sweep retries safely).
  external_source    text CHECK (external_source IN ('reminders', 'raycast')),
  external_id        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The hot path: a member's active tasks per view.
CREATE INDEX idx_todo_tasks_active
  ON todo_tasks (assignee_email, bucket, sort_order)
  WHERE completed_at IS NULL AND deleted_at IS NULL;
-- The lazy wake sweep + the Snoozed view.
CREATE INDEX idx_todo_tasks_snoozed
  ON todo_tasks (snoozed_until)
  WHERE snoozed_until IS NOT NULL AND completed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_todo_tasks_logbook
  ON todo_tasks (completed_at DESC)
  WHERE completed_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_todo_tasks_project ON todo_tasks (project_id);
-- One row per external item, ever — survives soft delete, so a re-sweep of an
-- already-imported reminder is a no-op rather than a resurrection. A full
-- constraint (not a partial index) so PostgREST upserts can target it with
-- ON CONFLICT; rows without an external_id never collide (NULLs are distinct).
ALTER TABLE todo_tasks
  ADD CONSTRAINT uq_todo_tasks_external UNIQUE (external_source, external_id);

CREATE TRIGGER todo_areas_updated_at
  BEFORE UPDATE ON todo_areas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER todo_projects_updated_at
  BEFORE UPDATE ON todo_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER todo_tasks_updated_at
  BEFORE UPDATE ON todo_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE todo_areas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_tasks           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family access" ON todo_areas FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Family access" ON todo_projects FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Family access" ON todo_project_members FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Family access" ON todo_tasks FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
