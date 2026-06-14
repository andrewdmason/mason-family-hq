import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import type { EssayRubric } from "@/lib/types";

/**
 * Generating a longform-essay assignment from a slice of book text. Pure and
 * self-contained (no Supabase, no auth) so the same call powers the manual
 * "Generate quiz" action today and the automatic per-check-in job (ensureStretchQuiz).
 * Mirrors the recommend.ts pattern: one forced tool call, defensive parsing,
 * resilient to failure (returns an empty essay rather than throwing).
 *
 * The essay is ONE flowing prompt with two parts of a whole: it opens by
 * requiring a concrete detail from the assigned pages (so it doubles as proof the
 * child did the reading — the "anchor"), then widens into a broader theme that
 * rewards original thinking. It carries a teacher-facing `anchorSummary` and a
 * three-dimension `rubric` to ground grading later.
 */

export type GeneratedEssay = {
  /** A short label for the assignment, e.g. "Pages 130–180". */
  title: string | null;
  /** The single flowing essay prompt (anchor → broader theme). Null on failure. */
  prompt: string | null;
  /** Grader-facing: the specific reading detail the opening must demonstrate. */
  anchorSummary: string | null;
  /** The three-dimension rubric to grade against. */
  rubric: EssayRubric | null;
  /** The soft minimum word count, passed in by the caller (age/settings driven). */
  minWords: number;
};

const REPORT_ESSAY_TOOL = {
  name: "report_essay_assignment",
  description:
    "Report ONE longform-essay assignment for the child: a single flowing prompt " +
    "that opens by requiring a concrete detail from the assigned pages, then widens " +
    "into a broader theme — plus the grader-facing anchor and a three-part rubric.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          'A short label for the assignment, e.g. "Pages 130–180" or "Through page 84".',
      },
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
          "moment the opening paragraph must demonstrate, so a grader can verify the " +
          "child actually read the assigned pages. One or two sentences.",
      },
      rubric: {
        type: "object",
        description:
          "What a grader should look for, each pitched to the child's age.",
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
        `that stretch. The anchor must come from within it — do NOT reference earlier ` +
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
      `The reader is ${input.readerAge} years old. Pitch the prompt, vocabulary, and ` +
        `rubric for that age.`
    );
  }
  if (input.readerContext) {
    parts.push(
      `A little about this reader, ONLY so the broader theme can feel relevant when ` +
        `it fits naturally:\n${input.readerContext}\n` +
        `Use this sparingly. Do NOT center the essay on the reader's main hobby or ` +
        `favorite topic, and vary your themes from one assignment to the next — a ` +
        `theme that genuinely fits the reading is always better than a forced personal ` +
        `connection.`
    );
  }
  parts.push(
    `Write ONE short essay prompt as a single, flowing question — two parts of a ` +
      `whole, not separate numbered questions, and as few words as you can manage. ` +
      `Part one (the anchor): in one sentence, ask the child to write about a specific ` +
      `moment or detail from ${label} that they could only know if they did the reading. ` +
      `Part two: in one or two more sentences, open into a broader theme that asks them ` +
      `to reflect, connect, or imagine — something that needs real thinking, not summary. ` +
      `Base the anchor strictly on the text below. Keep the whole prompt to about 2–3 ` +
      `short, plain sentences the reader can hold in their head, and do NOT mention word ` +
      `count, length, or how it will be graded — put grading criteria only in the rubric.`
  );
  parts.push(`Call report_essay_assignment exactly once.`);
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

const emptyEssay = (minWords: number): GeneratedEssay => ({
  title: null,
  prompt: null,
  anchorSummary: null,
  rubric: null,
  minWords,
});

/**
 * Ask the model to write a longform-essay assignment over the given text.
 * Resilient: any failure (API error, malformed output, missing prompt) resolves to
 * an empty essay (prompt: null) so the caller can surface "couldn't generate — try
 * again" and leave a retryable draft.
 */
export async function generateEssayAssignment(input: {
  bookTitle: string;
  author: string | null;
  fromPage?: number | null;
  throughPage: number;
  text: string;
  readerAge?: number | null;
  readerContext?: string | null;
  minWords: number;
}): Promise<GeneratedEssay> {
  if (!input.text.trim()) return emptyEssay(input.minWords);

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 1500,
      system:
        "You are a thoughtful English teacher who designs ONE short essay prompt for " +
        "a child partway through a book. Every prompt opens by requiring a concrete " +
        "detail from the exact pages the child just read — so it doubles as proof they " +
        "did the reading — then widens into a broader theme that rewards original " +
        "thinking, not plot summary. You write a single warm, flowing prompt of just a " +
        "couple of plain sentences a child can hold in their head — never separate " +
        "numbered questions, never padding. You never mention word counts or how the " +
        "work will be graded, and never reference or spoil anything beyond the assigned " +
        "pages.",
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
    if (!toolUse || toolUse.type !== "tool_use") return emptyEssay(input.minWords);

    const parsed = toolUse.input as {
      title?: unknown;
      prompt?: unknown;
      anchor_summary?: unknown;
      rubric?: unknown;
    };
    const prompt = asString(parsed.prompt);
    if (!prompt) return emptyEssay(input.minWords);

    return {
      title: asString(parsed.title),
      prompt,
      anchorSummary: asString(parsed.anchor_summary),
      rubric: sanitizeRubric(parsed.rubric),
      minWords: input.minWords,
    };
  } catch (err) {
    console.error(
      "[reading/quiz-generate] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return emptyEssay(input.minWords);
  }
}
