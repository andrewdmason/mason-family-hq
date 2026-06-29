-- Baseball Stats: an archive of the boys' GameChanger history.
--
-- GameChanger organizes everything by *team-season* and offers no export and no
-- public API. This subsystem imports each team-season (roster, schedule, per-game
-- box scores, GameChanger's per-player season totals, and the raw play-by-play
-- event log) into our own tables so we can see each boy's career season-by-season
-- and never lose the data. Data is loaded by a local importer that emits guarded,
-- idempotent data migrations (see scripts/baseball/, docs/baseball-import-runbook.md).
--
-- Identity continuity: a player's GameChanger id is *team-scoped* — the same kid
-- is a different roster entry on every team. baseball_people is the cross-season
-- identity; baseball_team_players.person_id links a team roster entry to it. The
-- two boys are people with kind='kid' and a user_id; teammates are kind='teammate'.
--
-- RLS: this is a family-wide read surface (every view is the same for everyone —
-- there is no per-kid privacy split), so each table has a single SELECT policy
-- granting any authenticated family member read access. There are NO user
-- INSERT/UPDATE/DELETE policies; every write goes through the service role via a
-- generated data migration.
--
-- Stats are stored as jsonb to preserve GameChanger's full field set (~84 offensive
-- + ~26 defensive/pitching season stats) without a brittle wide schema. The app
-- selects a curated traditional subset for default views and exposes the rest
-- behind a "more stats" affordance.

-- ============================================================
-- 1. People — cross-season player identity
-- ============================================================
-- One row per real person across all teams/seasons. slug is a stable human-readable
-- key the importer's committed registry (scripts/baseball/people.json) owns, so the
-- generated data migrations can upsert people deterministically. The two boys carry
-- a user_id linking to their account; teammates do not.
CREATE TABLE baseball_people (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  display_name text NOT NULL,
  kind         text NOT NULL DEFAULT 'teammate'
                 CHECK (kind IN ('kid', 'teammate', 'other')),
  -- Set for the two tracked boys; null for everyone else.
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_baseball_people_user ON baseball_people (user_id);

CREATE TRIGGER baseball_people_updated_at
  BEFORE UPDATE ON baseball_people
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE baseball_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads people" ON baseball_people FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 2. Teams — one row per GameChanger team-season
-- ============================================================
-- gc_team_id is GameChanger's internal team UUID (stable, our natural key);
-- gc_public_id is the short id used in web.gc.com URLs. season_name/season_year/
-- level (e.g. "Summer 2023" / 2023 / "10U") drive grouping and sort.
CREATE TABLE baseball_teams (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gc_team_id   text NOT NULL UNIQUE,
  gc_public_id text,
  name         text NOT NULL,
  season_name  text,
  season_year  int,
  -- e.g. "10U", "Majors"; free text as GameChanger provides.
  level        text,
  org_name     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER baseball_teams_updated_at
  BEFORE UPDATE ON baseball_teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE baseball_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads teams" ON baseball_teams FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 3. Team players — a roster entry on one team-season
-- ============================================================
-- gc_player_id is GameChanger's team-scoped player id (unique within a team, not
-- across teams — hence person_id for continuity). is_opponent is reserved: v1
-- captures only our team's side, so rows are our roster, but the column lets a
-- later pass store opponents without a schema change.
CREATE TABLE baseball_team_players (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES baseball_teams(id) ON DELETE CASCADE,
  gc_player_id text NOT NULL,
  person_id    uuid REFERENCES baseball_people(id) ON DELETE SET NULL,
  name         text NOT NULL,
  jersey       text,
  is_opponent  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, gc_player_id)
);

CREATE INDEX idx_baseball_team_players_team ON baseball_team_players (team_id);
CREATE INDEX idx_baseball_team_players_person ON baseball_team_players (person_id);

CREATE TRIGGER baseball_team_players_updated_at
  BEFORE UPDATE ON baseball_team_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE baseball_team_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads team players" ON baseball_team_players FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 4. Games — one row per game in a team-season
-- ============================================================
CREATE TABLE baseball_games (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES baseball_teams(id) ON DELETE CASCADE,
  gc_game_id      text NOT NULL UNIQUE,
  played_on       date,
  opponent_name   text,
  home_away       text CHECK (home_away IN ('home', 'away')),
  team_score      int,
  opponent_score  int,
  -- 'W' | 'L' | 'T' | null (unplayed/unknown).
  result          text CHECK (result IN ('W', 'L', 'T')),
  status          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_baseball_games_team ON baseball_games (team_id);

CREATE TRIGGER baseball_games_updated_at
  BEFORE UPDATE ON baseball_games
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE baseball_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads games" ON baseball_games FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 5. Per-game player stats — the box-score line for one player in one game
-- ============================================================
-- batting/pitching are jsonb holding the traditional box-score line GameChanger
-- renders (batting: AB,R,H,RBI,BB,SO,2B,3B,HR,SB; pitching: IP,H,R,ER,BB,SO).
-- pitching is null for players who didn't pitch.
CREATE TABLE baseball_game_player_stats (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id         uuid NOT NULL REFERENCES baseball_games(id) ON DELETE CASCADE,
  team_player_id  uuid NOT NULL REFERENCES baseball_team_players(id) ON DELETE CASCADE,
  batting         jsonb,
  pitching        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, team_player_id)
);

CREATE INDEX idx_baseball_game_player_stats_game ON baseball_game_player_stats (game_id);
CREATE INDEX idx_baseball_game_player_stats_player ON baseball_game_player_stats (team_player_id);

CREATE TRIGGER baseball_game_player_stats_updated_at
  BEFORE UPDATE ON baseball_game_player_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE baseball_game_player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads game player stats" ON baseball_game_player_stats FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 6. Per-season player stats — GameChanger's full per-player season aggregate
-- ============================================================
-- stats is the complete GameChanger season-stats blob for the player (offense /
-- defense / general groups, ~110 fields). One row per player per team-season.
CREATE TABLE baseball_season_player_stats (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES baseball_teams(id) ON DELETE CASCADE,
  team_player_id  uuid NOT NULL REFERENCES baseball_team_players(id) ON DELETE CASCADE,
  stats           jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, team_player_id)
);

CREATE INDEX idx_baseball_season_player_stats_team ON baseball_season_player_stats (team_id);
CREATE INDEX idx_baseball_season_player_stats_player ON baseball_season_player_stats (team_player_id);

CREATE TRIGGER baseball_season_player_stats_updated_at
  BEFORE UPDATE ON baseball_season_player_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE baseball_season_player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads season player stats" ON baseball_season_player_stats FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 7. Game events — the raw play-by-play archive
-- ============================================================
-- One row per game holding GameChanger's full event log (the "compactor" event
-- stream that its stat engine replays). v1 renders no view of this; it is the
-- deep "never lose it" backup and the source for any future per-game recompute.
CREATE TABLE baseball_game_events (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id      uuid NOT NULL UNIQUE REFERENCES baseball_games(id) ON DELETE CASCADE,
  gc_stream_id text,
  events       jsonb NOT NULL,
  captured_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE baseball_game_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family reads game events" ON baseball_game_events FOR SELECT
  USING (auth.uid() IS NOT NULL);
