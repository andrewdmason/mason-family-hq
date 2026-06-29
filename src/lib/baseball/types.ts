// View models for the baseball app. Stat blobs are GameChanger's jsonb kept as
// loose records; stats.ts owns which fields surface and how they format.

export type StatBlob = Record<string, number | string | null | undefined>;

export type Kid = { slug: string; displayName: string };

// GameChanger's season-stats blob (offense + defense groups), kept for the
// "more stats" sheet. NOTE: it excludes scrimmages, so it can undercount.
export type GcSeasonStats = { offense?: StatBlob; defense?: StatBlob } | null;

export type SeasonRow = {
  teamId: string;
  teamName: string;
  seasonName: string | null;
  seasonYear: number | null;
  level: string | null;
  // The viewed boy's season line, SUMMED from per-game box scores (complete).
  batting: StatBlob | null;
  pitching: StatBlob | null; // only when he pitched
  gcStats: GcSeasonStats; // GameChanger's own summary, for the more-stats sheet
};

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
  team: { id: string; name: string; seasonName: string | null; seasonYear: number | null; level: string | null };
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
