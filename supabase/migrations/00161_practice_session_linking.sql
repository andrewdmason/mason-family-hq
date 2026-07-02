-- Open-session linking state (plan U8/KTD9,
-- docs/plans/2026-07-02-001-feat-practice-capture-merge-plan.md).
--
-- Open sessions are now capture-only: initial processing is transcription-only
-- and writes zero practice_tasks (R15/AE6). Piece recognition survives as the
-- explicit "link to pieces" action (R16), which needs its own state, separate
-- from the session's transcription status machine (uploaded -> processing ->
-- ready | failed, 00144):
--
--   link_status: none -> linking -> linked | failed (-> linking again on
--   re-link/retry). NOT NULL so a `.neq('link_status','linking')` guarded
--   UPDATE works as the re-entry lease (NULL would never match .neq; and
--   .or() on a mutation is the PostgREST 42703 trap — see memory).
--
--   accepted_segments: jsonb array of accepted proposals
--   [{ key, pieceId, startSec, endSec, taskId, acceptedAt }] — the snapshot of
--   each recognition segment the user accepted plus the ordinary completed
--   practice_task it created. Re-linking replaces result.segments (the
--   proposal pool) but NEVER touches these or their tasks (KTD9 — the old
--   delete-and-rewrite autolog idempotency does not survive into linking).
--
-- Idempotent — the local Supabase stack is shared across Conductor workspaces,
-- so re-applying must be harmless (see 00147).

ALTER TABLE practice_sessions
  ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'none'
    CHECK (link_status IN ('none', 'linking', 'linked', 'failed')),
  ADD COLUMN IF NOT EXISTS link_error text,
  ADD COLUMN IF NOT EXISTS accepted_segments jsonb NOT NULL DEFAULT '[]'::jsonb;
