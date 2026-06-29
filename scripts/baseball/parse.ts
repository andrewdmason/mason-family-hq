// Pure parsers that turn captured GameChanger payloads into our row shapes.
//
// No I/O, no Playwright, no DB — every function takes plain JSON/arrays and
// returns plain objects so it can be unit-tested against the real sample
// payloads in scripts/baseball/fixtures/ (see verify-baseball-parse.mts).
//
// Data-flow note: a player's GameChanger id (gc_player_id) is the join key.
//   - season-stats is keyed by gc_player_id (no names).
//   - the roster (/players) maps gc_player_id <-> name + jersey.
//   - the rendered box score is keyed by name + jersey (no gc_player_id).
// So box-score lines are linked back to gc_player_id via the roster, by jersey
// first (unique within a team) then normalized name.

// ---- shared types -------------------------------------------------------

export type RosterPlayer = { gc_player_id: string; name: string; jersey: string | null };

export type BattingLine = {
  AB: number; R: number; H: number; RBI: number; BB: number; SO: number;
  "2B": number; "3B": number; HR: number; SB: number;
};

export type PitchingLine = {
  IP: number; H: number; R: number; ER: number; BB: number; SO: number;
};

export type BoxRow = { label: string; values: string[] };
export type BoxSide = {
  side: "home" | "away";
  name: string;
  batting: BoxRow[];
  pitching: BoxRow[];
  notes?: Record<string, string>;
};
export type BoxScoreCapture = { gc_game_id: string; teams: BoxSide[] };

export type GameSummary = {
  gc_game_id: string;
  gc_stream_id: string | null;
  opponent_id: string | null;
  home_away: "home" | "away" | null;
  team_score: number | null;
  opponent_score: number | null;
  result: "W" | "L" | "T" | null;
  status: string | null;
};

// ---- name handling ------------------------------------------------------

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "Sebastian Mason #28 (P, SS)" -> { name: "Sebastian Mason", jersey: "28" }
// "#32 (RF, LF)"               -> { name: "", jersey: "32" }
// "Lucas #33"                  -> { name: "Lucas", jersey: "33" }
// "TEAM"                       -> { name: "TEAM", jersey: null }
export function parseLabel(label: string): { name: string; jersey: string | null } {
  const withoutPositions = label.replace(/\([^)]*\)/g, "").trim();
  const jerseyMatch = withoutPositions.match(/#\s*(\w+)/);
  const jersey = jerseyMatch ? jerseyMatch[1] : null;
  const name = withoutPositions.replace(/#\s*\w+/, "").replace(/\s+/g, " ").trim();
  return { name, jersey };
}

// ---- box score ----------------------------------------------------------
// Batting cells render in order AB, R, H, RBI, BB, SO; pitching as IP, H, R,
// ER, BB, SO (indices used directly below).

// Per-player extras live in the team "notes" block, e.g. "2B: Robi McRay 5, Sebastian Mason".
// A bare name = 1; "Name N" = N. Returns normalized-name -> count.
function parseNoteCounts(note: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!note) return out;
  for (const raw of note.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const m = entry.match(/^(.*?)(?:\s+(\d+))?$/);
    if (!m) continue;
    const name = normalizeName(m[1]);
    if (!name) continue;
    out.set(name, (out.get(name) ?? 0) + (m[2] ? parseInt(m[2], 10) : 1));
  }
  return out;
}

// Box-score batting labels are often first-name-only (jersey is the join key),
// while the notes block carries fuller names — so match when one name's tokens
// are a subset of the other's ("Levi" matches note "Levi Evans").
function nameMatches(playerName: string, noteName: string): boolean {
  const a = normalizeName(playerName).split(" ").filter(Boolean);
  const b = normalizeName(noteName).split(" ").filter(Boolean);
  if (!a.length || !b.length) return false;
  const [small, big] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  return small.every((t) => big.has(t));
}

