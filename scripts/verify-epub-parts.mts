/**
 * What survives the walk from an EPUB's own contents into the reader's.
 *
 * The case this exists for: a part divider whose page is nothing but the part's
 * name over an ornament — "PART ONE / MARKOV" — which carries no prose and was
 * therefore dropped as an empty page, along with the contents row it stood for.
 * That row is a parent, and losing it doesn't cost one line: every chapter it
 * held keeps the nesting the book gave it with nothing left above it to sit
 * under, and slides inside whatever heading came before. A book with three parts
 * and twenty-three chapters came out as a prologue six hours and fifty-two
 * minutes long with the entire book folded inside it.
 *
 * The EPUBs here are built in memory rather than kept as fixtures: each is a few
 * lines of markup, and being able to read the exact book a case describes is
 * worth more than a binary in the repo. What must keep holding:
 *
 *   - A divider page with no prose is a row in the contents, and its chapters
 *     nest under it.
 *   - A page with no text AT ALL — an image-only cover — is still dropped. That
 *     is what the empty-page rule was for, and it has to keep working.
 *   - When several contents rows land on the same spot and the book prints its
 *     own heading there, only the row that heading repeats is suppressed. The
 *     rest are still places in the book, printed in the order the nav gave them.
 *   - Both contents formats — the EPUB3 nav document and the EPUB2 NCX — behave
 *     the same, since which one a publisher ships is an accident of vintage.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-epub-parts.mts
 */

import JSZip from "jszip";
import { convertBookFile } from "@/lib/reading/convert";
import { buildContents } from "@/lib/reading/contents-tree";
import type { ContentsNode } from "@/lib/reading/contents-tree";
import type { ReadingTocEntry } from "@/lib/types";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** "Title(child, child)" — the shape of a subtree, for legible assertions. */
function shape(nodes: ContentsNode[]): string {
  return nodes
    .map((n) => (n.children.length ? `${n.title}(${shape(n.children)})` : n.title))
    .join(", ");
}

type Doc = { name: string; body: string };
/** One contents row: the file it points at, its title, and its nesting. */
type Row = { file: string; title: string; depth: number };

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>x</title></head><body>${body}</body></html>`;
}

/** The nav document, with a row's children nested in an inner <ol> as EPUB3 wants. */
function navDoc(rows: Row[]): string {
  const parts: string[] = ["<ol>"];
  let open = 1;
  for (const row of rows) {
    while (open < row.depth) {
      parts.push("<ol>");
      open++;
    }
    while (open > row.depth) {
      parts.push("</ol></li>");
      open--;
    }
    parts.push(`<li><a href="${row.file}">${row.title}</a>`);
    // Closed lazily: a row with children keeps its <li> open around them.
    parts.push("</li>");
  }
  while (open > 1) {
    parts.push("</ol></li>");
    open--;
  }
  parts.push("</ol>");
  // The lazy close above leaves a stray </li> before each nested <ol>; drop it.
  const html = parts.join("").replace(/<\/li><ol>/g, "<ol>");
  return xhtml(`<nav epub:type="toc">${html}</nav>`);
}

/** The NCX, whose nesting is navPoints inside navPoints. */
function ncxDoc(rows: Row[]): string {
  const parts: string[] = [];
  let open = 0;
  rows.forEach((row, i) => {
    while (open >= row.depth) {
      parts.push("</navPoint>");
      open--;
    }
    parts.push(
      `<navPoint id="n${i}"><navLabel><text>${row.title}</text></navLabel>` +
        `<content src="${row.file}"/>`
    );
    open = row.depth;
  });
  while (open > 0) {
    parts.push("</navPoint>");
    open--;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head/><docTitle><text>x</text></docTitle><navMap>${parts.join("")}</navMap></ncx>`;
}

