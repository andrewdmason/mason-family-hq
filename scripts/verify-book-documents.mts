/**
 * What the reader's preface and afterword will actually be written from.
 *
 * The prompt IS the feature here — everything else is plumbing around it — and
 * it is assembled from pure inputs, so every case worth worrying about can be
 * written down rather than discovered by reading a generated document and
 * wondering why it says that. The ones worth watching hardest:
 *
 *   - The cache layout. The book goes in one block with a breakpoint on it, and
 *     that block must be byte-identical across both documents and both phases,
 *     or an interview re-reads the novel on every question it asks.
 *   - A spoiler-sensitive preface must carry the spoiler rule, and a
 *     non-fiction one must carry its opposite. Getting that backwards ruins a
 *     novel in one clause.
 *   - The afterword's dateline is written by us, not by the model, and must
 *     count passages the reader marked rather than recaps the app produced.
 *
 *   npx tsx scripts/verify-book-documents.mts
 */

import {
  BOOK_DOCUMENT_EFFORT,
  BOOK_DOCUMENT_MODEL,
  buildBookDocumentSystem,
} from "../src/lib/reading/chat-prompt";
import { afterwordDateline } from "../src/lib/reading/book-document-context";
import type {
  BookDocumentContext,
  ReaderMark,
} from "../src/lib/reading/book-document-context";
import {
  BOOK_DOCUMENT_LABEL,
  buildDocumentTurns,
  documentHeading,
  writeDocumentLabel,
  type DocumentTurn,
} from "../src/lib/reading/book-documents";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function mark(over: Partial<ReaderMark> = {}): ReaderMark {
  return {
    page: 12,
    quote: "Attention is the rarest and purest form of generosity.",
    notes: [],
    exchanges: [],
    isChapterSummary: false,
    ...over,
  };
}

function ctx(over: Partial<BookDocumentContext> = {}): BookDocumentContext {
  return {
    scope: "preface",
    bookTitle: "Gravity and Grace",
    bookAuthor: "Simone Weil",
    genres: ["philosophy"],
    spoilerSensitive: false,
    bookText: "[p.1] The book itself, at length.",
    hasPageMarkers: true,
    hasChapterMarkers: true,
    chapters: [{ title: "Attention", fromPage: 1, throughPage: 20 }],
    truncated: false,
    recommendedBy: "Dad",
    recommendationNote: "You'll argue with the second half.",
    history: [
      { title: "The Idiot", author: "Elif Batuman", rating: "loved", finishedAt: "2026-06-01" },
    ],
    startedAt: "2026-01-04",
    finishedAt: "2026-01-19",
    rating: "loved",
    marks: null,
    markCount: 0,
    passageCount: 0,
    marksTruncated: false,
    preface: null,
    ...over,
  };
}

/** All the system text as one string, for asking whether a rule made it in. */
const flatten = (blocks: { text: string }[]) => blocks.map((b) => b.text).join("\n");

console.log("\nCache layout");
{
  const fiction = ctx({ spoilerSensitive: true });
  const shapes = [
    buildBookDocumentSystem(fiction, "converse"),
    buildBookDocumentSystem(fiction, "document"),
    buildBookDocumentSystem({ ...fiction, scope: "afterword", marks: [] }, "converse"),
  ];
  check(
    "the book is the first block, and it carries the breakpoint",
    shapes.every(
      (b) => b[0].text.startsWith("<book ") && b[0].cache_control?.type === "ephemeral"
    )
  );
  check(
    "that block is byte-identical across both phases and both documents",
    shapes[0][0].text === shapes[1][0].text && shapes[1][0].text === shapes[2][0].text
  );
  check(
    "the contents index rides inside it, so it caches with the text",
    shapes[0][0].text.includes("<contents>") &&
      shapes[0][0].text.includes("Attention — [p.1] through [p.20]")
  );
  check(
    "the rules are last, where they can change without re-billing the book",
    shapes[0].at(-1)!.cache_control === undefined
  );

  // The reader's own material is large on a heavily-marked book and stable
  // across a sitting, so it takes the second breakpoint rather than riding in
  // the volatile tail.
  const marked = buildBookDocumentSystem(
    ctx({ scope: "afterword", marks: [mark()], markCount: 1, passageCount: 1 }),
    "converse"
  );
  check(
    "the reader's own material is a second cached block",
    marked[1].text.includes("<their_marks") &&
      marked[1].cache_control?.type === "ephemeral"
  );
  check("and it is not mixed into the book's block", !marked[0].text.includes("<their_marks"));
}

