// Read-side queries for the Workouts app: a full session for the detail view, a
// movement's history for the gym-time comparison card, and a session list.
// All reads are RLS-scoped to the caller (the views use security_invoker).

import type { SupabaseClient } from "@supabase/supabase-js";
import { percentOfE1rm, suggestedLoad } from "./normalization";
import type {
  MovementFamily,
  WorkoutBlockType,
  WorkoutMetricType,
  WorkoutRxLevel,
  WorkoutScoreType,
  WorkoutSetContext,
} from "./types";

// ---------- Session detail ----------

export type SetMetrics = {
  reps: number | null;
  load: number | null;
  unit: string | null;
  distance: number | null;
  duration: number | null;
  calories: number | null;
};

export type SetView = {
  id: string;
  position: number;
  metricType: WorkoutMetricType;
  context: WorkoutSetContext;
  rxLevel: WorkoutRxLevel | null;
  prescribed: SetMetrics;
  actual: SetMetrics;
  e1rm: number | null;
  e1rmIsLoose: boolean;
};

export type EntryView = {
  id: string;
  position: number;
  rawName: string;
  movementId: string | null;
  canonicalName: string | null;
  family: MovementFamily | null;
  isLoaded: boolean;
  slug: string | null;
  rpe: number | null;
  notes: string | null;
  sets: SetView[];
};

export type BlockView = {
  id: string;
  position: number;
  blockType: WorkoutBlockType;
  title: string | null;
  groupLabel: string | null;
  scoreType: WorkoutScoreType;
  score: {
    seconds: number | null;
    rounds: number | null;
    reps: number | null;
    load: number | null;
    distance: number | null;
    calories: number | null;
  };
  rxLevel: WorkoutRxLevel | null;
  rpe: number | null;
  notes: string | null;
  isBenchmark: boolean;
  benchmarkId: string | null;
  benchmarkName: string | null;
  entries: EntryView[];
};

export type SessionDetail = {
  id: string;
  sessionDate: string;
  title: string | null;
  source: string;
  calendarEventId: string | null;
  rawDescription: string | null;
  notes: string | null;
  effort: "easier" | "harder" | null;
  energy: "low" | "high" | null;
  parsedAt: string | null;
  completedAt: string | null;
  whoopSyncStatus: "synced" | "dirty" | "failed" | "syncing" | null;
  whoopSyncedAt: string | null;
  whoopSyncError: string | null;
  blocks: BlockView[];
};

