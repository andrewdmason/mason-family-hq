import "server-only";

import { createClient } from "@/lib/supabase/server";
import { pitchedSeason } from "./stats";
import { resolvePerson } from "./people";
import type { GameDetail, GameRow, SeasonDetail, SeasonRow, StatBlob } from "./types";

type TeamEmbed = { id: string; name: string; season_name: string | null; season_year: number | null; level: string | null };

// PostgREST returns a to-one embed as a single object, but supabase-js types it
// as an array without generated types — normalize to handle both.
function firstOf<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v ?? null) as T | null;
}

// Newest season first; nulls sort last.
function bySeasonDesc(a: SeasonRow, b: SeasonRow): number {
  const ay = a.seasonYear ?? -Infinity;
  const by = b.seasonYear ?? -Infinity;
  if (ay !== by) return by - ay;
  return (b.seasonName ?? "").localeCompare(a.seasonName ?? "");
}

function splitStats(stats: StatBlob | null | undefined): { batting: StatBlob | null; pitching: StatBlob | null } {
  const s = (stats ?? null) as { offense?: StatBlob; defense?: StatBlob } | null;
  const defense = s?.defense ?? null;
  return { batting: s?.offense ?? null, pitching: pitchedSeason(defense) ? defense : null };
}

// A boy's career: every team-season he appears on, with his season line.
export async function getCareer(slug: string): Promise<{ name: string; seasons: SeasonRow[] } | null> {
  const sb = await createClient();
  const person = await resolvePerson(slug, sb); // the team_players query filters on person.id
  if (!person) return null;
  const { data } = await sb
    .from("baseball_team_players")
    .select("id, baseball_teams(id, name, season_name, season_year, level), baseball_season_player_stats(stats)")
    .eq("person_id", person.id);

  const seasons: SeasonRow[] = (data ?? []).flatMap((tp) => {
    const team = firstOf<TeamEmbed>(tp.baseball_teams);
    if (!team) return [];
    const statRows = (tp.baseball_season_player_stats as { stats: StatBlob }[] | null) ?? [];
    const { batting, pitching } = splitStats(statRows[0]?.stats);
    return [{
      teamId: team.id,
      teamName: team.name,
      seasonName: team.season_name,
      seasonYear: team.season_year,
      level: team.level,
      batting,
      pitching,
    }];
  });
  seasons.sort(bySeasonDesc);
  return { name: person.displayName, seasons };
}

// One team-season: roster stat table (boy highlighted) + game log.
export async function getSeason(teamId: string, slug: string): Promise<SeasonDetail | null> {
  const sb = await createClient();
  // These four reads are independent — run them together.
  const [{ data: team }, person, { data: roster }, { data: games }] = await Promise.all([
    sb.from("baseball_teams").select("id, name, season_name, season_year, level").eq("id", teamId).maybeSingle(),
    resolvePerson(slug, sb),
    sb
      .from("baseball_team_players")
      .select("id, name, jersey, person_id, baseball_season_player_stats(stats)")
      .eq("team_id", teamId)
      .order("name"),
    sb
      .from("baseball_games")
      .select("id, played_on, opponent_name, home_away, team_score, opponent_score, result")
      .eq("team_id", teamId)
      .order("played_on", { nullsFirst: false }),
  ]);
  if (!team) return null;

  return {
    team: { id: team.id, name: team.name, seasonName: team.season_name, seasonYear: team.season_year, level: team.level },
    focusName: person?.displayName ?? "",
    roster: (roster ?? []).map((r) => {
      const statRows = (r.baseball_season_player_stats as { stats: StatBlob }[] | null) ?? [];
      const { batting, pitching } = splitStats(statRows[0]?.stats);
      return {
        teamPlayerId: r.id,
        name: r.name,
        jersey: r.jersey,
        isFocus: !!person && r.person_id === person.id,
        batting,
        pitching,
      };
    }),
    games: (games ?? []).map(toGameRow),
  };
}

// One game's full box score.
export async function getGame(gameId: string, slug: string): Promise<GameDetail | null> {
  const sb = await createClient();
  const [{ data: game }, person, { data: rows }] = await Promise.all([
    sb
      .from("baseball_games")
      .select("id, played_on, opponent_name, home_away, team_score, opponent_score, result, team_id, baseball_teams(id, name)")
      .eq("id", gameId)
      .maybeSingle(),
    resolvePerson(slug, sb),
    sb
      .from("baseball_game_player_stats")
      .select("batting, pitching, baseball_team_players(name, jersey, person_id)")
      .eq("game_id", gameId),
  ]);
  if (!game) return null;

  const team = firstOf<{ id: string; name: string }>(game.baseball_teams);
  return {
    game: { ...toGameRow(game), teamName: team?.name ?? "", teamId: team?.id ?? game.team_id },
    rows: (rows ?? [])
      .map((r) => {
        const tp = firstOf<{ name: string; jersey: string | null; person_id: string | null }>(r.baseball_team_players);
        return {
          name: tp?.name ?? "—",
          jersey: tp?.jersey ?? null,
          isFocus: !!person && !!tp && tp.person_id === person.id,
          batting: (r.batting ?? null) as StatBlob | null,
          pitching: (r.pitching ?? null) as StatBlob | null,
        };
      })
      .sort((a, b) => Number(b.isFocus) - Number(a.isFocus) || a.name.localeCompare(b.name)),
  };
}

function toGameRow(g: {
  id: string;
  played_on: string | null;
  opponent_name: string | null;
  home_away: string | null;
  team_score: number | null;
  opponent_score: number | null;
  result: string | null;
}): GameRow {
  return {
    gameId: g.id,
    playedOn: g.played_on,
    opponentName: g.opponent_name,
    homeAway: g.home_away,
    teamScore: g.team_score,
    opponentScore: g.opponent_score,
    result: (g.result as GameRow["result"]) ?? null,
  };
}
