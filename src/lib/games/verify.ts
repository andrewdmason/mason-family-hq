import { anthropic, GAMES_MODEL } from "@/lib/games/anthropic";
import type {
  GeneratedQuestion,
  McPayload,
  ListPayload,
  ClosestPayload,
  VerifyResult,
} from "@/lib/games/types";

/**
 * Independently verify one generated question before it becomes playable. The
 * host plays the game, so questions can't be human-reviewed without spoiling
 * play — this adversarial pass is the quality gate instead. Mirrors the reading
 * quiz-grade pattern: one isolated forced tool call per question, so one failure
 * never fails the batch.
 *
 * The verifier solves the question on its own, THEN checks the proposed answer
 * for correctness, ambiguity, and (for MC) distractor quality. On any error it
 * defaults to `quarantine` — failing closed keeps a possibly-wrong question off
 * the table.
 *
 * Known limit (documented in the plan): verifier and generator share a model
 * family, so a shared blind spot can pass both. The in-game "toss" is the human
 * backstop.
 */

const VERIFY_TOOL = {
  name: "report_verdict",
  description:
    "Report your independent verification of a trivia question and its proposed answer.",
  input_schema: {
    type: "object" as const,
    properties: {
      independent_answer: {
        type: "string",
        description:
          "The answer YOU arrive at independently, before judging the proposed one.",
      },
      proposed_is_correct: {
        type: "boolean",
        description: "Whether the proposed answer is factually correct.",
      },
      unambiguous: {
        type: "boolean",
        description:
          "Whether the question has exactly one defensible answer (not debatable, " +
          "not time-dependent without a date, not open to interpretation).",
      },
      distractors_ok: {
        type: "boolean",
        description:
          "For multiple choice: whether every wrong option is clearly wrong (none is " +
          "also arguably correct). For other types, true.",
      },
      notes: {
        type: "string",
        description: "One short sentence explaining the verdict, especially if rejecting.",
      },
    },
    required: ["independent_answer", "proposed_is_correct", "unambiguous", "distractors_ok"],
  },
};

/** Render the question + its proposed answer for the verifier to judge. */
function describe(q: GeneratedQuestion): string {
  if (q.type === "mc") {
    const p = q.payload as McPayload;
    const opts = p.options.map((o, i) => `  ${i}. ${o}`).join("\n");
    return (
      `Type: multiple choice\nQuestion: ${q.prompt}\nOptions:\n${opts}\n` +
      `Proposed correct option: ${p.correctIndex}. ${p.options[p.correctIndex]}`
    );
  }
  if (q.type === "list") {
    const p = q.payload as ListPayload;
    return (
      `Type: list (name as many as you can)\nQuestion: ${q.prompt}\n` +
      `Proposed full set of correct answers: ${p.items.join(", ")}`
    );
  }
  const p = q.payload as ClosestPayload;
  return (
    `Type: closest-wins (numeric)\nQuestion: ${q.prompt}\n` +
    `Proposed answer: ${p.answer}${p.unit ? ` ${p.unit}` : ""}`
  );
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function verifyQuestion(q: GeneratedQuestion): Promise<VerifyResult> {
  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: GAMES_MODEL,
      max_tokens: 600,
      system:
        "You are a meticulous fact-checker for a family trivia game. For each question " +
        "you FIRST work out the answer yourself, then judge the proposed answer. Be " +
        "skeptical: reject anything factually wrong, ambiguous, debatable, or (for " +
        "multiple choice) where a 'wrong' option is also arguably correct. When in doubt, " +
        "reject — a wrong answer reaching the table is worse than dropping a question.",
      tools: [VERIFY_TOOL],
      tool_choice: { type: "tool", name: VERIFY_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `Verify this trivia question. Call report_verdict exactly once.\n\n${describe(q)}`,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return { verdict: "quarantine", notes: "Verifier returned no verdict." };
    }
    const r = toolUse.input as Record<string, unknown>;
    const ok =
      r.proposed_is_correct === true &&
      r.unambiguous === true &&
      r.distractors_ok === true;
    return {
      verdict: ok ? "ready" : "quarantine",
      notes: asString(r.notes),
    };
  } catch (err) {
    console.error(
      "[games/verify] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { verdict: "quarantine", notes: "Verifier call failed." };
  }
}
