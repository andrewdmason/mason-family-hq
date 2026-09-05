/**
 * Bookmarks: the rules that decide what the header ribbon is doing.
 *
 * None of these throw when they break. They show up as a ribbon that stays
 * hollow while you are standing on a bookmark — which then lets a second tap
 * save a second bookmark on the same page — or as a list of rows all labelled
 * with the same six words, which is the one thing the excerpt exists to prevent.
 *
 * The interesting case is a PAGE that opens halfway through a paragraph. The
 * reader's raw position is then wherever the column happened to break, and the
 * bookmark on that paragraph sits BEHIND it; comparing against the raw position
 * would miss it. Snapping to the block's start is what makes the two agree, and
 * it is the reason bookmarkAtSpot takes a spot rather than a position.
 *
 *   npx tsx scripts/verify-bookmarks.mts
 */

import {
  bookmarkAtSpot,
  bookmarkExcerpt,
  bookmarkLabel,
  bookmarkPlace,
} from "../src/lib/reading/bookmarks";

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
/* Standing on one                                                     */
/* ------------------------------------------------------------------ */

console.log("\nwhat makes the ribbon solid");

const marks = [
  { id: "a", charOffset: 100 },
  { id: "b", charOffset: 4200 },
  { id: "c", charOffset: 4600 },
];

check(
  "scrolling: the reading line's own block counts",
  bookmarkAtSpot(marks, 4200, null)?.id === "b"
);
check(
  "scrolling: a bookmark further down the screen does not",
  bookmarkAtSpot(marks, 4300, null) === null
);
check(
  "pages: anything in the window counts",
  bookmarkAtSpot(marks, 4000, 4700)?.id === "b"
);
check(
  "pages: a bookmark past the last character does not",
  bookmarkAtSpot(marks, 4000, 4500)?.id === "b" &&
    bookmarkAtSpot([marks[2]], 4000, 4500) === null
);
check(
  "pages: a page opening mid-paragraph still finds its own bookmark",
  // The page broke at 4250; the paragraph — and the bookmark — start at 4200.
  bookmarkAtSpot(marks, 4200, 4800)?.id === "b"
);
check("no bookmarks, nothing to stand on", bookmarkAtSpot([], 4200, null) === null);

/* ------------------------------------------------------------------ */
/* What a row is called                                                */
/* ------------------------------------------------------------------ */

console.log("\nthe label");

const line =
  "If we keep following our experimental method based on mental silence, we come upon " +
  "several discoveries that will gradually put us on the right track.";

const excerpt = bookmarkExcerpt(line);
check("a long line is cut", excerpt != null && excerpt.length < line.length);
check("it says it was cut", excerpt != null && excerpt.endsWith("…"));
check(
  "it does not cut mid-word",
  excerpt != null && line.startsWith(excerpt.slice(0, -1))
);
check("a short line is left alone", bookmarkExcerpt("Chapter Five.") === "Chapter Five.");
check("whitespace-only is not a label", bookmarkExcerpt("   \n  ") === null);
check(
  "runs of whitespace collapse",
  bookmarkExcerpt("The   centers\n of\tconsciousness") === "The centers of consciousness"
);

check(
  "a named bookmark is called what the reader called it",
  bookmarkLabel({ name: "where the argument turns", excerpt: "If we keep" }) ===
    "where the argument turns"
);
check(
  "an unnamed one is called by its line",
  bookmarkLabel({ name: null, excerpt: "If we keep" }) === "If we keep"
);
check(
  "a name of only spaces is no name",
  bookmarkLabel({ name: "   ", excerpt: "If we keep" }) === "If we keep"
);
check(
  "with neither, it still reads as something",
  bookmarkLabel({ name: null, excerpt: null }) === "Bookmark"
);

/* ------------------------------------------------------------------ */
/* Where it is                                                         */
/* ------------------------------------------------------------------ */

console.log("\nthe place");

check(
  "a book with real pages is cited by page",
  bookmarkPlace({ page: 212 }, 14, true) === "p. 212"
);
check(
  "a synthetic page map is not — a made-up page number is worse than a percentage",
  bookmarkPlace({ page: 212 }, 14, false) === "14%"
);
check(
  "no page map at all falls back the same way",
  bookmarkPlace({ page: null }, 14, true) === "14%"
);

console.log(
  failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
