/**
 * The pictures in a book, and the line under them.
 *
 * A converted book used to be text and nothing else: the sanitizer had no <img>
 * in its allow-list, so every plate, diagram and ornament was dropped on the way
 * in, and a caption — which does survive, being a paragraph — arrived set as
 * body prose, reading as the opening of the next thought rather than as a label
 * for the picture that was no longer there.
 *
 * What this checks is that pictures now come through, and that carrying them
 * costs the rest of the reader nothing. The load-bearing property is the
 * character space: annotation anchors, quiz page scoping and the paged windows
 * are all measured against a block stream the browser rebuilds from the same
 * HTML, and a picture the two sides counted differently would silently move
 * every highlight after it.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-epub-images.mts
 */

import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";
import { convertBookFile } from "@/lib/reading/convert";
import { blockMap, isCaptionBlock, isFigureBlock } from "@/lib/reading/block-stream";
import { mechanicalClean } from "@/lib/reading/audio/clean";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A real, decodable picture of a given size. */
function picture(width: number, height: number, colour: string): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

function prose(word: string): string {
  return `<p>${Array.from({ length: 40 }, () => word).join(" ")}.</p>`;
}

type Doc = { name: string; xml: string };

/**
 * A book whose spine documents and image files are handed in verbatim, so each
 * case ships exactly the markup it means to test. The cover is declared the
 * EPUB2 way, which is what most of the corpus does.
 */
async function epub(
  docs: Doc[],
  images: { name: string; bytes: Buffer }[],
  opts: { cover?: string } = {}
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  );
  for (const doc of docs) zip.file(`OEBPS/${doc.name}`, doc.xml);
  for (const img of images) zip.file(`OEBPS/images/${img.name}`, img.bytes);
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
  const manifest =
    docs
      .map((d, i) => `<item id="d${i}" href="${d.name}" media-type="application/xhtml+xml"/>`)
      .join("") +
    images
      .map((m, i) => `<item id="i${i}" href="images/${m.name}" media-type="image/png"/>`)
      .join("");
  const coverIndex = opts.cover ? images.findIndex((m) => m.name === opts.cover) : -1;
  const coverMeta = coverIndex >= 0 ? `<meta name="cover" content="i${coverIndex}"/>` : "";
  const spine = docs.map((_, i) => `<itemref idref="d${i}"/>`).join("");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:identifier id="id">x</dc:identifier>${coverMeta}</metadata>
<manifest>${manifest}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
<spine toc="ncx">${spine}</spine></package>`
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Wrap body markup in the XHTML a spine document is. */
function doc(name: string, body: string): Doc {
  return {
    name,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>t</title></head>
<body>${body}</body></html>`,
  };
}

/** The picture markup most books ship: an <img> alone inside a paragraph. */
const PLATE = `<p class="image"><img src="images/plate.png" alt="image"/></p>`;
const CAPTION = `<p class="caption">1. Tree of Life and Death. Miniature by Berthold Furtmeyer.</p>`;

const IMAGES = [
  { name: "cover.png", bytes: picture(60, 90, "#334455") },
  { name: "plate.png", bytes: picture(400, 560, "#aa3311") },
];

// ---------------------------------------------------------------------------
console.log("\nA plate and its caption");
// ---------------------------------------------------------------------------
const book = await convertBookFile(
  "epub",
  await epub(
    [
      doc("cover.xhtml", `<div><img src="images/cover.png" alt="cover-image"/></div>`),
      doc("ch1.xhtml", `<h1>The Shadow</h1>${prose("alpha")}${PLATE}${CAPTION}${prose("beta")}`),
    ],
    IMAGES,
    { cover: "cover.png" }
  )
);
const blocks = blockMap(book.html);
const figures = blocks.filter(isFigureBlock);
const captions = blocks.filter(isCaptionBlock);

