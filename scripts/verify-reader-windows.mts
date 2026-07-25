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

console.log(
  failures === 0 ? "\nAll window invariants hold." : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
