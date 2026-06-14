import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import type { EssayRubric, EssayRubricScores } from "@/lib/types";

/**
 * Grading a submitted quiz. The essay is graded by a single model call against a
 * three-dimension rubric (the path new quizzes take). Legacy multiple-choice is
 * graded deterministically here, and each legacy free-text answer by an
 * independent model call — all isolated so one failure leaves that answer
 * ungraded rather than failing the submission. Pure and self-contained, like
 * quiz-generate.ts.
 */

/** Deterministic: did the reader pick the keyed option? */
export function gradeMultipleChoice(
  selectedIndex: number | null,
  correctIndex: number
): boolean {
  return selectedIndex != null && selectedIndex === correctIndex;
}

export type FreeTextGrade = {
  /** null = couldn't grade (API failure); the caller marks it ungraded. */
  correct: boolean | null;
  /** A warm note to the reader on why the answer was good/bad. */
  notes: string;
};

const GRADE_ANSWER_TOOL = {
  name: "grade_answer",
  description:
    "Grade a child's short written answer against the rubric and report whether " +
    "it's correct plus a short, encouraging note explaining why.",
  input_schema: {
    type: "object" as const,
    properties: {
      correct: {
        type: "boolean",
        description:
          "True if the answer shows the understanding the rubric calls for. Judge " +
          "generously — reward understanding over exact wording or spelling.",
      },
      notes: {
        type: "string",
        description:
          "1-2 warm sentences addressed to the child (\"you\"). If the answer is " +
          "correct, say what they got right. If it falls short, give a gentle, " +
          "specific hint that points them in the right direction — name the part of " +
          "the story or the idea to think about again — but do NOT state or reveal " +
          "the correct answer, so they can rework it themselves on a retake.",
      },
    },
    required: ["correct", "notes"],
  },
};

/**
 * Grade one free-text answer. A blank answer short-circuits (no API call). Any
 * API/parse failure resolves to { correct: null } so the caller can record the
 * answer as ungraded without failing the whole submission.
 */
export async function gradeFreeText(input: {
  question: string;
  rubric: string;
  sampleAnswer: string;
  answer: string;
  readerAge?: number | null;
}): Promise<FreeTextGrade> {
  if (!input.answer.trim()) {
    return {
      correct: false,
      notes: "You left this one blank — give it a try next time!",
    };
  }

  const ageLine =
    input.readerAge != null
      ? `The reader is ${input.readerAge} years old; judge at that level.\n`
      : "";

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 512,
      system:
        "You are a kind, encouraging reading teacher grading a child's short " +
        "written answer about a book. Judge correctness generously against the " +
        "rubric — reward genuine understanding over exact wording, grammar, or " +
        "spelling. Then write a short, warm note addressed directly to the child. " +
        "When the answer falls short, coach rather than correct: point them toward " +
        "the part of the book or the idea they missed so they can try again, but " +
        "never give away the answer itself.",
      tools: [GRADE_ANSWER_TOOL],
      tool_choice: { type: "tool", name: GRADE_ANSWER_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `${ageLine}Question: ${input.question}\n\n` +
            `What a correct answer needs (rubric): ${input.rubric}\n\n` +
            `A model answer: ${input.sampleAnswer || "(none provided)"}\n\n` +
            `The child's answer: "${input.answer.trim()}"\n\n` +
            `Grade it and call grade_answer exactly once.`,
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return { correct: null, notes: "" };
    }
    const parsed = toolUse.input as { correct?: unknown; notes?: unknown };
    const correct = typeof parsed.correct === "boolean" ? parsed.correct : null;
    const notes = typeof parsed.notes === "string" ? parsed.notes.trim() : "";
    return { correct, notes };
  } catch (err) {
    console.error(
      "[reading/quiz-grade] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { correct: null, notes: "" };
  }
}

export type EssayGrade = {
  /** False when the AI grade failed/parsed badly — the answer stays ungraded. */
  graded: boolean;
  /** True when every dimension is graded at >= 2 (the pass that advances the book). */
  meetsStandard: boolean;
  /** The per-dimension grades to store on the answer row. */
  scores: EssayRubricScores;
  /** A warm, holistic note to the child. */
  notes: string;
};

