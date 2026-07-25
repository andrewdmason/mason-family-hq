-- Anchored AI chats inside the reader ("marginalia" model).
--
-- A chat lives at a fixed spot in a book and never moves. Anchors are stored in
-- the conversion's CHARACTER-OFFSET SPACE — the same space as
-- reading_book_pages.char_start/char_end. That space is defined by convert.ts
-- (`advance()`: every emitted <p>/<h*> contributes text.length + 1) and
-- reconstructed by extract-text.ts (stripHtmlToText). The book HTML is a static
-- generated file, so the reader client can recompute byte-identical offsets from
-- the same bytes on every load — which is what makes these anchors durable
-- without fragile DOM measurement.
--
-- Spoiler model: each chat FREEZES its own context boundary at creation time.
-- reading_books.spoiler_free only decides what a NEW chat gets; flipping it
-- never rewrites existing chats. To read with a different boundary you start a
-- new chat or fork an existing one.

-- ============================================================
-- 1. Book metadata + the per-book spoiler switch
-- ============================================================
-- genres: resolved by the AI book lookup at add time; informational.
-- spoiler_free: seeded true for fiction at add time, flippable per book.
ALTER TABLE reading_books ADD COLUMN genres text[];
ALTER TABLE reading_books ADD COLUMN spoiler_free boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Chats (one row per anchored thread)
-- ============================================================
CREATE TABLE reading_chats (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id              uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Durable position in the reflowed text. Shape (v1):
  --   { "v": 1, "kind": "between" | "selection",
  --     "blockIndex": int,          -- index into the document-order block stream
  --     "endBlockIndex": int|null,  -- selection only
  --     "startOffset": int|null,    -- selection only: char offset within block
  --     "endOffset": int|null }
  anchor               jsonb NOT NULL,

  -- The anchor's position in the conversion char stream. Client-computed from
  -- the book HTML; the server re-derives anchor_page from it (never trusts a
  -- client-supplied page, since that would let a caller widen its own context).
  anchor_char_offset   int NOT NULL,

  -- Source page containing the anchor, from reading_book_pages. NULL when the
  -- book has no page map at all (an unchaptered synthetic-page EPUB).
  anchor_page          int,

  -- The book's spoiler_free at the moment this chat was created, FROZEN here.
  -- Flipping the book's switch later never rewrites existing chats.
  spoiler_free         boolean NOT NULL,

  -- The FROZEN boundary, used when spoiler_free is true: send the book through
  -- this page. NULL while spoiler_free is true means the book has no page map at
  -- all (an unchaptered synthetic-page EPUB) — fall back to anchor_char_offset.
  -- Meaningless when spoiler_free is false (the whole book is sent).
  -- Never updated after insert.
  --
  -- The separate spoiler_free flag is load-bearing: without it, NULL here is
  -- ambiguous between "whole book" and "scoped, but no pages to scope by", and
  -- the second reading would silently send an entire novel to a spoiler-safe chat.
  context_through_page int,

  -- Selection-initiated chats: the highlighted passage, quoted verbatim into
  -- both the prompt and the thread. Stored as text so the quote survives even
  -- if the block offsets above ever fail to resolve.
  quoted_text          text,

  -- 'fast' = claude-haiku-4-5, 'deep' = claude-sonnet-5. A Fast chat is
  -- promoted to Deep per-request when the context exceeds Haiku's window; that
  -- promotion is recorded on the message, not here.
  model_preference     text NOT NULL DEFAULT 'fast'
                         CHECK (model_preference IN ('fast', 'deep')),

  -- "Continue from here": the chat whose transcript this one carries forward.
  forked_from_chat_id  uuid REFERENCES reading_chats(id) ON DELETE SET NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_chats_book ON reading_chats (book_id, user_id);

CREATE TRIGGER reading_chats_updated_at
  BEFORE UPDATE ON reading_chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_chats FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 3. Messages
-- ============================================================
-- role 'note' is a system-inserted one-liner shown in the thread (e.g. "answered
-- with the Deep model because this book is too long for Fast"). Notes are never
-- sent to the model.
CREATE TABLE reading_chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    uuid NOT NULL REFERENCES reading_chats(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'assistant', 'note')),
  content    text NOT NULL,
  -- Which model actually produced an assistant turn, so a promotion is auditable.
  model      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_chat_messages_chat
  ON reading_chat_messages (chat_id, created_at);

ALTER TABLE reading_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_chat_messages FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
