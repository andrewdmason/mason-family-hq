import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import type { EssayRubric } from "@/lib/types";

/**
 * Generating two-part essay assignments from a slice of book text. Pure and
 * self-contained (no Supabase, no auth) so the same call powers the manual
 * "Generate quiz" action, the automatic per-check-in job (ensureStretchQuiz), and
 * the parent steering regeneration (quiz-steer.ts). One forced tool call, defensive
 * parsing, resilient to failure (returns an empty set rather than throwing).
 *
 * Each assignment is a TWO-PART exercise:
 *   Part 1 (comprehension) — a short prompt, answerable in a sentence or two, that
 *   proves the child read the assigned pages. It's a light gate, not the point.
 *   Part 2 (the real work) — a longer, personal question that takes a theme from
 *   the reading as a launching pad and connects it to something the child actually
 *   cares about (from their Present profile), so writing becomes a way to think
 *   through something useful to them, not a book report.
 *
 * We generate THREE distinct candidates in one call; a parent curates them down to
 * the one the child writes (see chosen_question_id). Each carries a grader-facing
 * `anchorSummary` (what Part 1 must show) and a `rubric` so grading can ground
 * itself later.
 */

/** How many candidate prompts a generated essay quiz offers the parent to curate. */
export const ESSAY_OPTION_COUNT = 3;

/** One candidate two-part essay prompt with the grader-facing detail it grades against. */
export type GeneratedEssayOption = {
  /** Part 1: the short comprehension prompt that proves the child read the pages. */
  comprehensionPrompt: string;
  /** Part 2: the longer personal question (bridges a book theme to the child's life). */
  prompt: string;
  /** Grader-facing: the reading detail Part 1's answer must demonstrate. */
  anchorSummary: string | null;
  /** The rubric to grade this prompt against (comprehension gate + Part 2 dimensions). */
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
    `Report ${ESSAY_OPTION_COUNT} DISTINCT two-part essay assignments. Each has a ` +
    "short Part 1 that proves the child read the pages and a longer Part 2 that " +
    "connects a theme from the reading to something the child cares about — plus, " +
    "per assignment, the grader-facing anchor and a rubric.",
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
          `Exactly ${ESSAY_OPTION_COUNT} distinct two-part assignments. They must take ` +
          "genuinely different angles — different anchoring moments AND different Part 2 " +
          "themes/connections, not reworded versions of one idea.",
        minItems: ESSAY_OPTION_COUNT,
        maxItems: ESSAY_OPTION_COUNT,
        items: {
          type: "object",
          properties: {
            comprehension_prompt: {
              type: "string",
              description:
                "Part 1, shown to the child: a SHORT question they can answer in a " +
                "sentence or two, asking what happened in these pages or about a specific " +
                "moment they could only know if they read them. Its whole job is to prove " +
                "they did the reading — keep it quick and concrete, not an essay.",
            },
            prompt: {
              type: "string",
              description:
                "Part 2, shown to the child: the real writing. Take a theme, idea, or " +
                "question raised by the reading and use it as a launching point to ask the " +
                "child something genuinely interesting to THEM and useful to think through — " +
                "tied to their own life, interests, or goals (see the reader profile). This " +
                "is where the thinking happens; it may connect only loosely to the book. Warm, " +
                "open, 1–3 plain sentences. Do NOT mention word count, length, or grading.",
            },
            anchor_summary: {
              type: "string",
              description:
                "Teacher-facing, NEVER shown to the child: the specific reading detail or " +
                "moment Part 1's answer must demonstrate, so a grader can verify the child " +
                "actually read the assigned pages. One or two sentences.",
            },
            rubric: {
              type: "object",
              description:
                "What a grader should look for on THIS assignment, pitched to the child's age.",
              properties: {
                comprehension: {
                  type: "string",
                  description:
                    "The bar for the Part 1 gate — what the child's short answer must show " +
                    "to prove they read (matches the anchor). A low, easy-to-clear bar.",
                },
                mechanics: {
                  type: "string",
                  description:
                    "The grammar, spelling, punctuation, paragraphing, and structure " +
                    "expected of a writer this age, judged on the Part 2 writing.",
                },
                thinking: {
                  type: "string",
                  description:
                    "What strong thinking looks like in Part 2 — originality, depth, honesty, " +
                    "and how well ideas are supported. Reward real reflection over length.",
                },
              },
              required: ["comprehension", "mechanics", "thinking"],
            },
          },
          required: ["comprehension_prompt", "prompt", "anchor_summary", "rubric"],
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
  steeringNote?: string | null;
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
      `About this reader — use this to make Part 2 genuinely connect to their real ` +
        `life, interests, and goals:\n${input.readerContext}\n` +
        `Part 2 SHOULD reach for something that matters to this specific child (a passion, ` +
        `a goal they're chasing, a question they'd actually care about) and use a theme from ` +
        `the reading as the launching point. Vary the connection across the three so it's a ` +
        `real choice, and keep it honest — a connection that feels natural beats a forced one.`
    );
  } else {
    parts.push(
      `You don't have a profile for this reader, so let Part 2 pose a broadly relatable, ` +
        `age-appropriate question that a child could genuinely enjoy thinking through — still ` +
        `launched from a theme in the reading.`
    );
  }
  parts.push(
    `Write ${ESSAY_OPTION_COUNT} DISTINCT two-part assignments the parent will choose ` +
      `between. They must take genuinely different angles — different anchoring moments AND ` +
      `different Part 2 questions/connections. For EACH:\n` +
      `• Part 1 (comprehension_prompt): one short question, answerable in a sentence or two, ` +
      `asking what happened in ${label} or about a specific detail the child could only know ` +
      `if they read it. Its only job is to prove they did the reading — keep it quick.\n` +
      `• Part 2 (prompt): the real writing. Take a theme or idea from the reading and use it ` +
      `as a springboard to ask the child something interesting and useful to THEM to think ` +
      `through — connected to their own life, interests, or goals. It's fine if the tie to the ` +
      `book is loose; the point is honest thinking, not book analysis. 1–3 plain sentences.\n` +
      `Base each Part 1 anchor strictly on the text below. Do NOT number the parts inside a ` +
      `field, and do NOT mention word count, length, or grading — put grading criteria only ` +
      `in the rubric.`
  );
  if (input.steeringNote) parts.push(input.steeringNote);
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