check("the plate arrives as a block of its own", figures.length === 1, `${figures.length} figures`);
check("carrying the picture inline", /<img[^>]+src="data:image\/(png|jpeg);base64,/.test(book.html));
check(
  "at its own size, so the page can reserve the space before it decodes",
  /width="400"[^>]*height="560"/.test(book.html) || /width="400" height="560"/.test(book.html),
  book.html.match(/<img[^>]*width="[^"]*" height="[^"]*"/)?.[0]?.slice(0, 60)
);
check("the plate contributes no text", figures[0]?.text === "", JSON.stringify(figures[0]?.text));
check("the caption is a caption, not prose", captions.length === 1, `${captions.length} captions`);
check(
  "and reads as it was written",
  captions[0]?.text.startsWith("1. Tree of Life and Death."),
  captions[0]?.text
);
check("the caption follows the plate", captions[0]?.index === figures[0]?.index + 1);
check("the picture is counted", book.imagesInlined === 1, String(book.imagesInlined));

// The whole point of emitting a picture as a block: the character space the
// browser rebuilds has to be the one the server recorded, to the character.
const last = blocks[blocks.length - 1];
check(
  "the char space the browser rebuilds is the one the server counted",
  last.charStart + last.text.length + 1 === book.charCount,
  `${last.charStart + last.text.length + 1} vs ${book.charCount}`
);
check(
  "and a picture adds no words to the book's length",
  book.wordCount === blocks.reduce((n, b) => n + (b.text.trim() ? b.text.trim().split(/\s+/).length : 0), 0),
  String(book.wordCount)
);

// ---------------------------------------------------------------------------
console.log("\nThe cover is not the first page of the book");
// ---------------------------------------------------------------------------
check("the shelf gets the cover", book.coverImageDataUrl != null);
check(
  "but the book does not open with it again",
  figures.length === 1,
  `${figures.length} pictures in the body`
);

// ---------------------------------------------------------------------------
console.log("\nThe other shapes publishers ship");
// ---------------------------------------------------------------------------
const shapes = await convertBookFile(
  "epub",
  await epub(
    [
      doc("cover.xhtml", `<p>front matter</p>`),
      doc(
        "ch1.xhtml",
        `<h1>One</h1>${prose("alpha")}` +
          `<figure><img src="images/plate.png"/><figcaption>Read from a figcaption.</figcaption></figure>` +
          `<div><svg viewBox="0 0 400 560"><image width="400" height="560" xlink:href="images/plate.png"/></svg></div>` +
          prose("beta")
      ),
    ],
    IMAGES
  )
);
const shapeBlocks = blockMap(shapes.html);
check(
  "a <figure> wrapper gives up its picture",
  shapeBlocks.filter(isFigureBlock).length === 2,
  `${shapeBlocks.filter(isFigureBlock).length}`
);
check(
  "a <figcaption> is read at all — it never used to be",
  shapeBlocks.some((b) => isCaptionBlock(b) && b.text === "Read from a figcaption.")
);
check(
  "an SVG-wrapped <image> is a picture too",
  shapeBlocks.filter(isFigureBlock).length === 2
);
check("the same file is decoded once", shapes.imagesInlined === 1, String(shapes.imagesInlined));

// ---------------------------------------------------------------------------
console.log("\nA picture that can't be read doesn't take the book with it");
// ---------------------------------------------------------------------------
const broken = await convertBookFile(
  "epub",
  await epub(
    [
      doc("cover.xhtml", `<p>front matter</p>`),
      doc(
        "ch1.xhtml",
        `<h1>One</h1>${prose("alpha")}<p><img src="images/broken.png"/></p>` +
          `<p><img src="images/missing.png"/></p>${prose("beta")}`
      ),
    ],
    [{ name: "broken.png", bytes: Buffer.from("not an image at all") }]
  )
);
check("the prose survives", broken.html.includes("alpha") && broken.html.includes("beta"));
check(
  "and no empty frame is left where a picture failed",
  blockMap(broken.html).filter(isFigureBlock).length === 0
);

// ---------------------------------------------------------------------------
console.log("\nA page that is only a plate is still a page");
// ---------------------------------------------------------------------------
const plateOnly = await convertBookFile(
  "epub",
  await epub(
    [
      doc("cover.xhtml", `<div><img src="images/cover.png" alt="cover-image"/></div>`),
      doc("ch1.xhtml", `<h1>One</h1>${prose("alpha")}`),
      doc("plate.xhtml", `<div><img src="images/plate.png"/></div>`),
      doc("ch2.xhtml", `<h1>Two</h1>${prose("beta")}`),
    ],
    IMAGES,
    { cover: "cover.png" }
  )
);
check(
  "a leaf carrying nothing but a plate is kept",
  blockMap(plateOnly.html).filter(isFigureBlock).length === 1
);

// ---------------------------------------------------------------------------
console.log("\nThe rest of the reader has nothing to say about a picture");
// ---------------------------------------------------------------------------
const narration = mechanicalClean(blocks, 0);
check(
  "the narrator is never handed a plate to read aloud",
  !narration.some((n) => isFigureBlock(blocks[n.index])),
  `${narration.length} narrated blocks`
);
check(
  "but it does read the caption",
  narration.some((n) => n.text.includes("Tree of Life and Death")),
);

console.log(failures === 0 ? "\nAll good." : `\n${failures} failing check(s).`);
if (failures > 0) process.exit(1);
