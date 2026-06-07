// Persist a ParsedWorkout into the session/blocks/entries/sets tables. Movements
// are canonicalized (growing the library via the admin client); set actual_*
// columns are seeded equal to prescribed_* so "I did exactly what was written"
// needs no edits; e1RM is computed for loaded sets at insert time.
//
// Writes to the per-user workout_* tables go through the caller's RLS-scoped
// client (which stamps user_id); only the movement-library growth uses admin.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createMovementResolver } from "./canonicalize";
import { computeSetE1rm } from "./e1rm";
import type {
  ParsedBlock,
  ParsedScore,
  ParsedWorkout,
  WorkoutScoreType,
} from "./types";

function scoreColumns(score: ParsedScore): Record<string, number | null> {
  return {
    score_type: scoreTypeValue(score.scoreType),
    score_seconds: score.seconds ?? null,
    score_rounds: score.rounds ?? null,
    score_reps: score.reps ?? null,
    score_load: score.load ?? null,
    score_distance: score.distanceMeters ?? null,
    score_calories: score.calories ?? null,
  } as unknown as Record<string, number | null>;
}

// score_type is text in the row but typed; keep it as the enum string.
function scoreTypeValue(t: WorkoutScoreType): WorkoutScoreType {
  return t;
}

/** Look up benchmark ids by lowercased name (global library + the user's own). */
async function benchmarkIdByName(
  user: SupabaseClient,
  names: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (names.length === 0) return map;
  const { data } = await user
    .from("workout_benchmarks")
    .select("id, name")
    .in("name", names);
  for (const b of (data ?? []) as { id: string; name: string }[]) {
    map.set(b.name.toLowerCase(), b.id);
  }
  return map;
}

/**
 * Write all blocks/entries/sets for an already-created session. Returns the
 * number of sets written. Throws on the first DB error (the caller cleans up the
 * half-written session).
 */
export async function materializeSession(opts: {
  user: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  sessionId: string;
  parsed: ParsedWorkout;
}): Promise<{ setCount: number }> {
  const { user, admin, userId, sessionId, parsed } = opts;
  const resolver = await createMovementResolver(admin);

  const benchmarkNames = parsed.blocks
    .map((b) => b.benchmarkName)
    .filter((n): n is string => !!n);
  const benchmarks = await benchmarkIdByName(user, benchmarkNames);

  let setCount = 0;

  for (let bi = 0; bi < parsed.blocks.length; bi++) {
    const block: ParsedBlock = parsed.blocks[bi];
    const benchmarkId = block.benchmarkName
      ? benchmarks.get(block.benchmarkName.toLowerCase()) ?? null
      : null;

    const { data: blockRow, error: blockErr } = await user
      .from("workout_blocks")
      .insert({
        user_id: userId,
        session_id: sessionId,
        position: bi,
        block_type: block.blockType,
        title: block.title,
        group_label: block.groupLabel ?? null,
        ...scoreColumns(block.score),
        benchmark_id: benchmarkId,
        is_benchmark: benchmarkId !== null,
      })
      .select("id")
      .single();
    if (blockErr || !blockRow) {
      throw new Error(`materialize block: ${blockErr?.message ?? "no row"}`);
    }
    const blockId = blockRow.id as string;

    for (let mi = 0; mi < block.movements.length; mi++) {
      const movement = block.movements[mi];
      const resolved = await resolver.resolve(
        movement.rawName,
        movement.canonicalName,
        movement.family
      );

      const { data: entryRow, error: entryErr } = await user
        .from("workout_movement_entries")
        .insert({
          user_id: userId,
          block_id: blockId,
          movement_id: resolved.movementId,
          raw_name: movement.rawName,
          position: mi,
        })
        .select("id")
        .single();
      if (entryErr || !entryRow) {
        throw new Error(`materialize entry: ${entryErr?.message ?? "no row"}`);
      }
      const entryId = entryRow.id as string;

      const setRows = movement.sets.map((set, si) => {
        const p = set.prescribed;
        const e = computeSetE1rm({
          load: p.load,
          reps: p.reps,
          unit: p.unit,
          isLoadedMovement: resolved.isLoaded,
        });
        return {
          user_id: userId,
          entry_id: entryId,
          position: si,
          metric_type: set.metricType,
          context: set.context,
          rx_level: set.rxLevel ?? null,
          // Prescribed (the immutable plan).
          prescribed_reps: p.reps ?? null,
          prescribed_load: p.load ?? null,
          prescribed_unit: p.unit ?? null,
          prescribed_distance: p.distanceMeters ?? null,
          prescribed_duration: p.durationSeconds ?? null,
          prescribed_calories: p.calories ?? null,
          // Actual seeded equal to prescribed.
          actual_reps: p.reps ?? null,
          actual_load: p.load ?? null,
          actual_unit: p.unit ?? null,
          actual_distance: p.distanceMeters ?? null,
          actual_duration: p.durationSeconds ?? null,
          actual_calories: p.calories ?? null,
          e1rm: e?.e1rm ?? null,
          e1rm_is_loose: e?.isLoose ?? false,
        };
      });

      if (setRows.length > 0) {
        const { error: setErr } = await user.from("workout_sets").insert(setRows);
        if (setErr) throw new Error(`materialize sets: ${setErr.message}`);
        setCount += setRows.length;
      }
    }
  }

  return { setCount };
}