console.log("\nWhat a preface may say about the book");
{
  // The failure this section exists for: the first preface shipped asked
  // "what pulled you to this one — the argument, or the fact that Pollan ends
  // up sitting in a cave in New Mexico [p.284]?" of a reader who had not opened
  // the book. It gave away the destination, cited a page they could not go to,
  // and asked a question only someone who had already read it could answer.
  for (const kind of ["fiction", "non-fiction"] as const) {
    const sensitive = kind === "fiction";
    for (const phase of ["converse", "document"] as const) {
      const text = flatten(
        buildBookDocumentSystem(ctx({ spoilerSensitive: sensitive }), phase)
      );
      check(
        `${kind}, ${phase}: bounded to what they could know without reading it`,
        text.includes("THE READER HAS NOT OPENED THIS BOOK") &&
          text.includes("Never mention where it ends up")
      );
      check(
        `${kind}, ${phase}: and never cites a page`,
        text.includes("Never cite a page")
      );
      check(
        `${kind}, ${phase}: no page-citation rule to contradict that`,
        !text.includes("cite the nearest preceding marker")
      );
    }
  }

  const converse = flatten(buildBookDocumentSystem(ctx(), "converse"));
  check(
    "a question may not assume they know something from inside the book",
    converse.includes("can never assume they know something from inside")
  );
  check(
    "and the worked example of getting that wrong is spelled out",
    converse.includes("ends up doing Y")
  );

  const novel = flatten(buildBookDocumentSystem(ctx({ spoilerSensitive: true }), "converse"));
  check("a story holds the line harder still", novel.includes("This one is a story"));
  check(
    "and is pointed at the reader rather than at the plot",
    novel.includes("The subject of every question is THEM")
  );

  const argument = flatten(buildBookDocumentSystem(ctx(), "converse"));
  check("an argument may be named at jacket-and-contents level", argument.includes("jacket-"));
  check(
    "but its conclusions are still the reader's to reach",
    argument.includes("must still not do is report its findings")
  );

  const after = flatten(
    buildBookDocumentSystem(
      ctx({ scope: "afterword", spoilerSensitive: true, marks: [] }),
      "document"
    )
  );
  check(
    "an afterword protects nothing — they've read it",
    !after.includes("THE READER HAS NOT OPENED THIS BOOK")
  );
  check("and cites pages, because there's now somewhere to go back to", after.includes("[p.212]"));
}

console.log("\nThe interview");
{
  const converse = flatten(buildBookDocumentSystem(ctx(), "converse"));
  check("asks exactly one question a turn", converse.includes("ONE question per turn"));
  check(
    "guesses only from evidence, never from reputation",
    converse.includes("NEVER") && converse.includes("reputation")
  );
  check("offers to stop after four or five", converse.includes("four or five exchanges"));
  check(
    "opens with the question rather than a greeting",
    converse.includes("this turn is your opening")
  );

  const withNotes = flatten(
    buildBookDocumentSystem(ctx(), "converse", { hasReaderNotes: true })
  );
  check("explains the reader's own notes when the thread has any", withNotes.includes("[Reader's note]"));
  check("and says nothing about them when it doesn't", !converse.includes("[Reader's note]"));
}

console.log("\nThe documents");
{
  const preface = flatten(buildBookDocumentSystem(ctx(), "document"));
  check("a preface is short", preface.includes("150 to 250 words"));
  check("written back to the reader", preface.includes('Address the reader as "you"'));
  check("with no heading of its own — the app supplies that", preface.includes("no title at"));
  check(
    "no headings or bullets: this is an argument, not a form",
    preface.includes("No headings, no bullet lists, no bold labels") &&
      preface.includes("not a set of sections to label")
  );
  check(
    "paragraphed often, because it's read down a narrow column",
    preface.includes("never longer than about six sentences")
  );
  check(
    "and the only emphasis is italics on the titles of works",
    preface.includes("Italicise the titles of books") && preface.includes("no bold")
  );
  check(
    "and the reader's people are named the way the reader named them",
    preface.includes("Never borrow a name or a detail from the book")
  );

  const bare = flatten(
    buildBookDocumentSystem(ctx({ scope: "afterword", marks: [] }), "document")
  );
  check("an afterword is longer", bare.includes("500 to 800 words"));
  check(
    "every claim has to point at something they marked",
    bare.includes("Their marks are the evidence")
  );
  check("and it must not open with the dateline we write", bare.includes("Do not open with a dateline"));
  check(
    "with no preface, it doesn't promise to answer one",
    !bare.includes("did they get it?")
  );

  const paired = flatten(
    buildBookDocumentSystem(
      ctx({ scope: "afterword", marks: [], preface: "You came for the argument about attention." }),
      "document"
    )
  );
  check("with one, it closes the loop", paired.includes("did they get it?"));
  check("and the preface itself is in context", paired.includes("<their_preface>"));
}