const SESSION_SELECT = `
  id, session_date, title, source, calendar_event_id, raw_description, notes, effort, energy,
  parsed_at, completed_at,
  whoop_sync_status, whoop_synced_at, whoop_sync_error,
  workout_blocks (
    id, position, block_type, title, group_label, score_type, score_seconds, score_rounds,
    score_reps, score_load, score_distance, score_calories, rx_level, rpe, notes,
    is_benchmark, benchmark_id,
    workout_benchmarks ( name ),
    workout_movement_entries (
      id, position, raw_name, movement_id, rpe, notes,
      movements ( canonical_name, family, is_loaded, slug ),
      workout_sets (
        id, position, metric_type, context, rx_level,
        prescribed_reps, prescribed_load, prescribed_unit, prescribed_distance,
        prescribed_duration, prescribed_calories,
        actual_reps, actual_load, actual_unit, actual_distance, actual_duration,
        actual_calories, e1rm, e1rm_is_loose
      )
    )
  )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapSet(s: any): SetView {
  return {
    id: s.id,
    position: s.position,
    metricType: s.metric_type,
    context: s.context,
    rxLevel: s.rx_level,
    prescribed: {
      reps: s.prescribed_reps,
      load: s.prescribed_load,
      unit: s.prescribed_unit,
      distance: s.prescribed_distance,
      duration: s.prescribed_duration,
      calories: s.prescribed_calories,
    },
    actual: {
      reps: s.actual_reps,
      load: s.actual_load,
      unit: s.actual_unit,
      distance: s.actual_distance,
      duration: s.actual_duration,
      calories: s.actual_calories,
    },
    e1rm: s.e1rm,
    e1rmIsLoose: s.e1rm_is_loose,
  };
}

function mapEntry(e: any): EntryView {
  const m = e.movements ?? null;
  return {
    id: e.id,
    position: e.position,
    rawName: e.raw_name,
    movementId: e.movement_id,
    canonicalName: m?.canonical_name ?? null,
    family: m?.family ?? null,
    isLoaded: m?.is_loaded ?? false,
    slug: m?.slug ?? null,
    rpe: e.rpe,
    notes: e.notes,
    sets: ((e.workout_sets ?? []) as any[])
      .map(mapSet)
      .sort((a, b) => a.position - b.position),
  };
}

function mapBlock(b: any): BlockView {
  return {
    id: b.id,
    position: b.position,
    blockType: b.block_type,
    title: b.title,
    groupLabel: b.group_label,
    scoreType: b.score_type,
    score: {
      seconds: b.score_seconds,
      rounds: b.score_rounds,
      reps: b.score_reps,
      load: b.score_load,
      distance: b.score_distance,
      calories: b.score_calories,
    },
    rxLevel: b.rx_level,
    rpe: b.rpe,
    notes: b.notes,
    isBenchmark: b.is_benchmark,
    benchmarkId: b.benchmark_id,
    benchmarkName: b.workout_benchmarks?.name ?? null,
    entries: ((b.workout_movement_entries ?? []) as any[])
      .map(mapEntry)
      .sort((a, b2) => a.position - b2.position),
  };
}

export async function getSessionDetail(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<SessionDetail | null> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(SESSION_SELECT)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`getSessionDetail: ${error.message}`);
  if (!data) return null;
  const d = data as any;
  return {
    id: d.id,
    sessionDate: d.session_date,
    title: d.title,
    source: d.source,
    calendarEventId: d.calendar_event_id,
    rawDescription: d.raw_description,
    notes: d.notes,
    effort: d.effort,
    energy: d.energy,
    parsedAt: d.parsed_at,
    completedAt: d.completed_at,
    whoopSyncStatus: d.whoop_sync_status,
    whoopSyncedAt: d.whoop_synced_at,
    whoopSyncError: d.whoop_sync_error,
    blocks: ((d.workout_blocks ?? []) as any[])
      .map(mapBlock)
      .sort((a, b) => a.position - b.position),
  };
}

/** Look up an existing session for a CFO event (parse-on-open dedup). */
export async function findSessionByEvent(
  supabase: SupabaseClient,
  calendarEventId: string,
): Promise<{ id: string; parsedAt: string | null } | null> {
  const { data } = await supabase
    .from("workout_sessions")
    .select("id, parsed_at")
    .eq("calendar_event_id", calendarEventId)
    .maybeSingle();
  return data ? { id: data.id, parsedAt: data.parsed_at } : null;
}

// ---------- Preferred substitutes (the WOD swap suggestion) ----------

/** Map of movement_id → the user's preferred substitute {id, name}. */
export async function getSubstitutesForMovements(
  supabase: SupabaseClient,
  movementIds: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const map = new Map<string, { id: string; name: string }>();
  const ids = [...new Set(movementIds)];
  if (ids.length === 0) return map;

  const { data: subs } = await supabase
    .from("workout_movement_substitutions")
    .select("movement_id, substitute_movement_id")
    .in("movement_id", ids);
  const rows = (subs ?? []) as {
    movement_id: string;
    substitute_movement_id: string;
  }[];
  if (rows.length === 0) return map;

  const { data: names } = await supabase
    .from("movements")
    .select("id, canonical_name")
    .in("id", [...new Set(rows.map((r) => r.substitute_movement_id))]);
  const nameById = new Map(
    ((names ?? []) as { id: string; canonical_name: string }[]).map((m) => [
      m.id,
      m.canonical_name,
    ]),
  );

  for (const r of rows) {
    const name = nameById.get(r.substitute_movement_id);
    if (name) {
      map.set(r.movement_id, { id: r.substitute_movement_id, name });
    }
  }
  return map;
}

// ---------- Movement history (the gym-time comparison card) ----------

export type HistorySet = {
  date: string;
  load: number | null;
  reps: number | null;
  unit: string | null;
  e1rm: number | null;
  e1rmIsLoose: boolean;
  context: WorkoutSetContext;
  rxLevel: WorkoutRxLevel | null;
};

export type MovementHistory = {
  movementId: string;
  bestE1rmStrict: number | null;
  bestE1rmAny: number | null;
  lastDate: string | null;
  recent: HistorySet[];
  /** Suggested load for a given rep target, derived from the best strict e1RM. */
  suggestedFor: (reps: number) => number | null;
  percentOf: (load: number) => number | null;
};

export async function getMovementHistory(
  supabase: SupabaseClient,
  movementId: string,
  opts: { limit?: number; excludeSessionId?: string } = {},
): Promise<MovementHistory> {
  const limit = opts.limit ?? 12;

  const { data: best } = await supabase
    .from("workout_movement_e1rm_best")
    .select("best_e1rm_strict, best_e1rm_any, last_session_date")
    .eq("movement_id", movementId)
    .eq("context", "strength")
    .maybeSingle();

  const { data: setsData, error } = await supabase
    .from("workout_sets")
    .select(
      `id, actual_load, actual_reps, actual_unit, e1rm, e1rm_is_loose, context, rx_level, entry_id,
       workout_movement_entries!inner (
         movement_id,
         workout_blocks!inner (
           session_id,
           workout_sessions!inner ( id, session_date )
         )
       )`,
    )
    .eq("workout_movement_entries.movement_id", movementId);
  if (error) throw new Error(`getMovementHistory: ${error.message}`);

  const recent: HistorySet[] = ((setsData ?? []) as any[])
    .map((s) => {
      const session =
        s.workout_movement_entries?.workout_blocks?.workout_sessions;
      return {
        sessionId: session?.id as string | undefined,
        date: session?.session_date as string,
        load: s.actual_load,
        reps: s.actual_reps,
        unit: s.actual_unit,
        e1rm: s.e1rm,
        e1rmIsLoose: s.e1rm_is_loose,
        context: s.context as WorkoutSetContext,
        rxLevel: s.rx_level as WorkoutRxLevel | null,
      };
    })
    .filter((s) => s.date && s.sessionId !== opts.excludeSessionId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map((s) => ({
      date: s.date,
      load: s.load,
      reps: s.reps,
      unit: s.unit,
      e1rm: s.e1rm,
      e1rmIsLoose: s.e1rmIsLoose,
      context: s.context,
      rxLevel: s.rxLevel,
    }));

  const bestStrict = (best?.best_e1rm_strict as number | null) ?? null;

  return {
    movementId,
    bestE1rmStrict: bestStrict,
    bestE1rmAny: (best?.best_e1rm_any as number | null) ?? null,
    lastDate: (best?.last_session_date as string | null) ?? null,
    recent,
    suggestedFor: (reps: number) =>
      bestStrict ? suggestedLoad(bestStrict, reps) : null,
    percentOf: (load: number) =>
      bestStrict ? percentOfE1rm(load, bestStrict) : null,
  };
}

// ---------- Benchmark attempts (the comparison banner) ----------

export type BenchmarkAttemptRow = {
  sessionId: string;
  date: string;
  scoreType: WorkoutScoreType;
  score: {
    seconds: number | null;
    rounds: number | null;
    reps: number | null;
    load: number | null;
    distance: number | null;
    calories: number | null;
  };
  rxLevel: WorkoutRxLevel | null;
};

/** Prior attempts at a benchmark (most recent first), for the comparison banner. */
export async function getBenchmarkAttempts(
  supabase: SupabaseClient,
  benchmarkId: string,
  opts: { excludeSessionId?: string } = {},
): Promise<BenchmarkAttemptRow[]> {
  const { data, error } = await supabase
    .from("workout_blocks")
    .select(
      `score_type, score_seconds, score_rounds, score_reps, score_load,
       score_distance, score_calories, rx_level, session_id,
       workout_sessions!inner ( session_date )`,
    )
    .eq("benchmark_id", benchmarkId);
  if (error) throw new Error(`getBenchmarkAttempts: ${error.message}`);
  return ((data ?? []) as any[])
    .map((b) => ({
      sessionId: b.session_id as string,
      date: b.workout_sessions?.session_date as string,
      scoreType: b.score_type as WorkoutScoreType,
      score: {
        seconds: b.score_seconds,
        rounds: b.score_rounds,
        reps: b.score_reps,
        load: b.score_load,
        distance: b.score_distance,
        calories: b.score_calories,
      },
      rxLevel: b.rx_level as WorkoutRxLevel | null,
    }))
    .filter((a) => a.date && a.sessionId !== opts.excludeSessionId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---------- Session list ----------

export type SessionListItem = {
  id: string;
  sessionDate: string;
  title: string | null;
  source: string;
  parsedAt: string | null;
  blockCount: number;
};

export async function listSessions(
  supabase: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<SessionListItem[]> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("id, session_date, title, source, parsed_at, workout_blocks(count)")
    .order("session_date", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw new Error(`listSessions: ${error.message}`);
  return ((data ?? []) as any[]).map((s) => ({
    id: s.id,
    sessionDate: s.session_date,
    title: s.title,
    source: s.source,
    parsedAt: s.parsed_at,
    blockCount: s.workout_blocks?.[0]?.count ?? 0,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
