-- Personal API tokens for the todo ingest endpoint (/api/todo/ingest), used by
-- the Apple Reminders iOS Shortcut sweep and the Raycast quick-capture command.
--
-- The raw token is shown exactly once at creation; only its SHA-256 hex digest
-- is stored. The ingest route verifies with the service-role client (bypassing
-- RLS); the user-facing policy below only lets members manage their own tokens'
-- metadata from the settings page.

CREATE TABLE todo_api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email text NOT NULL REFERENCES family_members(email)
                 ON UPDATE CASCADE ON DELETE CASCADE,
  name         text NOT NULL,            -- e.g. "iOS Shortcut", "Raycast"
  token_hash   text NOT NULL UNIQUE,     -- hex sha256 of the raw token
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

ALTER TABLE todo_api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own tokens" ON todo_api_tokens FOR ALL
  USING (EXISTS (
    SELECT 1 FROM family_members m
    WHERE m.user_id = auth.uid() AND m.email = todo_api_tokens.member_email
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM family_members m
    WHERE m.user_id = auth.uid() AND m.email = todo_api_tokens.member_email
  ));
