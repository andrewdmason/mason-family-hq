// View models for the baseball app. Stat blobs are GameChanger's jsonb kept as
// loose records; stats.ts owns which fields surface and how they format.

export type StatBlob = Record<string, number | string | null | undefined>;

export type Kid = { slug: string; displayName: string };

// GameChanger's season-stats blob (offense + defense groups), kept for the
// "more stats" sheet. NOTE: it excludes scrimmages, so it can undercount.
export type GcSeasonStats = { offense?: StatBlob; defense?: StatBlob } | null;

export type TeamRecord = { w: number; l: number; t: number };

export type SeasonRow = {
  teamId: string;
  teamName: string;
  seasonName: string | null;
  seasonYear: number | null;
  level: string | null;
  record: TeamRecord; // the team's W-L for the season
  // The viewed boy's season line, SUMMED from per-game box scores (complete).
  batting: StatBlob | null;
  pitching: StatBlob | null; // only when he pitched
  gcStats: GcSeasonStats; // GameChanger's own summary, for the more-stats sheet
};

// One of the boy's games, across any team — for the career Games feed.
export type CareerGame = {
  gameId: string;
  playedOn: string | null;
  teamId: string;
  teamName: string;
  opponentName: string | null;
  homeAway: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  result: "W" | "L" | "T" | null;
  batting: StatBlob | null;
  pitching: StatBlob | null;
};

export type Career = { name: string; seasons: SeasonRow[]; games: CareerGame[] };

export type RosterStatRow = {
  teamPlayerId: string;
  name: string;
  jersey: string | null;
  isFocus: boolean;
  batting: StatBlob | null;
  pitching: StatBlob | null;
  gcStats: GcSeasonStats;
};

export type GameRow = {
  gameId: string;
  playedOn: string | null;
  opponentName: string | null;
  homeAway: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  result: "W" | "L" | "T" | null;
};

export type SeasonDetail = {
  team: { id: string; name: string; seasonName: string | null; seasonYear: number | null; level: string | null; gcPublicId: string | null };
  focusName: string;
  roster: RosterStatRow[];
  games: GameRow[];
};

export type BoxScoreRow = {
  name: string;
  jersey: string | null;
  isFocus: boolean;
  batting: StatBlob | null; // per-game batting jsonb
  pitching: StatBlob | null; // per-game pitching jsonb
};

export type GameDetail = {
  game: GameRow & { teamName: string; teamId: string };
  rows: BoxScoreRow[];
};
