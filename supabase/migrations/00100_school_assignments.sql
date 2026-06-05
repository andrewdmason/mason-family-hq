-- The School Assignments app: the kids' homework from Bentley's Blackbaud
-- (myschoolapp.com) portal, pulled into Family Mason HQ.
--
-- Bentley runs Blackbaud ("myBENTLEY" at bentleyschool.myschoolapp.com), NOT
-- Blackboard. There is no parent-accessible official API without the school
-- provisioning SKY API access, so this integration replays the parent's own
-- logged-in portal session against the same internal JSON endpoint the
-- assignment-center page uses:
--
--   GET /api/assignment2/ParentStudentAssignmentCenterGet?studentUserId={id}
--
-- It returns a rolling window of assignments bucketed by due date. We store the
-- real due_date and recompute buckets at render time, and keep the raw item in
-- `raw` so we can light up more fields later without a re-sync.
--
-- Three tables, mirroring the TeamSnap/calendar shape (00098):
--
--   * blackbaud_connections — the authenticating PARENT's portal session cookie,
--     one row per connecting adult (keyed by member_email, like
--     teamsnap_connections). A single parent session can read every child.
--   * blackbaud_students — maps each kid (family_members.email) to their Blackbaud
--     studentUserId and school host. Seeded for Oscar + Sebastian below.
--   * school_assignments — the synced homework, scoped to a kid by kid_email
--     (like calendar_events.member_email).
--
-- RLS mirrors the rest of the schema: a kid sees only their OWN assignments; a
-- parent/owner sees ALL kids'. Sync writes go through the service role and bypass
-- RLS (see src/lib/assignments/sync.ts).

-- ---------------------------------------------------------------------------
-- The connecting parent's Blackbaud portal session (only adults connect).
-- session_cookie is the full Cookie header captured from a logged-in myBENTLEY
-- session; cookie_expires_at is our best guess at when it stops working, after
-- which a parent must reconnect (Blackbaud ID is SSO — there's no refresh grant).
-- ---------------------------------------------------------------------------
CREATE TABLE blackbaud_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email      text NOT NULL UNIQUE REFERENCES family_members(email) ON DELETE CASCADE,
  school_host       text NOT NULL DEFAULT 'bentleyschool.myschoolapp.com',
  session_cookie    text NOT NULL,
  cookie_expires_at timestamptz,
  blackbaud_user_id text,
  last_synced_at    timestamptz,
  sync_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Kid -> Blackbaud studentUserId mapping. One row per child we track.
-- ---------------------------------------------------------------------------
CREATE TABLE blackbaud_students (
  member_email         text PRIMARY KEY REFERENCES family_members(email) ON DELETE CASCADE,
  blackbaud_student_id text NOT NULL,
  school_host          text NOT NULL DEFAULT 'bentleyschool.myschoolapp.com',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The synced assignments. Scoped to a kid by kid_email. Dedup on external_id
-- ('bb:{studentUserId}:{assignmentId}'). due_date is the source of truth for
-- bucketing; `raw` keeps the original portal object for later.
-- ---------------------------------------------------------------------------
CREATE TABLE school_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_email     text NOT NULL REFERENCES family_members(email) ON DELETE CASCADE,

  external_id   text UNIQUE,             -- 'bb:{studentUserId}:{assignmentId}', for dedup
  title         text NOT NULL,
  short_description text,
  long_description  text,
  course        text,                    -- the section/class, e.g. "Mathematics 6 - 4"
  assignment_type text,

  date_assigned date,
  due_date      date,
  due_time      time,

  -- 'assigned' | 'submitted' | 'graded' | 'missing' — best-effort from the portal.
  status        text NOT NULL DEFAULT 'assigned'
                  CHECK (status IN ('assigned', 'submitted', 'graded', 'missing')),
  max_points    numeric,
  points_earned numeric,

  source_type   text NOT NULL DEFAULT 'blackbaud'
                  CHECK (source_type IN ('blackbaud', 'manual')),
  raw           jsonb,                   -- original portal item, for building on later
  last_synced_at timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_school_assignments_kid_due ON school_assignments (kid_email, due_date);
CREATE INDEX idx_school_assignments_external_id ON school_assignments (external_id) WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse the shared function used everywhere else).
-- ---------------------------------------------------------------------------
CREATE TRIGGER blackbaud_connections_updated_at
  BEFORE UPDATE ON blackbaud_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER blackbaud_students_updated_at
  BEFORE UPDATE ON blackbaud_students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER school_assignments_updated_at
  BEFORE UPDATE ON school_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS. Kids see only their own assignments; parents/owner see all. The portal
-- session cookie is visible only to the adult who connected it. The student
-- mapping is readable by any member and managed by parents/owner.
-- ---------------------------------------------------------------------------

ALTER TABLE blackbaud_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own connection" ON blackbaud_connections FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.email = blackbaud_connections.member_email))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.email = blackbaud_connections.member_email));

ALTER TABLE blackbaud_students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON blackbaud_students FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Manage for parents" ON blackbaud_students FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

ALTER TABLE school_assignments ENABLE ROW LEVEL SECURITY;
-- A kid reads rows for their own email; a parent/owner reads every kid's.
CREATE POLICY "Read own (kid) or all (parent/owner)" ON school_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM family_members m
    WHERE m.user_id = auth.uid()
      AND (m.role IN ('owner', 'parent') OR m.email = school_assignments.kid_email)
  ));
-- Manual rows (and edits) are a parent/owner ability; Blackbaud rows are written
-- by the service-role sync, which bypasses RLS.
CREATE POLICY "Manage for parents" ON school_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

-- ---------------------------------------------------------------------------
-- Seed the two kids' Blackbaud student IDs (captured from the parent portal:
-- the #profile/{id}/progress links). Idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO blackbaud_students (member_email, blackbaud_student_id, school_host) VALUES
  ('oscar@mason.io',     '7371235', 'bentleyschool.myschoolapp.com'),
  ('sebastian@mason.io', '7371236', 'bentleyschool.myschoolapp.com')
ON CONFLICT (member_email) DO NOTHING;
