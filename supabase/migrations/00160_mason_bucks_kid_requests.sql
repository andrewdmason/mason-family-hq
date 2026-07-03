-- Mason Bucks: let kids request an arbitrary amount with a note.
--
-- Adults already hand out one-off grants (awardBucks → an `adjustment` ledger row,
-- instant). This lets a KID ask for a one-off amount with a note that an adult then
-- approves — reusing the whole claim → approve/reject machinery rather than adding a
-- parallel "requests" table. A request is simply a task claim with no task:
--   task_id NULL, quantity 1, unit_value = the amount asked for, note = why.
-- On approval it credits `unit_value * quantity` (= the amount) exactly like a task
-- claim, and reject leaves no ledger row. Same idempotency (one credit per claim id).

-- A claim can now stand alone (no originating task). The FK still holds for the
-- rows that do point at a task; NULL simply skips it.
ALTER TABLE bucks_task_claims ALTER COLUMN task_id DROP NOT NULL;

-- The kid's explanation. Only set on task-less requests; task claims label
-- themselves from the task title (see approve_task_claim below).
ALTER TABLE bucks_task_claims ADD COLUMN note text;

-- Re-approve with a note fallback: a task claim still labels its ledger row from
-- the task title; a task-less request uses the kid's note. Otherwise identical to
-- the 00151 definition (locks, one-time archiving, single-credit guarantee).
CREATE OR REPLACE FUNCTION approve_task_claim(
  p_claim_id uuid,
  p_actor_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim bucks_task_claims%ROWTYPE;
  v_task bucks_earning_tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_claim FROM bucks_task_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'CLAIM_NOT_PENDING';
  END IF;

  -- Lock the task row so concurrent approvals of stacked claims on a one-time
  -- task serialize: once the first archives it, the rest see archived_at set and
  -- raise — a one-time task can never pay more than once. A task-less request
  -- (task_id NULL) finds no row and skips this entirely.
  SELECT * INTO v_task FROM bucks_earning_tasks WHERE id = v_claim.task_id FOR UPDATE;
  IF v_task.id IS NOT NULL AND v_task.is_one_time AND v_task.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'TASK_ALREADY_CLAIMED';
  END IF;

  UPDATE bucks_task_claims
     SET status = 'approved',
         resolved_at = now(),
         resolved_by_email = p_actor_email
   WHERE id = p_claim_id;

  INSERT INTO bucks_ledger (user_id, amount, source, reference_id, note, created_by_email)
  VALUES (
    v_claim.user_id,
    v_claim.unit_value * v_claim.quantity,
    'task',
    v_claim.id,
    COALESCE(v_task.title, v_claim.note, 'Earning task')
      || CASE WHEN v_claim.quantity > 1 THEN ' ×' || v_claim.quantity ELSE '' END,
    p_actor_email
  );

  IF v_task.id IS NOT NULL AND v_task.is_one_time AND v_task.archived_at IS NULL THEN
    UPDATE bucks_earning_tasks SET archived_at = now() WHERE id = v_task.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION approve_task_claim(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_task_claim(uuid, text) TO service_role;
