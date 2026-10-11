-- Baseball Clips: at-bats filmed with the Clips Camera iPhone app.
--
-- The phone logs each pitch live and builds the finished quick version itself,
-- so a camera at-bat arrives as one final, playback-ready video (original_path
-- and playback_path both point at it) with its pitches already labeled. Its
-- pitch times are positions in that finished video. The website plays it as-is
-- — there are no markers to edit.
--
-- The phone labels pitches the way Scorelord scores them, which adds hit by
-- pitch, the batted-ball type, and two results (popout, fielder's choice).

ALTER TABLE clip_at_bats
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'camera'));

ALTER TABLE clip_at_bats DROP CONSTRAINT IF EXISTS clip_at_bats_result_check;
ALTER TABLE clip_at_bats ADD CONSTRAINT clip_at_bats_result_check CHECK (result IN (
  'K', 'KL', 'BB', 'HBP', '1B', '2B', '3B', 'HR', 'GO', 'FO', 'LO', 'PO', 'ROE', 'FC'
));

ALTER TABLE clip_pitches DROP CONSTRAINT IF EXISTS clip_pitches_outcome_check;
ALTER TABLE clip_pitches ADD CONSTRAINT clip_pitches_outcome_check CHECK (outcome IN (
  'ball', 'called_strike', 'swinging_strike', 'foul', 'in_play', 'hit_by_pitch'
));

ALTER TABLE clip_pitches DROP CONSTRAINT IF EXISTS clip_pitches_source_check;
ALTER TABLE clip_pitches ADD CONSTRAINT clip_pitches_source_check CHECK (source IN ('manual', 'auto', 'camera'));

-- Scorelord's names, so a later sync is a straight copy.
ALTER TABLE clip_pitches
  ADD COLUMN IF NOT EXISTS batted_ball text
    CHECK (batted_ball IN ('ground_ball', 'line_drive', 'fly_ball', 'pop_fly', 'bunt'));
