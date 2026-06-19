import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import type { EssayRubric } from "@/lib/types";

/**
 * Generating longform-essay assignments from a slice of book text. Pure and
 * self-contained (no Supabase, no auth) so the same call powers the manual
 * "Generate quiz" action today and the automatic per-check-in job (ensureStretchQuiz).
 * Mirrors the recommend.ts pattern: one forced tool call, defensive parsing,
 * resilient to failure (returns an empty set rather than throwing).
 *
 * We generate THREE distinct prompts in a single call (the reader picks one and
 * commits before writing — see chosen_question_id). One call beats three so the
 * model can make them genuinely different angles, not three rewordings. Each
 * prompt is ONE flowing question with two parts of a whole: it opens by requiring
 * a concrete detail from the assigned pages (so it doubles as proof the child did
 * the reading — the "anchor"), then widens into a broader theme that rewards
 * original thinking. Each carries its own teacher-facing `anchorSummary` and
 * three-dimension `rubric` so grading the chosen one can ground itself later.
 */

/** How many candidate prompts a generated essay quiz offers the reader. */
export const ESSAY_OPTION_COUNT = 3;

/** One candidate essay prompt with the grader-facing detail it grades against. */
export type GeneratedEssayOption = {
  /** The single flowing essay prompt (anchor → broader theme). */
  prompt: string;
  /** Grader-facing: the specific reading detail the opening must demonstrate. */
  anchorSummary: string | null;
  /** The three-dimension rubric to grade this prompt against. */
  rubric: EssayRubric | null;
};

export type GeneratedEssaySet = {
  /** A short label for the assignment, e.g. "Pages 130–180". Shared by the set. */
  title: string | null;
  /**
   * The candidate prompts. Either ESSAY_OPTION_COUNT valid options or empty on
   * failure (so the caller leaves a retryable draft rather than a partial quiz).
   */
  options: GeneratedEssayOption[];
  /** The soft minimum word count, passed in by the caller (age/settings driven). */
  minWords: number;
};

const REPORT_ESSAY_TOOL = {
  name: "report_essay_assignments",
  description:
    `Report ${ESSAY_OPTION_COUNT} DISTINCT longform-essay prompts for the child to ` +
    "choose from. Each is a single flowing prompt that opens by requiring a concrete " +
    "detail from the assigned pages, then widens into a broader theme — plus, per " +
    "prompt, the grader-facing anchor and a three-part rubric.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          'A short label for the assignment, e.g. "Pages 130–180" or "Through page 84". ' +
          "Shared by all the prompts (it labels the page range, not any one prompt).",
      },
      assignments: {
        type: "array",
        description:
          `Exactly ${ESSAY_OPTION_COUNT} distinct essay prompts the child will choose ` +
          "between. They must take genuinely different angles — different anchoring " +
          "moments and different broader themes, not reworded versions of one idea.",
        minItems: ESSAY_OPTION_COUNT,
        maxItems: ESSAY_OPTION_COUNT,
        items: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "The single essay prompt the child reads — ONE short, flowing question of " +
                "about 2–3 plain sentences (two parts of a whole, never numbered sub-" +
                "questions). First ask them to write about a specific moment or detail from " +
                "the assigned pages that they could only know if they read them, then open " +
                "into a broader theme that needs real, creative thinking — not plot recap. " +
                "Warm, brief, and age-appropriate. Do NOT mention word count, length, or how " +
                "it will be graded — that lives elsewhere.",
            },
            anchor_summary: {
              type: "string",
              description:
                "Teacher-facing, NEVER shown to the child: the specific reading detail or " +
                "moment THIS prompt's opening must demonstrate, so a grader can verify the " +
                "child actually read the assigned pages. One or two sentences.",
            },
            rubric: {
              type: "object",
              description:
                "What a grader should look for on THIS prompt, each pitched to the child's age.",
              properties: {
                comprehension: {
                  type: "string",
                  description:
                    "What the essay must show about understanding the reading — that the " +
                    "opening reflects the anchor and the essay stays accurate to the book.",
                },
                mechanics: {
                  type: "string",
                  description:
                    "The grammar, spelling, punctuation, paragraphing, and structure " +
                    "expected of a writer this age.",
                },
                thinking: {
                  type: "string",
                  description:
                    "What strong thinking looks like here — originality, depth, and how " +
                    "well ideas are supported. Reward insight over length.",
                },
              },
              required: ["comprehension", "mechanics", "thinking"],
            },
          },
          required: ["prompt", "anchor_summary", "rubric"],
        },
      },
    },
    required: ["assignments"],
  },
};

function rangeLabel(fromPage: number | null, throughPage: number): string {
  return fromPage != null && fromPage > 1
    ? `pages ${fromPage}–${throughPage}`
    : `through page ${throughPage}`;
}

