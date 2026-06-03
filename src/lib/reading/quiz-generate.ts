import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";

/**
 * Generating a reading-comprehension quiz from a slice of book text. Pure and
 * self-contained (no Supabase, no auth) so the same call powers the manual
 * "Generate quiz" action today and an automatic per-check-in job later. Mirrors
 * the recommend.ts pattern: one forced tool call, defensive parsing, resilient to
 * failure (returns an empty quiz rather than throwing).
 */

export type QuizQuestionDraft =
  | {
      type: "multiple_choice";
      prompt: string;
      options: string[];
      correctIndex: number;
      explanation: string;
    }
  | {
      type: "free_text";
      prompt: string;
      gradingRubric: string;
      sampleAnswer: string;
    };

export type GeneratedQuiz = {
  title: string | null;
  questions: QuizQuestionDraft[];
};

/** Hard ceiling on questions kept from one generation, after filtering. */
const MAX_QUESTIONS = 8;

const REPORT_QUIZ_TOOL = {
  name: "report_quiz",
  description:
    "Report a reading-comprehension quiz: a short title plus a mix of multiple-" +
    "choice and free-text writing questions drawn only from the provided text.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          'A short label for the quiz, e.g. "Through Chapter 4" or "Through page 84".',
      },
      questions: {
        type: "array",
        description:
          "The questions, best/most important first. Include BOTH multiple-choice " +
          "and free-text writing questions.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["multiple_choice", "free_text"],
              description:
                "multiple_choice = one right answer among options; free_text = a " +
                "short written response the reader composes in their own words.",
            },
            prompt: {
              type: "string",
              description: "The question, in warm, age-appropriate language.",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description:
                "multiple_choice ONLY: exactly 4 answer options, plausible and " +
                "distinct. Omit for free_text.",
            },
            correct_index: {
              type: "integer",
              description:
                "multiple_choice ONLY: the 0-based index of the correct option. " +
                "Omit for free_text.",
            },
            explanation: {
              type: "string",
              description:
                "multiple_choice ONLY: one sentence on why that answer is correct, " +
                "grounded in the text. Omit for free_text.",
            },
            grading_rubric: {
              type: "string",
              description:
                "free_text ONLY: the specific points or understanding a correct " +
                "answer must show, so an automated grader can judge it. Omit for MC.",
            },
            sample_answer: {
              type: "string",
              description:
                "free_text ONLY: a concise model answer a strong reader might give. " +
                "Omit for MC.",
            },
          },
          required: ["type", "prompt"],
        },
      },
    },
    required: ["questions"],
  },
};

type RawQuestion = {
  type?: unknown;
  prompt?: unknown;
  options?: unknown;
  correct_index?: unknown;
  explanation?: unknown;
  grading_rubric?: unknown;
  sample_answer?: unknown;
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
  questionCount: number;
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
      `This quiz covers ONLY ${label} of the book. The text below is exactly that ` +
        `stretch. Ask only about what happens within it — do NOT ask about earlier ` +
        `pages, and do NOT reference, hint at, or spoil anything that happens after ` +
        `page ${input.throughPage}.`
    );
  } else {
    parts.push(
      `This quiz covers the book from the very beginning THROUGH page ${input.throughPage} ` +
        `(cumulative). The reader has only read up to that point — do NOT ask about, ` +
        `hint at, or spoil anything that happens later in the book.`
    );
  }
  if (input.readerAge != null) {
    parts.push(
      `The reader is ${input.readerAge} years old. Pitch the vocabulary, difficulty, ` +
        `and tone for that age.`
    );
  }
  parts.push(
    `Write about ${input.questionCount} questions total: roughly two-thirds ` +
      `multiple-choice and one-third free-text writing questions (you decide the ` +
      `exact split, but include at least one of each). Multiple-choice questions ` +
      `check comprehension and recall; free-text questions ask the reader to explain, ` +
      `infer, or react in their own words — to practice writing and engage with the ` +
      `material more deeply. Each multiple-choice question needs exactly 4 options ` +
      `with one clearly correct answer. Base every question strictly on the text below.`
  );
  parts.push(`Call report_quiz exactly once.`);
  parts.push(`--- BOOK TEXT (${label}) ---\n${input.text}`);
  return parts.join("\n\n");
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Keep only well-formed questions, coercing the AI's raw output into our union. */
function sanitizeQuestions(raw: RawQuestion[]): QuizQuestionDraft[] {
  const out: QuizQuestionDraft[] = [];
  for (const q of raw) {
    const prompt = asString(q.prompt);
    if (!prompt) continue;

    if (q.type === "multiple_choice") {
      const options = Array.isArray(q.options)
        ? q.options.map(asString).filter((o): o is string => o !== null)
        : [];
      const correctIndex =
        typeof q.correct_index === "number" ? q.correct_index : -1;
      // Need at least two distinct options and a valid correct index.
      if (
        options.length < 2 ||
        correctIndex < 0 ||
        correctIndex >= options.length
      ) {
        continue;
      }
      out.push({
        type: "multiple_choice",
        prompt,
        options,
        correctIndex,
        explanation: asString(q.explanation) ?? "",
      });
    } else if (q.type === "free_text") {
      const gradingRubric = asString(q.grading_rubric);
      if (!gradingRubric) continue; // can't auto-grade without a rubric
      out.push({
        type: "free_text",
        prompt,
        gradingRubric,
        sampleAnswer: asString(q.sample_answer) ?? "",
      });
    }
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

/**
 * Ask the model to write a quiz over the given text. Resilient: any failure (API
 * error, malformed output, no usable questions) resolves to an empty quiz so the
 * caller can surface a friendly "couldn't generate — try again".
 */
export async function generateQuiz(input: {
  bookTitle: string;
  author: string | null;
  fromPage?: number | null;
  throughPage: number;
  text: string;
  readerAge?: number | null;
  questionCount?: number;
}): Promise<GeneratedQuiz> {
  if (!input.text.trim()) return { title: null, questions: [] };

  const questionCount = input.questionCount ?? 6;
  let rawTitle: string | null = null;
  let rawQuestions: RawQuestion[] = [];

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 3000,
      system:
        "You write warm, age-appropriate reading-comprehension quizzes for a child " +
        "who is partway through a book. You only ever ask about material the child " +
        "has already read — never spoil later events. You mix factual recall, " +
        "inference (\"why do you think…\"), and short personal-response questions to " +
        "build comprehension AND writing practice.",
      tools: [REPORT_QUIZ_TOOL],
      tool_choice: { type: "tool", name: REPORT_QUIZ_TOOL.name },
      messages: [
        {
          role: "user",
          content: buildPrompt({
            bookTitle: input.bookTitle,
            author: input.author,
            fromPage: input.fromPage ?? null,
            throughPage: input.throughPage,
            readerAge: input.readerAge ?? null,
            questionCount,
            text: input.text,
          }),
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return { title: null, questions: [] };
    }
    const parsed = toolUse.input as { title?: unknown; questions?: unknown };
    rawTitle = asString(parsed.title);
    if (Array.isArray(parsed.questions)) {
      rawQuestions = parsed.questions as RawQuestion[];
    }
  } catch (err) {
    console.error(
      "[reading/quiz-generate] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { title: null, questions: [] };
  }

  return { title: rawTitle, questions: sanitizeQuestions(rawQuestions) };
}
