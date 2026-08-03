/**
 * What the reader chat can actually see of a book's structure.
 *
 * A converted book is handed to the model as one flat line-per-block stream, so a
 * chapter heading arrives looking exactly like a short paragraph. That failure is
 * invisible from the outside: the model doesn't error, it just can't find
 * "Chapter 21" in a quarter-million tokens and says the book has no numbered
 * chapters. The markers and the <contents> index fix it — and both are spliced in
 * while building the output, which is the dangerous part. The character space is
 * what every stored highlight, chat anchor and page row is recorded against, so a
 * single character of drift moves all of them, silently, in books already read.
 *
 * Hence the invariant asserted hardest here: strip what was spliced in, and the
 * bytes must be exactly `fullText.slice(from, to)` again.
 *
 *   npx tsx scripts/verify-chapter-context.mts
 */

import { blockMap, stripHtmlToText } from "../src/lib/reading/block-stream";
import {
  chapterMarks,
  pageMarks,
  spliceMarks,
  type ContextMark,
} from "../src/lib/reading/context-markup";
import {
  blockMarksFromHtml,
  layoutSyntheticPages,
} from "../src/lib/reading/synthetic-pages";
import { countWords } from "../src/lib/reading/word-counts";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// A synthetic converted book
// ---------------------------------------------------------------------------

const CHAPTERS = 6;
const PARAS_PER_CHAPTER = 12;

/** Emitted the way convert.ts emits: <h2 id="sec-N"> headings and <p> bodies. */
function buildBook(): string {
  const parts: string[] = [];
  for (let c = 1; c <= CHAPTERS; c++) {
    parts.push(`<h2 id="sec-${c}" class="reader-heading reader-h2">Chapter ${c}</h2>`);
    for (let p = 1; p <= PARAS_PER_CHAPTER; p++) {
      // Long enough that a 280-word page spans several paragraphs, as in a novel.
      const sentence = `In chapter ${c} paragraph ${p} the porter set down the cases and waited by the lift.`;
      parts.push(`<p>${`${sentence} `.repeat(4).trim()}</p>`);
    }
  }
  return parts.join("\n");
}

const HTML = buildBook();
const BLOCKS = blockMap(HTML);
const FULL_TEXT = stripHtmlToText(HTML);
const MARKS = blockMarksFromHtml(HTML);
const CHAR_COUNT = MARKS[MARKS.length - 1].char;
const WORD_COUNT = MARKS[MARKS.length - 1].word;
const PAGES = layoutSyntheticPages(MARKS, CHAR_COUNT, WORD_COUNT);
const PAGE_ROWS = PAGES.map((p) => ({
  page_number: p.pageNumber,
  char_start: p.charStart,
  char_end: p.charEnd,
}));

