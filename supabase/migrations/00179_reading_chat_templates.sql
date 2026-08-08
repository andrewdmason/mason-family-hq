-- Mid-book chat templates: "How should I read this?" and "Check in".
--
-- The reader already has both bookends of an interpretive conversation — a
-- preface interview before the first page and an afterword interview after the
-- last — and nothing at all in between. These two templates are that middle: a
-- briefing on how a book wants to be read, and a book-club check-in grounded in
-- what the reader has actually marked so far.
--
-- Why this needs a COLUMN rather than living in the opening message. The chat
-- route rebuilds the system prompt from the row on every single turn, so a
-- template whose instructions rode in the first user message would govern turn
-- one and evaporate on turn two — and the register is exactly the thing that has
-- to survive the whole conversation. It is also what tells the route to go and
-- gather the reader's marks, which an ordinary chat does not carry.
--
-- NULL is the overwhelming majority and means "an ordinary anchored chat". The
-- constraint is deliberately narrow: an unrecognised value would fall through
-- the prompt builder's branch and silently produce a chat with no register at
-- all, which reads as the feature quietly not working.
--
-- Note for whoever adds the third one: `template` governs REGISTER, and it is
-- not the same axis as `book_scope` (which document this is) or
-- `chapter_anchor_id` (which chapter this recaps). Those three have been kept
-- separate on purpose — an annotation is at most one of them.
--
-- Idempotent throughout: one local Supabase instance is shared across Conductor
-- workspaces, so a migration can be re-applied against a database that already
-- has it.

ALTER TABLE reading_annotations ADD COLUMN IF NOT EXISTS template text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reading_annotations_template_check'
  ) THEN
    ALTER TABLE reading_annotations ADD CONSTRAINT reading_annotations_template_check
      CHECK (template IS NULL OR template IN ('reading_key', 'check_in'));
  END IF;
END $$;

COMMENT ON COLUMN reading_annotations.template IS
  'Which mid-book template started this chat: reading_key (how to read the book) '
  'or check_in (a book-club conversation about the reader''s reading so far). '
  'NULL for an ordinary anchored chat. Governs the register in chat-prompt.ts and '
  'whether the route sends the reader''s marks along.';

NOTIFY pgrst, 'reload schema';
