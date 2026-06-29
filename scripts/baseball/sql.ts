// Pure SQL builder: cache + registry -> a guarded, idempotent data migration.
//
// FK references are resolved with subqueries on the natural GameChanger ids
// (gc_team_id, gc_game_id, gc_player_id, slug), so the emitted SQL is portable
// (no uuid generation, no env-specific ids) and every statement is an
// INSERT ... ON CONFLICT DO UPDATE — re-applying refreshes data without
// duplicating (R7). Kid people resolve user_id via family_members so the same
// migration works in prod and local.

import type { Registry } from "./identity";

export type CacheTeam = {
  gc_team_id: string;
  gc_public_id?: string | null;
  name: string;
  season_name?: string | null;
  season_year?: number | null;
  level?: string | null;
  org_name?: string | null;
};
export type CacheGame = {
  gc_game_id: string;
  gc_stream_id?: string | null;
  home_away?: "home" | "away" | null;
  team_score?: number | null;
  opponent_score?: number | null;
  result?: "W" | "L" | "T" | null;
  status?: string | null;
  played_on?: string | null;
  opponent_name?: string | null;
};
export type CacheGameStat = {
  gc_player_id: string;
  batting: unknown;
  pitching: unknown;
};
export type Cache = {
  team: CacheTeam;
  roster: { gc_player_id: string; name: string; jersey: string | null }[];
  games: CacheGame[];
  seasonStats: { gc_player_id: string; stats: unknown }[];
  gameStats: Record<string, { linked: CacheGameStat[]; events?: { gc_stream_id: string | null; events: unknown[] } }>;
};

function q(s: string | null | undefined): string {
  if (s === null || s === undefined) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}
function qn(n: number | null | undefined): string {
  return n === null || n === undefined ? "NULL" : String(n);
}
function jb(obj: unknown): string {
  if (obj === null || obj === undefined) return "NULL";
  return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
}

const teamRef = (gcTeam: string) => `(SELECT id FROM baseball_teams WHERE gc_team_id = ${q(gcTeam)})`;
const personRef = (slug: string) => `(SELECT id FROM baseball_people WHERE slug = ${q(slug)})`;
const gameRef = (gcGame: string) => `(SELECT id FROM baseball_games WHERE gc_game_id = ${q(gcGame)})`;
const teamPlayerRef = (gcTeam: string, gcPlayer: string) =>
  `(SELECT tp.id FROM baseball_team_players tp JOIN baseball_teams t ON tp.team_id = t.id WHERE t.gc_team_id = ${q(gcTeam)} AND tp.gc_player_id = ${q(gcPlayer)})`;
// Resolve a kid's account portably wherever the migration runs.
const familyMemberRef = (name: string) =>
  `(SELECT user_id FROM family_members WHERE lower(name) = lower(${q(name)}) AND role = 'kid')`;

