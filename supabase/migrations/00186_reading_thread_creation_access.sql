-- ============================================================
-- You can start a conversation of your own
-- ============================================================
-- Migration 00183 scoped conversations to their participants, which is right for
-- reading one and wrong for making one. Two things it left impossible, both on
-- the ordinary path of marking a passage in your own book:
--
--   Reading back a thread you just created. `INSERT ... RETURNING` needs SELECT
--   on the row, the SELECT policy asks whether you are a participant, and you
--   cannot be a participant of a thread that does not exist yet. The insert
--   fails outright — which is what made "couldn't save that annotation".
--
--   Putting yourself in it. Granting access is deliberately privileged and goes
--   through server code on an admin client, and adding YOURSELF to your OWN new
--   thread got caught by the same rule.
--
-- Both are fixed by naming the creator, which is a fact the row already carries.
-- Neither widens what anybody can see of somebody else: the first only ever
-- matches threads you started, and the second can only ever insert a row for
-- yourself, into a thread you started. Bringing another person in still has no
-- policy at all and stays admin-only.
--
-- Worth recording why this got through: every check written against 00183 used
-- the service-role client, which bypasses RLS entirely, so the create path was
-- never once exercised as a signed-in reader.

DROP POLICY "Participant reads thread" ON reading_annotation_threads;
CREATE POLICY "Participant reads thread" ON reading_annotation_threads FOR SELECT
  USING (
    created_by = auth.uid()
    OR reading_thread_is_participant(id, auth.uid())
  );

-- Yourself, into a thread you started. Nothing else.
CREATE POLICY "Creator joins own thread" ON reading_annotation_thread_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM reading_annotation_threads t
      WHERE t.id = thread_id AND t.created_by = auth.uid()
    )
  );

-- And read that row back, so the placement it points at can be set. Same shape
-- as above: your own row, in your own thread.
CREATE POLICY "Creator reads own participation"
  ON reading_annotation_thread_participants FOR SELECT
  USING (user_id = auth.uid());

-- Stamping your own read state. Restricted to your own row; the columns that
-- matter for access (role, annotation_id) are only ever written by server code
-- on an admin client, which this does not change.
CREATE POLICY "Own participation updates"
  ON reading_annotation_thread_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Leaving a conversation, or deleting your own mark's thread of one.
CREATE POLICY "Leave own participation"
  ON reading_annotation_thread_participants FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Creator deletes own thread" ON reading_annotation_threads FOR DELETE
  USING (created_by = auth.uid());
