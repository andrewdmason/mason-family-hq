/**
 * WHERE the reader's chats may search, checked against the prompts themselves.
 *
 * Search is on in two places and deliberately off in several others, and every
 * one of those decisions is a sentence in a system prompt plus a tool armed in
 * a route — two files that can drift apart without anything failing loudly:
 *
 *  - A TOOL WITH NO RULES is a model handed a search box and told, three
 *    paragraphs earlier, to work only from the book. It searches anyway, and
 *    nothing in the prompt governs what it does with the result.
 *  - RULES WITH NO TOOL is worse in the other direction: the prompt promises a
 *    capability, so the model says it looked something up when it did not.
 *  - THE PREFACE MUST NEVER SEARCH. Its whole contract is that the reader has
 *    not opened the book — everything it says must be knowable from the cover.
 *    A search returns the critical conversation about a book they are about to
 *    start, which is the one thing a preface cannot contain.
 *  - A SPOILER-SCOPED CHAT MUST REFUSE TO SEARCH THE BOOK. Criticism is written
 *    for someone who has finished; there is no safe way to read it from page
 *    ninety.
 *
 * So this asserts the two halves agree, for every scope and phase.
 *
 *   npx tsx scripts/verify-web-search-scope.mts
 */

import {
  bookDocumentCanSearch,
  buildBookDocumentSystem,
  buildReaderChatSystem,
  readerWebSearchTools,
  READER_CHAT_DEEP_MODEL,
  READER_CHAT_FAST_MODEL,
  type BookDocumentPhase,
} from "../src/lib/reading/chat-prompt";
import type { BookDocumentContext } from "../src/lib/reading/book-document-context";
import type { BookScope } from "../src/lib/reading/book-documents";

let failures = 0;

