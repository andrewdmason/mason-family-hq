-- One-time data migration: collapse the two multi-movement works into single
-- pieces, retiring the works feature for them.
--
--   French Suite 5 in G (Bach)  — 7 movement-pieces, each with A/B sections
--   Sonata Op 31 No 3 (Beethoven) — 4 movement-pieces, no sections
--
-- Each work becomes one standalone piece. The French Suite's existing sections
-- are relabeled into one continuous run (A · Allemande A, B · Allemande B,
-- C · Courante A, …) and moved to the merged piece IN PLACE — section ids never
-- change, so status snapshots, video timestamps, and any section-scoped
-- practice tasks stay valid without remapping. Each section gets its source
-- movement's target tempo as a per-section override. The Beethoven gets four
-- fresh sections, one per movement in sonata order.
--
-- Practice history (practice_tasks), assignments, lesson entries, and
-- performances are repointed to the merged pieces BEFORE the old pieces are
-- deleted (several of those FKs are ON DELETE CASCADE). The Allemande's
-- YouTube video moves to the merged piece. Reference MIDIs on the old pieces
-- are intentionally dropped via cascade.
--
-- Re-run safe: everything is keyed off the old piece/work ids, which are gone
-- after the first run, and the merged-piece inserts have fixed ids with
-- ON CONFLICT DO NOTHING. On databases without this prod data (local dev,
-- previews) every statement is a no-op.

-- ------------------------------------------------------------
-- 1. Create the two merged pieces (fixed ids; skip if source work is absent)
-- ------------------------------------------------------------
INSERT INTO pieces (id, name, composer, status, kind, notes)
SELECT 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c', 'French Suite 5 in G', 'Bach', 'active', 'piece', NULL
WHERE EXISTS (SELECT 1 FROM works WHERE id = '53019de6-1791-4582-a2a5-70f6da05854e')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pieces (id, name, composer, status, kind, notes)
SELECT '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d', 'Sonata Op 31 No 3', 'Beethoven', 'active', 'piece', 'Eb'
WHERE EXISTS (SELECT 1 FROM works WHERE id = '64708685-cce4-4194-bdfa-4814fcafd7ad')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. French Suite: move the 14 A/B sections onto the merged piece in place,
--    relabeled A–N with their movement name, tempo carried from the movement
-- ------------------------------------------------------------
WITH mvt (old_piece_id, mvt_order, movement, tempo) AS (
  VALUES
    ('19bdf5fa-235f-48af-b08e-b3137660c275'::uuid, 1, 'Allemande', 120),
    ('efd0f70b-7be9-4260-9c0d-c46b4a8ac6bc', 2, 'Courante',  96),
    ('6163fc61-da72-4079-860b-9e6e5b62a6de', 3, 'Sarabande', 60),
    ('170a5be1-e634-4b42-96a2-fa8ab0508bbd', 4, 'Gavotte',   165),
    ('5f59b57b-f827-44f8-b645-65e98595b571', 5, 'Bourree',   160),
    ('fe8f7426-e512-423b-8d2f-085a0bff63ae', 6, 'Loure',     120),
    ('73efe7af-f867-43d4-80fa-b6a3a6eb5434', 7, 'Gigue',     120)
),
ranked AS (
  SELECT
    s.id,
    chr((64 + row_number() OVER w)::int) || ' · ' || m.movement || ' ' || s.label AS new_label,
    (row_number() OVER w - 1)::int AS new_sort,
    m.tempo
  FROM piece_sections s
  JOIN mvt m ON m.old_piece_id = s.piece_id
  WHERE s.parent_id IS NULL
  WINDOW w AS (ORDER BY m.mvt_order, s.sort_order)
)
UPDATE piece_sections s
SET piece_id     = 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c',
    label        = r.new_label,
    sort_order   = r.new_sort,
    target_tempo = r.tempo
FROM ranked r
WHERE s.id = r.id;