function buildPrompt(input: {
  bookTitle: string;
  author: string | null;
  fromPage: number | null;
  throughPage: number;
  readerAge: number | null;
  readerContext: string | null;
  text: string;
}): string {
  const ranged = input.fromPage != null && input.fromPage > 1;
  const label = rangeLabel(input.fromPage, input.throughPage);
  const parts: string[] = [];
  parts.push(
    `Book: "${input.bookTitle}"${input.author ? ` by ${input.author}` : ""}.`
  );
  if (ranged) {
    parts.push(
      `This assignment covers ONLY ${label} of the book. The text below is exactly ` +
        `that stretch. Every anchor must come from within it — do NOT reference earlier ` +
        `pages, and do NOT reference, hint at, or spoil anything after page ${input.throughPage}.`
    );
  } else {
    parts.push(
      `This assignment covers the book from the very beginning THROUGH page ${input.throughPage} ` +
        `(cumulative). The reader has only read up to that point — do NOT reference, hint ` +
        `at, or spoil anything that happens later in the book.`
    );
  }
  if (input.readerAge != null) {
    parts.push(
      `The reader is ${input.readerAge} years old. Pitch the prompts, vocabulary, and ` +
        `rubrics for that age.`
    );
  }
  if (input.readerContext) {
    parts.push(
      `A little about this reader, ONLY so a broader theme can feel relevant when ` +
        `it fits naturally:\n${input.readerContext}\n` +
        `Use this sparingly. Do NOT center the prompts on the reader's main hobby or ` +
        `favorite topic, and vary your themes — a theme that genuinely fits the reading ` +
        `is always better than a forced personal connection.`
    );
  }
  parts.push(
    `Write ${ESSAY_OPTION_COUNT} DISTINCT essay prompts the child will choose between. ` +
      `The prompts must take genuinely different angles — different anchoring moments from ` +
      `the reading and different broader themes — so the choice is a real one, not three ` +
      `versions of the same question. Shape EACH prompt as a single, flowing question — ` +
      `two parts of a whole, not separate numbered questions, and as few words as you can ` +
      `manage. Part one (the anchor): in one sentence, ask the child to write about a ` +
      `specific moment or detail from ${label} that they could only know if they did the ` +
      `reading. Part two: in one or two more sentences, open into a broader theme that asks ` +
      `them to reflect, connect, or imagine — something that needs real thinking, not ` +
      `summary. Base each anchor strictly on the text below. Keep each prompt to about 2–3 ` +
      `short, plain sentences the reader can hold in their head, and do NOT mention word ` +
      `count, length, or how it will be graded — put grading criteria only in the rubric.`
  );
  parts.push(`Call report_essay_assignments exactly once.`);
  parts.push(`--- BOOK TEXT (${label}) ---\n${input.text}`);
  return parts.join("\n\n");
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Coerce the model's rubric object into our three-string shape, or null. */
function sanitizeRubric(raw: unknown): EssayRubric | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const comprehension = asString(r.comprehension);
  const mechanics = asString(r.mechanics);
  const thinking = asString(r.thinking);
  if (!comprehension && !mechanics && !thinking) return null;
  return {
    comprehension: comprehension ?? "",
    mechanics: mechanics ?? "",
    thinking: thinking ?? "",
  };
}

/** Coerce one tool-reported assignment into an option, or null if unusable. */
function sanitizeOption(raw: unknown): GeneratedEssayOption | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const prompt = asString(r.prompt);
  if (!prompt) return null;
  return {
    prompt,
    anchorSummary: asString(r.anchor_summary),
    rubric: sanitizeRubric(r.rubric),
  };
}

const emptySet = (minWords: number): GeneratedEssaySet => ({
  title: null,
  options: [],
  minWords,
});

/**
 * Ask the model to write the candidate essay prompts over the given text.
 * Resilient: any failure (API error, malformed output, fewer than
 * ESSAY_OPTION_COUNT usable prompts) resolves to an empty set so the caller can
 * surface "couldn't generate — try again" and leave a retryable draft.
 */
export async function generateEssayAssignments(input: {
  bookTitle: string;
  author: string | null;
  fromPage?: number | null;
  throughPage: number;
  text: string;
  readerAge?: number | null;
  readerContext?: string | null;
  minWords: number;
}): Promise<GeneratedEssaySet> {
  if (!input.text.trim()) return emptySet(input.minWords);

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 3000,
      system:
        `You are a thoughtful English teacher who designs ${ESSAY_OPTION_COUNT} short ` +
        "essay prompts for a child partway through a book, so the child can pick the one " +
        "that sparks them. Every prompt opens by requiring a concrete detail from the exact " +
        "pages the child just read — so it doubles as proof they did the reading — then " +
        "widens into a broader theme that rewards original thinking, not plot summary. The " +
        "prompts must be genuinely different from one another: different anchoring moments " +
        "and different themes. You write each as a single warm, flowing prompt of just a " +
        "couple of plain sentences a child can hold in their head — never separate numbered " +
        "questions, never padding. You never mention word counts or how the work will be " +
        "graded, and never reference or spoil anything beyond the assigned pages.",
      tools: [REPORT_ESSAY_TOOL],
      tool_choice: { type: "tool", name: REPORT_ESSAY_TOOL.name },
      messages: [
        {
          role: "user",
          content: buildPrompt({
            bookTitle: input.bookTitle,
            author: input.author,
            fromPage: input.fromPage ?? null,
            throughPage: input.throughPage,
            readerAge: input.readerAge ?? null,
            readerContext: input.readerContext ?? null,
            text: input.text,
          }),
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return emptySet(input.minWords);

    const parsed = toolUse.input as { title?: unknown; assignments?: unknown };
    const rawOptions = Array.isArray(parsed.assignments) ? parsed.assignments : [];
    const options = rawOptions
      .map(sanitizeOption)
      .filter((o): o is GeneratedEssayOption => o != null);

    // Demand the full set — anything short is treated as a generation failure so the
    // owner regenerates rather than shipping a thinner choice than promised.
    if (options.length < ESSAY_OPTION_COUNT) return emptySet(input.minWords);

    return {
      title: asString(parsed.title),
      options: options.slice(0, ESSAY_OPTION_COUNT),
      minWords: input.minWords,
    };
  } catch (err) {
    console.error(
      "[reading/quiz-generate] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return emptySet(input.minWords);
  }
}