/** Zip up a book: spine documents in order, plus a contents in one format. */
async function epub(docs: Doc[], rows: Row[], format: "nav" | "ncx"): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  );
  for (const doc of docs) zip.file(`OEBPS/${doc.name}`, xhtml(doc.body));

  const contentsItem =
    format === "nav"
      ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
      : `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;
  zip.file(`OEBPS/${format === "nav" ? "nav.xhtml" : "toc.ncx"}`, format === "nav" ? navDoc(rows) : ncxDoc(rows));

  const manifest = docs
    .map((d, i) => `<item id="d${i}" href="${d.name}" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = docs.map((_, i) => `<itemref idref="d${i}"/>`).join("");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:identifier id="id">x</dc:identifier></metadata>
<manifest>${manifest}${contentsItem}</manifest><spine>${spine}</spine></package>`
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** A chapter's worth of prose, so word offsets are distinguishable. */
function prose(word: string): string {
  return `<p>${Array.from({ length: 40 }, () => word).join(" ")}.</p>`;
}

// ---------------------------------------------------------------------------
// 1. A part divider whose page carries nothing but the part's own name.
// ---------------------------------------------------------------------------

const DIVIDER_DOCS: Doc[] = [
  { name: "cover.xhtml", body: `<p><img src="cover.jpg" alt=""/></p>` },
  { name: "prologue.xhtml", body: `<h1>Prologue</h1>${prose("prologue")}` },
  // The divider: two headings over an image, and not one word of prose.
  { name: "part1.xhtml", body: `<h1>PART ONE</h1><p><img src="orn.jpg" alt=""/></p><h1>MARKOV</h1>` },
  { name: "c01.xhtml", body: `<h1>1</h1>${prose("one")}` },
  { name: "c02.xhtml", body: `<h1>2</h1>${prose("two")}` },
  { name: "part2.xhtml", body: `<h1>PART TWO</h1><p><img src="orn.jpg" alt=""/></p><h1>TRUSH</h1>` },
  { name: "c03.xhtml", body: `<h1>3</h1>${prose("three")}` },
  { name: "epilogue.xhtml", body: `<h1>Epilogue</h1>${prose("epilogue")}` },
];

const DIVIDER_ROWS: Row[] = [
  { file: "cover.xhtml", title: "Cover", depth: 1 },
  { file: "prologue.xhtml", title: "Prologue", depth: 1 },
  { file: "part1.xhtml", title: "Part One | Markov", depth: 1 },
  { file: "c01.xhtml", title: "Chapter 1", depth: 2 },
  { file: "c02.xhtml", title: "Chapter 2", depth: 2 },
  { file: "part2.xhtml", title: "Part Two | Trush", depth: 1 },
  { file: "c03.xhtml", title: "Chapter 3", depth: 2 },
  { file: "epilogue.xhtml", title: "Epilogue", depth: 1 },
];

for (const format of ["nav", "ncx"] as const) {
  console.log(`\nA book whose parts are divider pages (${format})`);
  const result = await convertBookFile("epub", await epub(DIVIDER_DOCS, DIVIDER_ROWS, format));
  const titles = result.toc.map((t) => t.title);

  check(
    "the parts are in the contents",
    titles.includes("Part One | Markov") && titles.includes("Part Two | Trush"),
    titles.join(", ")
  );
  check("every chapter is still there", ["Chapter 1", "Chapter 2", "Chapter 3"].every((t) => titles.includes(t)), titles.join(", "));
  check("the contentless cover is not", !titles.includes("Cover"), titles.join(", "));
  check(
    "a part sits just before the first chapter inside it",
    titles.indexOf("Part One | Markov") === titles.indexOf("Chapter 1") - 1,
    titles.join(", ")
  );
  check(
    "the divider's own two lines aren't printed as well",
    !titles.includes("PART ONE") && !titles.includes("MARKOV"),
    titles.join(", ")
  );

  const contents = buildContents(result.toc as ReadingTocEntry[], "Test Book", result.wordCount);
  check(
    "so the chapters hang off their part, not off the prologue",
    shape(contents.body) ===
      "Prologue, Part One | Markov(Chapter 1, Chapter 2), Part Two | Trush(Chapter 3), Epilogue",
    shape(contents.body)
  );

  // The prologue's estimate is the giveaway: when the parts vanish it swallows
  // the whole book, and it should read as its own few hundred words.
  const prologue = contents.body[0];
  const part = contents.body[1];
  check(
    "and the prologue's length is the prologue's",
    prologue.minutes != null && part.minutes != null && prologue.minutes < part.minutes,
    `prologue ${prologue.minutes} vs part ${part.minutes}`
  );
}

// ---------------------------------------------------------------------------
// 2. A part and its first chapter landing on the same printed heading.
// ---------------------------------------------------------------------------
console.log("\nA part divider whose chapter opens with a heading of its own");

// The chapter prints a title of its own ("The Long Winter") where the contents
// says "Chapter One", so the book's heading is kept and stands in for that row.
// The part landed on the same spot and is a different place: it must survive
// alongside it, above it, rather than being suppressed with it.
const SHARED_DOCS: Doc[] = [
  { name: "part1.xhtml", body: `<h1>PART ONE</h1>` },
  { name: "c01.xhtml", body: `<h1>The Long Winter</h1>${prose("alpha")}` },
  { name: "c02.xhtml", body: `<h1>The Thaw</h1>${prose("beta")}` },
];
const SHARED_ROWS: Row[] = [
  { file: "part1.xhtml", title: "Part One: Beginnings", depth: 1 },
  { file: "c01.xhtml", title: "Chapter One", depth: 2 },
  { file: "c02.xhtml", title: "Chapter Two", depth: 2 },
];

const shared = await convertBookFile("epub", await epub(SHARED_DOCS, SHARED_ROWS, "nav"));
const sharedTitles = shared.toc.map((t) => t.title);
check(
  "the part is printed above the chapter's own heading",
  sharedTitles.slice(0, 2).join(" / ") === "Part One: Beginnings / The Long Winter",
  sharedTitles.join(", ")
);
check(
  "and the chapter keeps the nesting its nav row had",
  shared.toc[1]?.depth === 2 && shared.toc[0]?.depth === 1,
  sharedTitles.map((t, i) => `${t}=${shared.toc[i].depth}`).join(", ")
);

// ---------------------------------------------------------------------------
// 3. A book with no dividers at all is untouched.
// ---------------------------------------------------------------------------
console.log("\nA book with no parts");

const PLAIN_DOCS: Doc[] = [
  { name: "cover.xhtml", body: `<p><img src="cover.jpg" alt=""/></p>` },
  { name: "c01.xhtml", body: `<h1>Chapter 1</h1>${prose("alpha")}` },
  { name: "c02.xhtml", body: `<h1>Chapter 2</h1>${prose("beta")}` },
];
const PLAIN_ROWS: Row[] = [
  { file: "cover.xhtml", title: "Cover", depth: 1 },
  { file: "c01.xhtml", title: "Chapter 1", depth: 1 },
  { file: "c02.xhtml", title: "Chapter 2", depth: 1 },
];

const plain = await convertBookFile("epub", await epub(PLAIN_DOCS, PLAIN_ROWS, "nav"));
check(
  "reads exactly as its contents does",
  plain.toc.map((t) => t.title).join(", ") === "Chapter 1, Chapter 2",
  plain.toc.map((t) => t.title).join(", ")
);
check(
  "with nothing nested inside anything",
  shape(buildContents(plain.toc as ReadingTocEntry[], "Test Book", plain.wordCount).body) ===
    "Chapter 1, Chapter 2",
  shape(buildContents(plain.toc as ReadingTocEntry[], "Test Book", plain.wordCount).body)
);

console.log(failures === 0 ? "\nAll good." : `\n${failures} failing check(s).`);
process.exit(failures === 0 ? 0 : 1);
