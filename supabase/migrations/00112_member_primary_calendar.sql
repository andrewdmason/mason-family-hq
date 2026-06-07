-- Per-member primary calendar: the heart of the calendar model. Every person has
-- ONE Google calendar; their TeamSnap teams, school ICS feeds, and manual events
-- all import INTO it. This promotes "the import destination" from a property
-- repeated on every source (00109) to a first-class per-person setting.
--
--   * primary_calendar_id         — the Google calendar id everything lands on
--                                   (a person's primary is just their email).
--   * primary_calendar_connection — the principal we act AS when writing to it.
--   * primary_calendar_mode:
--       'managed'   — written via the service account's domain-wide delegation,
--                     impersonating `connection` (kids + any adult an owner sets
--                     up for them — no login required from that person).
--       'connected' — written via that person's own Google OAuth token (an adult
--                     who signed in and chose one of their own calendars).
--
-- Importer sources resolve their destination from the owning member's primary
-- (see getMemberPrimary in materialize.ts); the per-source import_destination_*
-- columns from 00109 are no longer used for resolution.

ALTER TABLE family_members
  ADD COLUMN primary_calendar_id         text,
  ADD COLUMN primary_calendar_connection text,
  ADD COLUMN primary_calendar_mode       text
    CHECK (primary_calendar_mode IN ('managed', 'connected')),
  -- The calendar's human-readable Google title, captured at setup so the UI can
  -- show "Oscar's calendar" rather than the raw id.
  ADD COLUMN primary_calendar_summary    text;

-- Kids are managed via delegation, with their own Google calendar (id == email)
-- as the primary — a Google account's primary calendar id IS its email. Adults
-- are set up through the UI (the owner can set up other members as 'managed', or
-- an adult connects their own account as 'connected').
UPDATE family_members
  SET primary_calendar_id         = email,
      primary_calendar_connection = email,
      primary_calendar_mode       = 'managed',
      primary_calendar_summary    = name
  WHERE role = 'kid';

-- Read each kid's own calendar into the app too, as a Google source synced via
-- delegation (google-sync picks the DWD credential for managed members). Without
-- this, their primary is only a write target and their real events never show.
INSERT INTO calendar_sources
  (member_email, source_type, google_calendar_id, google_connection_email, nickname)
SELECT fm.email, 'google', fm.email, fm.email, fm.name
FROM family_members fm
WHERE fm.role = 'kid'
  AND NOT EXISTS (
    SELECT 1 FROM calendar_sources cs
    WHERE cs.source_type = 'google'
      AND cs.member_email = fm.email
      AND cs.google_calendar_id = fm.email
  );
