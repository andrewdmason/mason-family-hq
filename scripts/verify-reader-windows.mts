/**
 * The invariants the paged reader's windowing rests on.
 *
 * Windowing renders a slice of the book rather than all of it, and every stored
 * annotation anchor assumes a block element's textContent is byte-identical to
 * the block stream's `text`. So the one thing that must never break is that a
 * window's HTML is an exact substring of the book's HTML which re-parses to the
 * same blocks, with the same characters, at recoverable offsets.
 *
 *   npx tsx scripts/verify-reader-windows.mts
 */

import { blockMap } from "../src/lib/reading/block-stream";
import {
  segmentsOf,
  windowFor,
  windowHolds,
  windowHtml as sliceWindow,
} from "../src/lib/reading/paged-window";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Converted books contain exactly p / h1 / h2 plus zero-width page anchors. */
function buildBook(chapters: { title: string; paragraphs: string[] }[]): string {
  let html = "";
  let sec = 0;
  let anchor = 0;
  for (const chapter of chapters) {
    html += `<h1 id="sec-${sec++}">${chapter.title}</h1>\n`;
    for (const p of chapter.paragraphs) {
      // Interstitial page marks: they contribute no characters and must survive
      // slicing without disturbing offsets.
      if (anchor++ % 3 === 0) html += `<span class="page-anchor" id="pg-${anchor}"></span>`;
      html += `<p>${p}</p>\n`;
    }
  }
  return html;
}

const book = buildBook([
  {
    title: "The Beginning & the <End>",
    paragraphs: [
      "Call me Ishmael.",
      "Some years ago — never mind how long precisely — I thought I would sail.",
      "A quote with entities: 5 &lt; 6 &amp;&amp; 7 &gt; 6.",
    ],
  },
  {
    title: "Chapter Two",
    paragraphs: ["A short one.", "Another paragraph entirely.", "And a third."],
  },
  {
    title: "Chapter Three",
    paragraphs: ["Final chapter, first line.", "Final chapter, last line."],
  },
]);

const blocks = blockMap(book);

console.log("block stream");
check("parses every block", blocks.length === 11, `got ${blocks.length}, want 11`);
check(
  "tags are recorded",
  blocks.filter((b) => b.tag === "h1").length === 3 &&
    blocks.filter((b) => b.tag === "p").length === 8
);
check(
  "charStart advances by text.length + 1",
  blocks.every(
    (b, i) => i === 0 || b.charStart === blocks[i - 1].charStart + blocks[i - 1].text.length + 1
  )
);

console.log("\nhtml spans");
check(
  "spans are ordered and non-overlapping",
  blocks.every((b, i) => b.htmlStart < b.htmlEnd && (i === 0 || b.htmlStart >= blocks[i - 1].htmlEnd))
);
check(
  "each span re-parses to exactly its own block",
  blocks.every((b) => {
    const [only, ...rest] = blockMap(book.slice(b.htmlStart, b.htmlEnd));
    return rest.length === 0 && only?.text === b.text && only?.tag === b.tag;
  })
);

console.log("\nwindow slices");
/** What usePagination will do: render blocks [from, to) as one substring. */
function windowHtml(from: number, to: number): string {
  return book.slice(blocks[from].htmlStart, blocks[to - 1].htmlEnd);
}

const ranges: [number, number][] = [
  [0, blocks.length], // the whole book
  [0, 4],
  [4, 8],
  [8, blocks.length], // to the very end
  [5, 6], // a single block
];

for (const [from, to] of ranges) {
  const label = `blocks [${from}, ${to})`;
  const windowed = blockMap(windowHtml(from, to));
  const expected = blocks.slice(from, to);

  check(
    `${label}: same block count`,
    windowed.length === expected.length,
    `got ${windowed.length}, want ${expected.length}`
  );
  check(
    `${label}: byte-identical text`,
    windowed.every((b, i) => b.text === expected[i].text)
  );
  check(
    `${label}: ids and tags preserved`,
    windowed.every((b, i) => b.id === expected[i].id && b.tag === expected[i].tag)
  );
  // The window's own char space starts at 0; adding the first block's global
  // charStart is what makes a window-local measurement a global position. This
  // is the identity paged-position.ts relies on to stay unchanged.
  check(
    `${label}: offsets rebase onto the global char space`,
    windowed.every((b, i) => b.charStart + expected[0].charStart === expected[i].charStart)
  );
}

console.log("\nheadings are window boundaries");
// Chapter headings carry break-before:column, so a window that starts on one
// fragments identically whether or not the preceding chapters are in the DOM.
const headingIndices = blocks.filter((b) => b.tag.startsWith("h")).map((b) => b.index);
check("every chapter start is a heading block", headingIndices.length === 3);
check(
  "a window starting at a heading starts at that chapter's char offset",
  headingIndices.every((i) => {
    const windowed = blockMap(windowHtml(i, blocks.length));
    return windowed[0].text === blocks[i].text && blocks[i].charStart >= 0;
  })
);