-- ------------------------------------------------------------
-- 3. Beethoven: four fresh sections, one per movement in sonata order
-- ------------------------------------------------------------
INSERT INTO piece_sections (piece_id, label, sort_order, status)
SELECT '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d', v.label, v.sort_order, 0
FROM (VALUES
  ('A · Allegro', 0),
  ('B · Scherzo', 1),
  ('C · Menuetto', 2),
  ('D · Presto con fuoco', 3)
) AS v(label, sort_order)
-- Guard on the old work still existing so re-runs don't duplicate sections.
WHERE EXISTS (SELECT 1 FROM works WHERE id = '64708685-cce4-4194-bdfa-4814fcafd7ad');

-- ------------------------------------------------------------
-- 4. Repoint everything that references the old movement-pieces
--    (practice_tasks / lesson_entries / performances / snapshots piece_id are
--    ON DELETE CASCADE — repointing must happen before the deletes below)
-- ------------------------------------------------------------
-- Old piece → merged piece is derivable from pieces.work_id, so each repoint
-- joins through pieces rather than materializing a mapping table.
UPDATE practice_tasks t
SET piece_id = CASE p.work_id
  WHEN '53019de6-1791-4582-a2a5-70f6da05854e' THEN 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c'::uuid
  ELSE '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d'::uuid END
FROM pieces p
WHERE p.id = t.piece_id
  AND p.work_id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
                    '64708685-cce4-4194-bdfa-4814fcafd7ad');

UPDATE assignments a
SET piece_id = CASE p.work_id
  WHEN '53019de6-1791-4582-a2a5-70f6da05854e' THEN 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c'::uuid
  ELSE '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d'::uuid END
FROM pieces p
WHERE p.id = a.piece_id
  AND p.work_id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
                    '64708685-cce4-4194-bdfa-4814fcafd7ad');

UPDATE lesson_entries l
SET piece_id = CASE p.work_id
  WHEN '53019de6-1791-4582-a2a5-70f6da05854e' THEN 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c'::uuid
  ELSE '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d'::uuid END
FROM pieces p
WHERE p.id = l.piece_id
  AND p.work_id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
                    '64708685-cce4-4194-bdfa-4814fcafd7ad');

UPDATE performances pf
SET piece_id = CASE p.work_id
  WHEN '53019de6-1791-4582-a2a5-70f6da05854e' THEN 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c'::uuid
  ELSE '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d'::uuid END
FROM pieces p
WHERE p.id = pf.piece_id
  AND p.work_id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
                    '64708685-cce4-4194-bdfa-4814fcafd7ad');

UPDATE section_status_snapshots ss
SET piece_id = CASE p.work_id
  WHEN '53019de6-1791-4582-a2a5-70f6da05854e' THEN 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c'::uuid
  ELSE '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d'::uuid END
FROM pieces p
WHERE p.id = ss.piece_id
  AND p.work_id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
                    '64708685-cce4-4194-bdfa-4814fcafd7ad');

-- The Allemande's YouTube video (the works' only video) moves to the merged
-- piece; its section timestamp survives untouched since section ids didn't
-- change.
UPDATE piece_videos v
SET piece_id = CASE p.work_id
  WHEN '53019de6-1791-4582-a2a5-70f6da05854e' THEN 'b7e5a1c4-2f3d-4e8a-9c6b-1f0a2d3e4b5c'::uuid
  ELSE '9d4c8b2a-6e1f-4a7d-8b3c-2e5f6a7b8c9d'::uuid END
FROM pieces p
WHERE p.id = v.piece_id
  AND p.work_id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
                    '64708685-cce4-4194-bdfa-4814fcafd7ad');

-- ------------------------------------------------------------
-- 5. Delete the old movement-pieces (cascades their reference MIDIs, by
--    design) and the now-empty works rows
-- ------------------------------------------------------------
DELETE FROM pieces
WHERE work_id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
                  '64708685-cce4-4194-bdfa-4814fcafd7ad');

DELETE FROM works
WHERE id IN ('53019de6-1791-4582-a2a5-70f6da05854e',
             '64708685-cce4-4194-bdfa-4814fcafd7ad');
