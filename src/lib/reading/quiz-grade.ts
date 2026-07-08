import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import { essayPassed } from "@/lib/reading/essay-scoring";
import type {
  EssayRubric,
  EssayRubricScores,
  ThinkingBand,
} from "@/lib/types";

/**
 * Grading a submitted quiz. An essay is graded in two moves: the Part 1 comprehension
 * gate is judged on its own (gradeComprehension, when the kid clears it before the
 * essay screen), and the essay itself (gradeEssay) is a single model call scoring one
 * dimension — Quality of Thinking, on a below/meets/exceeds band — behind a pass/fail
 * Grammar readability gate. Legacy multiple-choice is graded deterministically here,
 * and each legacy free-text answer by an independent model call — all isolated so one
 * failure leaves that answer ungraded rather than failing the submission. Pure and
 * self-contained, like quiz-generate.ts.
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
  /** True when the grammar gate is met AND the thinking reaches at least "meets" —
   *  the pass that advances the book (see essay-scoring). */
  meetsStandard: boolean;
  /** The grammar gate + thinking band to store on the answer row. */
  scores: EssayRubricScores;
  /** A warm, holistic note to the child (used for the blank-essay nudge; empty
   *  otherwise, since the per-dimension notes carry the feedback). */
  notes: string;
};

