-- Baseball Clips: a ball trail on a Clips Camera at-bat's field view.
--
-- The clips worker traces the batted ball through the GameChanger field view
-- (contact -> landing) and the phone draws a trail over it, live and in shares.
-- Contract: docs/clips-ball-trail.md.
--
--   ball_trail         the trail (trail JSON v1); null until traced
--   ball_trail_status  pending | ready | needs_tap | failed; null = never traced
--   ball_trail_tap     the last "Fix the ball" tap {t, x, y} (clip seconds,
--                      frame-normalized) so re-traces stay anchored to it

ALTER TABLE clip_at_bats
  ADD COLUMN IF NOT EXISTS ball_trail jsonb,
  ADD COLUMN IF NOT EXISTS ball_trail_status text,
  ADD COLUMN IF NOT EXISTS ball_trail_tap jsonb;

ALTER TABLE clip_at_bats DROP CONSTRAINT IF EXISTS clip_at_bats_ball_trail_status_check;
ALTER TABLE clip_at_bats
  ADD CONSTRAINT clip_at_bats_ball_trail_status_check
  CHECK (ball_trail_status IS NULL OR ball_trail_status IN ('pending', 'ready', 'needs_tap', 'failed'));
