import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";

/** Metadata the AI resolves from a book title. */
export type BookLookupResult = {
  /** True when the AI is sure which single book this is. False = ambiguous. */
  confident: boolean;
  title: string;
  author: string | null;
  totalPages: number | null;
  coverImageUrl: string | null;
};

const LOOKUP_TOOL = {
  name: "report_book",
  description:
    "Report the canonical details of the book the user named, so it can be " +
    "added to their reading list.",
  input_schema: {
    type: "object" as const,
    properties: {
      found: {
        type: "boolean",
        description:
          "True if you recognize a real, published book matching the input.",
      },
      confident: {
        type: "boolean",
        description:
          "True ONLY if the input clearly identifies one specific book. Set " +
          "false if the title is ambiguous (multiple well-known books share it), " +
          "too vague, or you're unsure which edition/book is meant — the user " +
          "will then fill in the details by hand.",
      },
      title: {
        type: "string",
        description: "The canonical, correctly-capitalized book title.",
      },
      author: { type: "string", description: "The primary author's full name." },
      total_pages: {
        type: "integer",
        description:
          "Approximate page count of a common print edition. Omit if unsure.",
      },
      isbn: {
        type: "string",
        description:
          "ISBN-13 (digits only, no hyphens) of a common print edition, used to " +
          "fetch the cover. Omit if you don't know it confidently.",
      },
    },
    required: ["found", "confident", "title"],
  },
};

type LookupInput = {
  found?: unknown;
  confident?: unknown;
  title?: unknown;
  author?: unknown;
  total_pages?: unknown;
  isbn?: unknown;
};

/** A working Open Library cover URL for an ISBN, or null. */
function coverUrlFromIsbn(isbn: string | null): string | null {
  if (!isbn) return null;
  const digits = isbn.replace(/[^0-9Xx]/g, "");
  if (digits.length !== 10 && digits.length !== 13) return null;
  // `default=false` makes Open Library 404 (rather than return a blank) when it
  // has no cover, so the UI can fall back gracefully.
  return `https://covers.openlibrary.org/b/isbn/${digits}-L.jpg?default=false`;
}

/**
 * Resolve a book from just its title using the AI. Returns confident details to
 * auto-fill the add flow, or `confident: false` so the UI asks the user to fill
 * the rest in by hand. Resilient: any failure resolves to a non-confident,
 * title-only result rather than throwing.
 */
export async function lookupBookByTitle(title: string): Promise<BookLookupResult> {
  const trimmed = title.trim();
  const fallback: BookLookupResult = {
    confident: false,
    title: trimmed,
    author: null,
    totalPages: null,
    coverImageUrl: null,
  };
  if (!trimmed) return fallback;

  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 512,
      system:
        "You identify books from a title the user typed and report their details. " +
        "Call report_book exactly once. Be honest about uncertainty: if you can't " +
        "pin down one specific book, set confident=false.",
      tools: [LOOKUP_TOOL],
      tool_choice: { type: "tool", name: LOOKUP_TOOL.name },
      messages: [{ role: "user", content: trimmed }],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return fallback;
    const input = toolUse.input as LookupInput;

    const found = input.found === true;
    const confident = found && input.confident === true;
    const resolvedTitle =
      typeof input.title === "string" && input.title.trim()
        ? input.title.trim()
        : trimmed;
    const author =
      typeof input.author === "string" && input.author.trim()
        ? input.author.trim()
        : null;
    const totalPages =
      typeof input.total_pages === "number" && input.total_pages > 0
        ? Math.round(input.total_pages)
        : null;
    const isbn = typeof input.isbn === "string" ? input.isbn : null;

    return {
      confident,
      title: resolvedTitle,
      author,
      totalPages,
      coverImageUrl: coverUrlFromIsbn(isbn),
    };
  } catch (err) {
    console.error(
      "[reading/book-lookup] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return fallback;
  }
}