const GRADE_ESSAY_TOOL = {
  name: "grade_essay",
  description:
    "Grade a child's book essay: a pass/fail GRAMMAR readability gate, then the one " +
    "graded dimension — QUALITY OF THINKING on a below/meets/exceeds band.",
  input_schema: {
    type: "object" as const,
    properties: {
      grammar_ok: {
        type: "boolean",
        description:
          "The GRAMMAR GATE — pass/fail, about READABILITY ONLY: are the sentences " +
          "mostly complete, is the spelling and end punctuation mostly right, and is it " +
          "broken into paragraphs? This is exactly the standard 'do errors interfere " +
          "with communication?' — NOT style, word choice, or phrasing (never judged " +
          "here). Be forgiving: a handful of ordinary slips (some misspellings, a missed " +
          "capital, a couple of run-ons, a 'to'/'too' mix-up) still PASSES — those go in " +
          "the fix-it list but don't fail the gate. Return false ONLY when the writing " +
          "is genuinely hard to follow (errors in most sentences) or is a single " +
          "undivided block with no paragraph breaks. Optional or stylistic commas are " +
          "judgment calls, never errors.",
      },
      grammar_fixes: {
        type: "array",
        items: { type: "string" },
        description:
          "A short, do-this checklist of the CLEAR mechanical errors only — " +
          "misspellings, missing or wrong capitals, missing end punctuation, comma " +
          "splices or genuine run-ons, or a structural fix (\"Break this into paragraphs: " +
          "start a new one each time you move to a new idea.\"). For each, quote the exact " +
          "text, give the correction, and add a few words on the rule — e.g. \"'thank her " +
          "to' → 'thank her too' — 'too' means 'also.'\" or \"Capitalize the name: 'thresh' " +
          "→ 'Thresh.'\" This is the child's cleanup list and may be non-empty even when " +
          "grammar_ok is true (a readable essay with a few slips). HARD LIMITS: do NOT " +
          "list word-choice or phrasing suggestions (style, not grammar); do NOT list " +
          "optional/stylistic commas or any 'consider…' nitpick you aren't sure is a real " +
          "error — when in doubt, leave it off. Keep it to the few that genuinely matter " +
          "so the child can fix them and be done. Whenever grammar_ok is false, this list " +
          "MUST name every reason it failed. Return an empty array when the writing is " +
          "genuinely clean.",
      },
      thinking_band: {
        type: "string",
        enum: ["below", "meets", "exceeds"],
        description:
          "THE GRADE — the quality of thinking in the essay, judged at the child's age. " +
          "Part 2 asks the child to take and back up a POINT OF VIEW on something in " +
          "their own life; grade the thinking, never the style, the length, or whether " +
          "they stuck to the book (straying into their own life is encouraged, never " +
          "penalized). \"below\": no real idea of their own — it restates the prompt, " +
          "retells the plot, states a generic platitude ('family is important'), or lists " +
          "things with no thought attached, and has no specific detail from their life or " +
          "the book. \"meets\": an honest effort with a real position or idea of their own, " +
          "made concrete by at least one specific detail (a real moment, person, or " +
          "example) with some connection back to the idea — one point made decently is " +
          "enough; honest and specific beats deep-sounding and vague. \"exceeds\": the " +
          "thinking goes somewhere — genuine insight or nuance for their age, such as " +
          "weighing two sides or a tension, considering a counter-view, showing how their " +
          "own thinking changed ('I used to think… but now…'), an honest admission, or a " +
          "non-obvious connection; one genuinely developed moment of real insight is " +
          "enough. Big vocabulary, extra length, and deep-sounding generalities NEVER " +
          "raise the band — the insight must be in the substance of what they say, not a " +
          "single clever phrase. Calibrate \"exceeds\" as an earnable bar for a strong, " +
          "genuinely-trying kid at this age, not perfection.",
      },
      thinking_note: {
        type: "string",
        description:
          "One or two short sentences spoken DIRECTLY to the writer as \"you\", warm and " +
          "specific. On \"exceeds\" or \"meets\", name what actually worked in their " +
          "thinking. On \"below\", be honest that it's not there yet and encouraging about " +
          "the fix. On a revision, refer back to your last note first — acknowledge what " +
          "they acted on, or say you don't see the change you asked for yet — then give " +
          "the ask. Coach toward the thinking; never write the argument for them.",
      },
      thinking_next: {
        type: "array",
        items: { type: "string" },
        description:
          "A short (2–4 item) do-this checklist of directions, the way a tutor points the " +
          "way WITHOUT writing it for them. Tailor it to the band: on \"below\", concrete " +
          "moves to reach a passing essay — e.g. \"Pick one real thing you actually " +
          "believe about this and say it in a sentence,\" \"Add one true example from your " +
          "own life that shows why,\" \"Explain what that example proves.\" On \"meets\", " +
          "specific ways to push it to \"exceeds\" for the bonus — e.g. \"Add the other " +
          "side: when might the opposite be true?\", \"Show a moment that complicates your " +
          "point,\" \"Say whether your view changed as you thought it through.\" On " +
          "\"exceeds\", 1–2 short bullets naming what made the thinking land, so they know " +
          "what to repeat. Suggest directions and questions to explore — never hand over " +
          "the actual idea, example, or answer.",
      },
    },
    required: ["grammar_ok", "grammar_fixes", "thinking_band", "thinking_next"],
  },
};

/** Coerce a raw band to a ThinkingBand, or null if unusable. */
function toBand(v: unknown): ThinkingBand | null {
  return v === "below" || v === "meets" || v === "exceeds" ? v : null;
}

const ungraded = (): EssayGrade => ({
  graded: false,
  meetsStandard: false,
  scores: {
    grammar: { met: null, note: "" },
    thinking: { band: null, note: "" },
  },
  notes: "",
});

/**
 * Grade one essay: a pass/fail grammar readability gate plus the one graded dimension,
 * quality of thinking, on a below/meets/exceeds band. A blank essay short-circuits to
 * a graded fail (no API call). Any API/parse failure resolves to an ungraded result so
 * the caller records it without failing the submission. "Meets standard" — the pass
 * that advances the book — means grammar passed AND the thinking reaches at least
 * "meets" (below that is "close, but revise and resubmit").
 */
