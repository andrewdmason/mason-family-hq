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

import {
  blockMap,
  stripHtmlToText,
  textFromBlocks,
} from "../src/lib/reading/block-stream";
import {
  chapterBounds,
  chapterSpan,
  summarizableChapters,
} from "../src/lib/reading/reading-progress";
import {
  chapterIndex,
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

function markup(from: number, to: number) {
  const chapters = chapterMarks(BLOCKS, from, to);
  const marks: ContextMark[] = pageMarks(PAGE_ROWS, from, to).concat(chapters.marks);
  return {
    text: spliceMarks(FULL_TEXT, from, to, marks),
    titles: chapters.chapters.map((c) => c.title),
    index: chapterIndex(chapters.chapters, PAGE_ROWS, to),
  };
}

/** The page a character offset falls on, read straight off the page map. */
function pageOf(at: number): number {
  return PAGES.find((p) => at >= p.charStart && at < p.charEnd)!.pageNumber;
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
// Where each chapter ends
//
// The index has to state the LAST page of a chapter, not just its first. Without
// that a model reads until something sounds like an ending and stops there —
// which is how a summary of a 24-page chapter covered its first 14 pages and
// then quoted a mid-chapter parting as the closing words.
// ---------------------------------------------------------------------------

console.log("\nthe contents index says how far each chapter runs");

const chapterStarts = Array.from(
  { length: CHAPTERS },
  (_, i) => BLOCKS.find((b) => b.text === `Chapter ${i + 1}`)!.charStart
);

check(
  "every chapter opens on the page its heading is on",
  whole.index.every((entry, i) => entry.fromPage === pageOf(chapterStarts[i]))
);
check(
  "every chapter runs through the page before the next one opens",
  whole.index.every(
    (entry, i) =>
      entry.throughPage ===
      pageOf(i + 1 < CHAPTERS ? chapterStarts[i + 1] - 1 : CHAR_COUNT - 1)
  ),
  whole.index.map((e) => `${e.title}:${e.fromPage}-${e.throughPage}`).join(" ")
);
check(
  "a chapter's range covers more than the page it starts on",
  whole.index.every((entry) => entry.throughPage! > entry.fromPage!)
);
check(
  "the ranges tile the book — no gap between one chapter and the next",
  whole.index.every((entry, i) => i === 0 || entry.fromPage! >= whole.index[i - 1].throughPage!)
);
check(
  "the last chapter runs to the last page of the book",
  whole.index[CHAPTERS - 1].throughPage === PAGES[PAGES.length - 1].pageNumber
);
check(
  "with no page map at all, chapters are named but not placed",
  chapterIndex(chapterMarks(BLOCKS, 0, CHAR_COUNT).chapters, [], CHAR_COUNT).every(
    (entry) => entry.fromPage === null && entry.throughPage === null
  )
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
  chapterMarks(BLOCKS, 0, chapter3At)
    .chapters.map((c) => c.title)
    .join("|") === "Chapter 1|Chapter 2"
);
check(
  "the chapter they're in ends at the boundary, not at its real end",
  scoped.index[2].throughPage === pageOf(chapter3At + 199),
  `${scoped.index[2].throughPage} vs ${pageOf(chapter3At + 199)}`
);

// ---------------------------------------------------------------------------
// The span one chapter covers, which is what a chapter summary is built from
// ---------------------------------------------------------------------------

console.log("\nthe span a chapter summary is cut from");

/**
 * A more awkward book than the one above, and awkward in the way real ones are:
 * a part divider the contents lists as level 1, chapters under it, and — the
 * case that matters — sections INSIDE a chapter, emitted as the same <h2> tag
 * the chapters use. Nothing in the markup distinguishes them; only the contents
 * does, which is exactly what chapterSpan relies on.
 */
{
  const parts: string[] = [
    `<h1 id="sec-p1" class="reader-heading reader-h1">Part One</h1>`,
    `<h2 id="sec-c1" class="reader-heading reader-h2">Chapter 1</h2>`,
    `<p>The first chapter opens.</p>`,
    `<h2 id="sec-c1s1" class="reader-heading reader-h2">A section inside chapter one</h2>`,
    `<p>Still chapter one, under a heading the contents never mentions.</p>`,
    `<h2 id="sec-c2" class="reader-heading reader-h2">Chapter 2</h2>`,
    `<p>The second chapter opens.</p>`,
    `<h2 id="sec-c3" class="reader-heading reader-h2">Chapter 3</h2>`,
    `<p>The last chapter, running to the end of the book.</p>`,
    `<h2 id="sec-ack" class="reader-heading reader-h2">Acknowledgments</h2>`,
    `<p>With thanks to everyone.</p>`,
  ];
  const html = parts.join("\n");
  const blocks = blockMap(html);
  const text = textFromBlocks(blocks);
  // The contents lists the part and the chapters — never the inner section.
  const toc: ReadingTocEntry[] = [
    { title: "Part One", anchorId: "sec-p1", level: 1, page: null },
    { title: "Chapter 1", anchorId: "sec-c1", level: 2, page: null },
    { title: "Chapter 2", anchorId: "sec-c2", level: 2, page: null },
    { title: "Chapter 3", anchorId: "sec-c3", level: 2, page: null },
    { title: "Acknowledgments", anchorId: "sec-ack", level: 2, page: null },
  ];
  const bounds = chapterBounds(toc, "A Book", blocks);
  const cut = (anchorId: string) => {
    const span = chapterSpan(bounds, anchorId, text.length);
    return span ? text.slice(span.from, span.to) : null;
  };

  const first = cut("sec-c1");
  check(
    "a chapter starts at its own heading",
    first != null && first.startsWith("Chapter 1\n"),
    JSON.stringify(first?.slice(0, 20))
  );
  // The one that silently breaks if the boundary is ever "the next heading".
  check(
    "a section inside a chapter stays inside it",
    first != null && first.includes("A section inside chapter one"),
    JSON.stringify(first)
  );
  check(
    "and the next chapter stays out",
    first != null && !first.includes("Chapter 2"),
    JSON.stringify(first)
  );
  check(
    "the last chapter stops at the back matter that follows it",
    cut("sec-c3") ===
      "Chapter 3\nThe last chapter, running to the end of the book.\n",
    JSON.stringify(cut("sec-c3"))
  );
  check(
    "a part divider covers only what precedes its first chapter",
    cut("sec-p1") === "Part One\n"
  );
  check(
    "a heading the contents doesn't list has no span at all",
    cut("sec-c1s1") === null && cut("sec-nope") === null
  );

  // What the reader is actually OFFERED, which is narrower than what has a span.
  const offered = summarizableChapters(bounds).map((c) => c.anchorId);
  check(
    "only the real chapters are offered a summary",
    offered.join("|") === "sec-c1|sec-c2|sec-c3",
    offered.join("|")
  );
  check(
    "a book with no chapter level falls back to its parts",
    summarizableChapters([
      { title: "Part One", anchorId: "a", charStart: 0, startWord: null, level: 1 },
      { title: "Part Two", anchorId: "b", charStart: 9, startWord: null, level: 1 },
    ])
      .map((c) => c.anchorId)
      .join("|") === "a|b"
  );
}

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
