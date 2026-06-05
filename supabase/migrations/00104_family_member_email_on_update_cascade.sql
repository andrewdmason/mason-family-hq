-- Make renaming a family member's email safe everywhere.
--
-- The owner can already edit a member's email in Settings → Family
-- (updateFamilyMember), which renames family_members.email and relies on the
-- referencing FKs being ON UPDATE CASCADE to carry that member's rows along.
-- Only journal_member_photos got that treatment (00064); every later table
-- (calendar, school assignments, Google/TeamSnap connections) kept the default
-- ON DELETE CASCADE *without* ON UPDATE CASCADE — so renaming a member who has,
-- say, a calendar source would fail the FK check.
--
-- This matters now because we're moving the kids onto @mason.io addresses (for
-- the Internal Google Workspace OAuth app). Rather than enumerate every
-- constraint by hand, add ON UPDATE CASCADE to *all* foreign keys that reference
-- family_members(email), preserving each one's existing ON DELETE action.
-- Idempotent: constraints that already cascade on update are skipped.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      con.conname,
      con.conrelid::regclass AS tbl,
      pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = 'family_members'::regclass
  LOOP
    -- pg_get_constraintdef yields e.g.
    --   FOREIGN KEY (member_email) REFERENCES family_members(email) ON DELETE CASCADE
    -- Append ON UPDATE CASCADE unless it's already there.
    IF position('ON UPDATE' IN r.def) = 0 THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I %s ON UPDATE CASCADE',
        r.tbl, r.conname, r.def
      );
    END IF;
  END LOOP;
END $$;
