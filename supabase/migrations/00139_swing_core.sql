-- Swing Coach — youth baseball swing assessment for volunteer coaches.
-- Plan: docs/plans/2026-06-12-001-feat-baseball-swing-coach-plan.md
--
-- The coach uploads 5–10 iPhone slo-mo clips of one player's swings; the
-- browser extracts pose keypoints, computes biomechanics metrics, and renders
-- annotated stills (heavy processing never touches the serverless deployment).
-- Production persists DERIVED ARTIFACTS ONLY — keypoints/metrics/stills — never
-- raw video. A server-side LLM call turns the aggregated metrics into a
-- coach-facing assessment with 1–2 prioritized focus areas.
--
-- STORED vs DERIVED state (load-bearing — the browser never drives a stored
-- server state transition):
--   • swing_sessions.status: draft → analyzing → complete | analysis_failed.
--     There is NO stored 'extracted'/'insufficient' — "ready to analyze"
--     (≥3 ok clips) and "insufficient" are predicates computed in queries and
--     re-verified inside the analyze route at the moment it runs. The session
--     stays 'draft' while clips are added/extracted, which is what makes
--     tab-close recovery trivial.
--   • swing_clips.status: pending → extracting → ok | rejected. The row is
--     created at signed-URL issuance (before upload) so it anchors artifacts;
--     re-adding a crashed-mid-extracting file resets that row via the unique
--     constraint below rather than inserting beside it.
--   • swing_assessments.status: generating → complete | analysis_failed, plus
--     complete → superseded (regenerate) and complete → voided (wrong kid /
--     garbage). 'generating' → 'complete' is the atomic COMMIT POINT for
--     assessment persistence (PostgREST has no multi-statement transactions):
--     current-ness keys strictly on 'complete', so partially-written
--     assessments are invisible and retries are idempotent.
--   • "Current focus areas" = swing_focus_areas rows of the player's latest
--     'complete' assessment by created_at (superseded/voided excluded). Focus
--     area rows are IMMUTABLE after creation — each assessment owns a complete
--     snapshot (kept areas re-emitted with a prior_focus_area_id continuity
--     link). Void is a single status flip; no compensating writes exist.
--
-- content_hash is a constant-memory fingerprint, NOT a whole-file digest:
-- SHA-256 over (file size + first 1 MiB + last 1 MiB via Blob.slice). A full
-- digest would buffer a 100–400 MB HEVC clip into memory, which kills iOS
-- Safari tabs. Sufficient for same-file re-add detection in a family app.
--
-- Storage paths are {session_id}/{clip_id}/... — no mutable foreign keys in
-- paths by design. Player linkage lives in rows only, so reassigning a session
-- to another player (wrong-kid recovery) is a one-column update and the
-- player hard-purge path is a prefix walk over their sessions.
--
-- Players are other people's kids: archive (archived_at) never removes
-- artifacts, but FKs cascade so a deliberate hard-purge (delete player →
-- sessions → clips/assessments/focus areas + storage prefixes) is coherent.

CREATE TABLE swing_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- Birth year, not age: age drifts; assessments derive "9-year-old" at
  -- generation time.
  birth_year  integer NOT NULL CHECK (birth_year BETWEEN 1990 AND 2030),
  bats        text NOT NULL CHECK (bats IN ('L', 'R')),
  notes       text,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE swing_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES swing_players(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft', 'analyzing', 'complete', 'analysis_failed')),
  filmed_on  date NOT NULL DEFAULT CURRENT_DATE,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_swing_sessions_player ON swing_sessions (player_id, created_at DESC);

CREATE TABLE swing_clips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES swing_sessions(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'extracting', 'ok', 'rejected')),
  rejection_reason text,
  -- Constant-memory fingerprint (see header). Unique per session: re-adds are
  -- upserts (reuse/reset the row), and the two-tabs-same-session race resolves
  -- at the database, per the uq_todo_tasks_external retry-safety precedent.
  content_hash     text NOT NULL,
  file_name        text,
  -- Actual track fps read from container metadata (never assumed 240 — some
  -- share paths bake the slo-mo edit into ~30fps).
  source_fps       double precision,
  duration_seconds double precision,
  -- Detected from stance orientation; compared against roster bats for the
  -- handedness-mismatch warning (footage wins for metric mirroring).
  detected_bats    text CHECK (detected_bats IN ('L', 'R')),
  -- Hitter pixel height (normalized 0–1) — the cross-clip same-hitter outlier
  -- signal: a mis-picked clip of a teammate shows up as a height outlier.
  hitter_height    double precision,
  filmed_at        timestamptz,
  -- Swing phase events (frame timestamps ms): stance/load/plant/launch/contact/finish.
  events           jsonb,
  -- Per-swing metric summary with per-metric confidence. Small by design —
  -- the full keypoint series lives in Storage (keypoints_path), never in rows.
  metrics          jsonb,
  keypoints_path   text,
  -- Phase-keyframe stills: [{path, phase, contentType, annotations: [...]}].
  -- contentType matters: WebP normally, JPEG on Safari (no WebP encoder).
  stills           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_swing_clips_session_hash UNIQUE (session_id, content_hash)
);