export async function gradeEssay(input: {
  /** Part 2 prompt (the point-of-view question). */
  prompt: string;
  rubric: EssayRubric | null;
  /** The essay that carries the grade. */
  essay: string;
  readerAge?: number | null;
  minWords?: number | null;
  /** This attempt's number (1 = first try, 2+ = a revision), so the grader can
   *  reward progress rather than re-judging each draft from scratch. */
  attemptNumber?: number | null;
  /** The previous draft and its scores, for the same reason. */
  priorEssay?: string | null;
  priorScores?: EssayRubricScores | null;
}): Promise<EssayGrade> {
  if (!input.essay.trim()) {
    return {
      graded: true,
      meetsStandard: false,
      scores: {
        grammar: { met: null, note: "", fixes: [] },
        thinking: { band: "below", note: "There's nothing written yet.", next: [] },
      },
      notes: "You left the essay blank — give it a real try and resubmit!",
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

  // On a revision, give the grader the previous draft and its grade so it can reward
  // genuine progress instead of re-critiquing from scratch and surfacing a fresh batch
  // of ever-smaller nitpicks each round.
  const attempt = input.attemptNumber ?? 1;
  const ps = input.priorScores;
  // The exact feedback the writer was handed last round — so the grader judges this
  // draft as a rework of that one (did they address what you flagged?).
  const priorFixes = ps?.grammar.fixes?.length
    ? ps.grammar.fixes.map((f) => `    • ${f}`).join("\n") + "\n"
    : "    (none)\n";
  const priorNext = ps?.thinking.next?.length
    ? ps.thinking.next.map((f) => `    • ${f}`).join("\n") + "\n"
    : "    (none)\n";
  const priorGrammar =
    ps?.grammar.met === true
      ? "passed"
      : ps?.grammar.met === false
        ? "failed"
        : "—";
  const priorFeedbackBlock = ps
    ? `Last round's grade and the EXACT feedback you gave the writer:\n` +
      `- Grammar gate: ${priorGrammar}. Cleanup list you gave them:\n` +
      priorFixes +
      `- Thinking: ${ps.thinking.band ?? "—"}. ${ps.thinking.note || "(no note)"}\n` +
      `  Directions you gave them to improve:\n` +
      priorNext
    : "";
  const priorEssayBlock = input.priorEssay?.trim()
    ? `Their PREVIOUS draft (for comparing progress):\n"""\n${input.priorEssay.trim()}\n"""\n\n`
    : "";
  const revisionBlock =
    attempt > 1
      ? `This is revision ${attempt - 1} (attempt ${attempt}), a rework of the draft ` +
        `below.\n${priorFeedbackBlock}\n` +
        `Grade this as a revision, not a fresh essay: go through the feedback above and ` +
        `credit what they addressed. If they took your directions and the thinking is ` +
        `clearly better, move the band up — a child who does what you asked should rise, ` +
        `not be held down by brand-new nitpicks you didn't raise before. Only keep the ` +
        `band where it was if the real problem genuinely remains or your earlier ` +
        `guidance was ignored. Your notes must read like an ongoing conversation across ` +
        `revisions, not a fresh first reaction each time. When the thinking is basically ` +
        `unchanged because they did NOT act on what you asked, say so plainly: name the ` +
        `guidance you already gave and that you don't see it reflected yet, THEN repeat ` +
        `the ask. When they clearly did act on it, acknowledge that too ("You took my ` +
        `note about … — nice work"). Refer back to your prior guidance the way a tutor ` +
        `who remembers the last session would.\n\n` +
        priorEssayBlock
      : "";

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 1024,
      system:
        "You are an encouraging but honest middle-school English teacher grading a " +
        "child's book essay. The essay asks the child to take a theme from their reading " +
        "as a launching point and think through and articulate a POINT OF VIEW on " +
        "something that matters in their own life — school, sports, friends, a goal. It " +
        "is NOT a literary analysis; the child is meant to make and back up a claim of " +
        "their own, and straying into their own life is encouraged, never penalized. You " +
        "produce TWO things. FIRST, a pass/fail GRAMMAR gate — readability ONLY: are the " +
        "sentences mostly complete, spelling and end punctuation mostly right, and is it " +
        "broken into paragraphs? Be forgiving — ordinary slips still pass (they go in the " +
        "cleanup list, they don't fail the gate); fail it only when errors genuinely get " +
        "in the way of understanding or there are no paragraph breaks at all. Grammar is " +
        "NEVER about style, word choice, or phrasing. SECOND, the real grade — QUALITY OF " +
        "THINKING on a below/meets/exceeds band, judged at the child's age. \"below\": no " +
        "real idea of their own (restates the prompt, retells the plot, a generic " +
        "platitude, or a list with no thought) and no specific detail. \"meets\": an honest " +
        "effort with a real position or idea of their own, made concrete by at least one " +
        "specific detail (a real moment, person, or example) connected back to the idea — " +
        "one point made decently is enough. \"exceeds\": the thinking goes somewhere — " +
        "genuine insight or nuance for their age, like weighing two sides or a tension, " +
        "answering a counter-view, showing how their thinking changed, an honest " +
        "admission, or a non-obvious connection; one genuinely developed moment of " +
        "insight is enough. NEVER let big vocabulary, extra length, or deep-sounding " +
        "generalities raise the band — the insight must live in the substance of what " +
        "they say, not one clever phrase. Calibrate \"exceeds\" as a real, earnable bar " +
        "for a strong, genuinely-trying kid, not perfection. Speak all notes and " +
        "directions DIRECTLY to the writer as \"you\", warm and specific, and coach toward " +
        "the thinking — point them at what to try or push on, but NEVER write the idea, " +
        "the example, or the argument for them (that thinking is theirs). When you point " +
        "somewhere, name it the way they'll recognize it (\"the opening of your essay\") " +
        "and never invent a reference like \"Entry #1,\" a section label, or a page number " +
        "— they have no such markers. On a revision you'll get the previous draft and the " +
        "exact feedback you gave; reward real improvement and sound like the same tutor " +
        "continuing the conversation. The grammar cleanup list corrects the writing " +
        "directly; the thinking note and directions only guide.",
      tools: [GRADE_ESSAY_TOOL],
      tool_choice: { type: "tool", name: GRADE_ESSAY_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `${ageLine}${lengthLine}${revisionBlock}` +
            `The writing prompt the child answered (they take and back up a point of ` +
            `view on their own life):\n${input.prompt}\n\n` +
            `Rubric:\n` +
            `- Grammar (readability gate): ${input.rubric?.grammar || "(use your judgment)"}\n` +
            `- Thinking: ${input.rubric?.thinking || "(use your judgment)"}\n\n` +
            `The child's essay:\n"""\n${input.essay.trim()}\n"""\n\n` +
            `Grade it and call grade_essay exactly once.`,
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return ungraded();

    const p = toolUse.input as Record<string, unknown>;
    const grammarOk = typeof p.grammar_ok === "boolean" ? p.grammar_ok : null;
    const band = toBand(p.thinking_band);
    const noteOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const listOf = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
        : [];

    const scores: EssayRubricScores = {
      grammar: { met: grammarOk, note: "", fixes: listOf(p.grammar_fixes) },
      thinking: {
        band,
        note: noteOf(p.thinking_note),
        next: listOf(p.thinking_next),
      },
    };
    // Graded only when both parts came back usable; "meets standard" (the pass) is
    // grammar gate met AND thinking at meets-or-above.
    const graded = grammarOk != null && band != null;
    const meetsStandard = essayPassed(scores);
    return { graded, meetsStandard, scores, notes: "" };
  } catch (err) {
    console.error(
      "[reading/quiz-grade] Essay grade failed:",
      err instanceof Error ? err.message : String(err)
    );
    return ungraded();
  }
}

export type ComprehensionGrade = {
  /** null = couldn't grade (API failure); the caller keeps the gate uncleared. */
  met: boolean | null;
  /** A short note: an affirmation on a pass, or a directive "Try …" hint on a miss. */
  note: string;
};

const GRADE_COMPREHENSION_TOOL = {
  name: "grade_comprehension",
  description:
    "Judge whether a child's short Part 1 answer proves they read the assigned pages.",
  input_schema: {
    type: "object" as const,
    properties: {
      met: {
        type: "boolean",
        description:
          "Did the child prove, in their short answer, that they actually read the " +
          "assigned pages (judged against the anchor)? This is a LOW, easy-to-clear " +
          "bar — true whenever the answer shows real knowledge of what happened, IN THE " +
          "CHILD'S OWN WORDS (an accurate paraphrase fully counts; never require quotes). " +
          "Return false ONLY when the answer is blank, plainly wrong, or so vague it " +
          "could have been written without reading. A short but correct answer passes — " +
          "never penalize brevity.",
      },
      note: {
        type: "string",
        description:
          "One short sentence spoken DIRECTLY to the child as \"you\". If met, a quick " +
          "affirmation (\"You showed me you read it — I could tell exactly what " +
          "happened.\"). If not met, a directive \"Try …\" that points them at what to " +
          "reread WITHOUT handing over the answer (\"Try telling me in a sentence what " +
          "actually happens when Thresh lets her go.\"). NEVER invent a reference like " +
          "\"Entry #1,\" a section label, or a page number; the child has no such markers.",
      },
    },
    required: ["met", "note"],
  },
};

/**
 * Grade the Part 1 comprehension gate on its own — the quick pass/fail check the child
 * clears before the essay screen opens. A blank answer short-circuits to a miss (no
 * API call). Any API/parse failure resolves to { met: null } so the caller leaves the
 * gate uncleared and lets them try again rather than failing hard.
 */
export async function gradeComprehension(input: {
  prompt: string;
  anchorSummary: string;
  rubric?: string | null;
  answer: string;
  readerAge?: number | null;
}): Promise<ComprehensionGrade> {
  if (!input.answer.trim()) {
    return {
      met: false,
      note: "Give it a try — a sentence or two on what happened in these pages.",
    };
  }

  const ageLine =
    input.readerAge != null
      ? `The child is ${input.readerAge} years old; judge at that level.\n`
      : "";

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 256,
      system:
        "You are a kind reading teacher running a quick comprehension check. The child " +
        "answers a short question to prove they read the assigned pages. It's a LOW, " +
        "easy-to-clear pass/fail gate: pass whenever the answer shows real knowledge of " +
        "what happened in the child's own words (a paraphrase fully counts; never require " +
        "quotes; a short answer still passes). Fail only when it's blank, plainly wrong, " +
        "or so vague it needed no reading. Then write one short sentence to the child: an " +
        "affirmation on a pass, or a directive \"Try …\" hint on a miss that points them " +
        "to reread without giving away the answer.",
      tools: [GRADE_COMPREHENSION_TOOL],
      tool_choice: { type: "tool", name: GRADE_COMPREHENSION_TOOL.name },
      messages: [
        {
          role: "user",
          content:
            `${ageLine}The question (shown to the child): ${input.prompt}\n\n` +
            `What the answer must show they read (anchor — teacher-facing, do NOT repeat ` +
            `it to the child): ${input.anchorSummary || "(none provided)"}\n\n` +
            `The bar for a pass: ${input.rubric || "(use your judgment)"}\n\n` +
            `The child's answer: "${input.answer.trim()}"\n\n` +
            `Judge it and call grade_comprehension exactly once.`,
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { met: null, note: "" };
    const p = toolUse.input as { met?: unknown; note?: unknown };
    const met = typeof p.met === "boolean" ? p.met : null;
    const note = typeof p.note === "string" ? p.note.trim() : "";
    return { met, note };
  } catch (err) {
    console.error(
      "[reading/quiz-grade] Comprehension grade failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { met: null, note: "" };
  }
}