console.log("\nWho the afterword is for");
{
  // The failure this section exists for: an afterword that opened "You stopped
  // at 79%, with Koch's doubts about physicalism fresh" and then ran a
  // catalogue of highlights with a percentage after each. Written for someone
  // who had just closed the book, when the whole point is to be readable by
  // someone who has forgotten it.
  const after = flatten(
    buildBookDocumentSystem(ctx({ scope: "afterword", marks: [] }), "document")
  );

  check("it is written for them years later", after.includes("FIVE YEARS FROM NOW"));
  check(
    "and assumes nothing is still familiar",
    after.includes("Introduce each person, term and idea the first time it appears")
  );
  check(
    "with a worked example of the failure",
    after.includes("Christof Koch") && after.includes("not\n" + '"Koch"') === false
  );
  check(
    "what the book was comes first, and at length",
    after.includes("WHAT THIS BOOK WAS") && after.includes("does the remembering")
  );
  check(
    "and it no longer refuses to recap",
    !after.includes("Do not recap the plot")
  );
  check("then how it landed, then what they took", 
    after.indexOf("WHAT THIS BOOK WAS") < after.indexOf("HOW IT LANDED ON THEM") &&
      after.indexOf("HOW IT LANDED ON THEM") < after.indexOf("WHAT THEY TOOK FROM IT")
  );
  check("long enough to do all three", after.includes("500 to 800 words"));
  check(
    "quotations are rationed, because a list of them is an index",
    after.includes("two or three of their highlights at most") &&
      after.includes("is an index of their highlights")
  );
  check(
    "and what they said outranks what you inferred",
    after.includes("A highlight is a guess about what someone thought")
  );

  // Always written as though the book was read in full: the app cannot tell
  // where anyone stopped, and hedging about it ages worse than being wrong.
  check(
    "it assumes the book was read through",
    after.includes("Assume they read the whole") &&
      !after.includes("NOT FINISHED THE BOOK")
  );
  const line = afterwordDateline(ctx({ passageCount: 34 }));
  check(
    "and the dateline reports only what was recorded",
    line === "Read Jan 4, 2026 – Jan 19, 2026 · 15 days · Loved it · 34 passages marked"
  );
  check(
    "no finish date invented when the shelf never captured one",
    afterwordDateline(ctx({ finishedAt: null, rating: null, passageCount: 2 })) ===
      "Started Jan 4, 2026 · 2 passages marked"
  );
}

console.log("\nMarks");
{
  const rich = flatten(
    buildBookDocumentSystem(
      ctx({
        scope: "afterword",
        markCount: 2,
        passageCount: 1,
        marks: [
          mark({ notes: ["This is the whole book."], page: 12 }),
          mark({
            quote: null,
            page: 88,
            isChapterSummary: true,
            exchanges: [{ question: 'Summarize "Attention".', answer: "It argues…" }],
          }),
        ],
      }),
      "document"
    )
  );
  check("a highlight arrives with its page", rich.includes('<mark n="1" page="12">'));
  check("a note arrives as the reader's", rich.includes("THEIR NOTE: This is the whole book."));
  check("a recap is labelled as one", rich.includes("(a chapter recap they asked for)"));
  check("an exchange keeps both halves", rich.includes("THEY ASKED:") && rich.includes("ANSWER:"));

  const none = flatten(
    buildBookDocumentSystem(ctx({ scope: "afterword", marks: [] }), "document")
  );
  check("marking nothing is said plainly", none.includes("They marked nothing in this book."));
}