/** Coerce one tool-reported assignment into an option, or null if unusable. Both
 *  parts must be present — an assignment missing either is not a valid two-parter. */
function sanitizeOption(raw: unknown): GeneratedEssayOption | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const comprehensionPrompt = asString(r.comprehension_prompt);
  const prompt = asString(r.prompt);
  if (!comprehensionPrompt || !prompt) return null;
  return {
    comprehensionPrompt,
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
 * Ask the model to write the candidate two-part essay prompts over the given text.
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
  /** Prior parent↔AI steering turns, prepended as conversation on a regeneration. */
  priorTurns?: { role: "user" | "assistant"; content: string }[];
  /** A steering instruction (current candidates + the parent's latest guidance),
   *  appended to the prompt when a parent is refining the candidates. */
  steeringNote?: string | null;
}): Promise<GeneratedEssaySet> {
  if (!input.text.trim()) return emptySet(input.minWords);

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 3000,
      system:
        `You are a thoughtful English teacher who designs ${ESSAY_OPTION_COUNT} short ` +
        "two-part writing assignments for a child partway through a book, so a parent can " +
        "pick the one that best fits their kid. Part 1 is a quick comprehension check — a " +
        "sentence or two proving the child read the exact pages. Part 2 is the real work: " +
        "you take a theme from the reading and use it as a launching point to ask the child " +
        "something genuinely interesting and useful to THEM — tied to their own life, " +
        "interests, or goals — so that writing becomes a way to think clearly about something " +
        "that matters to them, not a book report. The Part 2 tie to the book can be loose; " +
        "honest thinking matters more than sticking to the plot. The three assignments must " +
        "be genuinely different from one another. You never mention word counts or how the " +
        "work will be graded, and never reference or spoil anything beyond the assigned pages.",
      tools: [REPORT_ESSAY_TOOL],
      tool_choice: { type: "tool", name: REPORT_ESSAY_TOOL.name },
      messages: [
        ...(input.priorTurns ?? []),
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
            steeringNote: input.steeringNote ?? null,
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
