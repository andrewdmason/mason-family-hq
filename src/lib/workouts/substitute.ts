// AI fallback for picking a substitute movement: when none of the existing
// library movements fit, recommend one (reusing an existing movement when a good
// match exists, otherwise proposing a clean new one to add to the library).

import { anthropic, WORKOUTS_MODEL } from "./anthropic";
import {
  MOVEMENT_FAMILIES,
  type MovementFamily,
  type MovementVocabularyEntry,
} from "./types";

export type SubstituteRecommendation = {
  canonicalName: string;
  family: MovementFamily;
  isLoaded: boolean;
  rationale: string;
};

const TOOL = {
  name: "recommend_substitute",
  description:
    "Recommend a single substitute exercise that trains a similar movement " +
    "pattern but works around the athlete's constraint.",
  input_schema: {
    type: "object" as const,
    properties: {
      canonical_name: {
        type: "string",
        description:
          "The substitute movement, Title Case and singular. Reuse an exact " +
          "name from the known list when a good fit exists; otherwise propose a " +
          "clean new movement name.",
      },
      family: { type: "string", enum: MOVEMENT_FAMILIES },
      is_loaded: {
        type: "boolean",
        description:
          "True only if it's a weighted barbell/dumbbell strength lift worth " +
          "tracking for estimated 1RM.",
      },
      rationale: {
        type: "string",
        description: "One short sentence on why it's a good substitute.",
      },
    },
    required: ["canonical_name", "family", "is_loaded", "rationale"],
  },
};

export async function recommendSubstitute(args: {
  movementName: string;
  family: MovementFamily;
  reason?: string;
  vocabulary: MovementVocabularyEntry[];
}): Promise<SubstituteRecommendation | null> {
  try {
    const client = anthropic();
    const vocab = args.vocabulary.map((m) => m.canonicalName).join(", ");
    const message = await client.messages.create({
      model: WORKOUTS_MODEL,
      max_tokens: 400,
      system:
        "You recommend ONE substitute CrossFit/strength exercise that trains a " +
        "similar pattern but is more accessible given the athlete's constraint. " +
        "Prefer an existing movement from the known list when one fits well; " +
        "otherwise propose a clean new one. Call recommend_substitute exactly once.",
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `Recommend a substitute for: ${args.movementName} ` +
            `(${args.family} family).` +
            (args.reason ? ` Constraint: ${args.reason}.` : "") +
            `\nKnown movements: ${vocab}`,
        },
      ],
    });

    const tool = message.content.find((b) => b.type === "tool_use");
    if (!tool || tool.type !== "tool_use") return null;
    const input = tool.input as {
      canonical_name?: unknown;
      family?: unknown;
      is_loaded?: unknown;
      rationale?: unknown;
    };

    const canonicalName =
      typeof input.canonical_name === "string" ? input.canonical_name.trim() : "";
    if (!canonicalName) return null;
    const family = (MOVEMENT_FAMILIES as string[]).includes(input.family as string)
      ? (input.family as MovementFamily)
      : "other";
    return {
      canonicalName,
      family,
      isLoaded: input.is_loaded === true,
      rationale:
        typeof input.rationale === "string" ? input.rationale.trim() : "",
    };
  } catch (err) {
    console.error(
      "[workouts/substitute] recommendSubstitute failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
