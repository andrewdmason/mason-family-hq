-- ============================================================
-- A mark and its conversation stop being the same thing
-- ============================================================
-- Everything in the reader is a private copy. Two people reading the same title
-- have two reading_books rows, two conversions of the file, two sets of marks,
-- and no way to see each other's. That is right for a library and wrong for a
-- passage you want to show someone.
--
-- Sharing one mark breaks against a fact that runs through every query in the
-- reader: the margin, the gutter, the highlight painter and the marks index are
-- all drawn from `reading_annotations WHERE book_id = <their book> AND user_id =
-- <them>`. A row belonging to someone else's copy cannot appear in any of them
-- without a book-identity join at every call site — and there is no book
-- identity in this schema, only per-user rows. Worse, half the columns on an
-- annotation are irreducibly per-reader: anchor_page, spoiler_free,
-- context_through_page, and the anchor itself when the two files differ. One row
-- cannot hold two readers' spoiler boundaries.
--
-- So the row splits in two:
--
--   the PLACEMENT      reading_annotations, unchanged. One per person, per copy.
--                      Owns the anchor, the page, the spoiler boundary. Paints,
--                      sorts, counts and deletes exactly as it does today.
--
--   the CONVERSATION   reading_annotation_threads. One per shared mark. Messages
--                      hang off it instead of off a placement.
--
-- Sharing a mark then means: create a second placement in the recipient's own
-- copy, pointing at the same thread. Their margin gets a real mark; the
-- transcript is single and shared; and deleting your placement takes your mark
-- out of your book without destroying a conversation two people wrote.
--
-- Nothing user-visible changes in this migration. Every existing annotation gets
-- a thread of one, and the app is repointed to read messages by thread. The
-- sharing itself arrives later.

-- ============================================================
-- 1. The conversation
-- ============================================================
CREATE TABLE reading_annotation_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The AI is a participant once mentioned, and stays one: you should not have
  -- to re-summon it on every turn of a conversation you are already having with
  -- it. Sticky rather than derived, because "has an assistant message" would
  -- also be true of a thread whose only AI turn was months and one topic ago.
  ai_participant  boolean NOT NULL DEFAULT false,

  -- Denormalized so the notification bell can find threads with something new in
  -- them without scanning messages. Written by the same server code that inserts
  -- a message rather than by a trigger, because the streaming chat route already
  -- owns that write path and a trigger would fire once per streamed insert.
  last_message_at timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER reading_annotation_threads_updated_at
  BEFORE UPDATE ON reading_annotation_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. Who is in it
