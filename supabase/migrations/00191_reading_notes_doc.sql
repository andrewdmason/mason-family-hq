-- Notes as a tree: the notepad becomes an outline.
--
-- Every line of the notepad is now a block that can hold blocks under it, and
-- a block can be collapsed. Markdown can carry the nesting but not the
-- collapsed state (nor, later, anything else a block might carry), so the
-- note gains a structured column: the editor's own document as JSON, of the
-- shape doc > noteBlock+, noteBlock = head + noteBlock* — see note-tree.ts.
--
-- `doc` is the truth when it is present. `content` stays, and is REWRITTEN
-- from the tree on every save, so everything that reads the note as text —
-- the assistant's background, the Contents blurb, the word count — keeps
-- reading the same column it always did. A row with `doc` null was written
-- before the outline existed; its markdown is the truth until the notepad is
-- next opened, which parses it into blocks and saves both.
--
-- Idempotent throughout: one local Supabase instance is shared across Conductor
-- workspaces, so a migration can be re-applied against a database that already
-- has it.

ALTER TABLE reading_notes ADD COLUMN IF NOT EXISTS doc jsonb;

COMMENT ON COLUMN reading_notes.doc IS
  'The note as a tree (ProseMirror JSON: doc > noteBlock+; see note-tree.ts). '
  'The truth when present; content is derived from it on every save. Null for '
  'rows written before the outline, whose content is the truth until the '
  'notepad is next opened.';

NOTIFY pgrst, 'reload schema';
