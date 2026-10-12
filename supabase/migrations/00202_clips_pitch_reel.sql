-- Baseball Clips: camera at-bats stored as a pitch reel, played live.
--
-- Until now the Clips Camera app uploaded a finished edit with slow-motion
-- replays, captions and a title card burned in. From this version it uploads
-- the pitch reel instead: just the real-speed window around each pitch, back to
-- back, with swings (and unlabeled pitches) kept at every 240fps frame and
-- takes thinned to 60fps. The player adds slow motion, replays and captions as
-- it plays, and a shared video is rendered from the reel on request.
--
-- playback_path/original_path point at the reel, and clip_pitches.t is each
-- pitch's time in it, as before. The GameChanger field view stays a separate
-- file (field_view_path, trimmed by field_view_start_s/end_s) that the player
-- runs on into after the reel — field_view_at_s and closeup_path stay null.
--
--   reel   {"segments": [{"start": 0, "end": 3.0, "fps": 60, "pitch": 0}, ...]}
--          each pitch window's place in the reel (seconds), its frame rate,
--          and the pitch (index into the at-bat's pitches by time) it was cut
--          for. Null for every at-bat that isn't a reel.

ALTER TABLE clip_at_bats ADD COLUMN IF NOT EXISTS reel jsonb;
