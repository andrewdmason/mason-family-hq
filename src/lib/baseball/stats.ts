// Which GameChanger stats surface by default and how they format.
//
// Season aggregates come from GameChanger's groups: batting = "offense",
// pitching = "defense" (GameChanger files pitching there alongside fielding).
// Per-game lines are the simpler box-score jsonb the importer captured.

import type { StatBlob } from "./types";

export type StatCol = { key: string; label: string; fmt: (v: unknown) => string };

const int = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : "—";
};
// Baseball rate stats render as ".273" (no leading zero), 3 places.
export const rate3 = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
};

// A YYYY-MM-DD game date as a short human label. Noon anchor avoids the UTC
// off-by-one that bites bare `new Date("YYYY-MM-DD")`.
export const formatGameDate = (date: string | null): string => {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const dec2 = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
};
// Innings render in baseball thirds: 5.333… -> "5.1", 2 -> "2.0".
export const formatIP = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const whole = Math.floor(n + 1e-9);
  const outs = Math.round((n - whole) * 3);
  return outs === 3 ? `${whole + 1}.0` : `${whole}.${outs}`;
};

// Curated default lines (the "back of the baseball card").
export const SEASON_BATTING: StatCol[] = [
  { key: "AVG", label: "AVG", fmt: rate3 },
  { key: "OBP", label: "OBP", fmt: rate3 },
  { key: "SLG", label: "SLG", fmt: rate3 },
  { key: "OPS", label: "OPS", fmt: rate3 },
  { key: "AB", label: "AB", fmt: int },
  { key: "H", label: "H", fmt: int },
  { key: "2B", label: "2B", fmt: int },
  { key: "3B", label: "3B", fmt: int },
  { key: "HR", label: "HR", fmt: int },
  { key: "RBI", label: "RBI", fmt: int },
  { key: "R", label: "R", fmt: int },
  { key: "BB", label: "BB", fmt: int },
  { key: "SO", label: "SO", fmt: int },
  { key: "SB", label: "SB", fmt: int },
];

export const SEASON_PITCHING: StatCol[] = [
  { key: "IP", label: "IP", fmt: formatIP },
  { key: "ERA", label: "ERA", fmt: dec2 },
  { key: "WHIP", label: "WHIP", fmt: dec2 },
  { key: "SO", label: "K", fmt: int },
  { key: "BB", label: "BB", fmt: int },
  { key: "H", label: "H", fmt: int },
];

export const GAME_BATTING: StatCol[] = [
  { key: "AB", label: "AB", fmt: int },
  { key: "R", label: "R", fmt: int },
  { key: "H", label: "H", fmt: int },
  { key: "RBI", label: "RBI", fmt: int },
  { key: "BB", label: "BB", fmt: int },
  { key: "SO", label: "SO", fmt: int },
  { key: "2B", label: "2B", fmt: int },
  { key: "3B", label: "3B", fmt: int },
  { key: "HR", label: "HR", fmt: int },
  { key: "SB", label: "SB", fmt: int },
];

export const GAME_PITCHING: StatCol[] = [
  { key: "IP", label: "IP", fmt: formatIP },
  { key: "H", label: "H", fmt: int },
  { key: "R", label: "R", fmt: int },
  { key: "ER", label: "ER", fmt: int },
  { key: "BB", label: "BB", fmt: int },
  { key: "SO", label: "K", fmt: int },
];

// A player pitched if GameChanger faced batters against them (BF) — the cleanest
// signal that the "defense" blob carries pitching, not just fielding.
export function pitchedSeason(defense: StatBlob | null | undefined): boolean {
  if (!defense) return false;
  return Number(defense["BF"] ?? 0) > 0 || Number(defense["GP:P"] ?? 0) > 0;
}

export function row(blob: StatBlob | null | undefined, cols: StatCol[]): { label: string; value: string }[] {
  return cols.map((c) => ({ label: c.label, value: blob ? c.fmt(blob[c.key]) : "—" }));
}

export function num(blob: StatBlob | null | undefined, key: string): number | null {
  if (!blob) return null;
  const n = Number(blob[key]);
  return Number.isFinite(n) ? n : null;
}
