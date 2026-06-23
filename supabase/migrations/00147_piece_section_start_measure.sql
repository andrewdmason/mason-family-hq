-- Add an optional measure marker to piece sections.
--
-- A section with a start_measure acts as a START marker on the reference-MIDI
-- piano roll (the "Measure view"): the section runs from start_measure until the
-- next marker at the same level. Top-level sections (A, B, C) tile the whole
-- piece; subsections (A1, A2) tile within their parent's span. NULL keeps
-- existing sections working without a marker — they simply aren't drawn on the
-- roll until placed.
--
-- Idempotent (IF NOT EXISTS) because the local Supabase stack is shared across
-- Conductor workspaces; re-applying must be harmless.
ALTER TABLE piece_sections
  ADD COLUMN IF NOT EXISTS start_measure integer;
