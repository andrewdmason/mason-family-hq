import { anthropic, GAMES_MODEL } from "@/lib/games/anthropic";
import type {
  GeneratedQuestion,
  GenerateResult,
  TriviaLevel,
  TriviaType,
} from "@/lib/games/types";

/**
 * Generate a batch of trivia questions for one topic/level/type in a single
 * forced tool call. Pure and self-contained (no Supabase, no auth) so the same
 * function powers the manual generator action today and any background job later.
 * Mirrors the reading quiz-generate pattern: one forced tool call, a strict
 * input_schema, defensive per-field parsing, and resilience to failure (returns
 * an empty batch rather than throwing).
 *
 * The questions still pass through the adversarial verifier (verify.ts) before
 * they're playable — generation optimizes for variety and coverage, verification
 * for correctness.
 */

export type GenerateInput = {
  topic: string;
  level: TriviaLevel;
  type: TriviaType;
  count: number;
  /**
   * A human description of who the questions are for, e.g. "a 5th grader (about
   * 10 years old)" or "the parents (adults)". The caller derives the concrete
   * age/grade (from birthdate) so the stored level tag can stay stable.
   */
  audience: string;
};

/** Build the per-type forced-output tool. The item shape varies by question type. */
function buildTool(type: TriviaType, count: number) {
  const base = {
    prompt: {
      type: "string",
      description:
        "The question as it will be read aloud at the table. One clear sentence, " +
        "no answer leakage.",
    },
    perishable: {
      type: "boolean",
      description:
        "True only if the answer can change over time (current sports rosters/stats, " +
        "recent pop culture, 'who currently...'). False for evergreen facts " +
        "(history, math, geography, classic books).",
    },
  };

  let itemProps: Record<string, unknown>;
  let required: string[];
  if (type === "mc") {
    itemProps = {
      ...base,
      options: {
        type: "array",
        description:
          "Exactly 4 answer options. Exactly one is correct; the other three are " +
          "plausible but clearly wrong to someone who knows the answer (no joke or " +
          "throwaway options).",
        items: { type: "string" },
        minItems: 4,
        maxItems: 4,
      },
      correct_index: {
        type: "integer",
        description: "0-based index into options of the single correct answer.",
        minimum: 0,
        maximum: 3,
      },
    };
    required = ["prompt", "options", "correct_index", "perishable"];
  } else if (type === "list") {
    itemProps = {
      ...base,
      items: {
        type: "array",
        description:
          "The full set of correct answers to enumerate (e.g. all 13 colonies). " +
          "Each a short canonical name.",
        items: { type: "string" },
        minItems: 3,
      },
      target: {
        type: "integer",
        description:
          "How many a team must name to earn the bonus — a fair stretch, usually " +
          "60–80% of the list length.",
        minimum: 1,
      },
    };
    required = ["prompt", "items", "target", "perishable"];
  } else {
    itemProps = {
      ...base,
      answer: {
        type: "number",
        description: "The single numeric answer (closest guess wins).",
      },
      unit: {
        type: "string",
        description: "The unit for the answer, e.g. 'feet', 'years', 'home runs'.",
      },
    };
    required = ["prompt", "answer", "unit", "perishable"];
  }

  return {
    name: "report_questions",
    description: `Report exactly ${count} ${type} trivia questions.`,
    input_schema: {
      type: "object" as const,
      properties: {
        questions: {
          type: "array",
          description: `Exactly ${count} distinct questions — no near-duplicates.`,
          minItems: 1,
          items: { type: "object", properties: itemProps, required },
        },
      },
      required: ["questions"],
    },
  };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Coerce one tool-reported item into a GeneratedQuestion, or null if unusable. */
function sanitize(type: TriviaType, raw: unknown): GeneratedQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const prompt = asString(r.prompt);
  if (!prompt) return null;
  const perishable = r.perishable === true;

  if (type === "mc") {
    const options = Array.isArray(r.options)
      ? r.options.map(asString).filter((s): s is string => s != null)
      : [];
    const correctIndex = asNumber(r.correct_index);
    if (options.length !== 4 || correctIndex == null) return null;
    if (correctIndex < 0 || correctIndex > 3) return null;
    return { type, prompt, payload: { options, correctIndex }, perishable };
  }
  if (type === "list") {
    const items = Array.isArray(r.items)
      ? r.items.map(asString).filter((s): s is string => s != null)
      : [];
    const target = asNumber(r.target);
    if (items.length < 3 || target == null || target < 1) return null;
    return {
      type,
      prompt,
      payload: { items, target: Math.min(Math.round(target), items.length) },
      perishable,
    };
  }
  // closest
  const answer = asNumber(r.answer);
  if (answer == null) return null;
  return {
    type,
    prompt,
    payload: { answer, unit: asString(r.unit) },
    perishable,
  };
}

const LEVEL_GUIDANCE: Record<TriviaLevel, string> = {
  younger_kid: "an upper-elementary kid",
  older_kid: "a middle-school kid",
  adult: "well-read adults",
  all: "a mixed family audience of kids and adults",
};

/**
 * Ask the model for a batch of questions. Any failure (API error, malformed
 * output, zero usable questions) resolves to `{ ok: false, questions: [] }` so
 * the caller can mark the batch failed and let the adult retry.
 */
export async function generateQuestionBatch(
  input: GenerateInput
): Promise<GenerateResult> {
  if (!input.topic.trim() || input.count < 1) return { ok: false, questions: [] };

  const tool = buildTool(input.type, input.count);
  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: GAMES_MODEL,
      max_tokens: 4000,
      system:
        "You are a trivia writer for a family game. You write accurate, unambiguous " +
        "questions with exactly one correct answer, pitched precisely to the audience's " +
        "age and knowledge. Questions are read aloud, so they must be self-contained and " +
        "clear. You never write trick questions or questions whose answer is debatable.",
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content:
            `Write ${input.count} ${input.type} trivia questions about "${input.topic}".\n\n` +
            `Audience: ${input.audience} — pitch the difficulty and vocabulary for ${LEVEL_GUIDANCE[input.level]}.\n\n` +
            `Make them genuinely different from one another. Base every answer on ` +
            `well-established fact. Call report_questions exactly once.`,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { ok: false, questions: [] };

    const parsed = toolUse.input as { questions?: unknown };
    const rawList = Array.isArray(parsed.questions) ? parsed.questions : [];
    const questions = rawList
      .map((raw) => sanitize(input.type, raw))
      .filter((q): q is GeneratedQuestion => q != null);

    return { ok: questions.length > 0, questions };
  } catch (err) {
    console.error(
      "[games/generate] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { ok: false, questions: [] };
  }
}
