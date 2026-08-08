import { anthropic } from "@/lib/journal/anthropic";
import {
  READING_GENRES,
  READING_GENRE_VALUES,
  isReadingGenre,
  type ReadingGenre,
} from "@/lib/reading/book-genres";

/**
 * Classifying a book into fiction/non-fiction and one genre.
 *
 * Deliberately a step of its own rather than part of any add flow. A book can
 * enter the reader six ways — Open Library typeahead, AI title lookup, manual
 * entry, file upload, the browser extension, a recommendation — and only one of
 * them talks to Claude today. Hanging classification off the add dialog would
 * leave five paths producing uncategorised books. So this runs after the row
 * exists, whatever created it, and the backfill is the same function in a loop.
 *
 * Title and author only, not the book's text. The text would be more accurate for
 * obscure titles but costs far more and helps a handful of cases; revisit if the
 * guesses turn out bad.
 */

/** Haiku is plenty for "is this a novel" and keeps the post-add call cheap. */
export const BOOK_CLASSIFY_MODEL =
  process.env.BOOK_CLASSIFY_MODEL ?? "claude-haiku-4-5";

export type BookClassification = {
  /** Null when genuinely unclear — a real answer, not a failure. */
  fiction: boolean | null;
  genre: ReadingGenre | null;
};

const UNKNOWN: BookClassification = { fiction: null, genre: null };

/** The taxonomy rendered for the tool description, so the model picks knowingly. */
const GENRE_GUIDE = READING_GENRES.map(
  (g) => `- ${g.value} (${g.side}): ${g.hint}`
).join("\n");

const CLASSIFY_TOOL = {
  name: "classify_book",
  description:
    "Report what kind of book this is, so it can be filed on the reader's " +
    "shelf.\n\nThe genres, and what each covers:\n" +
    GENRE_GUIDE,
  input_schema: {
    type: "object" as const,
    properties: {
      recognized: {
        type: "boolean",
        description:
          "True if you actually know this book. False if you're guessing from " +
          "the title alone — a wrong confident answer is worse than none.",
      },
      fiction: {
        type: "boolean",
        description:
          "True if this is a work of fiction (novel, short stories, narrative " +
          "verse). False for non-fiction. Omit it entirely if the book genuinely " +
          "sits on the line — autofiction, a memoir written as a novel, myth " +
          "presented as scripture. Omitting is a real answer here, not a failure.",
      },
      genre: {
        type: "string",
        enum: READING_GENRE_VALUES,
        description:
          "The single best-fitting genre from the list. Pick the one a reader " +
          "would look under to find this book again. Stay on the side that " +
          "matches your fiction answer — a novel gets a fiction genre even when " +
          "its subject is spiritual or historical, because the shelf groups the " +
          "two sides apart and a novel filed under a non-fiction genre lands in " +
          "the wrong half.",
      },
    },
    required: ["recognized"],
  },
};

/**
 * Ask the AI what kind of book this is. Resilient by design: any failure — no
 * API key, a network error, an unrecognised book, a genre outside the taxonomy —
 * resolves to nulls rather than throwing, because every caller is a side-effect
 * on a book that has already been saved.
 */
export async function classifyBook(
  title: string,
  author: string | null
): Promise<BookClassification> {
  const trimmed = title.trim();
  if (!trimmed) return UNKNOWN;

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: BOOK_CLASSIFY_MODEL,
      max_tokens: 256,
      system:
        "You file books onto a personal reading shelf. Call classify_book " +
        "exactly once. Be honest about uncertainty: if you don't recognise the " +
        "book, say so rather than inferring a genre from the words in the title.",
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
      messages: [
        {
          role: "user",
          content: author ? `${trimmed} — by ${author}` : trimmed,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return UNKNOWN;
    const input = toolUse.input as {
      recognized?: unknown;
      fiction?: unknown;
      genre?: unknown;
    };

    // An unrecognised book gets no genre: a guess from the title's words is the
    // one outcome worse than a blank, because it looks authoritative on the shelf.
    if (input.recognized !== true) return UNKNOWN;

    return {
      fiction: typeof input.fiction === "boolean" ? input.fiction : null,
      // `enum` in the schema isn't a guarantee, so re-check against the taxonomy
      // — the column's CHECK constraint would otherwise reject the whole write.
      genre: isReadingGenre(input.genre) ? input.genre : null,
    };
  } catch (err) {
    console.error(
      "[reading/classify-book] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return UNKNOWN;
  }
}
