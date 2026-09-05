/**
 * The markup a real EPUB actually ships, and whether we can still read it.
 *
 * The case this exists for: a book whose every page closed its void elements
 * explicitly — `<meta ...></meta>`, `<link ...></link>` — which is valid XHTML
 * and what several publisher toolchains emit. Parsed as HTML those end tags have
 * nothing to close, which is a *fatal* parse error, so one such tag in the first
 * file took the whole book down and the shelf just said "Couldn't prepare".
 *
 * The fix can't simply be "parse as XML instead": the other half of the corpus
 * ships unclosed, sloppy markup that only HTML mode forgives. Both halves have
 * to keep working, which is what this checks.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-epub-markup.mts
 */

import JSZip from "jszip";
import { convertBookFile } from "@/lib/reading/convert";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A chapter's worth of prose, so there's real text to find afterwards. */
function prose(word: string): string {
  return `<p>${Array.from({ length: 40 }, () => word).join(" ")}.</p>`;
}

/**
 * Zip up a two-chapter book whose spine documents are handed in verbatim, so
 * each case can ship exactly the head and body markup it means to test.
 */
async function epub(docs: { name: string; xml: string }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  );
  for (const doc of docs) zip.file(`OEBPS/${doc.name}`, doc.xml);
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head/><docTitle><text>x</text></docTitle><navMap>${docs
      .map(
        (d, i) =>
          `<navPoint id="n${i}"><navLabel><text>Chapter ${i + 1}</text></navLabel>` +
          `<content src="${d.name}"/></navPoint>`
      )
      .join("")}</navMap></ncx>`
  );
  const manifest = docs
    .map((d, i) => `<item id="d${i}" href="${d.name}" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = docs.map((_, i) => `<itemref idref="d${i}"/>`).join("");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:identifier id="id">x</dc:identifier></metadata>
<manifest>${manifest}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
<spine toc="ncx">${spine}</spine></package>`
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// 1. Void elements closed explicitly — strict XHTML, fatal to an HTML parser.
// ---------------------------------------------------------------------------
console.log("\nA book that closes its void elements the XHTML way");

const STRICT = (n: number, word: string) => ({
  name: `c0${n}.xhtml`,
  xml: `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.1//EN' 'http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd'>
<html xml:lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta content="text/html; charset=UTF-8" http-equiv="Content-Type"></meta>
<title>Test Book</title>
<link rel="stylesheet" type="text/css" href="style.css"></link>
</head>
<body><h1>Chapter ${n}</h1>${prose(word)}</body>
</html>`,
});

const strict = await convertBookFile("epub", await epub([STRICT(1, "alpha"), STRICT(2, "beta")]));
check("both chapters survive", strict.toc.map((t) => t.title).join(", ") === "Chapter 1, Chapter 2", strict.toc.map((t) => t.title).join(", "));
check("and their prose comes with them", strict.html.includes("alpha") && strict.html.includes("beta"));
check("with a word count to match", strict.wordCount > 70, String(strict.wordCount));

// ---------------------------------------------------------------------------
// 2. Void elements left hanging — the half of the corpus a strict parser rejects.
// ---------------------------------------------------------------------------
console.log("\nA book that leaves its void elements hanging");

const LOOSE = (n: number, word: string) => ({
  name: `c0${n}.xhtml`,
  xml: `<html>
<head>
<meta charset="utf-8">
<title>Test Book</title>
</head>
<body><h1>Chapter ${n}</h1><p><img src="orn.jpg"></p>${prose(word)}</body>
</html>`,
});

const loose = await convertBookFile("epub", await epub([LOOSE(1, "gamma"), LOOSE(2, "delta")]));
check("both chapters survive", loose.toc.length === 2, loose.toc.map((t) => t.title).join(", "));
check("and their prose comes with them", loose.html.includes("gamma") && loose.html.includes("delta"));

// ---------------------------------------------------------------------------
// 3. One of each, in one book — neither mode can carry the whole spine.
// ---------------------------------------------------------------------------
console.log("\nA book with one page of each");

const mixed = await convertBookFile("epub", await epub([STRICT(1, "epsilon"), LOOSE(2, "zeta")]));
check("both chapters survive", mixed.toc.length === 2, mixed.toc.map((t) => t.title).join(", "));
check("and their prose comes with them", mixed.html.includes("epsilon") && mixed.html.includes("zeta"));

// ---------------------------------------------------------------------------
// 4. Named HTML entities in a strict file — the reader must see the character,
//    not the entity. The strict pass is XHTML rather than plain XML for this.
// ---------------------------------------------------------------------------
console.log("\nA strict book that spells its spaces and dashes as entities");

const entities = await convertBookFile(
  "epub",
  await epub([
    {
      name: "c01.xhtml",
      xml: `<?xml version='1.0' encoding='UTF-8'?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"></meta><title>Test Book</title></head>
<body><h1>Chapter 1</h1><p>Mr.&nbsp;Johnson&mdash;the author&mdash;wrote this.</p>${prose("eta")}</body>
</html>`,
    },
  ])
);
check(
  // The non-breaking space arrives as one, then joins the whitespace collapse
  // every block's text goes through — so what lands in the prose is a space.
  "the entities came through as characters",
  entities.html.includes("Mr. Johnson\u2014the author\u2014wrote this."),
  entities.html.slice(0, 200)
);
check("and not as their spelling", !entities.html.includes("&nbsp;") && !entities.html.includes("&mdash;"));

console.log(failures === 0 ? "\nAll good." : `\n${failures} failing check(s).`);
process.exit(failures === 0 ? 0 : 1);
