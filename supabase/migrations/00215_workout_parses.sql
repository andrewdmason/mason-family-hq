-- A workout's text, structured once and kept: the AI parse is the slow part of
-- opening a calendar workout (src/lib/workouts/session.ts), so the Workouts
-- iPhone app has the website work it out ahead for the workouts coming up
-- (/workouts/api/prepare) and the first open only has to write the rows.
--
-- Keyed by the text itself, not the event: an edited workout hashes
-- differently and is parsed afresh, and the same programming on two members'
-- calendars is parsed once. Nothing here is a session, so a workout prepared
-- and then skipped leaves no trace in anyone's lists or PRs.

CREATE TABLE IF NOT EXISTS workout_parses (
  -- sha256 (hex) of the text handed to the parser.
  source_hash text NOT NULL,
  parse_model text NOT NULL,
  -- ParsedWorkout's blocks (src/lib/workouts/types.ts).
  blocks jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_hash, parse_model)
);

-- Read and written by the server only.
ALTER TABLE workout_parses ENABLE ROW LEVEL SECURITY;