-- ============================================================
-- This table is the permission. Mentions are recorded on messages as provenance
-- — who was named, where in the text — but nothing reads them to decide access.
-- Keeping those separate is what makes revoking someone a one-row delete instead
-- of a rewrite of history.
CREATE TABLE reading_annotation_thread_participants (
  thread_id     uuid NOT NULL REFERENCES reading_annotation_threads(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'owner' started the thread; 'participant' was brought in by a mention. The
  -- distinction decides whose action is "delete" and whose is "leave".
  role          text NOT NULL DEFAULT 'participant'
                  CHECK (role IN ('owner', 'participant')),

  -- THEIR placement — the mark in their own copy of the book. NULL means it has
  -- not landed yet: sharing returns as soon as the grant exists and the book
  -- copy runs afterwards, so this column is also the "not placed yet" state that
  -- the permalink and the panel both heal on first sight.
  annotation_id uuid REFERENCES reading_annotations(id) ON DELETE SET NULL,

  invited_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at    timestamptz NOT NULL DEFAULT now(),

  -- Read state, same job as journal_entry_views.last_viewed_at (migration
  -- 00066) but one table smaller, since a participant row already exists per
  -- (person, conversation).
  last_read_at  timestamptz,
  muted         boolean NOT NULL DEFAULT false,

  PRIMARY KEY (thread_id, user_id)
);

-- The bell's query is "my threads", not "this thread's people".
CREATE INDEX idx_reading_thread_participants_user
  ON reading_annotation_thread_participants (user_id, thread_id);

-- ============================================================
-- 3. Placements point at a thread
-- ============================================================
ALTER TABLE reading_annotations
  ADD COLUMN thread_id uuid REFERENCES reading_annotation_threads(id) ON DELETE CASCADE,

  -- Whose mark this originally was. NULL on your own; set on a placement created
  -- for you by someone else's mention, which is what lets the margin paint it as
  -- somebody else's rather than as one of yours.
  ADD COLUMN shared_from_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Whether the passage was actually found in THIS copy of the book.
  --   'exact'     the file is byte-identical, so the offsets transferred verbatim
  --   'relocated' a different file, so the quote was fuzzy-matched into it
  --   'unplaced'  the quote could not be found; the mark is listed and linkable
  --               but never painted
  -- A share that produces nothing visible is the worst available failure for
  -- this feature, so 'unplaced' exists to make sure one never silently vanishes.
  ADD COLUMN anchor_status text NOT NULL DEFAULT 'exact'
    CHECK (anchor_status IN ('exact', 'relocated', 'unplaced'));

-- Every annotation that exists today becomes a thread of one. The thread reuses
-- the annotation's id: they are 1:1 at this moment, it makes the backfill a
-- join-free update, and for the whole history predating sharing the two ids
-- reading the same is a debugging convenience rather than a coincidence.
INSERT INTO reading_annotation_threads
  (id, created_by, ai_participant, last_message_at, created_at, updated_at)
SELECT
  a.id,
  a.user_id,
  EXISTS (
    SELECT 1 FROM reading_annotation_messages m
    WHERE m.annotation_id = a.id AND m.role = 'assistant'
  ),
  (SELECT max(m.created_at) FROM reading_annotation_messages m
   WHERE m.annotation_id = a.id),
  a.created_at,
  a.updated_at
FROM reading_annotations a;

UPDATE reading_annotations SET thread_id = id;

ALTER TABLE reading_annotations ALTER COLUMN thread_id SET NOT NULL;

INSERT INTO reading_annotation_thread_participants
  (thread_id, user_id, role, annotation_id, invited_at)
SELECT a.id, a.user_id, 'owner', a.id, a.created_at
FROM reading_annotations a;

-- One placement per person per conversation, enforced structurally rather than
-- by the care of whatever code path happens to be creating it. The placement
-- flow can run from three places at once (the share's own after-hook, the
-- permalink, the panel opening), and this is what makes losing that race safe.
CREATE UNIQUE INDEX idx_reading_annotations_thread_user
  ON reading_annotations (thread_id, user_id);

-- ============================================================
-- 4. Messages hang off the thread
-- ============================================================
ALTER TABLE reading_annotation_messages
  ADD COLUMN thread_id uuid REFERENCES reading_annotation_threads(id) ON DELETE CASCADE;

UPDATE reading_annotation_messages SET thread_id = annotation_id;

ALTER TABLE reading_annotation_messages ALTER COLUMN thread_id SET NOT NULL;

CREATE INDEX idx_reading_annotation_messages_thread
  ON reading_annotation_messages (thread_id, created_at);

-- annotation_id survives this migration, nullable and unread, for exactly one
-- reason: the database migrates before the code deploys, and in that window the
-- running app still inserts messages keyed by annotation. The trigger below
-- keeps those rows valid. Migration 00167's own notes are about getting that
-- window wrong in production; this is the cheap version of not doing it again.
-- A later migration drops both once the deploy has settled.
ALTER TABLE reading_annotation_messages ALTER COLUMN annotation_id DROP NOT NULL;

-- And it stops cascading. This is the load-bearing half of keeping the column
-- around: it still points at the mark it was written on, and every row written
-- before today has one, so leaving the cascade in place would mean the first
-- person to take a shared mark out of their own margin destroys a conversation
-- two people wrote. Deleting a placement must delete a placement.
ALTER TABLE reading_annotation_messages
  DROP CONSTRAINT reading_chat_messages_chat_id_fkey;
ALTER TABLE reading_annotation_messages
  ADD CONSTRAINT reading_annotation_messages_annotation_id_fkey
  FOREIGN KEY (annotation_id) REFERENCES reading_annotations(id) ON DELETE SET NULL;

CREATE FUNCTION reading_annotation_message_thread_fill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.thread_id IS NULL AND NEW.annotation_id IS NOT NULL THEN
    SELECT a.thread_id INTO NEW.thread_id
    FROM reading_annotations a WHERE a.id = NEW.annotation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reading_annotation_messages_thread_fill
  BEFORE INSERT ON reading_annotation_messages
  FOR EACH ROW EXECUTE FUNCTION reading_annotation_message_thread_fill();

COMMENT ON COLUMN reading_annotation_messages.annotation_id IS
  'Superseded by thread_id (migration 00180). Retained only to keep the pre-deploy app writing valid rows; not read.';

-- user_id changes meaning here, and it is worth saying so where the schema can
-- be read rather than only where the code can. It used to mean two things at
-- once — who wrote this, and whose library this row belongs to. The second is
-- now wrong: a shared thread's rows belong to the thread. What survives is the
-- first, which is the useful one and the one that lets a transcript say who
-- said what.
COMMENT ON COLUMN reading_annotation_messages.user_id IS
  'Who wrote this turn (or, for assistant/notice/document rows, whose turn produced it). NOT a scoping column — scope by thread_id.';
