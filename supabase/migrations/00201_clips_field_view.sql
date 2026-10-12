-- Baseball Clips: a GameChanger "field view" on a camera at-bat.
--
-- The Clips Camera app can add a trimmed GameChanger clip (the wide field
-- camera, the whole play) to the end of a camera at-bat, or make an at-bat of
-- just the field view. The phone renders one finished video either way, so
-- playback_path/original_path stay the thing to play and share. These columns
-- keep what's needed to re-trim or remove it later:
--
--   field_view_path     the GameChanger clip as shared, untrimmed
--   field_view_start_s  the kept stretch of it, in seconds into that clip
--   field_view_end_s
--   field_view_at_s     where the field view starts in the finished video
--                       (the website's "next" after the last pitch goes here)
--   closeup_path        the finished video without the field view; null for
--                       an at-bat that is only the field view

ALTER TABLE clip_at_bats
  ADD COLUMN IF NOT EXISTS field_view_path text,
  ADD COLUMN IF NOT EXISTS field_view_start_s double precision,
  ADD COLUMN IF NOT EXISTS field_view_end_s double precision,
  ADD COLUMN IF NOT EXISTS field_view_at_s double precision,
  ADD COLUMN IF NOT EXISTS closeup_path text;
