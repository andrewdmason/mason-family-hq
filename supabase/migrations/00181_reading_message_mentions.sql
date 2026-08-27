-- ============================================================
-- Who was named in a message
-- ============================================================
-- Mentions are PROVENANCE. Permission lives in
-- reading_annotation_thread_participants, and nothing reads this column to
-- decide who may see a conversation. Keeping the two apart is what makes taking
-- somebody back out of a thread a one-row delete instead of a rewrite of
-- everything either of you ever wrote in it.
--
-- jsonb rather than a table: a mention belongs to exactly one message, is never
-- queried across messages, and is written on the streaming path where a second
-- insert is a second thing that can fail halfway. Shape, validated in TypeScript
-- rather than by a CHECK because it is read by one module:
--
--   [{"kind":"member","email":"jenny@mason.io","userId":"…",
--     "handle":"jenny","start":0,"len":6},
--    {"kind":"ai","email":null,"userId":null,"handle":"nor","start":22,"len":4}]
--
-- The character offsets are stored rather than recomputed on the client for the
-- same reason the server re-parses rather than trusting the client: two parsers
-- agree until the day the handle rules change, and then a message renders one
-- person's name over another person's grant.
ALTER TABLE reading_annotation_messages
  ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN reading_annotation_messages.mentions IS
  'Who was named in this message, with offsets. Provenance only — access is decided by reading_annotation_thread_participants.';
