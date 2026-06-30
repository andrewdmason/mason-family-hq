import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import { ESSAY_PASS_MIN } from "@/lib/reading/essay-scoring";
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
  /** True when the three dimensions sum to at least ESSAY_PASS_MIN (the pass that
   *  advances the book) — a weak part can be carried by a strong one. */
  meetsStandard: boolean;
  /** Sum of the three dimensions (out of 12), or null when not fully graded. */
  total: number | null;
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
          "3 = meets the standard for their grade, 4 = exceptional. A 3 requires the " +
          "essay to convey the key events and reasoning accurately IN THE CHILD'S OWN " +
          "WORDS — an accurate paraphrase is fully sufficient, so do NOT require exact " +
          "quotes or verbatim wording even when the anchor quotes the book. Score 2 or " +
          "below only when the opening is vague, gets the key events wrong, or is only " +
          "loosely tied to the assigned pages.",
      },
      comprehension_note: {
        type: "string",
        description: "One short, specific sentence on the comprehension score.",
      },
      mechanics_score: {
        type: "integer",
        description:
          "1–4 for grammar, spelling, punctuation, paragraphing, and structure at " +
          "this child's age. Same scale (3 = meets the grade-level standard). Judge " +
          "the essay as a whole: a 3 means the writing is largely clean and clearly " +
          "organized — the kind of thing handed in after a careful proofread — and a " +
          "couple of minor slips (one or two spelling errors, a single missed capital, " +
          "an occasional run-on, a missing comma, a 'to'/'too' mix-up) are fine at a 3 " +
          "as long as they don't pile up. Reserve a 2 or below for PERVASIVE problems: " +
          "errors in most sentences, frequent run-ons, or writing that's genuinely " +
          "hard to follow. The one hard rule: an essay with no paragraph breaks at " +
          "all — a single undivided block — cannot score above 2, because organization " +
          "is part of mechanics.",
      },
      mechanics_note: {
        type: "string",
        description:
          "One short sentence summarizing the mechanics — what's working and the " +
          "kinds of things to tighten — as a lead-in to the fix-it checklist below.",
      },
      mechanics_fixes: {
        type: "array",
        items: { type: "string" },
        description:
          "A specific, do-this checklist for cleaning up the writing — one entry " +
          "per concrete problem, roughly in the order they appear. For EACH entry, " +
          "quote the exact word, phrase, or sentence that's wrong, give the " +
          "correction outright, and add a few words on the rule so the child learns " +
          "it — e.g. \"'thank her to' → 'thank her too' — 'too' means 'also.'\", " +
          "\"Capitalize the name: 'thresh' → 'Thresh.'\", or \"Split the run-on after " +
          "'...let her go' into two sentences.\" Be concrete and complete: a child " +
          "should be able to follow this list and fix every mechanics error, then " +
          "score a 4. Unlike the other dimensions, here you DO correct the writing " +
          "directly. Return an empty array only when the mechanics are genuinely clean.",
      },
      thinking_score: {
        type: "integer",
        description:
          "1–4 for originality, depth, and support of ideas in the broader-theme " +
          "part. Same scale (3 = meets the grade-level standard). A 3 develops a " +
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
          "strength, then point them at what to work on at a high level (the mechanics " +
          "checklist already has the line-by-line fixes, so just gesture at it here — " +
          "\"work through the writing fixes below\"). For the ideas — comprehension and " +
          "thinking — coach without solving: e.g. \"reread the moment Thresh lets her " +
          "go\" or \"push your idea further with an example from the book,\" but do NOT " +
          "hand them the missing facts or the analysis; that thinking is theirs to do.",
      },
    },
    required: [
      "comprehension_score",
      "comprehension_note",
      "mechanics_score",
      "mechanics_note",
      "mechanics_fixes",
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
  total: null,
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
 * "Meets standard" — the pass that advances the book — means the three dimensions
 * sum to at least ESSAY_PASS_MIN of 12, so a weak part can be carried by a strong
 * one (a total below that is "close, but revise and resubmit").
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
      total: 3,
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
        "stay accurate to the book — an accurate retelling in the child's OWN words " +
        "fully counts, and you must NOT require exact quotes or verbatim wording even " +
        "when the anchor quotes the book), writing mechanics, and quality of thinking " +
        "(reward genuine insight over length — never reward padding). Score each " +
        "dimension honestly on its own merits: 3 is solid grade-level work, 2 is " +
        "developing, 4 is exceptional. Judge mechanics on the essay as a whole, not on " +
        "any single slip: a couple of minor errors (a stray spelling mistake, one " +
        "missed capital, an occasional run-on or missing comma) are fine at a 3 when " +
        "the writing is otherwise clean and clearly organized; reserve a 2 or below " +
        "for problems that are PERVASIVE (errors in most sentences, frequent run-ons) " +
        "or for a single undivided block with no paragraph breaks. Expect the " +
        "broader-theme idea to be genuinely developed, not a thin " +
        "afterthought. Then write a short, warm holistic note: name one real strength " +
        "and, in broad strokes, what to work on. For MECHANICS specifically, also " +
        "produce a concrete fix-it checklist: quote each error, give the correction " +
        "outright, and add a few words on the rule, so the child can follow the list " +
        "and learn from it — here you DO correct the writing directly. But for " +
        "comprehension and quality of thinking, coach rather than solve: point them to " +
        "what to reread or push further, and never hand them the missing facts, the " +
        "analysis, or the answer; that thinking is theirs to do.",
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
    const fixesOf = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
        : [];

    const scores: EssayRubricScores = {
      comprehension: { score: comprehension, note: noteOf(p.comprehension_note) },
      mechanics: {
        score: mechanics,
        note: noteOf(p.mechanics_note),
        fixes: fixesOf(p.mechanics_fixes),
      },
      thinking: { score: thinking, note: noteOf(p.thinking_note) },
    };
    const total =
      comprehension != null && mechanics != null && thinking != null
        ? comprehension + mechanics + thinking
        : null;
    const graded = total != null;
    // Pass on the total, not each part: a strong dimension can carry a weak one.
    const meetsStandard = total != null && total >= ESSAY_PASS_MIN;
    return { graded, meetsStandard, total, scores, notes: noteOf(p.notes) };
  } catch (err) {
    console.error(
      "[reading/quiz-grade] Essay grade failed:",
      err instanceof Error ? err.message : String(err)
    );
    return ungraded();
  }
}
