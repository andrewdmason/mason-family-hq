/**
 * Starring a mark: the two rules that would fail silently.
 *
 * Neither is visible in a screenshot and neither throws when it breaks, which is
 * why they are worth writing down.
 *
 *   - THE MARGIN RULE. A plain highlight of your own gets no icon in the gutter,
 *     deliberately, and a starred one must — otherwise a starred highlight is
 *     invisible everywhere except the marks panel, which is the whole thing
 *     starring exists to fix. The rule used to be an inline condition inside a
 *     DOM-measuring hook, where nothing could reach it; it lives in
 *     annotation-types.ts now so this file can.
 *
 *   - THE BUDGET. The reader's marks are packed into the chat prompt under a
 *     character cap and dropped from the end when they overflow. Starred marks
 *     are exempt, and the exemption only works if their room is RESERVED before
 *     anything else spends any — a single greedy pass in reading order would
 *     still let a pile of unstarred marks in chapter one crowd out a starred one
 *     in chapter thirty, which is precisely the case it exists for. The failure
 *     mode is a companion that has quietly never seen the passages you kept.
 *
 * The third check is the one that guards a product decision rather than a bug:
 * the model is told THAT some marks were dropped and that everything starred
 * survived, but never WHICH individual passages are starred. Handing it that
 * label invites it to weight one of the reader's highlights over another. An
 * assertion is the only way that decision survives the next person to touch the
 * prompt.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-starred-marks.mts
 */

import { marksGutter } from "../src/lib/reading/annotation-types";
import { packMarks } from "../src/lib/reading/book-document-context";
import type {
  BookDocumentContext,
  ReaderMark,
  SizedMark,
} from "../src/lib/reading/book-document-context";
import { buildBookDocumentSystem } from "../src/lib/reading/chat-prompt";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* The margin rule                                                     */
/* ------------------------------------------------------------------ */

console.log("\nwhat earns a margin icon");

const mine = { sharedFromUserId: null };
const theirs = { sharedFromUserId: "someone-else" };
const empty = { noteCount: 0, messageCount: 0 };
const written = { noteCount: 0, messageCount: 4 };

check(
  "a plain highlight of your own stays out of the margin",
  marksGutter({ ...mine, ...empty, starred: false }) === false
);
check(
  "the same highlight, starred, comes in",
  marksGutter({ ...mine, ...empty, starred: true }) === true
);
check(
  "a conversation of your own is in whether or not it is starred",
  marksGutter({ ...mine, ...written, starred: false }) === true &&
    marksGutter({ ...mine, ...written, starred: true }) === true
);
check(
  "a plain highlight somebody left you is in whether or not it is starred",
  marksGutter({ ...theirs, ...empty, starred: false }) === true &&
    marksGutter({ ...theirs, ...empty, starred: true }) === true
);
check(
  "a note counts as words, same as a message",
  marksGutter({ ...mine, noteCount: 1, messageCount: 0, starred: false }) === true
);

/* ------------------------------------------------------------------ */
/* The budget                                                          */
/* ------------------------------------------------------------------ */

console.log("\nwhich marks survive the prompt budget");

/** A mark whose quote is `size` characters long, so the arithmetic is legible. */
function sized(id: string, size: number, starred = false): SizedMark {
  return {
    mark: {
      page: null,
      quote: `${id}${"x".repeat(Math.max(0, size - id.length))}`,
      notes: [],
      exchanges: [],
      isChapterSummary: false,
      template: null,
      starred,
    },
    size,
  };
}

const quoteOf = (m: ReaderMark) => (m.quote ?? "").replace(/x+$/, "");

// Reading order: a wall of unstarred marks, then one starred mark at the very
// end — the arrangement a real reader produces by highlighting freely early and
// starring something in the last chapter.
const bulk = Array.from({ length: 10 }, (_, i) => sized(`m${i}`, 100));
const lateStar = sized("kept", 100, true);

{
  // Budget of 500 holds five marks. Without the reservation the five would all
  // come from `bulk` and "kept" would never be reached.
  const { marks, truncated } = packMarks([...bulk, lateStar], 500);
  const ids = marks.map(quoteOf);
  check("a starred mark at the end of the book survives the trim", ids.includes("kept"));
  check("the overflow is still reported", truncated === true);
  check(
    "unstarred marks fill what is left, from the start",
    ids.filter((id) => id !== "kept").join(",") === "m0,m1,m2,m3"
  );
  check(
    "the result comes back in reading order, not starred-first",
    ids.at(-1) === "kept" && ids[0] === "m0"
  );
}

{
  // The same list with nothing starred must behave exactly as it did before the
  // feature existed: a prefix of the marks, cut at the first that doesn't fit.
  const plain = [...bulk, sized("kept", 100)];
  const { marks, truncated } = packMarks(plain, 500);
  check(
    "with nothing starred, the old behaviour is unchanged",
    marks.map(quoteOf).join(",") === "m0,m1,m2,m3,m4" && truncated === true
  );
}

{
  const { marks, truncated } = packMarks([...bulk, lateStar], 100_000);
  check(
    "a budget nothing overflows keeps everything and reports no trim",
    marks.length === 11 && truncated === false
  );
}

{
  // Starred marks are exempt with no ceiling, on purpose: a silent invisible cap
  // on something sold as "always included" is the worse failure. This pins the
  // decision rather than merely observing it.
  const allStarred = Array.from({ length: 6 }, (_, i) => sized(`s${i}`, 100, true));
  const { marks, truncated } = packMarks(allStarred, 200);
  check(
    "starred marks are exempt even past the budget",
    marks.length === 6 && truncated === false
  );
}

/* ------------------------------------------------------------------ */
/* What the model is and isn't told                                    */
/* ------------------------------------------------------------------ */

console.log("\nwhat the prompt says about it");

function context(over: Partial<BookDocumentContext> = {}): BookDocumentContext {
  return {
    scope: "afterword",
    bookTitle: "The Radetzky March",
    bookAuthor: "Joseph Roth",
    genres: ["fiction"],
    isStory: true,
    bookText: "The book itself, at length.",
    hasPageMarkers: false,
    hasChapterMarkers: false,
    chapters: [],
    truncated: false,
    recommendedBy: null,
    recommendationNote: null,
    history: [],
    profile: { family: null, present: null, timeline: null },
    startedAt: "2026-01-04",
    finishedAt: "2026-01-19",
    rating: "loved",
    marks: [
      {
        page: 40,
        quote: "Watch Gustav.",
        notes: [],
        exchanges: [],
        isChapterSummary: false,
        template: null,
        starred: true,
      },
    ],
    markCount: 12,
    passageCount: 12,
    marksTruncated: false,
    preface: null,
    ...over,
  };
}

/** All the system text as one string, for asking whether a rule made it in. */
const text = (c: BookDocumentContext) =>
  buildBookDocumentSystem(c, "document")
    .map((b) => ("text" in b ? b.text : ""))
    .join("\n");

const trimmed = text(context({ marksTruncated: true }));
check(
  "a trimmed set says everything starred is still here",
  trimmed.includes("everything they starred is here")
);
check(
  "and no longer claims the missing ones are the later ones",
  !trimmed.includes("Later marks omitted")
);
check(
  "no per-mark starred label reaches the model",
  !/star/i.test(text(context()).split("<their_marks")[1]?.split("</their_marks>")[0] ?? "")
);

console.log(failures === 0 ? "\nall good" : `\n${failures} failing`);
process.exit(failures ? 1 : 0);