console.log("\nThe dateline");
{
  check(
    "reads as a span with a length, a verdict and a count",
    afterwordDateline(ctx({ passageCount: 34 })) ===
      "Read Jan 4, 2026 – Jan 19, 2026 · 15 days · Loved it · 34 passages marked"
  );
  check(
    "counts passages the reader marked, not recaps the app produced",
    afterwordDateline(ctx({ markCount: 40, passageCount: 34 })).includes("34 passages marked")
  );
  check(
    "singular when there was one of anything",
    afterwordDateline(
      ctx({ startedAt: "2026-01-04", finishedAt: "2026-01-05", passageCount: 1 })
    ).includes("1 day · Loved it · 1 passage marked")
  );
  check(
    "a book read in a sitting doesn't claim a range",
    afterwordDateline(
      ctx({ startedAt: "2026-01-04", finishedAt: "2026-01-04", passageCount: 0 })
    ) === "Read Jan 4, 2026 · Loved it"
  );
  check(
    "and one we know nothing about gets no dateline at all",
    afterwordDateline(
      ctx({ startedAt: null, finishedAt: null, rating: null, passageCount: 0 })
    ) === ""
  );
}

console.log("\nThe shape of the request");
{
  // The failure this section exists for: pressing "write the preface" sends no
  // words, so the request ended on the last interview question, and the model
  // read that trailing assistant turn as a prefill it does not accept. A 400
  // at the exact moment the reader asks for the thing the interview was for.
  const u = (content: string): DocumentTurn => ({ role: "user", content });
  const a = (content: string): DocumentTurn => ({ role: "assistant", content });

  const interview = [a("What pulled you here?"), u("Curiosity."), a("About what?")];

  const writing = buildDocumentTurns(interview, "document", "preface", "A World Appears");
  check("writing after an interview ends on a user turn", writing.at(-1)!.role === "user");
  check(
    "and that turn asks for the document",
    writing.at(-1)!.content.includes("write my preface now")
  );
  check("without disturbing what was actually said", writing.slice(1, -1).length === 3);

  const answering = buildDocumentTurns([...interview, u("Consciousness.")], "converse", "preface", "B");
  check("answering needs no help at the end", answering.at(-1)!.content === "Consciousness.");

  const opening = buildDocumentTurns([], "converse", "preface", "A World Appears");
  check("an empty thread still opens with a user turn", opening.length === 1 && opening[0].role === "user");
  check("named after the book", opening[0].content.includes("A World Appears"));

  const straightToWriting = buildDocumentTurns([], "document", "afterword", "B");
  check(
    "writing from nothing is one legal turn, not two",
    straightToWriting.length === 1 && straightToWriting[0].role === "user"
  );

  // A follow-up asked under a written document is still a legal conversation,
  // even though nothing there offers to write a second one.
  const written = [...interview, u("Consciousness."), a("Here is your preface…")];
  const followingUp = buildDocumentTurns(written, "converse", "preface", "B");
  check("a follow-up under a written document ends on a user turn", followingUp.at(-1)!.role === "user");

  // Every shape the route can produce, checked against both rules at once —
  // this is the invariant, and the two above are the cases that broke it.
  const shapes: DocumentTurn[][] = [
    [],
    [a("q")],
    [u("hi")],
    interview,
    [...interview, u("a")],
    [u("note one"), u("note two"), a("q")],
  ];
  const legal = shapes.every((s) =>
    (["converse", "document"] as const).every((p) => {
      const t = buildDocumentTurns(s, p, "afterword", "B");
      return t.length > 0 && t[0].role === "user" && t.at(-1)!.role === "user";
    })
  );
  check("every transcript the route can build starts and ends with a user turn", legal);

  const folded = buildDocumentTurns([u("note one"), u("note two")], "converse", "preface", "B");
  check("and consecutive turns from one side are folded together", folded.length === 1);
}

console.log("\nWhat the reader is shown");
{
  check("both are possessive", BOOK_DOCUMENT_LABEL.preface === "Your preface");
  check(
    "the write button says which one it will write, and offers no second",
    writeDocumentLabel("afterword") === "Write the afterword" &&
      writeDocumentLabel("preface") === "Write the preface"
  );
  check(
    "a written document is dated, because regenerating appends",
    documentHeading("afterword", "2026-08-06T12:00:00.000Z").startsWith("Your afterword · ")
  );
  check(
    "one still streaming is not",
    documentHeading("afterword", null) === "Your afterword"
  );
}

console.log("\nModel");
{
  check("the best model there is, for the things that get kept", BOOK_DOCUMENT_MODEL === "claude-opus-5");
  check(
    "quick for a question, thorough for a document",
    BOOK_DOCUMENT_EFFORT.converse === "low" && BOOK_DOCUMENT_EFFORT.document === "high"
  );
}

console.log(
  failures === 0
    ? "\nAll book-document checks passed.\n"
    : `\n${failures} book-document check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
