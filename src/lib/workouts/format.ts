// Display formatting for workout data (pure; safe in client or server).

import type {
  SetMetrics,
} from "./queries";
import type {
  WorkoutBlockType,
  WorkoutMetricType,
  WorkoutScoreType,
} from "./types";

/** Seconds → m:ss (or h:mm:ss past an hour). */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds < 0) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const trimNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);

/** A single set's metric as a compact string, e.g. "55 lb × 9", "400 m", "0:30". */
export function formatSetMetric(
  metricType: WorkoutMetricType,
  m: SetMetrics
): string {
  switch (metricType) {
    case "load_reps":
      if (m.load && m.reps) return `${trimNum(m.load)} ${m.unit ?? "lb"} × ${m.reps}`;
      if (m.load) return `${trimNum(m.load)} ${m.unit ?? "lb"}`;
      if (m.reps) return `× ${m.reps}`;
      return "—";
    case "distance":
      return m.distance != null ? `${trimNum(m.distance)} m` : "—";
    case "duration":
      return formatDuration(m.duration);
    case "calories":
      return m.calories != null ? `${m.calories} cal` : "—";
    case "reps":
      return m.reps != null ? `× ${m.reps}` : "—";
    default:
      return "—";
  }
}

export function formatScore(
  scoreType: WorkoutScoreType,
  score: {
    seconds: number | null;
    rounds: number | null;
    reps: number | null;
    load: number | null;
    distance: number | null;
    calories: number | null;
  }
): string | null {
  switch (scoreType) {
    case "time":
      return score.seconds != null ? formatDuration(score.seconds) : null;
    case "rounds_reps":
      if (score.rounds == null && score.reps == null) return null;
      return `${score.rounds ?? 0} rounds${score.reps ? ` + ${score.reps}` : ""}`;
    case "reps":
      return score.reps != null ? `${score.reps} reps` : null;
    case "load":
      return score.load != null ? `${trimNum(score.load)} lb` : null;
    case "distance":
      return score.distance != null ? `${trimNum(score.distance)} m` : null;
    case "calories":
      return score.calories != null ? `${score.calories} cal` : null;
    default:
      return null;
  }
}

export const BLOCK_TYPE_LABEL: Record<WorkoutBlockType, string> = {
  warmup: "Warm-up",
  strength: "Strength",
  metcon: "WOD",
  accessory: "Accessory",
  cooldown: "Cool-down",
  skill: "Skill",
};

export const SCORE_TYPE_LABEL: Record<WorkoutScoreType, string> = {
  time: "For time",
  rounds_reps: "AMRAP (rounds + reps)",
  reps: "Total reps",
  load: "Max load",
  distance: "Distance",
  calories: "Calories",
  none: "Unscored",
};

/**
 * Split a block title into its WOD base and part label, e.g.
 * "Steak and Pudding: Part 1" → { base: "Steak and Pudding", part: "Part 1" }.
 * Returns part: null when the title isn't a "… Part N" form. Used to group
 * already-parsed blocks that predate the explicit group_label.
 */
export function parseWodTitle(title: string | null): {
  base: string | null;
  part: string | null;
} {
  if (!title) return { base: null, part: null };
  const m = title.match(
    /^(.+?)\s*[–—:-]?\s*\(?\b(Part\s+[\dA-Za-z]+|[A-D])\)?\s*$/i
  );
  if (m && m[1].trim().length >= 3) {
    return { base: m[1].trim(), part: m[2].trim() };
  }
  return { base: null, part: null };
}

/** "Mon, Jun 1" from a YYYY-MM-DD date string (no TZ drift). */
export function formatSessionDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** A forward-looking label: "Today" / "Tomorrow" / weekday / "Mon, Jun 9". */
export function dayLabel(date: string, today: string): string {
  const a = new Date(`${date}T12:00:00`).getTime();
  const b = new Date(`${today}T12:00:00`).getTime();
  const days = Math.round((a - b) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "long",
    });
  }
  return formatSessionDate(date);
}

/** Days since a YYYY-MM-DD date, as "today" / "yesterday" / "N days ago". */
export function relativeDays(date: string, today: string): string {
  const a = new Date(`${date}T12:00:00`).getTime();
  const b = new Date(`${today}T12:00:00`).getTime();
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
