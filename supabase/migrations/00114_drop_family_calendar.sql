-- Remove the family-wide ("everyone") calendar concept. Every calendar event and
-- source now belongs to a specific member; member_email IS NULL is no longer a
-- thing the app creates or surfaces. Drop any existing family-level rows.
DELETE FROM calendar_events WHERE member_email IS NULL;
DELETE FROM calendar_sources WHERE member_email IS NULL;
