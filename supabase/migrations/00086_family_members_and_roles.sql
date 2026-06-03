-- Family accounts: cross-app members + a real role model.
--
-- Two changes that go together:
--
-- 1. Rename journal_members -> family_members. Members are a cross-app concept
--    (journal, reader, practice, and whatever comes next), so the journal_
--    prefix was always wrong. The rename is OID-based in Postgres: the primary
--    key, the user_id UNIQUE constraint, every inbound FK (member photos,
--    reading_settings, reading_books.recommended_by_email, the self-referential
--    mother_email/father_email), and every attached RLS policy follow the table
--    automatically — none need recreating.
--
-- 2. Replace the is_owner boolean with a role enum (owner | parent | kid).
--    'owner' is exactly today's is_owner=true; 'parent' and 'kid' both behave
--    exactly like today's non-owner member — this migration changes the data
--    model only, not a single permission. Roles are derived from existing data
--    (ownership + the parent links from 00075) and editable in the family UI.
--
-- role is text + CHECK (not a Postgres ENUM) to match every other status enum in
-- this schema (reading_books.status, etc.) and to keep future value changes cheap.

ALTER TABLE journal_members RENAME TO family_members;

-- Add role nullable, backfill by precedence (each step only fills rows still
-- NULL), then lock it down. This happens before the policy swap below so the new
-- policy's reference to family_members.role resolves.
ALTER TABLE family_members ADD COLUMN role text;

-- The owner.
UPDATE family_members SET role = 'owner' WHERE is_owner = true;

-- Anyone named as some member's mother/father is a parent.
UPDATE family_members SET role = 'parent'
WHERE role IS NULL
  AND email IN (
    SELECT mother_email FROM family_members WHERE mother_email IS NOT NULL
    UNION
    SELECT father_email FROM family_members WHERE father_email IS NOT NULL
  );

-- Anyone with a parent link of their own is a kid.
UPDATE family_members SET role = 'kid'
WHERE role IS NULL
  AND (mother_email IS NOT NULL OR father_email IS NOT NULL);

-- Everyone else defaults to parent (the safe, fully-capable non-owner role).
UPDATE family_members SET role = 'parent' WHERE role IS NULL;

ALTER TABLE family_members ALTER COLUMN role SET NOT NULL;
ALTER TABLE family_members ALTER COLUMN role SET DEFAULT 'parent';
ALTER TABLE family_members
  ADD CONSTRAINT family_members_role_check CHECK (role IN ('owner', 'parent', 'kid'));

-- One RLS policy reads the column we're about to drop: the inline-comment
-- moderation DELETE policy (00065) lets the account owner delete anyone's
-- comment. Recreate it against role before dropping is_owner, or the DROP fails.
-- (role must already exist — added above — for the new policy body to resolve.)
DROP POLICY "Delete own or owner" ON journal_inline_comments;
CREATE POLICY "Delete own or owner" ON journal_inline_comments FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members m
      WHERE m.user_id = auth.uid() AND m.role = 'owner'
    )
  );

ALTER TABLE family_members DROP COLUMN is_owner;
