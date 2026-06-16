-- Caregiver duty option: track when a nanny/babysitter (not a parent) does
-- drop-off / pick-up.
--
-- Functionally identical to N/A — no drive block lands on anyone's Google
-- calendar (desiredFor in drive-events.ts only materializes a block when
-- assignee_email is set) — but we record WHO so it shows on the card. The
-- caregiver is a free-text label (not a family_members FK): caregivers aren't
-- members and have no calendars. The known names live in src/lib/calendar/
-- caregivers.ts.

ALTER TABLE event_duty_assignments ADD COLUMN caregiver text;

-- A duty is at most ONE of: assigned to a parent, explicitly N/A, or done by a
-- caregiver. (chk_duty_state already forbids is_na + assignee_email together.)
ALTER TABLE event_duty_assignments
  ADD CONSTRAINT chk_duty_caregiver_excl
  CHECK (caregiver IS NULL OR (assignee_email IS NULL AND is_na = false));