/** Undo exactly the two things the assembler splices in, and nothing else. */
function stripMarkers(text: string): string {
  return text.replace(/\n\[p\.\d+\]\n/g, "").replace(/\n\n## /g, "");
}

function markup(from: number, to: number): { text: string; titles: string[] } {
  const chapters = chapterMarks(BLOCKS, from, to);
  const marks: ContextMark[] = pageMarks(PAGE_ROWS, from, to).concat(chapters.marks);
  return { text: spliceMarks(FULL_TEXT, from, to, marks), titles: chapters.titles };
}

// ---------------------------------------------------------------------------
// The char space the whole reader is built on
// ---------------------------------------------------------------------------

console.log("\nmarking the text up never changes it");

const whole = markup(0, CHAR_COUNT);

check(
  "removing the markers gives back the exact char space",
  stripMarkers(whole.text) === FULL_TEXT,
  `${stripMarkers(whole.text).length} vs ${FULL_TEXT.length} chars`
);
check(
  "a mid-book slice does too",
  (() => {
    const from = Math.floor(CHAR_COUNT * 0.4);
    const to = Math.floor(CHAR_COUNT * 0.8);
    return stripMarkers(markup(from, to).text) === FULL_TEXT.slice(from, to);
  })()
);
check(
  "and asking for no marks at all is the plain slice",
  spliceMarks(FULL_TEXT, 100, 900, []) === FULL_TEXT.slice(100, 900)
);

// ---------------------------------------------------------------------------
// What the model can now find
// ---------------------------------------------------------------------------

console.log("\nthe whole book, marked up for a chat");

check(
  "every chapter start is a visible heading",
  Array.from({ length: CHAPTERS }, (_, i) => `\n\n## Chapter ${i + 1}\n`).every((h) =>
    whole.text.includes(h)
  )
);
check(
  "the contents index names them, in order, verbatim",
  whole.titles.join("|") ===
    Array.from({ length: CHAPTERS }, (_, i) => `Chapter ${i + 1}`).join("|"),
  whole.titles.join("|")
);
check("a heading is never marked twice", whole.text.split("## Chapter 3\n").length === 2);
check(
  "every page label lands on its own page's first character",
  PAGES.every((p) => {
    const at = whole.text.indexOf(`\n[p.${p.pageNumber}]\n`);
    return at >= 0 && stripMarkers(whole.text.slice(0, at)).length === p.charStart;
  })
);
check(
  "a page label landing on a heading sits above it, not inside it",
  spliceMarks("ABCDEF", 0, 6, [
    { at: 2, text: "\n\n## ", order: 1 },
    { at: 2, text: "\n[p.7]\n", order: 0 },
  ]) === "AB\n[p.7]\n\n\n## CDEF"
);

// ---------------------------------------------------------------------------
// A spoiler-scoped chat
// ---------------------------------------------------------------------------

console.log("\na chat scoped to where the reader has got to");

// Cut in the middle of chapter 3, the way an anchor mid-paragraph would.
const chapter3At = BLOCKS.find((b) => b.text === "Chapter 3")!.charStart;
const chapter4At = BLOCKS.find((b) => b.text === "Chapter 4")!.charStart;
const scoped = markup(0, chapter3At + 200);

check(
  "the index stops at the boundary",
  scoped.titles.join("|") === "Chapter 1|Chapter 2|Chapter 3",
  scoped.titles.join("|")
);
check("no later chapter is marked", !scoped.text.includes("## Chapter 4"));
check("nothing past the boundary leaks in", stripMarkers(scoped.text).length < chapter4At);
check(
  "a boundary landing exactly on a heading excludes it",
  chapterMarks(BLOCKS, 0, chapter3At).titles.join("|") === "Chapter 1|Chapter 2"
);

// ---------------------------------------------------------------------------
// The page map the repair path rebuilds
// ---------------------------------------------------------------------------

console.log("\nthe synthetic page map tiles the book exactly");

check("it starts at the first character", PAGES[0]?.charStart === 0);
check(
  "it ends at the last",
  PAGES[PAGES.length - 1]?.charEnd === CHAR_COUNT,
  `${PAGES[PAGES.length - 1]?.charEnd} vs ${CHAR_COUNT}`
);
check(
  "no page overlaps or skips its neighbour",
  PAGES.every((p, i) => i === 0 || p.charStart === PAGES[i - 1].charEnd)
);
check(
  "every page breaks on a block boundary",
  PAGES.every((p) => p.charEnd === CHAR_COUNT || MARKS.some((m) => m.char === p.charEnd))
);
check(
  "the words counted are the words in the text",
  WORD_COUNT === countWords(FULL_TEXT),
  `${WORD_COUNT} vs ${countWords(FULL_TEXT)}`
);
check(
  "rebuilding from the stored HTML gives the same map",
  JSON.stringify(layoutSyntheticPages(blockMarksFromHtml(HTML), CHAR_COUNT, WORD_COUNT)) ===
    JSON.stringify(PAGES)
);

console.log(
  failures === 0
    ? "\nThe chat can see the book's structure, and the char space is untouched.\n"
    : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