export function buildMigrationSql(caches: Cache[], registry: Registry): string {
  // Guard: every captured roster player must already be resolved in the registry
  // (R8/R9 — identity is confirmed before generation, never guessed here).
  const unresolved: string[] = [];
  for (const c of caches) {
    for (const p of c.roster) {
      if (!registry.aliases[p.gc_player_id]) unresolved.push(`${c.team.name}: ${p.name} (${p.gc_player_id})`);
    }
  }
  if (unresolved.length) {
    throw new Error(
      `Cannot generate: ${unresolved.length} roster player(s) unresolved in people.json. Confirm identities first:\n  ${unresolved.join("\n  ")}`,
    );
  }

  const out: string[] = [];
  out.push("-- Baseball data import (generated). Re-run safe: every statement is");
  out.push("-- INSERT ... ON CONFLICT DO UPDATE keyed on GameChanger natural ids.");
  out.push(`-- Teams: ${caches.map((c) => c.team.name).join(", ")}`);
  out.push("");

  // 1. People referenced by this import.
  const referencedSlugs = new Set<string>();
  for (const c of caches) for (const p of c.roster) referencedSlugs.add(registry.aliases[p.gc_player_id]);
  out.push("-- People (cross-season identities)");
  for (const slug of [...referencedSlugs].sort()) {
    const rec = registry.people[slug];
    if (!rec) throw new Error(`registry missing person for slug "${slug}"`);
    const userId = rec.kind === "kid" && rec.family_member ? familyMemberRef(rec.family_member) : "NULL";
    out.push(
      `INSERT INTO baseball_people (slug, display_name, kind, user_id) VALUES (${q(slug)}, ${q(rec.display_name)}, ${q(rec.kind)}, ${userId})\n` +
        `  ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, kind = EXCLUDED.kind, user_id = EXCLUDED.user_id;`,
    );
  }
  out.push("");

  for (const c of caches) {
    const t = c.team;
    // team_players are created from the roster; only stats for those players can
    // resolve a team_player_id. GameChanger's season-stats blob often lists more
    // players than the current roster (guests, departed) — skip them rather than
    // emit a NULL FK that would abort the whole migration.
    const rosterIds = new Set(c.roster.map((p) => p.gc_player_id));
    out.push(`-- ===== Team: ${t.name} (${t.season_name ?? ""}) =====`);
    out.push(
      `INSERT INTO baseball_teams (gc_team_id, gc_public_id, name, season_name, season_year, level, org_name)\n` +
        `  VALUES (${q(t.gc_team_id)}, ${q(t.gc_public_id)}, ${q(t.name)}, ${q(t.season_name)}, ${qn(t.season_year)}, ${q(t.level)}, ${q(t.org_name)})\n` +
        `  ON CONFLICT (gc_team_id) DO UPDATE SET gc_public_id = EXCLUDED.gc_public_id, name = EXCLUDED.name, season_name = EXCLUDED.season_name, season_year = EXCLUDED.season_year, level = EXCLUDED.level, org_name = EXCLUDED.org_name;`,
    );

    out.push("-- roster");
    for (const p of c.roster) {
      const slug = registry.aliases[p.gc_player_id];
      out.push(
        `INSERT INTO baseball_team_players (team_id, gc_player_id, person_id, name, jersey)\n` +
          `  VALUES (${teamRef(t.gc_team_id)}, ${q(p.gc_player_id)}, ${personRef(slug)}, ${q(p.name)}, ${q(p.jersey)})\n` +
          `  ON CONFLICT (team_id, gc_player_id) DO UPDATE SET person_id = EXCLUDED.person_id, name = EXCLUDED.name, jersey = EXCLUDED.jersey;`,
      );
    }

    out.push("-- games");
    for (const g of c.games) {
      out.push(
        `INSERT INTO baseball_games (team_id, gc_game_id, played_on, opponent_name, home_away, team_score, opponent_score, result, status)\n` +
          `  VALUES (${teamRef(t.gc_team_id)}, ${q(g.gc_game_id)}, ${g.played_on ? q(g.played_on) : "NULL"}, ${q(g.opponent_name)}, ${q(g.home_away)}, ${qn(g.team_score)}, ${qn(g.opponent_score)}, ${q(g.result)}, ${q(g.status)})\n` +
          `  ON CONFLICT (gc_game_id) DO UPDATE SET played_on = EXCLUDED.played_on, opponent_name = EXCLUDED.opponent_name, home_away = EXCLUDED.home_away, team_score = EXCLUDED.team_score, opponent_score = EXCLUDED.opponent_score, result = EXCLUDED.result, status = EXCLUDED.status;`,
      );
    }

    const skippedSeason = c.seasonStats.filter((s) => !rosterIds.has(s.gc_player_id)).length;
    out.push(`-- season stats${skippedSeason ? ` (skipped ${skippedSeason} not on roster)` : ""}`);
    for (const s of c.seasonStats) {
      if (!rosterIds.has(s.gc_player_id)) continue;
      out.push(
        `INSERT INTO baseball_season_player_stats (team_id, team_player_id, stats)\n` +
          `  VALUES (${teamRef(t.gc_team_id)}, ${teamPlayerRef(t.gc_team_id, s.gc_player_id)}, ${jb(s.stats)})\n` +
          `  ON CONFLICT (team_id, team_player_id) DO UPDATE SET stats = EXCLUDED.stats;`,
      );
    }

    out.push("-- per-game box scores + raw events");
    for (const [gcGameId, gs] of Object.entries(c.gameStats)) {
      for (const line of gs.linked) {
        if (!rosterIds.has(line.gc_player_id)) continue;
        out.push(
          `INSERT INTO baseball_game_player_stats (game_id, team_player_id, batting, pitching)\n` +
            `  VALUES (${gameRef(gcGameId)}, ${teamPlayerRef(t.gc_team_id, line.gc_player_id)}, ${jb(line.batting)}, ${jb(line.pitching)})\n` +
            `  ON CONFLICT (game_id, team_player_id) DO UPDATE SET batting = EXCLUDED.batting, pitching = EXCLUDED.pitching;`,
        );
      }
      if (gs.events) {
        out.push(
          `INSERT INTO baseball_game_events (game_id, gc_stream_id, events)\n` +
            `  VALUES (${gameRef(gcGameId)}, ${q(gs.events.gc_stream_id)}, ${jb(gs.events.events)})\n` +
            `  ON CONFLICT (game_id) DO UPDATE SET gc_stream_id = EXCLUDED.gc_stream_id, events = EXCLUDED.events, captured_at = now();`,
        );
      }
    }
    out.push("");
  }

  return out.join("\n") + "\n";
}