function check(what: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${what}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${what}\n      got      ${a}\n      expected ${e}`);
}

/** Flatten the system blocks to one string, the way the model reads them. */
const flatten = (blocks: { text: string }[]) => blocks.map((b) => b.text).join("\n\n");

/**
 * Does this prompt tell the model it can search?
 *
 * Deliberately the affirmative grant, not the word "search" — every one of
 * these prompts talks about searching, including the ones whose whole point is
 * to forbid it.
 */
const grantsSearch = (text: string) => /You can search the web/.test(text);

function documentContext(
  scope: BookScope,
  overrides: Partial<BookDocumentContext> = {}
): BookDocumentContext {
  return {
    scope,
    bookTitle: "The Unconsoled",
    bookAuthor: "Kazuo Ishiguro",
    genres: ["fiction"],
    spoilerSensitive: true,
    bookText: "Once, a porter carried three suitcases across a lobby.",
    hasPageMarkers: true,
    hasChapterMarkers: true,
    chapters: [],
    truncated: false,
    recommendedBy: null,
    recommendationNote: null,
    history: [],
    profile: { family: null, present: null, timeline: null },
    startedAt: null,
    finishedAt: null,
    rating: null,
    marks: scope === "afterword" ? [] : null,
    markCount: 0,
    passageCount: 0,
    marksTruncated: false,
    preface: null,
    ...overrides,
  };
}

console.log("book documents — the gate and the rules agree");

const SCOPES: BookScope[] = ["preface", "afterword"];
const PHASES: BookDocumentPhase[] = ["converse", "document"];

for (const scope of SCOPES) {
  for (const phase of PHASES) {
    const gate = bookDocumentCanSearch(scope, phase);
    const prompt = flatten(buildBookDocumentSystem(documentContext(scope), phase));
    check(`${scope}/${phase}: prompt matches the gate (${gate})`, grantsSearch(prompt), gate);
  }
}

// The gate itself, stated as the product decision rather than derived from it:
// both interviews, neither writing turn.
check("both interviews search; neither writing turn does", {
  "preface/converse": bookDocumentCanSearch("preface", "converse"),
  "preface/document": bookDocumentCanSearch("preface", "document"),
  "afterword/converse": bookDocumentCanSearch("afterword", "converse"),
  "afterword/document": bookDocumentCanSearch("afterword", "document"),
}, {
  "preface/converse": true,
  "preface/document": false,
  "afterword/converse": true,
  "afterword/document": false,
});

/**
 * The preface may search, but almost nothing a search returns survives its one
 * rule — the reader has not opened the book. The grant has to arrive with that
 * filter attached, or it is a licence to import a reviewer's account of the
 * ending into the front matter of a book someone is about to start.
 */
const prefaceInterview = flatten(
  buildBookDocumentSystem(documentContext("preface"), "converse")
);
check(
  "a searching preface carries the could-they-know-it-already filter",
  /COULD THEY HAVE LEARNED THIS WITHOUT READING THE BOOK/.test(prefaceInterview),
  true
);
check(
  "a fiction preface is warned that most of a result is unusable",
  /Expect to find the plot and discard it/.test(prefaceInterview),
  true
);
// Non-fiction gets the same grant without the story-specific warning, since it
// is allowed to name what the book is about in the first place.
const nonFictionPreface = flatten(
  buildBookDocumentSystem(
    documentContext("preface", { spoilerSensitive: false }),
    "converse"
  )
);
check(
  "the story-only warning is scoped to stories",
  {
    fiction: /Expect to find the plot and discard it/.test(prefaceInterview),
    nonFiction: /Expect to find the plot and discard it/.test(nonFictionPreface),
    bothMaySearch: grantsSearch(prefaceInterview) && grantsSearch(nonFictionPreface),
  },
  { fiction: true, nonFiction: false, bothMaySearch: true }
);

// The writing turns must still say "work from these and nothing else" — they
// have no tool, so a prompt implying otherwise would invite an invented quote.
const prefaceWrite = flatten(
  buildBookDocumentSystem(documentContext("preface"), "document")
);
const afterwordWrite = flatten(
  buildBookDocumentSystem(documentContext("afterword"), "document")
);
check(
  "both writing turns are told to work from the book and nothing else",
  {
    preface: /Work from those and nothing else/.test(prefaceWrite),
    afterword: /Work from those and nothing else/.test(afterwordWrite),
  },
  { preface: true, afterword: true }
);

// Both interviews must keep the interview's own governing rule: a question is
// about the reader, never about what the book is famous for.
check(
  "searching never turns an interview into a quiz on the criticism",
  {
    preface: /Searching does not loosen the rule about guesses/.test(prefaceInterview),
    afterword: /Searching does not loosen the rule about guesses/.test(
      flatten(buildBookDocumentSystem(documentContext("afterword"), "converse"))
    ),
  },
  { preface: true, afterword: true }
);

console.log("\nanchored chat — the spoiler boundary governs searching");

const chatInput = {
  bookTitle: "The Unconsoled",
  bookAuthor: "Kazuo Ishiguro",
  bookText: "Once, a porter carried three suitcases across a lobby.",
  hasPageMarkers: true,
  hasChapterMarkers: true,
  chapters: [],
  contextThroughPage: null,
  readerPosition: null,
  quotedText: null,
  hasReaderNotes: false,
  readerIntent: null,
  readerProfile: null,
  depth: "fast" as const,
};

const openChat = flatten(buildReaderChatSystem({ ...chatInput, spoilerFree: false }));
const scopedChat = flatten(
  buildReaderChatSystem({ ...chatInput, spoilerFree: true, contextThroughPage: 90 })
);

check("an unscoped chat may search", grantsSearch(openChat), true);
check("a spoiler-scoped chat may still search", grantsSearch(scopedChat), true);
check(
  "only the spoiler-scoped one is forbidden to search THIS book",
  {
    open: /do not search for this book/.test(openChat),
    scoped: /do not search for this book/.test(scopedChat),
  },
  { open: false, scoped: true }
);

console.log("\nthe tool itself");

// The Fast model predates the dynamically-filtered tool; everything else gets
// the current one. A wrong pairing is a 400 at request time, not a bad answer.
check(
  "tool version follows the model",
  {
    fast: readerWebSearchTools(READER_CHAT_FAST_MODEL)[0].type,
    deep: readerWebSearchTools(READER_CHAT_DEEP_MODEL)[0].type,
  },
  { fast: "web_search_20250305", deep: "web_search_20260209" }
);

// Blocking is the only guard that runs before a snippet reaches the model, so
// the list has to actually be attached to the tool.
const tool = readerWebSearchTools(READER_CHAT_DEEP_MODEL)[0] as {
  blocked_domains?: string[];
  allowed_domains?: string[] | null;
};
check(
  "the study-guide and plot-summary blocklist is attached",
  {
    blocksStudyGuides: (tool.blocked_domains ?? []).includes("sparknotes.com"),
    blocksFanWikis: (tool.blocked_domains ?? []).includes("fandom.com"),
    // The API rejects both at once, and an allowlist here would silently
    // narrow the open web to nothing.
    noAllowlist: tool.allowed_domains == null,
  },
  { blocksStudyGuides: true, blocksFanWikis: true, noAllowlist: true }
);

// Tools render ahead of the system blocks in the cached prefix, so a
// definition that varied per request would re-bill the whole novel every turn.
check(
  "the tool definition is byte-stable for a model",
  JSON.stringify(readerWebSearchTools(READER_CHAT_DEEP_MODEL)) ===
    JSON.stringify(readerWebSearchTools(READER_CHAT_DEEP_MODEL)),
  true
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall good");
