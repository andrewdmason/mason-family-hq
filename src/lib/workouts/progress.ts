// Reporting queries for the Progress view: a per-family strength "stat sheet"
// (best estimated 1RMs with a 90-day trend, computed against your OWN history),
// family training volume, and benchmark PRs.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MovementFamily,
  WorkoutRxLevel,
  WorkoutScoreType,
} from "./types";

const FAMILY_LABELS: Record<MovementFamily, string> = {
  squat: "Squat",
  hinge: "Hinge",
  press: "Press",
  jerk: "Jerk",
  pull: "Pull",
  clean: "Clean",
  snatch: "Snatch",
  lunge: "Lunge",
  carry: "Carry",
  gymnastics: "Gymnastics",
  monostructural: "Cardio",
  core: "Core",
  other: "Other",
};

export type LiftStat = {
  movementId: string;
  name: string;
  slug: string;
  bestE1rm: number;
  priorE1rm: number | null; // best as of >90 days ago, for the trend arrow
  lastDate: string;
};

export type FamilyProgress = {
  family: MovementFamily;
  label: string;
  lifts: LiftStat[]; // strength bests, strongest first
  totalReps: number;
  totalVolumeLoad: number;
  lastDate: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Per-family strength stats + volume. Strength bests are taken from non-loose,
 * strength-context sets; the prior value is the best from before a 90-day window
 * so the UI can show whether you're trending up against your past self.
 */
export async function getFamilyProgress(
  supabase: SupabaseClient,
  today: string
): Promise<FamilyProgress[]> {
  // One fetch of every set with its movement + family + date drives both the
  // strength bests/trend and the volume roll-up.
  const { data, error } = await supabase
    .from("workout_sets")
    .select(
      `actual_load, actual_reps, e1rm, e1rm_is_loose, context,
       workout_movement_entries!inner (
         movement_id,
         movements!inner ( canonical_name, slug, family, is_loaded ),
         workout_blocks!inner ( workout_sessions!inner ( session_date ) )
       )`
    );
  if (error) throw new Error(`getFamilyProgress: ${error.message}`);

  const cutoff = isoDaysAgo(today, 90);

  type Acc = {
    totalReps: number;
    totalVolume: number;
    lastDate: string | null;
    lifts: Map<string, LiftStat & { _priorCandidates: number[] }>;
  };
  const byFamily = new Map<MovementFamily, Acc>();

  for (const row of (data ?? []) as any[]) {
    const entry = row.workout_movement_entries;
    const m = entry?.movements;
    if (!m) continue;
    const family = m.family as MovementFamily;
    const date = entry.workout_blocks?.workout_sessions?.session_date as string;
    if (!date) continue;

    const acc =
      byFamily.get(family) ??
      ({ totalReps: 0, totalVolume: 0, lastDate: null, lifts: new Map() } as Acc);
    byFamily.set(family, acc);

    const reps = row.actual_reps ?? 0;
    const load = row.actual_load ?? 0;
    acc.totalReps += reps;
    acc.totalVolume += load * reps;
    if (!acc.lastDate || date > acc.lastDate) acc.lastDate = date;

    // Strength stat: only non-loose, strength-context, loaded movements.
    if (
      m.is_loaded &&
      row.context === "strength" &&
      !row.e1rm_is_loose &&
      row.e1rm != null
    ) {
      const id = entry.movement_id as string;
      const cur =
        acc.lifts.get(id) ??
        ({
          movementId: id,
          name: m.canonical_name,
          slug: m.slug,
          bestE1rm: 0,
          priorE1rm: null,
          lastDate: date,
          _priorCandidates: [],
        } as LiftStat & { _priorCandidates: number[] });
      if (row.e1rm > cur.bestE1rm) {
        cur.bestE1rm = row.e1rm;
        cur.lastDate = date;
      } else if (date > cur.lastDate) {
        cur.lastDate = date;
      }
      if (date < cutoff) cur._priorCandidates.push(row.e1rm);
      acc.lifts.set(id, cur);
    }
  }

  const result: FamilyProgress[] = [];
  for (const [family, acc] of byFamily) {
    const lifts = [...acc.lifts.values()]
      .map((l) => ({
        movementId: l.movementId,
        name: l.name,
        slug: l.slug,
        bestE1rm: l.bestE1rm,
        priorE1rm: l._priorCandidates.length
          ? Math.max(...l._priorCandidates)
          : null,
        lastDate: l.lastDate,
      }))
      .sort((a, b) => b.bestE1rm - a.bestE1rm);
    result.push({
      family,
      label: FAMILY_LABELS[family],
      lifts,
      totalReps: acc.totalReps,
      totalVolumeLoad: Math.round(acc.totalVolume),
      lastDate: acc.lastDate,
    });
  }
  // Families with strength data first, then by recency.
  return result.sort((a, b) => {
    if (a.lifts.length !== b.lifts.length) return b.lifts.length - a.lifts.length;
    return (b.lastDate ?? "").localeCompare(a.lastDate ?? "");
  });
}

// ---------- Workout-frequency trend (the reporting widget) ----------

export type WorkoutTrend = {
  last7: number;
  prev7: number;
  last30: number;
  prev30: number;
};

/**
 * Workout counts for the last 7 and 30 days, each alongside the prior equivalent
 * window so the widget can show whether training frequency is trending up.
 */
export async function getWorkoutTrend(
  supabase: SupabaseClient,
  today: string
): Promise<WorkoutTrend> {
  const d7 = isoDaysAgo(today, 7);
  const d14 = isoDaysAgo(today, 14);
  const d30 = isoDaysAgo(today, 30);
  const d60 = isoDaysAgo(today, 60);

  const { data: sessions } = await supabase
    .from("workout_sessions")
    .select("session_date")
    .gte("session_date", d60)
    .lte("session_date", today);

  let last7 = 0;
  let prev7 = 0;
  let last30 = 0;
  let prev30 = 0;
  for (const s of (sessions ?? []) as { session_date: string }[]) {
    const d = s.session_date;
    if (d > today) continue;
    if (d > d7) last7 += 1;
    else if (d > d14) prev7 += 1;
    if (d > d30) last30 += 1;
    else if (d > d60) prev30 += 1;
  }

  return { last7, prev7, last30, prev30 };
}

// ---------- Benchmark PRs ----------

export type BenchmarkPR = {
  benchmarkId: string;
  name: string;
  scoreType: WorkoutScoreType;
  attempts: number;
  best: {
    seconds: number | null;
    rounds: number | null;
    reps: number | null;
    load: number | null;
    distance: number | null;
    calories: number | null;
  };
  bestRxLevel: WorkoutRxLevel | null;
  lastDate: string;
};

/** "Lower is better" for time; otherwise higher. */
function scoreValue(scoreType: WorkoutScoreType, score: any): number | null {
  switch (scoreType) {
    case "time":
      return score.score_seconds;
    case "rounds_reps":
      return score.score_rounds != null || score.score_reps != null
        ? (score.score_rounds ?? 0) * 1000 + (score.score_reps ?? 0)
        : null;
    case "reps":
      return score.score_reps;
    case "load":
      return score.score_load;
    case "distance":
      return score.score_distance;
    case "calories":
      return score.score_calories;
    default:
      return null;
  }
}

export async function getBenchmarkPRs(
  supabase: SupabaseClient
): Promise<BenchmarkPR[]> {
  const { data, error } = await supabase
    .from("workout_blocks")
    .select(
      `benchmark_id, score_type, score_seconds, score_rounds, score_reps,
       score_load, score_distance, score_calories, rx_level,
       workout_benchmarks!inner ( name ),
       workout_sessions!inner ( session_date )`
    )
    .not("benchmark_id", "is", null);
  if (error) throw new Error(`getBenchmarkPRs: ${error.message}`);

  const byBenchmark = new Map<string, BenchmarkPR & { _bestVal: number | null }>();
  for (const b of (data ?? []) as any[]) {
    const id = b.benchmark_id as string;
    const scoreType = b.score_type as WorkoutScoreType;
    const date = b.workout_sessions?.session_date as string;
    const val = scoreValue(scoreType, b);
    const lowerBetter = scoreType === "time";

    const cur =
      byBenchmark.get(id) ??
      ({
        benchmarkId: id,
        name: b.workout_benchmarks?.name ?? "Benchmark",
        scoreType,
        attempts: 0,
        best: {
          seconds: null,
          rounds: null,
          reps: null,
          load: null,
          distance: null,
          calories: null,
        },
        bestRxLevel: null,
        lastDate: date,
        _bestVal: null,
      } as BenchmarkPR & { _bestVal: number | null });

    cur.attempts += 1;
    if (date > cur.lastDate) cur.lastDate = date;
    if (
      val != null &&
      (cur._bestVal == null ||
        (lowerBetter ? val < cur._bestVal : val > cur._bestVal))
    ) {
      cur._bestVal = val;
      cur.best = {
        seconds: b.score_seconds,
        rounds: b.score_rounds,
        reps: b.score_reps,
        load: b.score_load,
        distance: b.score_distance,
        calories: b.score_calories,
      };
      cur.bestRxLevel = b.rx_level ?? null;
    }
    byBenchmark.set(id, cur);
  }

  return [...byBenchmark.values()]
    .map(({ _bestVal, ...rest }) => {
      void _bestVal;
      return rest;
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/* eslint-enable @typescript-eslint/no-explicit-any */

function isoDaysAgo(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
