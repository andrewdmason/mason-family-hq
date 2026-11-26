-- Math in the Tuttles app pays by stars from 2026-11-26: a run's stars are
-- its only score, and 10 of them make a coin (ios/Tuttles/Shared/HousePay.swift).
-- Runs played before that counted stars differently, so each run says which
-- economy it was played under, and the stars top 10 (src/lib/tuttles/math.ts)
-- counts only the new ones. Older phones don't say: theirs are 1.

ALTER TABLE tuttles_math_runs ADD COLUMN IF NOT EXISTS economy smallint NOT NULL DEFAULT 1 CHECK (economy >= 1);

CREATE INDEX IF NOT EXISTS tuttles_math_runs_stars_idx ON tuttles_math_runs (economy, stars DESC);
