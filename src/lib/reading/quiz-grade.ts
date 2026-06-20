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
  /** True when every dimension is graded at >= 3 (the pass that advances the book). */
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
          "The 1–4 scale: 1 = needs a lot of work, 2 = developing / not yet there, " +
          "3 = meets the standard for their grade, 4 = exceptional. A 3 (the passing " +
          "bar) requires a clear, accurate anchor; if the opening is vague, partly " +
          "wrong, or only loosely tied to the assigned pages, score 2 or below.",
      },
      comprehension_note: {
        type: "string",
        description: "One short, specific sentence on the comprehension score.",
      },
      mechanics_score: {
        type: "integer",
        description:
          "1–4 for grammar, spelling, punctuation, paragraphing, and structure at " +
          "this child's age. Same scale (3 = meets the standard, the passing bar). Be " +
          "exacting and hold the bar high: REPEATED spelling errors, a misspelled or " +
          "uncapitalized proper noun (a character or place name), run-on sentences, or " +
          "missing commas each keep this at 2 or below — a 3 means the writing is " +
          "largely clean, the kind of thing handed in after a careful proofread. The " +
          "essay MUST be broken into more than one paragraph: a single undivided block " +
          "of text cannot score above 2 no matter how few other errors it has.",
      },
      mechanics_note: {
        type: "string",
        description:
          "One short sentence naming the KINDS of mechanics problems you found " +
          "(e.g. spelling slips, a name not capitalized, run-on sentences, no " +
          "paragraph breaks) so the child knows what to hunt for — but do NOT correct " +
          "them or rewrite any words yourself.",
      },
      thinking_score: {
        type: "integer",
        description:
          "1–4 for originality, depth, and support of ideas in the broader-theme " +
          "part. Same scale (3 = meets the standard, the passing bar). A 3 develops a " +
          "real idea across more than a sentence or two and backs it with something " +
          "specific from the book; a thin, one-note, or mostly-plot-summary answer " +
          "that never really digs into the broader question scores 2 or below. Reward " +
          "genuine insight, never padding or length on its own.",
      },
      thinking_note: {
        type: "string",
        description: "One short, specific sentence on the thinking score.",
      },
      notes: {
        type: "string",
        description:
          "2-3 warm sentences addressed to the child (\"you\"): name one real " +
          "strength, then name the KINDS of things to fix so they learn what to look " +
          "for — e.g. \"reread for spelling and run-on sentences,\" \"break this into " +
          "paragraphs,\" \"capitalize names,\" or \"push your idea further with an " +
          "example from the book.\" Point them to it; do NOT fix the errors, correct " +
          "spellings, or rewrite sentences for them — the revision is theirs to do.",
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
 * graded at 3 or better (a 2 is "close, but revise and resubmit").
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
        "dimensions, each 1–4 (1 = needs a lot of work, 2 = developing / not yet " +
        "there, 3 = meets the standard for the child's grade, 4 = exceptional): " +
        "comprehension of the reading (the opening must show they actually read and " +
        "understood the assigned pages, judged against the anchor, and the essay must " +
        "stay accurate to the book), writing mechanics, and quality of thinking " +
        "(reward genuine insight over length — never reward padding). Hold a real " +
        "bar: 3 is the passing standard, and a 2 means the work is close but not yet " +
        "good enough to advance. Be exacting on mechanics — repeated spelling errors, " +
        "an uncapitalized or misspelled name, run-on sentences, or a single " +
        "undivided block with no paragraph breaks all keep mechanics below a 3 — and " +
        "expect the broader-theme idea to be genuinely developed, not a thin " +
        "afterthought. Then write a short, warm note: name one real strength and the " +
        "KINDS of things to fix, so the child knows what to look for. Coach toward a " +
        "revision — point them at the problems — but never fix spellings, correct " +
        "errors, or rewrite sentences for them; the revision is theirs to do.",
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
      graded && comprehension >= 3 && mechanics >= 3 && thinking >= 3;
    return { graded, meetsStandard, scores, notes: noteOf(p.notes) };
  } catch (err) {
    console.error(
      "[reading/quiz-grade] Essay grade failed:",
      err instanceof Error ? err.message : String(err)
    );
    return ungraded();
  }
}