function toInt(v: string | undefined): number {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// GameChanger renders innings pitched as "2.1" = 2 + 1/3 (outs in the decimal).
export function parseInnings(v: string | undefined): number {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const [whole, frac] = s.split(".");
  const w = parseInt(whole, 10) || 0;
  const outs = frac ? parseInt(frac[0], 10) || 0 : 0;
  return w + outs / 3;
}

export type BoxScorePlayer = {
  name: string;
  jersey: string | null;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
};

// Extract our side's per-player lines. ourSide selects by side ("home"/"away")
// or by team-name match; opponent rows are dropped. The TEAM total row is skipped.
export function parseBoxScore(
  capture: BoxScoreCapture,
  ourSide: { side?: "home" | "away"; name?: string },
): BoxScorePlayer[] {
  if (!capture?.teams?.length) throw new Error("box score has no teams");
  // Prefer matching our side by team name (robust to DOM block order); fall back
  // to the home/away flag.
  const side =
    (ourSide.name ? capture.teams.find((t) => normalizeName(t.name) === normalizeName(ourSide.name!)) : null) ??
    (ourSide.side ? capture.teams.find((t) => t.side === ourSide.side) : null) ??
    null;
  if (!side) throw new Error(`box score has no side matching ${JSON.stringify(ourSide)}`);

  const players = new Map<string, BoxScorePlayer>();
  const keyFor = (name: string, jersey: string | null) => `${normalizeName(name)}#${jersey ?? ""}`;

  for (const row of side.batting ?? []) {
    const { name, jersey } = parseLabel(row.label);
    if (normalizeName(name) === "team" || (!name && !jersey)) continue;
    const v = row.values;
    const batting: BattingLine = {
      AB: toInt(v[0]), R: toInt(v[1]), H: toInt(v[2]), RBI: toInt(v[3]), BB: toInt(v[4]), SO: toInt(v[5]),
      "2B": 0, "3B": 0, HR: 0, SB: 0,
    };
    players.set(keyFor(name, jersey), { name, jersey, batting, pitching: null });
  }

  for (const row of side.pitching ?? []) {
    const { name, jersey } = parseLabel(row.label);
    if (normalizeName(name) === "team" || (!name && !jersey)) continue;
    const v = row.values;
    const pitching: PitchingLine = {
      IP: parseInnings(v[0]), H: toInt(v[1]), R: toInt(v[2]), ER: toInt(v[3]), BB: toInt(v[4]), SO: toInt(v[5]),
    };
    const k = keyFor(name, jersey);
    const existing = players.get(k);
    if (existing) existing.pitching = pitching;
    else players.set(k, { name, jersey, batting: null, pitching });
  }

  // Attribute extra-base/steal counts from the notes block to batters by flexible
  // name match (labels may be first-name-only; notes carry fuller names).
  const batters = [...players.values()].filter((p) => p.batting);
  for (const stat of ["2B", "3B", "HR", "SB"] as const) {
    for (const [noteName, count] of parseNoteCounts(side.notes?.[stat])) {
      const target = batters.find((p) => nameMatches(p.name, noteName));
      if (target && target.batting) target.batting[stat] += count;
    }
  }

  return [...players.values()];
}

// ---- season stats -------------------------------------------------------

export type SeasonPlayerStats = { gc_player_id: string; stats: unknown };

export function parseSeasonStats(blob: unknown): SeasonPlayerStats[] {
  const players = (blob as { stats_data?: { players?: Record<string, { stats: unknown }> } })?.stats_data
    ?.players;
  if (!players || typeof players !== "object") throw new Error("season-stats payload missing stats_data.players");
  return Object.entries(players).map(([gc_player_id, body]) => ({ gc_player_id, stats: body.stats }));
}

// ---- games --------------------------------------------------------------

function resultOf(team: number | null, opp: number | null): "W" | "L" | "T" | null {
  if (team == null || opp == null) return null;
  if (team > opp) return "W";
  if (team < opp) return "L";
  return "T";
}

export function parseGameSummaries(arr: unknown): GameSummary[] {
  if (!Array.isArray(arr)) throw new Error("game-summaries payload is not an array");
  return arr.map((g) => {
    const team = g.owning_team_score ?? null;
    const opp = g.opponent_team_score ?? null;
    const ha = g.home_away ?? g.game_stream?.home_away ?? null;
    return {
      gc_game_id: g.event_id,
      gc_stream_id: g.game_stream?.id ?? null,
      opponent_id: g.game_stream?.opponent_id ?? g.opponent_id ?? null,
      // Only the values the DB CHECK allows; anything else becomes null so it
      // can't abort the generated migration.
      home_away: ha === "home" || ha === "away" ? ha : null,
      team_score: team,
      opponent_score: opp,
      result: resultOf(team, opp),
      status: g.game_status ?? null,
    };
  });
}

// Schedule supplies date + opponent name (game-summaries only has opponent_id).
// Defensive over GameChanger field-name variation; returns event_id -> details.
export function parseSchedule(arr: unknown): Map<string, { played_on: string | null; opponent_name: string | null }> {
  const out = new Map<string, { played_on: string | null; opponent_name: string | null }>();
  if (!Array.isArray(arr)) return out;
  for (const e of arr) {
    const id = e.event_id ?? e.id ?? e.game_id;
    if (!id) continue;
    const start = e.start ?? e.start_at ?? e.scheduled_at ?? e.starttime ?? e.event_start;
    const played_on = start ? String(start).slice(0, 10) : null;
    const opponent_name =
      e.opponent_name ?? e.opponent?.name ?? e.opponent ?? e.opponent_label ?? null;
    out.set(id, { played_on, opponent_name: opponent_name ? String(opponent_name) : null });
  }
  return out;
}

// ---- events (raw archive) ----------------------------------------------

export function parseEvents(payload: unknown): { gc_stream_id: string | null; events: unknown[] } {
  const p = payload as { stream_id?: string; latest_events?: unknown[] };
  const events = Array.isArray(p?.latest_events) ? p.latest_events : [];
  return { gc_stream_id: p?.stream_id ?? null, events };
}

// ---- roster -------------------------------------------------------------

// Defensive over GameChanger's player object shape (field names vary by API
// version). Finalized against the live /players payload at capture time.
export function parseRoster(players: unknown): RosterPlayer[] {
  if (!Array.isArray(players)) throw new Error("roster payload is not an array");
  return players
    .map((p) => {
      const gc_player_id = p.id ?? p.player_id ?? p.uuid;
      const first = p.first_name ?? p.firstName ?? "";
      const last = p.last_name ?? p.lastName ?? "";
      const name = (p.name ?? `${first} ${last}`).trim();
      const jerseyRaw = p.number ?? p.jersey_number ?? p.jersey ?? p.uniform_number ?? null;
      return { gc_player_id, name, jersey: jerseyRaw == null ? null : String(jerseyRaw) };
    })
    .filter((p) => p.gc_player_id);
}

// ---- linking ------------------------------------------------------------

export type LinkedGameStat = {
  gc_player_id: string;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
};

// Match each box-score player to a roster entry: jersey first (unique within a
// team), then normalized name. Unmatched lines are returned separately so the
// importer can surface them rather than silently dropping a player's game.
export function linkBoxScoreToRoster(
  boxPlayers: BoxScorePlayer[],
  roster: RosterPlayer[],
): { linked: LinkedGameStat[]; unmatched: BoxScorePlayer[] } {
  const byJersey = new Map<string, RosterPlayer>();
  const byName = new Map<string, RosterPlayer>();
  for (const r of roster) {
    if (r.jersey) byJersey.set(r.jersey, r);
    byName.set(normalizeName(r.name), r);
  }
  const linked: LinkedGameStat[] = [];
  const unmatched: BoxScorePlayer[] = [];
  for (const bp of boxPlayers) {
    const match =
      (bp.jersey && byJersey.get(bp.jersey)) || byName.get(normalizeName(bp.name)) || null;
    if (!match) {
      unmatched.push(bp);
      continue;
    }
    linked.push({ gc_player_id: match.gc_player_id, batting: bp.batting, pitching: bp.pitching });
  }
  return { linked, unmatched };
}
