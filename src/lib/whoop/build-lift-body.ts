// Build the WHOOP lift-log request body from resolved exercises. The exact shape
// (workout_groups → workout_exercises → sets, and the denormalized
// exercise_details) is taken verbatim from github.com/briangaoo/totem
// (src/whoop/build_lift_body.ts) — WHOOP's POST validates these fields, so we
// match its proven shape rather than guessing. One exercise per group, matching
// totem (WHOOP "groups" are supersets; we don't model those).

import { createHash, randomUUID } from "node:crypto";
import { getWhoopExercise } from "./exercise-catalog";

export interface InputSet {
  reps: number;
  weightKg: number; // 0 for bodyweight movements
}

export interface InputExercise {
  exerciseId: string; // a WHOOP exercise_id present in the bundled catalog
  label: string; // our movement name, for skip/debug reporting
  sets: InputSet[];
}

export interface LiftBody {
  name: string;
  during: string;
  timezone: string;
  scaled_msk_strain_score: 0;
  msk_total_volume_kg: 0;
  msk_intensity_percent: 0;
  raw_msk_strain_score: 0;
  workout_groups: unknown[];
}

export interface BuildResult {
  body: LiftBody;
  setCount: number;
  exerciseCount: number;
  unknownExercises: string[]; // exercise_ids not in the bundled catalog
  hash: string; // stable hash of the logged content, for idempotent re-sends
}

function isoRange(startMs: number, endMs: number): string {
  return `['${new Date(startMs).toISOString()}','${new Date(endMs).toISOString()}')`;
}

/**
 * Assemble the full lift body. Each set gets a 100ms placeholder window (WHOOP
 * accepts this) walking forward from startMs; the workout's own `during` is the
 * real [start,end) window. Exercises missing from the bundled catalog are
 * dropped and returned in unknownExercises.
 */
export function buildLiftBody(args: {
  name: string;
  startMs: number;
  endMs: number;
  timezone: string;
  exercises: InputExercise[];
}): BuildResult {
  const groups: unknown[] = [];
  const unknown: string[] = [];
  const hashParts: string[] = [];
  let cursor = args.startMs;
  let setCount = 0;
  let exerciseCount = 0;

  for (const ex of args.exercises) {
    const meta = getWhoopExercise(ex.exerciseId);
    if (!meta) {
      unknown.push(ex.exerciseId);
      continue;
    }
    exerciseCount++;
    const sets = ex.sets.map((s) => {
      const setStart = cursor;
      cursor += 100;
      setCount++;
      hashParts.push(`${meta.exercise_id}:${s.reps}:${s.weightKg}`);
      return {
        during: isoRange(setStart, setStart + 100),
        msk_total_volume_kg: 0,
        weight: s.weightKg,
        number_of_reps: s.reps,
        strap_location: "1",
        strap_location_laterality: "LEFT",
        weightlifting_workout_set_id: randomUUID().toUpperCase(),
      };
    });
    groups.push({
      workout_exercises: [
        {
          sets,
          exercise_details: {
            push_core_name: meta.exercise_id,
            name: meta.name,
            muscle_groups: meta.muscle_groups,
            trackable: true,
            updated_at: "2025-01-01T00:00:00.000Z",
            created_at: "2022-01-01T00:00:00.000Z",
            training_types: [],
            translated_equipment: meta.equipment,
            translated_muscle_groups: meta.primary_muscle,
            translated_movement_pattern: meta.movement_pattern,
            equipment: meta.raw_equipment,
            exercise_id: meta.exercise_id,
            movement_pattern: meta.raw_movement_pattern,
            laterality: meta.laterality,
            deleted: false,
            volume_input_format: "REPS",
            exercise_type: "STRENGTH",
            instructions: [],
          },
        },
      ],
    });
  }

  const body: LiftBody = {
    name: args.name,
    during: isoRange(args.startMs, args.endMs),
    timezone: args.timezone,
    scaled_msk_strain_score: 0,
    msk_total_volume_kg: 0,
    msk_intensity_percent: 0,
    raw_msk_strain_score: 0,
    workout_groups: groups,
  };

  // Hash only the logged content (exercises/reps/weights + window date), not the
  // per-send random set ids, so an unchanged re-send is detectably a no-op.
  const hash = createHash("sha256")
    .update(`${new Date(args.startMs).toISOString().slice(0, 10)}|${hashParts.join("|")}`)
    .digest("hex")
    .slice(0, 32);

  return { body, setCount, exerciseCount, unknownExercises: unknown, hash };
}
