-- Mason Bucks: a per-kid family currency.
--
-- Kids earn Bucks from reading bonus pages (1:1), qualifying journal entries
-- (a flat grant past a word/time gate), and adult-defined "earning tasks" they
-- claim and an adult approves. They spend Bucks on "prizes" (migrated from the
-- reader's reward milestones). Balance is the SUM over an append-only ledger —
-- there is no stored balance column to drift (mirrors reading_stretch_advances).
--
-- RLS follows the reading subsystem (see 00148): a kid may READ their own ledger,
-- claims, and redemptions, and the shared/own catalog of tasks + prizes; there
-- are NO user INSERT/UPDATE/DELETE policies. Every write goes through the
-- service role (earning hooks, the parent admin) or a SECURITY DEFINER RPC.
--
-- Conditional/guarded writes (redeem-against-balance, approve-only-if-pending)
-- live in RPCs, never a supabase-js `.update().or()` — PostgREST rejects an
-- or-filter on a mutation with a misleading 42703 (see 00116).

-- ============================================================
-- 1. Append-only transaction ledger (basis for balance)
-- ============================================================
-- One immutable row per earn (positive) or spend (negative). reference_id points
-- at the originating event (a stretch advance, a journal entry, a task claim, a
-- redemption, or — for the opening seed — the kid's own user id); the partial
-- unique index on (source, reference_id) makes every grant idempotent so a
-- double-fired advance, a journal reopen/reclose, or a re-run data migration can
-- never double-credit. note carries a human label so the history view needs no
-- joins. balance = SUM(amount) per user_id.
CREATE TABLE bucks_ledger (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount           int NOT NULL CHECK (amount <> 0),
  source           text NOT NULL
                     CHECK (source IN ('reading', 'journal', 'task', 'redemption', 'migration', 'adjustment')),
  -- The originating row's id (advance / entry / claim / redemption / kid id).
  reference_id     uuid,
  note             text,
  -- The adult who approved/redeemed, when a human action drove the row.
  created_by_email text REFERENCES family_members(email) ON UPDATE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bucks_ledger_user ON bucks_ledger (user_id);

-- One ledger row per source event: idempotency for reading/journal/task/redemption
-- grants and the opening-balance seed. Adjustments (reference_id NULL) may repeat.
CREATE UNIQUE INDEX uq_bucks_ledger_source_ref
  ON bucks_ledger (source, reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE bucks_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own ledger" ON bucks_ledger FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- 2. Earning tasks (adult-defined ways to earn)
-- ============================================================
-- A catalog row. unit_value is Bucks per unit_label (e.g. 20 per "game",
-- 5 per "page"); a claim multiplies by its quantity. audience_user_id null = both
-- kids; a kid id = that kid only. is_one_time tasks auto-archive on first approved
-- grant. archived tasks are hidden from kids and not claimable.
CREATE TABLE bucks_earning_tasks (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title            text NOT NULL,
  unit_value       int NOT NULL CHECK (unit_value > 0),
  unit_label       text NOT NULL,
  is_one_time      boolean NOT NULL DEFAULT false,
  -- null = shared by both kids; otherwise scoped to one kid.
  audience_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  archived_at      timestamptz,
  created_by_email text NOT NULL REFERENCES family_members(email) ON UPDATE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bucks_earning_tasks_audience ON bucks_earning_tasks (audience_user_id);

CREATE TRIGGER bucks_earning_tasks_updated_at
  BEFORE UPDATE ON bucks_earning_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bucks_earning_tasks ENABLE ROW LEVEL SECURITY;

-- Kids see shared tasks and their own; the parent admin reads via the service role.
CREATE POLICY "Read shared or own tasks" ON bucks_earning_tasks FOR SELECT
  USING (audience_user_id IS NULL OR audience_user_id = auth.uid());

-- ============================================================
-- 3. Task claims (kid claims a task; adult approves/rejects)
-- ============================================================
-- One row per claim. unit_value is snapshotted so an approval pays what the kid
-- saw, even if the task is later edited. status pending → approved | rejected;
-- approval inserts the credit ledger row (see approve_task_claim).
CREATE TABLE bucks_task_claims (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id          uuid NOT NULL REFERENCES bucks_earning_tasks(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quantity         int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_value       int NOT NULL CHECK (unit_value > 0),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by_email text REFERENCES family_members(email) ON UPDATE CASCADE
);

CREATE INDEX idx_bucks_task_claims_user ON bucks_task_claims (user_id);
CREATE INDEX idx_bucks_task_claims_pending ON bucks_task_claims (status) WHERE status = 'pending';

ALTER TABLE bucks_task_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own claims" ON bucks_task_claims FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- 4. Prizes (adult-defined ways to spend; migrated from milestones)
-- ============================================================
-- price is in Bucks. image_path lives in the reading-milestones storage bucket
-- (reused). audience_user_id null = both kids. archived prizes are hidden + not
-- redeemable.
CREATE TABLE bucks_prizes (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title            text NOT NULL,
  price            int NOT NULL CHECK (price > 0),
  image_path       text,
  audience_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  archived_at      timestamptz,
  created_by_email text NOT NULL REFERENCES family_members(email) ON UPDATE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bucks_prizes_audience ON bucks_prizes (audience_user_id);

CREATE TRIGGER bucks_prizes_updated_at
  BEFORE UPDATE ON bucks_prizes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bucks_prizes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read shared or own prizes" ON bucks_prizes FOR SELECT
  USING (audience_user_id IS NULL OR audience_user_id = auth.uid());

-- ============================================================
-- 5. Redemptions (kid/adult spends Bucks on a prize)
-- ============================================================
-- Instant debit (the ledger row) plus a fulfillment reminder for an adult to hand
-- over the real-world prize. title + price are snapshotted so history survives a
-- prize being archived/edited. redeemed_by_email is the kid OR an adult redeeming
-- on the kid's behalf.
CREATE TABLE bucks_redemptions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prize_id          uuid REFERENCES bucks_prizes(id) ON DELETE SET NULL,
  prize_title       text NOT NULL,
  price             int NOT NULL CHECK (price > 0),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'unfulfilled'
                      CHECK (status IN ('unfulfilled', 'fulfilled')),
  redeemed_by_email text REFERENCES family_members(email) ON UPDATE CASCADE,
  redeemed_at       timestamptz NOT NULL DEFAULT now(),
  fulfilled_at      timestamptz,
  fulfilled_by_email text REFERENCES family_members(email) ON UPDATE CASCADE
);

CREATE INDEX idx_bucks_redemptions_user ON bucks_redemptions (user_id);
CREATE INDEX idx_bucks_redemptions_unfulfilled ON bucks_redemptions (status) WHERE status = 'unfulfilled';

ALTER TABLE bucks_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own redemptions" ON bucks_redemptions FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- 6. RPCs: balance + atomic guarded writes
-- ============================================================

-- Balance = SUM over the ledger. Computed in SQL (never by pulling the ledger
-- client-side and risking a large .in() 414).
CREATE OR REPLACE FUNCTION bucks_balance(p_user_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)::int
    FROM bucks_ledger
   WHERE user_id = p_user_id;
$$;

-- service_role only: these take a target user/claim id, so the action layer must
-- call them with a trusted id (never client input). Granting to `authenticated`
-- would let a kid pass another kid's id. SECURITY DEFINER internal calls (e.g.
-- redeem_prize → bucks_balance) run as the owner and don't need the grant.
GRANT EXECUTE ON FUNCTION bucks_balance(uuid) TO service_role;

-- Redeem a prize: verify it's available and affordable, then insert the
-- redemption + the negative ledger row in one transaction. A per-user advisory
-- lock serializes concurrent redemptions so balance can never go negative.
CREATE OR REPLACE FUNCTION redeem_prize(
  p_prize_id uuid,
  p_user_id uuid,
  p_actor_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prize bucks_prizes%ROWTYPE;
  v_balance int;
  v_redemption_id uuid;
BEGIN
  -- Serialize redemptions for this kid (balance is a SUM, not a lockable row).
  PERFORM pg_advisory_xact_lock(hashtext('bucks_balance:' || p_user_id::text));

  SELECT * INTO v_prize FROM bucks_prizes WHERE id = p_prize_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRIZE_NOT_FOUND';
  END IF;
  IF v_prize.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'PRIZE_ARCHIVED';
  END IF;
  IF v_prize.audience_user_id IS NOT NULL AND v_prize.audience_user_id <> p_user_id THEN
    RAISE EXCEPTION 'PRIZE_WRONG_AUDIENCE';
  END IF;

  v_balance := bucks_balance(p_user_id);
  IF v_balance < v_prize.price THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  INSERT INTO bucks_redemptions (prize_id, prize_title, price, user_id, redeemed_by_email)
  VALUES (v_prize.id, v_prize.title, v_prize.price, p_user_id, p_actor_email)
  RETURNING id INTO v_redemption_id;

  INSERT INTO bucks_ledger (user_id, amount, source, reference_id, note, created_by_email)
  VALUES (p_user_id, -v_prize.price, 'redemption', v_redemption_id,
          'Redeemed: ' || v_prize.title, p_actor_email);

  RETURN v_redemption_id;
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_prize(uuid, uuid, text) TO service_role;

-- Approve a pending claim: stamp it, insert the credit, and archive the task if
-- it's one-time. The ledger's unique (source, reference_id) guarantees a single
-- credit per claim even under a double call.
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
  UPDATE bucks_task_claims
     SET status = 'approved',
         resolved_at = now(),
         resolved_by_email = p_actor_email
   WHERE id = p_claim_id
     AND status = 'pending'
  RETURNING * INTO v_claim;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_PENDING';
  END IF;

  SELECT * INTO v_task FROM bucks_earning_tasks WHERE id = v_claim.task_id;

  INSERT INTO bucks_ledger (user_id, amount, source, reference_id, note, created_by_email)
  VALUES (
    v_claim.user_id,
    v_claim.unit_value * v_claim.quantity,
    'task',
    v_claim.id,
    COALESCE(v_task.title, 'Earning task')
      || CASE WHEN v_claim.quantity > 1 THEN ' ×' || v_claim.quantity ELSE '' END,
    p_actor_email
  );

  IF v_task.id IS NOT NULL AND v_task.is_one_time AND v_task.archived_at IS NULL THEN
    UPDATE bucks_earning_tasks SET archived_at = now() WHERE id = v_task.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_task_claim(uuid, text) TO service_role;

-- Reject a pending claim: stamp it rejected, no ledger row.
CREATE OR REPLACE FUNCTION reject_task_claim(
  p_claim_id uuid,
  p_actor_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found boolean;
BEGIN
  UPDATE bucks_task_claims
     SET status = 'rejected',
         resolved_at = now(),
         resolved_by_email = p_actor_email
   WHERE id = p_claim_id
     AND status = 'pending'
  RETURNING true INTO v_found;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_PENDING';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION reject_task_claim(uuid, text) TO service_role;
