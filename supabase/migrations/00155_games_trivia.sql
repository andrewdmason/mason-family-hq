-- Games · Trivia — the first game in the Games app.
--
-- A family trivia game played host-mode on one phone. Questions are generated on
-- demand by an LLM and gated by an adversarial verifier before they're playable;
-- a game assembles a deck from the verified pool, and the winning kid earns Mason
-- Bucks (capped per day) through the existing bucks_ledger.
--
-- RLS: the question bank and game records are a family-wide read surface (no
-- per-kid privacy split), so each table has a single SELECT policy for any
-- authenticated member and NO user write policies — every write goes through the
-- service role (server actions) or the SECURITY DEFINER payout RPC below. This
-- mirrors the baseball subsystem (00153) and Mason Bucks (00151).
--
-- jsonb is used for the per-type question payload (MC options, List items,
-- Closest answer) and for game state (teams, scores) to avoid a brittle wide
-- schema, matching the baseball stats convention.

-- ============================================================
-- 1. Allow 'games' as a Bucks ledger source
-- ============================================================
-- The trivia payout credits the ledger with source='games'; the inline CHECK in
-- 00151 (auto-named bucks_ledger_source_check) doesn't include it yet.
ALTER TABLE bucks_ledger DROP CONSTRAINT bucks_ledger_source_check;
ALTER TABLE bucks_ledger ADD CONSTRAINT bucks_ledger_source_check
  CHECK (source IN ('reading', 'journal', 'task', 'redemption', 'migration', 'adjustment', 'games'));

-- ============================================================
-- 2. Generation batches — one row per "generate questions" run
-- ============================================================
-- An adult triggers a batch for a topic (+ optional level/type/count). status
-- tracks the async-ish generate→verify flow so partial progress/failures are
-- visible. level/type are nullable for mixed batches.
CREATE TABLE trivia_batches (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  topic            text NOT NULL,
  level            text CHECK (level IN ('younger_kid', 'older_kid', 'adult', 'all')),
  type             text CHECK (type IN ('mc', 'list', 'closest')),
  requested_count  int NOT NULL DEFAULT 10,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  error            text,
  created_by_email text REFERENCES family_members(email) ON UPDATE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trivia_batches_updated_at
  BEFORE UPDATE ON trivia_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE trivia_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads trivia batches" ON trivia_batches FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 3. Questions — the verified playable bank
-- ============================================================
-- level is a relative band (younger_kid/older_kid map to the two boys, stable
-- across school years; the concrete grade only flavors generation). type drives
-- the payload shape: mc {options:[...], correctIndex}, list {items:[...],
-- acceptable?, target?}, closest {answer:number, unit?}. Only status='ready'
-- questions are playable; the verifier quarantines the rest.
CREATE TABLE trivia_questions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id      uuid REFERENCES trivia_batches(id) ON DELETE CASCADE,
  topic         text NOT NULL,
  level         text NOT NULL CHECK (level IN ('younger_kid', 'older_kid', 'adult', 'all')),
  type          text NOT NULL CHECK (type IN ('mc', 'list', 'closest')),
  prompt        text NOT NULL,
  payload       jsonb NOT NULL,
  perishable    boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'verifying', 'ready', 'quarantined', 'retired')),
  -- The verifier's verdict + notes; null until verification runs.
  verification  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Deck assembly filters by playable status, level band, and type; topic scoping
-- and batch review use their own lookups.
CREATE INDEX idx_trivia_questions_pool ON trivia_questions (status, level, type);
CREATE INDEX idx_trivia_questions_topic ON trivia_questions (topic);
CREATE INDEX idx_trivia_questions_batch ON trivia_questions (batch_id);

CREATE TRIGGER trivia_questions_updated_at
  BEFORE UPDATE ON trivia_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE trivia_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads trivia questions" ON trivia_questions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 4. Games — one row per played session
