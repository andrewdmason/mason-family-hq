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
        description:
          "One short sentence spoken DIRECTLY to the writer as \"you\", and make it " +
          "directive — tell them what to do in the next version, not just what's " +
          "wrong. If they met the standard, name what landed (\"You set the opening " +
          "up clearly — I could tell exactly what happened.\"). If not, give a " +
          "\"Try …\" that points them at what to reread or add WITHOUT handing over " +
          "the answer (\"Try opening by retelling what actually happens when Thresh " +
          "lets her go — walk me through that moment.\"). Point them using words they'll " +
          "recognize — \"the opening of your essay,\" \"the start of the reading,\" or the " +
          "character or moment by name — and NEVER invent a reference like \"Entry #1,\" a " +
          "section or figure label, or a page number; the writer has no such markers and " +
          "won't know what you mean.",
      },
      mechanics_score: {
        type: "integer",
        description:
          "1–4 for spelling, capitalization, punctuation, sentence completeness, and " +
          "paragraphing at this child's age — NOT word choice, phrasing, or style " +
          "(those are never penalized here). Same scale (3 = meets the grade-level " +
          "standard). Be forgiving and judge the writing as a whole: a 3 just means " +
          "the essay is easy to read — mostly-complete sentences, real paragraphs, " +
          "spelling and end punctuation mostly right. A handful of ordinary slips " +
          "(some misspellings, a missed capital, a couple of run-ons, a 'to'/'too' " +
          "mix-up) are completely fine at a 3 for a child; a clean essay is a 4. " +
          "Optional or stylistic commas are JUDGMENT CALLS, not errors — never lower " +
          "the score for a comma that isn't strictly required. Reserve a 2 or below " +
          "for writing that's genuinely hard to follow (errors in most sentences) or " +
          "a single undivided block with no paragraph breaks (which can't exceed 2). " +
          "CRITICAL: the score must agree with the fix-it checklist below, which is the " +
          "ONLY mechanics feedback the writer sees. If the checklist is empty there is " +
          "nothing left to correct, so the score is 4 — NEVER give a 3 (or lower) with an " +
          "empty checklist. A 3 means it reads fine but still has a few specific errors, " +
          "and you must list every one of them; if a problem is structural (no paragraph " +
          "breaks), put that in the checklist too and cap the score at 2.",
      },
      mechanics_fixes: {
        type: "array",
        items: { type: "string" },
        description:
          "A short, do-this checklist of the CLEAR mechanical errors only — " +
          "misspellings, missing or wrong capitals, missing end punctuation, comma " +
          "splices or genuine run-ons. For each, quote the exact text, give the " +
          "correction, and add a few words on the rule — e.g. \"'thank her to' → " +
          "'thank her too' — 'too' means 'also.'\" or \"Capitalize the name: 'thresh' " +
          "→ 'Thresh.'\" HARD LIMITS: do NOT list word-choice or phrasing suggestions " +
          "(e.g. 'pointing a rock' → 'holding a rock' is style, not a mechanics error " +
          "— leave it out); do NOT list optional or stylistic commas, or any " +
          "'consider…' nitpick you aren't sure is a real error — when in doubt, leave " +
          "it off. Keep the list to the few that genuinely matter so the child can fix " +
          "them and be done, not face a fresh batch of smaller nits every revision. " +
          "Here you DO correct the writing directly (unlike the other dimensions). This " +
          "checklist is the ENTIRE justification for any mechanics score below 4, so it " +
          "must capture every reason it isn't a 4 — including a structural fix (\"Break " +
          "this into paragraphs: start a new one each time you move to a new idea.\") when " +
          "paragraphing is the problem. Return an empty array ONLY when the writing is " +
          "genuinely clean — and an empty array means the mechanics score is 4.",
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
        description:
          "One short sentence spoken DIRECTLY to the writer as \"you\", and make it " +
          "directive. If they met the standard, name what worked. If not, push them " +
          "with a \"Try …\" that tells them what to do next — e.g. \"Try pushing this " +
          "further: pick one moment from the book and show why it backs up your idea.\" " +
          "Coach toward the thinking; never write the analysis for them.",
      },
    },
    required: [
      "comprehension_score",
      "comprehension_note",
      "mechanics_score",
      "mechanics_fixes",
      "thinking_score",
      "thinking_note",
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
  /** This attempt's number (1 = first try, 2+ = a revision), so the grader can
   *  reward progress rather than re-judging each draft from scratch. */
  attemptNumber?: number | null;
  /** The previous draft and its per-dimension scores, for the same reason. */
  priorEssay?: string | null;
  priorScores?: EssayRubricScores | null;
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

  // On a revision, give the grader the previous draft and its scores so it can
  // reward genuine progress instead of re-critiquing from scratch and surfacing a
  // fresh batch of ever-smaller nitpicks each round.
  const attempt = input.attemptNumber ?? 1;
  const ps = input.priorScores;
  // The exact feedback the writer was handed last round — so the grader judges this
  // draft as a rework of that one (did they address what you flagged?) rather than
  // re-critiquing it from scratch and surfacing a fresh batch of smaller nitpicks.
  const priorFixes = ps?.mechanics.fixes?.length
    ? ps.mechanics.fixes.map((f) => `    • ${f}`).join("\n") + "\n"
    : "    (none)\n";
  const priorFeedbackBlock = ps
    ? `Last round's grade and the EXACT feedback you gave the writer:\n` +
      `- Comprehension ${ps.comprehension.score ?? "—"}/4: ${ps.comprehension.note || "(no note)"}\n` +
      `- Mechanics ${ps.mechanics.score ?? "—"}/4. Fixes you asked them to make:\n` +
      priorFixes +
      `- Thinking ${ps.thinking.score ?? "—"}/4: ${ps.thinking.note || "(no note)"}\n`
    : "";
  const priorEssayBlock = input.priorEssay?.trim()
    ? `Their PREVIOUS draft (for comparing progress):\n"""\n${input.priorEssay.trim()}\n"""\n\n`
    : "";
  const revisionBlock =
    attempt > 1
      ? `This is revision ${attempt - 1} (attempt ${attempt}), a rework of the draft ` +
        `below.\n${priorFeedbackBlock}\n` +
        `Grade this as a revision, not a fresh essay: go through the feedback above ` +
        `and credit what they addressed. If they fixed what you flagged and a ` +
        `dimension is clearly better with only minor or subjective issues left, give ` +
        `it credit and score it 3 (meets standard) — a child who fixes what you ` +
        `flagged should move up, not be held at a 2 by brand-new nitpicks you didn't ` +
        `raise before. Only keep a dimension below 3 if real grade-level problems ` +
        `genuinely remain or your earlier feedback was ignored.\n\n` +
        priorEssayBlock
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
        "developing, 4 is exceptional. Be forgiving on mechanics and grade the writing " +
        "as a whole: a 3 just means the essay is easy to read — mostly-complete " +
        "sentences, broken into paragraphs, spelling and end punctuation mostly right — " +
        "and a handful of ordinary slips (some misspellings, a missed capital, a " +
        "couple of run-ons, a 'to'/'too' mix-up) are completely fine at a 3 for a " +
        "child. Mechanics covers spelling, capitalization, punctuation, sentence " +
        "completeness, and paragraphing ONLY — never word choice, phrasing, or style, " +
        "and never an optional or stylistic comma, which is a judgment call, not an " +
        "error. Reserve a 2 or below for writing that's genuinely hard to follow " +
        "(errors in most sentences) or a single undivided block with no paragraph " +
        "breaks. Expect the broader-theme idea to be genuinely developed, not a thin " +
        "afterthought. When this is a revision, you'll be given the previous draft and " +
        "its scores — reward real improvement: a dimension that's clearly better than " +
        "last time with only minor issues left meets the standard, and a child who " +
        "keeps improving across revisions should be able to pass rather than be held " +
        "down by new, smaller nitpicks. Write each dimension's note as ONE sentence " +
        "spoken DIRECTLY to the writer (\"you\") and make it directive: when they've " +
        "met the standard, say what worked; when they haven't, give a concrete \"Try …\" " +
        "that tells them what to do in the next version. For comprehension and quality " +
        "of thinking, coach toward it — point them to what to reread or push further — " +
        "but never hand them the missing facts, the analysis, or the answer; that " +
        "thinking is theirs to do. When you point them somewhere, name it the way the " +
        "writer will recognize it (\"the opening of your essay,\" \"the part where Leo does " +
        "the nutmeg\") and never invent a reference like \"Entry #1,\" a section or figure " +
        "label, or a page number — they have no such markers. MECHANICS carries NO " +
        "summary sentence: its feedback is the fix-it checklist alone — quote each clear " +
        "error, give the correction outright, and add a few words on the rule, so the " +
        "child can follow the list and learn from it (here you DO correct the writing " +
        "directly). Keep the mechanics score and that checklist in lockstep: an empty " +
        "checklist means a clean essay and scores 4, while a 3 means it reads fine but " +
        "still has a few specific errors that you list — never a 3 with an empty " +
        "checklist. Do not write a separate overall summary — the per-dimension notes " +
        "are the whole of the feedback.",
      tools: [GRADE_ESSAY_TOOL],
      tool_choice: { type: "tool", name: GRADE_ESSAY_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `${ageLine}${lengthLine}${revisionBlock}` +
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

    const mechanicsFixes = fixesOf(p.mechanics_fixes);
    // Mechanics shows only its fix-it checklist, so the score must agree with it: an
    // empty checklist means nothing left to correct and earns full marks — otherwise
    // the reader sees a sub-4 score with no listed reason (which reads as "I fixed
    // everything and still didn't get a 4"). The prompt has the grader list every
    // issue, structural ones included, so an empty list is genuinely a clean essay.
    const mechanicsScore =
      mechanics != null && mechanicsFixes.length === 0 ? 4 : mechanics;

    const scores: EssayRubricScores = {
      comprehension: { score: comprehension, note: noteOf(p.comprehension_note) },
      mechanics: { score: mechanicsScore, note: "", fixes: mechanicsFixes },
      thinking: { score: thinking, note: noteOf(p.thinking_note) },
    };
    const total =
      comprehension != null && mechanicsScore != null && thinking != null
        ? comprehension + mechanicsScore + thinking
        : null;
    const graded = total != null;
    // Pass on the total, not each part: a strong dimension can carry a weak one.
    const meetsStandard = total != null && total >= ESSAY_PASS_MIN;
    return { graded, meetsStandard, total, scores, notes: "" };
  } catch (err) {
    console.error(
      "[reading/quiz-grade] Essay grade failed:",
      err instanceof Error ? err.message : String(err)
    );
    return ungraded();
  }
}
