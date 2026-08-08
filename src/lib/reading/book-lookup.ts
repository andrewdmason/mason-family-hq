import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import { plausibleYear } from "@/lib/reading/classify-book";
import {
  READING_GENRES,
  READING_GENRE_VALUES,
  isReadingGenre,
  type ReadingGenre,
} from "@/lib/reading/book-genres";

// The typeahead search lives in a server-import-free module so the client can
// call Open Library directly; re-exported here to keep existing importers working.
export { searchBooks } from "./book-search";
export type { BookSearchResult } from "./book-search";

/** Metadata the AI resolves from a book title. */
export type BookLookupResult = {
  /** True when the AI is sure which single book this is. False = ambiguous. */
  confident: boolean;
  title: string;
  author: string | null;
  totalPages: number | null;
  /** ISBN-13 the AI resolved, used for re-fetch and links. Null if unknown. */
  isbn: string | null;
  coverImageUrl: string | null;
  /** Year the work was first published. Null when unknown. */
  publishedYear: number | null;
  /** Free-text genre labels, informational. Null when unknown. */
  genres: string[] | null;
  /**
   * True for fiction. Null = genuinely unclear, which the caller leaves for the
   * post-save classifier to answer rather than treating as a verdict.
   */
  fiction: boolean | null;
  /**
   * The shelf's taxonomy genre. Asked for here so the one add path that already
   * talks to Claude doesn't need a second call to classify what it just looked up.
   */
  genre: ReadingGenre | null;
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
      published_year: {
        type: "integer",
        description:
          "The year the work was FIRST published, not the year of a later " +
          "reissue or translation. Omit if you're unsure.",
      },
      fiction: {
        type: "boolean",
        description:
          "True if this is a work of fiction (novel, short stories, narrative " +
          "verse). False for non-fiction (history, memoir, science, reference, " +
          "self-help). Omit only if genuinely unclear.",
      },
      genre: {
        type: "string",
        enum: READING_GENRE_VALUES,
        description:
          "The single best-fitting shelf genre — the one a reader would look " +
          "under to find this book again. Stay on the side that matches your " +
          "`fiction` answer: the shelf groups fiction and non-fiction apart, so " +
          "a novel filed under a non-fiction genre lands in the wrong half. " +
          "The options:\n" +
          READING_GENRES.map((g) => `- ${g.value} (${g.side}): ${g.hint}`).join(
            "\n"
          ),
      },
      genres: {
        type: "array",
        items: { type: "string" },
        description:
          "One to three short free-text genre labels, e.g. [\"literary fiction\"], " +
          "[\"fantasy\", \"young adult\"]. Omit if unsure.",
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
  published_year?: unknown;
  fiction?: unknown;
  genre?: unknown;
  genres?: unknown;
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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** What an Open Library title+author search can tell us about a book. */
export type SearchMatch = {
  coverImageUrl: string | null;
  publishedYear: number | null;
};

const NO_MATCH: SearchMatch = { coverImageUrl: null, publishedYear: null };

/**
 * Cover art and a publication year, resolved by Open Library title+author
 * search. For a cover this is far more reliable than a guessed ISBN: the
 * catalogue returns a `cover_i` only for editions that actually have art. We
 * accept the first hit whose title and author plausibly match, so we don't pin
 * the wrong book's cover. Resilient: returns an empty match on any failure.
 *
 * The year is a weaker signal — `first_publish_year` is the earliest edition
 * record, which is often a reissue or a translation — so callers use it only
 * where nothing better is available. Still worth having: it's the one source
 * that knows about books no model has heard of.
 */
export async function metaFromSearch(
  title: string,
  author: string | null
): Promise<SearchMatch> {
  try {
    const params = new URLSearchParams({
      title,
      fields: "title,author_name,cover_i,first_publish_year",
      limit: "5",
    });
    if (author) params.set("author", author);
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NO_MATCH;
    const data = (await res.json()) as {
      docs?: {
        title?: string;
        author_name?: string[];
        cover_i?: number;
        first_publish_year?: number;
      }[];
    };
    const qt = norm(title);
    const surname = author ? norm(author.split(/\s+/).pop() ?? "") : "";
    for (const d of data.docs ?? []) {
      if (!d.cover_i) continue;
      const mt = norm(d.title ?? "");
      const titleOk = !!qt && !!mt && (qt.includes(mt) || mt.includes(qt));
      const authorOk =
        !surname || (d.author_name ?? []).some((a) => norm(a).includes(surname));
      if (titleOk && authorOk) {
        return {
          coverImageUrl: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`,
          publishedYear:
            typeof d.first_publish_year === "number" && d.first_publish_year > 0
              ? d.first_publish_year
              : null,
        };
      }
    }
    return NO_MATCH;
  } catch {
    return NO_MATCH;
  }
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
    isbn: null,
    coverImageUrl: null,
    publishedYear: null,
    genres: null,
    fiction: null,
    genre: null,
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
    // Store only a well-formed ISBN-10/13 (digits only); drop anything else.
    const cleanedIsbn = isbn?.replace(/[^0-9Xx]/g, "") ?? "";
    const storedIsbn =
      cleanedIsbn.length === 10 || cleanedIsbn.length === 13
        ? cleanedIsbn
        : null;

    // Prefer a search-resolved cover (reliably present); fall back to the ISBN.
    const match = await metaFromSearch(resolvedTitle, author);
    const coverImageUrl = match.coverImageUrl ?? coverUrlFromIsbn(isbn);
    // The year goes the other way round. Open Library's `first_publish_year` is
    // the earliest edition record it holds, not the year the book came out, and
    // it disagrees with the truth about half the time — it dates Klara and the
    // Sun to 2019 and The Alchemist to 2010. The model is right far more often,
    // so the catalogue is only the fallback for a book it doesn't know.
    const publishedYear =
      plausibleYear(input.published_year) ?? match.publishedYear;

    const fiction = typeof input.fiction === "boolean" ? input.fiction : null;
    const genres = Array.isArray(input.genres)
      ? input.genres
          .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
          .map((g) => g.trim())
          .slice(0, 3)
      : null;

    return {
      confident,
      title: resolvedTitle,
      author,
      totalPages,
      isbn: storedIsbn,
      coverImageUrl,
      publishedYear,
      genres: genres && genres.length > 0 ? genres : null,
      fiction,
      // The schema's `enum` isn't a guarantee; the column has a CHECK constraint,
      // so anything off-taxonomy has to become null here rather than fail a write.
      genre: isReadingGenre(input.genre) ? input.genre : null,
    };
  } catch (err) {
    console.error(
      "[reading/book-lookup] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return fallback;
  }
}
