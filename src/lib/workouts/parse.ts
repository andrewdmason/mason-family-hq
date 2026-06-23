// Turn a free-text CrossFit/strength workout description (from a CFO calendar
// event) into the structured session shape, in a single Claude tool-use call.
//
// The same call also canonicalizes: we hand Claude the current movement
// vocabulary and ask it to map each movement onto an existing canonical name when
// one fits, or propose a new one with its family. The DB-side resolve
// (canonicalize.ts) then turns those names into movement ids, growing the library
// when the name is genuinely new. Resilient: any failure returns { parsed: false }
// so the caller shows the raw text rather than throwing.

import { anthropic, WORKOUTS_MODEL } from "./anthropic";
import {
  MOVEMENT_FAMILIES,
  type MovementFamily,
  type MovementVocabularyEntry,
  type ParsedBlock,
  type ParsedMovement,
  type ParsedSet,
  type ParsedWorkout,
  type WeightUnit,
  type WorkoutBlockType,
  type WorkoutMetricType,
  type WorkoutScoreType,
  type WorkoutSetContext,
} from "./types";

const BLOCK_TYPES: WorkoutBlockType[] = [
  "warmup", "strength", "metcon", "accessory", "cooldown", "skill",
];
const METRIC_TYPES: WorkoutMetricType[] = [
  "load_reps", "distance", "duration", "calories", "reps",
];
const CONTEXTS: WorkoutSetContext[] = ["strength", "metcon", "warmup", "accessory"];
const SCORE_TYPES: WorkoutScoreType[] = [
  "time", "rounds_reps", "reps", "load", "distance", "calories", "none",
];

const PARSE_TOOL = {
  name: "report_workout",
  description:
    "Report the structured breakdown of the workout described, so it can be " +
    "logged and compared to past sessions.",
  input_schema: {
    type: "object" as const,
    properties: {
      blocks: {
        type: "array",
        description:
          "The workout's segments in order. A description with 'Pre-workout', " +
          "'Workout', and 'Post-workout' parts becomes three blocks. A plain " +
          "barbell session is one strength block.",
        items: {
          type: "object",
          properties: {
            block_type: { type: "string", enum: BLOCK_TYPES },
            title: {
              type: "string",
              description: "Short label, e.g. 'Metcon', 'Back Squat', 'Cool-down'.",
            },
            benchmark_name: {
              type: "string",
              description:
                "If this block is a recognized named benchmark WOD (e.g. Fran, " +
                "Grace, Murph, Cindy), its name. Omit otherwise.",
            },
            group_label: {
              type: "string",
              description:
                "When this block is one part of a multi-part named workout, the " +
                "shared workout name (e.g. 'Steak and Pudding'), so the parts " +
                "group together. Omit for standalone pieces.",
            },
            score_type: {
              type: "string",
              enum: SCORE_TYPES,
              description:
                "How the block is scored: 'time' (for time), 'rounds_reps' " +
                "(AMRAP), 'load' (heaviest), 'reps', 'distance', 'calories', or " +
                "'none' for unscored warm-up/skill work.",
            },
            movements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  raw_name: {
                    type: "string",
                    description: "The movement exactly as written in the source.",
                  },
                  canonical_name: {
                    type: "string",
                    description:
                      "Map to one of the provided canonical movement names when " +
                      "it clearly matches; otherwise propose a clean canonical " +
                      "name (Title Case, singular).",
                  },
                  family: { type: "string", enum: MOVEMENT_FAMILIES },
                  sets: {
                    type: "array",
                    description:
                      "The prescribed sets. Expand rep schemes like '9-12-15' " +
                      "into three sets. One set may also be a single round of a " +
                      "run/row/hold.",
                    items: {
                      type: "object",
                      properties: {
                        metric_type: {
                          type: "string",
                          enum: METRIC_TYPES,
                          description:
                            "'load_reps' for weighted reps, 'distance' for " +
                            "runs/rows (meters), 'duration' for timed holds " +
                            "(seconds), 'calories' for cal rows/bikes, 'reps' for " +
                            "bodyweight reps with no load.",
                        },
                        context: {
                          type: "string",
                          enum: CONTEXTS,
                          description:
                            "'strength' for dedicated lifting (max-effort intent), " +
                            "'metcon' for movements inside a conditioning piece, " +
                            "'warmup' or 'accessory' otherwise.",
                        },
                        reps: { type: "integer" },
                        load: {
                          type: "number",
                          description: "Prescribed load, in the unit given.",
                        },
                        unit: { type: "string", enum: ["lb", "kg"] },
                        distance_m: { type: "number", description: "Meters." },
                        duration_s: { type: "integer", description: "Seconds." },
                        calories: { type: "integer" },
                      },
                      required: ["metric_type", "context"],
                    },
                  },
                },
                required: ["raw_name", "canonical_name", "family", "sets"],
              },
            },
            score: {
              type: "object",
              description:
                "The block's prescribed/target score, when one is implied.",
              properties: {
                score_type: { type: "string", enum: SCORE_TYPES },
                seconds: { type: "integer", description: "For a time cap/target." },
                rounds: { type: "integer" },
                reps: { type: "integer" },
                load: { type: "number" },
                distance_m: { type: "number" },
                calories: { type: "integer" },
              },
            },
          },
          required: ["block_type", "score_type", "movements"],
        },
      },
    },
    required: ["blocks"],
  },
};

