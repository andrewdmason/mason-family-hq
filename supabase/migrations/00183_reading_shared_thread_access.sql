-- ============================================================
-- Being in a conversation is what lets you read it
-- ============================================================
-- Every reading table in this schema says the same thing: "Own rows", user_id =
-- auth.uid(). That is exactly right for a library and exactly wrong for a
-- conversation two people are having, which is the one thing here that is not
-- anybody's alone.
--
-- So the messages table stops being self-scoped and starts being
-- participant-scoped, and the marks table GAINS a read for participants without
-- losing anything: policies are OR'd, so a participant can see the anchor row a
-- conversation hangs off — its quote, its page — while still being unable to
-- write, move or delete a mark in somebody else's book.

-- ============================================================
-- 1. The predicate, in a function, for a reason
-- ============================================================
-- "You may see a participant row for a conversation you participate in" is
-- self-referential, and Postgres does not evaluate that — it raises
-- "infinite recursion detected in policy for relation" at query time, on a
-- policy that looked fine when it was written.
--
-- SECURITY DEFINER runs the inner scan as the table's owner with RLS not
-- applied, which breaks the cycle. STABLE lets the planner call it once per
-- statement rather than once per row. And search_path is pinned, because a
-- SECURITY DEFINER function without one is the classic way to hand somebody
-- else's schema the keys.
CREATE FUNCTION reading_thread_is_participant(t uuid, u uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM reading_annotation_thread_participants p
    WHERE p.thread_id = t AND p.user_id = u
  );
$$;

REVOKE ALL ON FUNCTION reading_thread_is_participant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reading_thread_is_participant(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION reading_thread_is_participant(uuid, uuid) TO authenticated;

-- ============================================================
-- 2. Marks: the same ownership, plus one read
-- ============================================================
-- "Own rows" is left exactly as it was. This only widens SELECT.
CREATE POLICY "Participant reads shared anchor" ON reading_annotations FOR SELECT
  USING (reading_thread_is_participant(thread_id, auth.uid()));

-- ============================================================
-- 3. Messages: the conversation's, not the author's
-- ============================================================
DROP POLICY "Own rows" ON reading_annotation_messages;

CREATE POLICY "Participant reads" ON reading_annotation_messages FOR SELECT
  USING (reading_thread_is_participant(thread_id, auth.uid()));

-- You may add your own words to a conversation you are in. Both halves matter:
-- the first stops you writing in somebody else's name, the second stops you
-- writing into a conversation you were never asked into.
CREATE POLICY "Participant writes own" ON reading_annotation_messages FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND reading_thread_is_participant(thread_id, auth.uid())
  );

-- Nobody edits a message — a transcript that can be rewritten under somebody is
-- not a record of a conversation. Removing your own is allowed.
CREATE POLICY "Author deletes own" ON reading_annotation_messages FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- 4. Threads and their rosters
-- ============================================================
ALTER TABLE reading_annotation_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participant reads thread" ON reading_annotation_threads FOR SELECT
  USING (reading_thread_is_participant(id, auth.uid()));
CREATE POLICY "Creator writes thread" ON reading_annotation_threads FOR INSERT
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Participant updates thread" ON reading_annotation_threads FOR UPDATE
  USING (reading_thread_is_participant(id, auth.uid()))
  WITH CHECK (reading_thread_is_participant(id, auth.uid()));

ALTER TABLE reading_annotation_thread_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participant reads roster" ON reading_annotation_thread_participants
  FOR SELECT USING (reading_thread_is_participant(thread_id, auth.uid()));

-- No INSERT, UPDATE or DELETE policy here, deliberately.
--
-- Granting somebody access is a privileged act and goes through server code that
-- has already checked who is asking. And RLS cannot express "you may change only
-- your own last_read_at": an UPDATE policy's WITH CHECK cannot see the old row,
-- so a self-update policy would also let a participant rewrite their own role or
-- repoint their placement at a mark in somebody else's book. The codebase
-- already has the right pattern for this — recommending a book writes a row into
-- another member's shelf on an admin client after verifying the caller — and
-- these follow it.