const GRADE_ESSAY_TOOL = {
  name: "grade_essay",
  description:
    "Grade a child's longform essay about a book against three dimensions and " +
    "write a short, encouraging holistic note.",
  input_schema: {
    type: "object" as const,
    properties: {
      comprehension_score: {
        type: "integer",
        description:
          "1–4. Does the essay open by showing they truly read and understood the " +
          "assigned pages (judged against the anchor) and stay accurate to the book? " +
          "1 = didn't show the reading, 2 = meets the standard for their grade, " +
          "3 = strong, 4 = exceptional.",
      },
      comprehension_note: {
        type: "string",
        description: "One short, specific sentence on the comprehension score.",
      },
      mechanics_score: {
        type: "integer",
        description:
          "1–4 for grammar, spelling, punctuation, paragraphing, and structure at " +
          "this child's age. Same 1–4 meaning as comprehension.",
      },
      mechanics_note: {
        type: "string",
        description: "One short, specific sentence on the mechanics score.",
      },
      thinking_score: {
        type: "integer",
        description:
          "1–4 for originality, depth, and support of ideas in the broader-theme " +
          "part. Reward genuine insight over length; never reward padding. Same " +
          "1–4 meaning as the others.",
      },
      thinking_note: {
        type: "string",
        description: "One short, specific sentence on the thinking score.",
      },
      notes: {
        type: "string",
        description:
          "2-3 warm sentences addressed to the child (\"you\"): name one real " +
          "strength and one specific thing to work on. If the essay falls short, " +
          "coach toward a revision — point to the part of the book or the idea to " +
          "develop — without writing it for them.",
      },
    },
    required: [
      "comprehension_score",
      "comprehension_note",
      "mechanics_score",
      "mechanics_note",
      "thinking_score",
      "thinking_note",
      "notes",
    ],
  },
};

/** Coerce a raw score to an integer in [1,4], or null if unusable. */
function toScore(v: unknown): number | null {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : null;
}

const ungraded = (): EssayGrade => ({
  graded: false,
  meetsStandard: false,
  scores: {
    comprehension: { score: null, note: "" },
    mechanics: { score: null, note: "" },
    thinking: { score: null, note: "" },
  },
  notes: "",
});

/**
 * Grade one longform essay against its three-dimension rubric. A blank essay
 * short-circuits to a graded fail (no API call). Any API/parse failure resolves
 * to an ungraded result so the caller records it without failing the submission.
 * "Meets standard" — the pass that advances the book — means every dimension is
 * graded at 2 or better.
 */
export async function gradeEssay(input: {
  prompt: string;
  anchorSummary: string;
  rubric: EssayRubric | null;
  essay: string;
  readerAge?: number | null;
  minWords?: number | null;
}): Promise<EssayGrade> {
  if (!input.essay.trim()) {
    return {
      graded: true,
      meetsStandard: false,
      scores: {
        comprehension: { score: 1, note: "There's nothing written yet." },
        mechanics: { score: 1, note: "There's nothing written yet." },
        thinking: { score: 1, note: "There's nothing written yet." },
      },
      notes: "You left this blank — give the essay a real try and resubmit!",
    };
  }

  const ageLine =
    input.readerAge != null
      ? `The writer is ${input.readerAge} years old; grade at that level.\n`
      : "";
  const lengthLine =
    input.minWords != null
      ? `They were asked to aim for about ${input.minWords} words; judge thinking on substance, not length.\n`
      : "";

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 1024,
      system:
        "You are an encouraging but honest middle-school English teacher grading a " +
        "child's longform essay about a book they're partway through. Grade three " +
        "dimensions, each 1–4 (1 = needs a lot of work, 2 = meets the standard for " +
        "the child's grade, 3 = strong, 4 = exceptional): comprehension of the " +
        "reading (the opening must show they actually read and understood the " +
        "assigned pages, judged against the anchor, and the essay must stay accurate " +
        "to the book), writing mechanics, and quality of thinking (reward genuine " +
        "insight over length — never reward padding). Then write a short, warm note " +
        "naming one real strength and one specific thing to improve. Coach toward a " +
        "revision without writing it for them.",
      tools: [GRADE_ESSAY_TOOL],
      tool_choice: { type: "tool", name: GRADE_ESSAY_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `${ageLine}${lengthLine}` +
            `The essay prompt the child answered:\n${input.prompt}\n\n` +
            `What the opening must show they read (anchor — teacher-facing, do NOT ` +
            `repeat it to the child): ${input.anchorSummary || "(none provided)"}\n\n` +
            `Rubric:\n` +
            `- Comprehension: ${input.rubric?.comprehension || "(use your judgment)"}\n` +
            `- Mechanics: ${input.rubric?.mechanics || "(use your judgment)"}\n` +
            `- Thinking: ${input.rubric?.thinking || "(use your judgment)"}\n\n` +
            `The child's essay:\n"""\n${input.essay.trim()}\n"""\n\n` +
            `Grade it and call grade_essay exactly once.`,
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return ungraded();

    const p = toolUse.input as Record<string, unknown>;
    const comprehension = toScore(p.comprehension_score);
    const mechanics = toScore(p.mechanics_score);
    const thinking = toScore(p.thinking_score);
    const noteOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    const scores: EssayRubricScores = {
      comprehension: { score: comprehension, note: noteOf(p.comprehension_note) },
      mechanics: { score: mechanics, note: noteOf(p.mechanics_note) },
      thinking: { score: thinking, note: noteOf(p.thinking_note) },
    };
    const graded =
      comprehension != null && mechanics != null && thinking != null;
    const meetsStandard =
      graded && comprehension >= 2 && mechanics >= 2 && thinking >= 2;
    return { graded, meetsStandard, scores, notes: noteOf(p.notes) };
  } catch (err) {
    console.error(
      "[reading/quiz-grade] Essay grade failed:",
      err instanceof Error ? err.message : String(err)
    );
    return ungraded();
  }
}
