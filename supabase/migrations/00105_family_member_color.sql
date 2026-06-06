-- An official per-member display color. Set in the Family tab of settings and
-- used across the app — the Calendar's per-member columns and event accents, the
-- Home "others' day" widget, and the event edit modal.
--
-- Free-form text (a CSS color, normally a #rrggbb hex) to match how
-- calendar_sources.color is stored. NULL means "no color chosen yet": callers
-- fall back to the deterministic per-email hash color
-- (src/lib/calendar/calendar-utils.ts#memberColor), so the column is purely
-- additive and safe to ship empty.
ALTER TABLE family_members ADD COLUMN color text;
