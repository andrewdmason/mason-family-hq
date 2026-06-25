-- Mason Bucks data migration: seed the new economy from existing reading data.
--
-- 1. Each reward milestone becomes a prize (threshold → price, 1:1).
-- 2. Each kid's opening balance = their lifetime bonus pages (1 page = 1 Buck),
--    recorded as a single 'migration'-source ledger row (so future per-advance
--    credits don't double-count history).
-- 3. Seed the two starter earning tasks.
--
-- Non-destructive: reading_milestones / reading_stretch_advances are left intact
-- as the historical record; the reading UI stops surfacing milestones separately.
-- Re-run safe: the prize copy only runs when bucks_prizes is empty, opening
-- balances are guarded by the ledger's unique (source, reference_id), and seed
-- tasks are guarded by title.

-- ------------------------------------------------------------
-- 1. Milestones → prizes (only on first run, when no prizes exist yet)
-- ------------------------------------------------------------
INSERT INTO bucks_prizes (title, price, image_path, audience_user_id, archived_at, created_by_email, created_at)
SELECT
  m.title,
  m.threshold,
  m.image_path,
  m.user_id,
  CASE WHEN m.awarded_at IS NOT NULL THEN now() ELSE NULL END,
  m.created_by_email,
  m.created_at
FROM reading_milestones m
WHERE NOT EXISTS (SELECT 1 FROM bucks_prizes);

-- ------------------------------------------------------------
-- 2. Opening balances = lifetime bonus pages per kid
-- ------------------------------------------------------------
-- One lump credit per kid who has read bonus pages; reference_id = the kid's own
-- user id so the unique (source, reference_id) index makes re-runs no-ops.
INSERT INTO bucks_ledger (user_id, amount, source, reference_id, note)
SELECT
  a.user_id,
  SUM(a.bonus_pages)::int,
  'migration',
  a.user_id,
  'Starting balance from reading'
FROM reading_stretch_advances a
GROUP BY a.user_id
HAVING SUM(a.bonus_pages) > 0
ON CONFLICT (source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

-- ------------------------------------------------------------
-- 3. Seed starter earning tasks (shared, repeatable)
-- ------------------------------------------------------------
INSERT INTO bucks_earning_tasks (title, unit_value, unit_label, is_one_time, audience_user_id, created_by_email)
SELECT 'Play a family board game', 20, 'game', false, NULL,
       (SELECT email FROM family_members WHERE role = 'owner' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM bucks_earning_tasks WHERE title = 'Play a family board game');

INSERT INTO bucks_earning_tasks (title, unit_value, unit_label, is_one_time, audience_user_id, created_by_email)
SELECT 'Summer Bridge workbook', 5, 'page', false, NULL,
       (SELECT email FROM family_members WHERE role = 'owner' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM bucks_earning_tasks WHERE title = 'Summer Bridge workbook');