function buildSystemPrompt(vocabulary: MovementVocabularyEntry[]): string {
  const vocab = vocabulary
    .map((m) => `${m.canonicalName} (${m.family})`)
    .join(", ");
  return [
    "You convert a CrossFit/strength workout description into structured data by",
    "calling report_workout exactly once. Be precise and literal — do not invent",
    "loads or reps that aren't stated.",
    "",
    "First, decide what's worth logging. Only emit blocks that yield meaningful,",
    "trackable measurements:",
    "- ALWAYS include the main workout (the day's metcon / for-time / AMRAP / EMOM,",
    "  or the primary piece).",
    "- ALWAYS include dedicated strength or weightlifting work, wherever it appears",
    "  — including in a pre- or post-workout slot. E.g. '5x5 deadlift', 'build to a",
    "  heavy single clean', 'back squat 3x3 @ 80%', a 1-rep-max attempt. These are",
    "  loaded barbell/dumbbell lifts the athlete tracks over time.",
    "- OMIT entirely (do not emit a block) for warm-ups, mobility/activation, cardio",
    "  flushes, stretching, skill drills, and bodyweight or unloaded accessory",
    "  'finisher' work that has no meaningful load to track (planks, side planks,",
    "  hollow holds, GHD sit-ups, banded work, foam rolling). The raw text is kept",
    "  separately, so nothing is lost by leaving these out.",
    "- When unsure whether a loaded lift is worth tracking, include it; when it's",
    "  clearly generic warm-up/cool-down/mobility, leave it out.",
    "",
    "Rules:",
    "- A block is ONE scored piece. Keep ALL movements of a single piece together",
    "  in that block: a for-time/AMRAP/EMOM/chipper that mixes movements (e.g. a",
    "  bike for calories alongside burpees in the same AMRAP) is ONE block with",
    "  multiple movements — log a calorie/distance movement's amount on its own",
    "  set, and give the block the piece's overall score.",
    "- When a workout has explicitly named parts with their OWN scores (e.g.",
    "  'Steak and Pudding: Part 1' is a 1:00 cal bike and 'Part 2' is an AMRAP),",
    "  make a separate block per part, set each block's `title` to the part label",
    "  ('Part 1', 'Part 2'), and set each block's `group_label` to the shared",
    "  workout name ('Steak and Pudding') so they group together. Leave",
    "  group_label empty for standalone pieces.",
    "- Expand rep schemes (e.g. '9-12-15 Pull-ups') into one set per number.",
    "- Put loads on the sets that have them; leave load empty when bodyweight.",
    "- Runs/rows are 'distance' sets in meters; timed holds are 'duration' in",
    "  seconds; cal rows/bikes are 'calories'.",
    "- Mark sets inside a conditioning piece as context 'metcon', and dedicated",
    "  lifting as 'strength'.",
    "- For canonical_name, reuse an exact name from this known list when it",
    "  matches; otherwise propose a clean new one and pick the closest family.",
    "",
    `Known movements: ${vocab}`,
  ].join("\n");
}