-- ============================================================
-- teams is the source of truth for who's on each team and which member is the
-- kid (so the payout can resolve "the winning kid"). Shape:
--   [ { "key": "team1", "name": "...", "memberUserIds": ["..."],
--       "kidUserId": "<uuid>"|null }, { "key": "team2", ... } ]
-- winner holds the winning team key, 'tie', or null. scores is { team1: n, ... }.
-- Turn-by-turn outcomes live client-side; only the summary lands here.
CREATE TABLE trivia_games (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  status         text NOT NULL DEFAULT 'setup'
                   CHECK (status IN ('setup', 'active', 'completed', 'abandoned')),
  teams          jsonb NOT NULL,
  -- 'quick' | 'standard' | 'target'; target uses target_score.
  mode           text NOT NULL DEFAULT 'standard'
                   CHECK (mode IN ('quick', 'standard', 'target')),
  target_score   int,
  -- Array of topic strings to scope the deck, or null = the whole bank.
  topic_scope    jsonb,
  scores         jsonb,
  winner         text,
  bucks_settled  boolean NOT NULL DEFAULT false,
  bucks_paid     boolean NOT NULL DEFAULT false,
  started_at     timestamptz,
  ended_at       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The daily-cap count filters paid games by their local-day ended_at.
CREATE INDEX idx_trivia_games_paid ON trivia_games (bucks_paid, ended_at);

CREATE TRIGGER trivia_games_updated_at
  BEFORE UPDATE ON trivia_games
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE trivia_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads trivia games" ON trivia_games FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 5. Served-deck log — which questions a game served, in order
-- ============================================================
-- Written at game start (the whole deck is known up front). Powers two things:
-- the recently-seen filter (R23) so back-to-back games don't repeat, and a
-- durable record of each game's deck.
CREATE TABLE trivia_game_questions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id           uuid NOT NULL REFERENCES trivia_games(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL REFERENCES trivia_questions(id) ON DELETE CASCADE,
  spotlight_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ordinal           int NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trivia_game_questions_game ON trivia_game_questions (game_id);
CREATE INDEX idx_trivia_game_questions_question ON trivia_game_questions (question_id);

ALTER TABLE trivia_game_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads trivia game questions" ON trivia_game_questions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 6. Payout RPC — settle a completed game's Bucks exactly once
-- ============================================================
-- Credits the winning kid +10 and the other kid +3 (a tie pays both the
-- consolation), capped to the first paying game per household per local day.
--
-- Locking: the cap is a HOUSEHOLD-WIDE invariant, so we lock a household-stable
-- key — NOT the game id. Locking per-game would let two games settling at once
-- each take a different lock, both read "0 paid today", and both pay (the exact
-- double-pay the cap prevents). Contrast redeem_prize (00151), which locks per
-- user because its guarded quantity is per user.
--
-- Idempotency: a bucks_settled flag guards re-runs, and each kid's ledger
-- reference_id is md5(game:kid) — deterministic and distinct per (game, kid), so
-- the global (source, reference_id) unique index also blocks any double credit.
--
-- Day boundary is Pacific/Honolulu (the family's tz); bare now() would resolve in
-- UTC and let an evening HST game roll into the next day.
CREATE OR REPLACE FUNCTION award_trivia_win(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game           trivia_games%ROWTYPE;
  v_cap            constant int := 1;   -- paying games per household per day
  v_winner_bucks   constant int := 10;
  v_consolation    constant int := 3;
  v_today          date := (now() AT TIME ZONE 'Pacific/Honolulu')::date;
  v_paid_today     int;
  v_team           jsonb;
  v_kid            uuid;
  v_amount         int;
  v_paid           boolean := false;
BEGIN
  -- Household-stable lock: serialize ALL trivia settlements so the cap holds.
  PERFORM pg_advisory_xact_lock(hashtext('trivia_payout:household'));

  SELECT * INTO v_game FROM trivia_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'completed' THEN
    RETURN;                              -- nothing to settle
  END IF;
  IF v_game.bucks_settled THEN
    RETURN;                              -- already settled (idempotent)
  END IF;

  SELECT count(*) INTO v_paid_today
    FROM trivia_games
   WHERE bucks_paid = true
     AND (ended_at AT TIME ZONE 'Pacific/Honolulu')::date = v_today;

  IF v_paid_today < v_cap THEN
    FOR v_team IN SELECT * FROM jsonb_array_elements(v_game.teams)
    LOOP
      v_kid := NULLIF(v_team->>'kidUserId', '')::uuid;
      CONTINUE WHEN v_kid IS NULL;       -- adult-only team earns nothing

      IF v_game.winner IS NULL OR v_game.winner = 'tie' THEN
        v_amount := v_consolation;
      ELSIF v_team->>'key' = v_game.winner THEN
        v_amount := v_winner_bucks;
      ELSE
        v_amount := v_consolation;
      END IF;

      INSERT INTO bucks_ledger (user_id, amount, source, reference_id, note)
      VALUES (
        v_kid,
        v_amount,
        'games',
        md5(p_game_id::text || ':' || v_kid::text)::uuid,
        CASE WHEN v_amount = v_winner_bucks THEN 'Trivia win' ELSE 'Trivia game' END
      )
      ON CONFLICT (source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
      v_paid := true;
    END LOOP;
  END IF;

  UPDATE trivia_games
     SET bucks_settled = true,
         bucks_paid = v_paid
   WHERE id = p_game_id;
END;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC (and authenticated ∈ PUBLIC), so a kid
-- could call this directly via PostgREST to mint Bucks. Lock it to service_role.
REVOKE ALL ON FUNCTION award_trivia_win(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_trivia_win(uuid) TO service_role;
