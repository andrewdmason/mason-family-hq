// Shared types for the Workouts app: the DB enums, and the shape the AI parser
// returns from a calendar workout description.

export type MovementFamily =
  | "squat"
  | "hinge"
  | "press"
  | "jerk"
  | "pull"
  | "clean"
  | "snatch"
  | "lunge"
  | "carry"
  | "gymnastics"
  | "monostructural"
  | "core"
  | "other";

export const MOVEMENT_FAMILIES: MovementFamily[] = [
  "squat", "hinge", "press", "jerk", "pull", "clean", "snatch",
  "lunge", "carry", "gymnastics", "monostructural", "core", "other",
];

export type WorkoutBlockType =
  | "warmup" | "strength" | "metcon" | "accessory" | "cooldown" | "skill";

export type WorkoutMetricType =
  | "load_reps" | "distance" | "duration" | "calories" | "reps";

export type WorkoutSetContext = "strength" | "metcon" | "warmup" | "accessory";

export type WorkoutRxLevel = "scaled" | "rx" | "rx_plus";

export type WorkoutScoreType =
  | "time" | "rounds_reps" | "reps" | "load" | "distance" | "calories" | "none";

export type WeightUnit = "lb" | "kg";

// ---------- Parser output (no DB ids; canonicalization happens after) ----------

export type ParsedPrescription = {
  reps?: number | null;
  load?: number | null;
  unit?: WeightUnit | null;
  distanceMeters?: number | null;
  durationSeconds?: number | null;
  calories?: number | null;
};

export type ParsedSet = {
  metricType: WorkoutMetricType;
  context: WorkoutSetContext;
  rxLevel?: WorkoutRxLevel | null;
  prescribed: ParsedPrescription;
};

export type ParsedMovement = {
  /** Exactly as written in the source text. */
  rawName: string;
  /** An existing canonical name from the provided vocabulary, or a new proposal. */
  canonicalName: string;
  family: MovementFamily;
  sets: ParsedSet[];
};

export type ParsedScore = {
  scoreType: WorkoutScoreType;
  seconds?: number | null;
  rounds?: number | null;
  reps?: number | null;
  load?: number | null;
  distanceMeters?: number | null;
  calories?: number | null;
};

export type ParsedBlock = {
  blockType: WorkoutBlockType;
  title?: string | null;
  /** A recognized benchmark name (e.g. "Fran") when this block is one. */
  benchmarkName?: string | null;
  /** Shared workout name when this block is one part of a multi-part WOD. */
  groupLabel?: string | null;
  score: ParsedScore;
  movements: ParsedMovement[];
};

export type ParsedWorkout = {
  /** False when parsing failed; the caller falls back to the raw description. */
  parsed: boolean;
  blocks: ParsedBlock[];
};

/** One entry in the canonical-movement vocabulary handed to the parser. */
export type MovementVocabularyEntry = {
  canonicalName: string;
  family: MovementFamily;
};