CREATE INDEX idx_swing_clips_session ON swing_clips (session_id, created_at);

CREATE TABLE swing_assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES swing_sessions(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES swing_players(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'generating'
                 CHECK (status IN ('generating', 'complete', 'analysis_failed', 'superseded', 'voided')),
  narrative      text,
  -- Per-prior-focus-area progress verdicts: [{priorFocusAreaId, verdict, evidence}].
  progress       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Issues seen but intentionally not promoted to focus areas (AE3): the next
  -- assessment can promote one. [{issueKey, summary}].
  parked         jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_notes text,
  swing_count    integer,
  model          text,
  prompt_version text,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_swing_assessments_player ON swing_assessments (player_id, created_at DESC);
-- Partial index for the hot "current focus" path: roster/player pages only
-- ever read complete assessments newest-first.
CREATE INDEX idx_swing_assessments_player_complete ON swing_assessments (player_id, created_at DESC)
  WHERE status = 'complete';
CREATE INDEX idx_swing_assessments_session ON swing_assessments (session_id);

CREATE TABLE swing_focus_areas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id       uuid NOT NULL REFERENCES swing_assessments(id) ON DELETE CASCADE,
  player_id           uuid NOT NULL REFERENCES swing_players(id) ON DELETE CASCADE,
  rank                integer NOT NULL,
  -- Classification, not lifecycle: rows are immutable after creation.
  -- 'focus' = one of the ≤2 active areas; 'parked' rows are not used in v1
  -- (parked issues live in swing_assessments.parked) but the disposition
  -- column leaves room without a schema change.
  disposition         text NOT NULL DEFAULT 'focus' CHECK (disposition IN ('focus', 'parked')),
  -- Continuity link for kept/advanced areas: each assessment re-emits its full
  -- snapshot, pointing at the prior assessment's row for the same issue.
  prior_focus_area_id uuid REFERENCES swing_focus_areas(id) ON DELETE SET NULL,
  issue_key           text NOT NULL,
  diagnosis           text NOT NULL,
  cue                 text NOT NULL,
  -- [{name, steps, equipment}] — 1–2 drills from the curated library.
  drills              jsonb NOT NULL DEFAULT '[]'::jsonb,
  tell                text NOT NULL,
  -- Model-selected evidence stills (≤2): [{path, phase, contentType, caption}].
  evidence_stills     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Set when the model couldn't find a fitting library entry and improvised —
  -- surfaces gaps for curation rather than hiding them.
  library_gap         boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_swing_focus_areas_assessment ON swing_focus_areas (assessment_id, rank);
CREATE INDEX idx_swing_focus_areas_player ON swing_focus_areas (player_id, created_at DESC);

CREATE TRIGGER swing_players_updated_at
  BEFORE UPDATE ON swing_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER swing_sessions_updated_at
  BEFORE UPDATE ON swing_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER swing_clips_updated_at
  BEFORE UPDATE ON swing_clips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER swing_assessments_updated_at
  BEFORE UPDATE ON swing_assessments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE swing_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE swing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE swing_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE swing_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE swing_focus_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family access" ON swing_players FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Family access" ON swing_sessions FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Family access" ON swing_clips FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Family access" ON swing_assessments FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Family access" ON swing_focus_areas FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Derived artifacts only — keypoints (gzipped JSON), metrics, annotated stills.
-- A 10-clip session is ~25–30 MB total; the 25 MB per-file cap is far above
-- any single artifact and far below anything raw-video-sized.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'swing-artifacts',
  'swing-artifacts',
  false,
  25 * 1024 * 1024,
  -- image/jpeg is the Safari still-encoding fallback (Safari canvas cannot
  -- encode WebP and silently falls back to PNG, which we do not allow).
  ARRAY['application/json', 'application/gzip', 'image/webp', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "swing-artifacts family select" ON storage.objects;
DROP POLICY IF EXISTS "swing-artifacts family insert" ON storage.objects;
DROP POLICY IF EXISTS "swing-artifacts family update" ON storage.objects;
DROP POLICY IF EXISTS "swing-artifacts family delete" ON storage.objects;

-- Household-wide, same shape as todo-images: the bucket holds nothing but
-- swing artifacts and sign-in is family-allowlisted.
CREATE POLICY "swing-artifacts family select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'swing-artifacts' AND auth.uid() IS NOT NULL);

CREATE POLICY "swing-artifacts family insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'swing-artifacts' AND auth.uid() IS NOT NULL);

CREATE POLICY "swing-artifacts family update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'swing-artifacts' AND auth.uid() IS NOT NULL);

CREATE POLICY "swing-artifacts family delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'swing-artifacts' AND auth.uid() IS NOT NULL);