console.log("\nsegments");
const segments = segmentsOf(blocks);
check("one segment per heading, plus front matter if any", segments.length === 3, `${segments.length}`);
check(
  "segments tile the book with no gap and no overlap",
  segments[0].startBlock === 0 &&
    segments.at(-1)!.endBlock === blocks.length &&
    segments.every((s, i) => i === 0 || s.startBlock === segments[i - 1].endBlock)
);
check(
  "every segment starts at a forced column break",
  segments.every((s) => s.startBlock === 0 || blocks[s.startBlock].tag.startsWith("h"))
);
check(
  "segment char spans match their blocks",
  segments.every(
    (s) =>
      s.charStart === blocks[s.startBlock].charStart &&
      s.charEnd ===
        blocks[s.endBlock - 1].charStart + blocks[s.endBlock - 1].text.length + 1
  )
);

// A book opening on a heading must not produce an empty leading segment, and a
// book with no headings at all must come back as one segment — which renders the
// whole book, exactly as the reader did before windowing existed.
const noHeadings = blockMap("<p>Only</p><p>Prose</p>");
check("a book with no headings is a single segment", segmentsOf(noHeadings).length === 1);
check("an empty book has no segments", segmentsOf([]).length === 0);
check(
  "a book opening on a heading has no empty leading segment",
  segmentsOf(blocks).every((s) => s.endBlock > s.startBlock)
);

console.log("\nwindows");
// Margins are taken in whole segments, so a margin larger than the book is the
// whole book and a margin of zero is one chapter.
const whole = windowFor(segments, blocks[5].charStart, 1_000_000);
check(
  "a margin bigger than the book renders all of it",
  whole.startBlock === 0 && whole.endBlock === blocks.length
);
const single = windowFor(segments, blocks[5].charStart, 0);
check(
  "a zero margin renders just the segment being read",
  single.startBlock === segments[1].startBlock && single.endBlock === segments[1].endBlock,
  `${single.startBlock}-${single.endBlock}`
);
check(
  "the window holds the character it was asked for",
  segments.every((s) => {
    const w = windowFor(segments, s.charStart, 0);
    return windowHolds(w, s.charStart);
  })
);
check(
  "every window edge is a segment edge",
  [0, 1, 2].every((i) => {
    const w = windowFor(segments, segments[i].charStart, 20);
    return (
      segments.some((s) => s.startBlock === w.startBlock) &&
      segments.some((s) => s.endBlock === w.endBlock)
    );
  })
);
check(
  "a window's html is the exact slice of the book's own html",
  segments.every((s) => {
    const w = windowFor(segments, s.charStart, 0);
    const slice = sliceWindow(book, blocks, w);
    return (
      book.includes(slice) &&
      slice === book.slice(blocks[w.startBlock].htmlStart, blocks[w.endBlock - 1].htmlEnd)
    );
  })
);
check(
  "a window re-parses to the same blocks, at rebasable offsets",
  segments.every((s) => {
    const w = windowFor(segments, s.charStart, 0);
    const windowed = blockMap(sliceWindow(book, blocks, w));
    return (
      windowed.length === w.endBlock - w.startBlock &&
      windowed.every(
        (b, i) =>
          b.text === blocks[w.startBlock + i].text &&
          b.charStart + blocks[w.startBlock].charStart === blocks[w.startBlock + i].charStart
      )
    );
  })
);
// The gap between the last block and the next segment belongs to the window: a
// position landing in it must not read as being outside.
check(
  "a window's char span reaches the next segment's first character",
  segments.slice(0, -1).every((s, i) => {
    const w = windowFor(segments, s.charStart, 0);
    return w.charEnd === segments[i + 1].charStart;
  })
);

// Home and End are expressed in characters, because a page number only means
// something inside the chapter currently rendered. Both ends of the book must
// therefore land in a window that actually contains them.
const lastChar = blocks.at(-1)!.charStart + blocks.at(-1)!.text.length;
const atStart = windowFor(segments, 0, 0);
const atEnd = windowFor(segments, lastChar, 0);
check("Home lands in a window holding the first character", windowHolds(atStart, 0));
check("Home's window starts at the front of the book", atStart.startBlock === 0);
check("End lands in a window holding the last character", windowHolds(atEnd, lastChar));
check("End's window runs to the end of the book", atEnd.endBlock === blocks.length);
// A character past the end (an off-by-one in a caller) must not produce a
// window that excludes everything — it should clamp to the last segment.
const past = windowFor(segments, lastChar + 500, 0);
check("a character past the end still yields the last segment", past.endBlock === blocks.length);

console.log(
  failures === 0 ? "\nAll window invariants hold." : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