type RawSet = {
  metric_type?: unknown;
  context?: unknown;
  reps?: unknown;
  load?: unknown;
  unit?: unknown;
  distance_m?: unknown;
  duration_s?: unknown;
  calories?: unknown;
};
type RawMovement = {
  raw_name?: unknown;
  canonical_name?: unknown;
  family?: unknown;
  sets?: unknown;
};
type RawScore = {
  score_type?: unknown;
  seconds?: unknown;
  rounds?: unknown;
  reps?: unknown;
  load?: unknown;
  distance_m?: unknown;
  calories?: unknown;
};
type RawBlock = {
  block_type?: unknown;
  title?: unknown;
  benchmark_name?: unknown;
  group_label?: unknown;
  score_type?: unknown;
  movements?: unknown;
  score?: unknown;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const oneOf = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
const oneOfOrNull = <T extends string>(v: unknown, allowed: T[]): T | null =>
  typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : null;

function normalizeSet(raw: RawSet): ParsedSet {
  const metricType = oneOf(raw.metric_type, METRIC_TYPES, "reps");
  return {
    metricType,
    context: oneOf(raw.context, CONTEXTS, "metcon"),
    rxLevel: null,
    prescribed: {
      reps: int(raw.reps),
      load: num(raw.load),
      unit: oneOfOrNull(raw.unit, ["lb", "kg"] as WeightUnit[]),
      distanceMeters: num(raw.distance_m),
      durationSeconds: int(raw.duration_s),
      calories: int(raw.calories),
    },
  };
}

function normalizeMovement(raw: RawMovement): ParsedMovement | null {
  const rawName = str(raw.raw_name);
  const canonicalName = str(raw.canonical_name) ?? rawName;
  if (!rawName || !canonicalName) return null;
  const family = oneOf<MovementFamily>(raw.family, MOVEMENT_FAMILIES, "other");
  const sets = Array.isArray(raw.sets)
    ? raw.sets.map((s) => normalizeSet(s as RawSet))
    : [];
  return { rawName, canonicalName, family, sets };
}

function normalizeBlock(raw: RawBlock): ParsedBlock {
  const score = (raw.score ?? {}) as RawScore;
  const movements = Array.isArray(raw.movements)
    ? raw.movements
        .map((m) => normalizeMovement(m as RawMovement))
        .filter((m): m is ParsedMovement => m !== null)
    : [];
  return {
    blockType: oneOf(raw.block_type, BLOCK_TYPES, "metcon"),
    title: str(raw.title),
    benchmarkName: str(raw.benchmark_name),
    groupLabel: str(raw.group_label),
    score: {
      scoreType: oneOf(
        score.score_type ?? raw.score_type,
        SCORE_TYPES,
        oneOf(raw.score_type, SCORE_TYPES, "none")
      ),
      seconds: int(score.seconds),
      rounds: int(score.rounds),
      reps: int(score.reps),
      load: num(score.load),
      distanceMeters: num(score.distance_m),
      calories: int(score.calories),
    },
    movements,
  };
}

/**
 * Parse a workout description into structured blocks/movements/sets. Returns
 * { parsed: false } on any failure so the caller can fall back to the raw text.
 */
/**
 * Build the text handed to the parser for a session. The workout often lives in
 * the calendar event's *title* with no description body (e.g. "Deadlift
 * 5-5-5-5-5"), so the title has to be part of the source text — otherwise the
 * parse sees nothing and the session never structures. Title goes first so it
 * reads as the heading; either part may be empty.
 */
export function buildSessionSourceText(
  title: string | null | undefined,
  description: string | null | undefined
): string {
  return [title, description]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join("\n");
}

export async function parseWorkoutDescription(
  description: string,
  vocabulary: MovementVocabularyEntry[]
): Promise<ParsedWorkout> {
  const trimmed = description.trim();
  if (!trimmed) return { parsed: false, blocks: [] };

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: WORKOUTS_MODEL,
      max_tokens: 2048,
      system: buildSystemPrompt(vocabulary),
      tools: [PARSE_TOOL],
      tool_choice: { type: "tool", name: PARSE_TOOL.name },
      messages: [{ role: "user", content: trimmed }],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { parsed: false, blocks: [] };

    const input = toolUse.input as { blocks?: unknown };
    const blocks = Array.isArray(input.blocks)
      ? input.blocks.map((b) => normalizeBlock(b as RawBlock))
      : [];
    if (blocks.length === 0) return { parsed: false, blocks: [] };

    return { parsed: true, blocks };
  } catch (err) {
    console.error(
      "[workouts/parse] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { parsed: false, blocks: [] };
  }
}
