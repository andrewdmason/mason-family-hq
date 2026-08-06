/**
 * What the reader's contents dialog will actually draw.
 *
 * The tree is built from stored data alone, so every interesting case can be
 * written down here rather than hunted for in a library of eighty EPUBs. The two
 * worth watching hardest:
 *
 *   - A book whose contents records NO nesting must come out looking exactly as
 *     it did before nesting existed. That is every book converted before this
 *     change, plus every PDF, and a regression there is a regression for the
 *     whole shelf.
 *   - Headings the nav never listed (an index's A–Z, a notes section's
 *     per-chapter heads) must land as siblings inside the section they belong
 *     to. Measuring each from the row above instead staircases them twenty-six
 *     indents deep and hands every letter a reading estimate that has swallowed
 *     the rest of the book.
 *
 *   npx tsx scripts/verify-contents-tree.mts
 */

import { buildContents, pathToAnchor } from "../src/lib/reading/contents-tree";
import type { ContentsNode } from "../src/lib/reading/contents-tree";
import { minutesToRead } from "../src/lib/reading/reading-time";
import type { ReadingTocEntry } from "../src/lib/types";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Terse builder: title, depth (undefined = the nav didn't list it), startWord. */
function entry(
  title: string,
  depth: number | undefined,
  startWord: number,
  level = 2
): ReadingTocEntry {
  return {
    title,
    anchorId: `sec-${startWord}`,
    level,
    ...(depth != null ? { depth } : {}),
    page: null,
    startWord,
  };
}

/** "Title(child, child)" — the shape of a subtree, for legible assertions. */
function shape(nodes: ContentsNode[]): string {
  return nodes
    .map((n) => (n.children.length ? `${n.title}(${shape(n.children)})` : n.title))
    .join(", ");
}

function titles(nodes: ContentsNode[]): string {
  return nodes.map((n) => n.title).join(", ");
}

// ---------------------------------------------------------------------------
// 1. A book with subsections — the shape from the screenshots.
// ---------------------------------------------------------------------------
console.log("\nA book whose chapters have sections in them");

const WITH_SECTIONS: ReadingTocEntry[] = [
  entry("Copyright", 1, 0),
  entry("Dedication", 1, 100),
  entry("Introduction: The Wager", 1, 200),
  entry("Chapter 1: Sentience", 1, 1000),
  entry("Minds Before Brains?", 2, 1100),
  entry("Plants Awaken", 2, 1400),
  entry("Chapter 2: Feeling", 1, 2000),
  entry("Being Is Feeling", 2, 2200),
  entry("Coda: The Cave", 1, 3000),
  entry("Acknowledgments", 1, 3500),
  entry("Index", 1, 3600),
  entry("A", undefined, 3610),
  entry("B", undefined, 3650),
  entry("C", undefined, 3700),
  entry("About the Author", 1, 3800),
];

const sectioned = buildContents(WITH_SECTIONS, "A World Appears", 4000);

check(
  "front matter is folded away",
  titles(sectioned.front) === "Copyright, Dedication",
  titles(sectioned.front)
);
check(
  "the body is the book, chapters carrying their sections",
  shape(sectioned.body) ===
    "Introduction: The Wager, Chapter 1: Sentience(Minds Before Brains?, Plants Awaken), " +
      "Chapter 2: Feeling(Being Is Feeling), Coda: The Cave",
  shape(sectioned.body)
);
check(
  "unlisted headings are siblings inside their section, not a staircase",
  shape(sectioned.back) === "Acknowledgments, Index(A, B, C), About the Author",
  shape(sectioned.back)
);

// A chapter's length runs to the next chapter, not to its first subheading —
// otherwise an hour-long chapter advertises itself as five minutes.
const chapterOne = sectioned.body[1];
check(
  "a chapter's length runs to the next chapter",
  chapterOne.minutes === minutesToRead(1000),
  `${chapterOne.minutes} vs ${minutesToRead(1000)}`
);
check(
  "and so covers its sections, plus its own opening pages",
  chapterOne.minutes != null &&
    chapterOne.minutes > chapterOne.children.reduce((n, c) => n + (c.minutes ?? 0), 0),
  `${chapterOne.minutes} vs the sum of its sections`
);
check(
  "a section's length stops at the next section",
  chapterOne.children[0]?.minutes === minutesToRead(300),
  `${chapterOne.children[0]?.minutes} vs ${minutesToRead(300)}`
);
check(
  "the last entry runs to the end of the book",
  sectioned.back.at(-1)?.minutes === minutesToRead(200),
  `${sectioned.back.at(-1)?.minutes} vs ${minutesToRead(200)}`
);

// ---------------------------------------------------------------------------
// 2. Parts and chapters.
// ---------------------------------------------------------------------------
console.log("\nA book divided into parts");

const WITH_PARTS: ReadingTocEntry[] = [
  entry("Contents", 1, 0),
  entry("Introduction", 1, 50),
  entry("Part I: The Technological Challenge", 1, 500, 1),
  entry("Chapter 1: Disillusionment", 2, 600),
  entry("Chapter 2: Work", 2, 1200),
  entry("Part II: The Political Challenge", 1, 2000, 1),
  entry("Chapter 5: Community", 2, 2100),
];

const parted = buildContents(WITH_PARTS, "21 Lessons", 3000);
check(
  "chapters sit under their part",
  shape(parted.body) ===
    "Introduction, Part I: The Technological Challenge(Chapter 1: Disillusionment, Chapter 2: Work), " +
      "Part II: The Political Challenge(Chapter 5: Community)",
  shape(parted.body)
);

// ---------------------------------------------------------------------------
// 3. A conversion that recorded no nesting at all — every older book, every PDF.
// ---------------------------------------------------------------------------
console.log("\nA book converted before nesting was recorded");

const NO_DEPTH: ReadingTocEntry[] = [
  entry("Copyright", undefined, 0),
  entry("Part One", undefined, 100, 1),
  entry("Chapter 1", undefined, 200),
  entry("Chapter 2", undefined, 900),
  entry("Index", undefined, 1500),
];

const legacy = buildContents(NO_DEPTH, "Some Book", 2000);
check(
  "it falls back to level, and does NOT cascade one deeper each row",
  shape(legacy.body) === "Part One(Chapter 1, Chapter 2)",
  shape(legacy.body)
);
check("front matter still groups", titles(legacy.front) === "Copyright", titles(legacy.front));
check("back matter still groups", titles(legacy.back) === "Index", titles(legacy.back));

// The commonest book of all, and the one that broke: no recorded nesting AND no
// parts, so `level` is 2 for every chapter and 1 for nothing. Read as depth that
// makes each chapter a child of the last front-matter page — which swallowed an
// entire book into its own epigraph.
console.log("\nA book with no nesting and no parts");

const NO_DEPTH_NO_PARTS: ReadingTocEntry[] = [
  entry("Copyright", undefined, 0),
  entry("Dedication", undefined, 50),
  entry("Epigraph", undefined, 100),
  entry("Introduction: The Wager", undefined, 200),
  entry("Chapter 1: Sentience", undefined, 1000),
  entry("Chapter 2: Feeling", undefined, 2000),
  entry("Index", undefined, 3000),
];

const flat = buildContents(NO_DEPTH_NO_PARTS, "A World Appears", 4000);
check(
  "the book is not swallowed by the front matter above it",
  shape(flat.body) === "Introduction: The Wager, Chapter 1: Sentience, Chapter 2: Feeling",
  shape(flat.body)
);
check(
  "and the front matter is still just the front matter",
  titles(flat.front) === "Copyright, Dedication, Epigraph",
  titles(flat.front)
);

// ---------------------------------------------------------------------------
// 4. Non-story entries only group at the ends.
// ---------------------------------------------------------------------------
console.log("\nA non-story heading in the middle of the book");

const MID_BOOK: ReadingTocEntry[] = [
  entry("Copyright", 1, 0),
  entry("Chapter 1", 1, 100),
  entry("A Note on the Translation", 1, 500),
  entry("Chapter 2", 1, 900),
  entry("Index", 1, 1500),
];

const midBook = buildContents(MID_BOOK, "Some Book", 2000);
check(
  "it stays where the book put it rather than being moved to the back",
  shape(midBook.body) === "Chapter 1, A Note on the Translation, Chapter 2",
  shape(midBook.body)
);

// ---------------------------------------------------------------------------
// 5. Degenerate contents.
// ---------------------------------------------------------------------------
console.log("\nContents with nothing in them");

const ALL_MATTER = buildContents(
  [entry("Copyright", 1, 0), entry("Index", 1, 100)],
  "Some Book",
  200
);
check(
  "a contents that is nothing but matter doesn't lose entries",
  ALL_MATTER.front.length + ALL_MATTER.body.length + ALL_MATTER.back.length === 2,
  `${ALL_MATTER.front.length}/${ALL_MATTER.body.length}/${ALL_MATTER.back.length}`
);

const EMPTY = buildContents([], "Some Book", 100);
check(
  "an empty contents is empty rather than a crash",
  EMPTY.front.length === 0 && EMPTY.body.length === 0 && EMPTY.back.length === 0
);

const ONLY_TITLE = buildContents([entry("Some Book", 1, 0)], "Some Book", 100);
check(
  "an entry that just repeats the book's own name is dropped",
  ONLY_TITLE.front.length === 0 && ONLY_TITLE.body.length === 0 && ONLY_TITLE.back.length === 0
);

// ---------------------------------------------------------------------------
// 6. Finding where the reader is.
// ---------------------------------------------------------------------------
console.log("\nOpening on the chapter you're in");

check(
  "a section reports its chapter above it",
  pathToAnchor(sectioned.body, "sec-1100").join(" > ") === "sec-1000 > sec-1100",
  pathToAnchor(sectioned.body, "sec-1100").join(" > ")
);
check(
  "a top-level chapter is its own path",
  pathToAnchor(sectioned.body, "sec-3000").join(" > ") === "sec-3000"
);
check(
  "an anchor in the back matter isn't found in the body",
  pathToAnchor(sectioned.body, "sec-3610").length === 0
);
check(
  "an index letter reports the group it's buried in",
  pathToAnchor(sectioned.back, "sec-3650").join(" > ") === "sec-3600 > sec-3650",
  pathToAnchor(sectioned.back, "sec-3650").join(" > ")
);
check("an unknown anchor finds nothing", pathToAnchor(sectioned.body, "nope").length === 0);

console.log(
  failures === 0
    ? "\nThe contents nests the way the book does, and older books are untouched.\n"
    : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
