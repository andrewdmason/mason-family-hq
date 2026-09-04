/**
 * Marks made across the two faces, checked in a real browser.
 *
 * A highlight made while reading in plain English has to (a) anchor to whole
 * paragraphs with the author's words as its quote, (b) paint exactly on the
 * plain face by finding its own sentence again, and (c) paint the whole
 * paragraph on the original face — never an arbitrary span picked out by
 * offsets that were measured in a different text. And a mark made in the
 * original must do the mirror of (c) on the plain face, while resolving exactly
 * as before on its own.
 *
 *   npx tsx scripts/verify-plain-anchors.mts
 */

import { build } from "esbuild";
import { chromium, type Browser } from "playwright";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const bundle = await build({
  stdin: {
    contents: `
      import { anchorFromRange, rangeForAnchor, renderedBlocks, ANCHOR_VERSION } from "./src/lib/reading/annotation-anchors";
      import { blockMap } from "./src/lib/reading/block-stream";
      import { plainDocumentHtml } from "./src/lib/reading/plain/render";
      globalThis.__lib = { anchorFromRange, rangeForAnchor, renderedBlocks, ANCHOR_VERSION, blockMap, plainDocumentHtml };
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "silent",
});
const LIB = bundle.outputFiles[0].text;

const ORIGINAL =
  `<h2 id="sec-0" class="reader-heading reader-h2">Chapter One</h2>` +
  `<p>The first ornate paragraph, in which the author says a great deal at length.</p>` +
  `<span class="page-anchor" id="page-1"></span>` +
  `<p>The second ornate paragraph, no less elaborate than the first, continues the thought.</p>` +
  `<p>The third paragraph is a quotation and stays as it is.</p>`;

const PLAIN_TEXTS: Record<number, string> = {
  1: "The first paragraph, in plain words: the author says a lot.",
  2: "The second paragraph, plainly: the thought goes on.",
};

let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<div id="content"></div>`);
  await page.addScriptTag({ content: LIB });

  await page.evaluate(
    ({ original, plainTexts }) => {
      (globalThis as never as { __args: unknown }).__args = { original, plainTexts };
    },
    { original: ORIGINAL, plainTexts: PLAIN_TEXTS }
  );
  // Plain JS as a string: tsx's transform would otherwise wrap every inner
  // function in a `__name` helper that does not exist inside the page.
  const result = await page.evaluate(`(() => {
    const lib = globalThis.__lib;
    const { original, plainTexts } = globalThis.__args;
    const container = document.getElementById("content");
    const blocks = lib.blockMap(original);
    const out = {};
    const state = {
      face: "plain",
      chapters: [{ index: 0, title: "Chapter One", anchorId: "sec-0", blockStart: 0, blockEnd: 4, charStart: 0, charEnd: 10000, status: "ready", error: null }],
      applied: new Set([0]),
      blocks: new Map(Object.entries(plainTexts).map(([i, text]) => [Number(i), { index: Number(i), chapterIndex: 0, kept: false, text }])),
      terms: [],
    };
    const faceTextOf = (i) => (plainTexts[i] ?? null);
    const nullFace = () => null;

    container.innerHTML = lib.plainDocumentHtml(original, blocks, [], state);
    const plainEls = Array.from(container.querySelectorAll("p, h2"));
    const textNode = plainEls[1].firstChild;
    const range = document.createRange();
    const sel = "in plain words";
    const at = textNode.data.indexOf(sel);
    range.setStart(textNode, at);
    range.setEnd(textNode, at + sel.length);
    const resolved = lib.anchorFromRange(range, container, { kind: "book", blocks, base: 0, faceTextOf });
    out.plainAnchor = resolved;
    if (resolved) {
      const own = lib.rangeForAnchor(resolved.anchor, container, lib.renderedBlocks(container, 0), faceTextOf, resolved.plainQuotedText);
      out.plainOwnFace = own ? own.toString() : null;
      container.innerHTML = original;
      const cross = lib.rangeForAnchor(resolved.anchor, container, lib.renderedBlocks(container, 0), undefined, resolved.plainQuotedText);
      out.plainOnOriginal = cross ? cross.toString() : null;
      out.originalP1 = blocks[1].text;
      out.expectedOffset = blocks[1].charStart;
    }

    container.innerHTML = original;
    const origEls = Array.from(container.querySelectorAll("p, h2"));
    const t2 = origEls[2].firstChild;
    const r2 = document.createRange();
    const sel2 = "no less elaborate";
    const at2 = t2.data.indexOf(sel2);
    r2.setStart(t2, at2);
    r2.setEnd(t2, at2 + sel2.length);
    const resolved2 = lib.anchorFromRange(r2, container, { kind: "book", blocks, base: 0, faceTextOf: nullFace });
    out.originalAnchor = resolved2;
    if (resolved2) {
      const exact = lib.rangeForAnchor(resolved2.anchor, container, lib.renderedBlocks(container, 0), nullFace, null);
      out.originalOwnFace = exact ? exact.toString() : null;
      container.innerHTML = lib.plainDocumentHtml(original, blocks, [], state);
      const crossed = lib.rangeForAnchor(resolved2.anchor, container, lib.renderedBlocks(container, 0), faceTextOf, null);
      out.originalOnPlain = crossed ? crossed.toString() : null;
      out.plainP2 = plainTexts[2];
    }

    container.innerHTML = original;
    const v2 = Object.assign({}, resolved2.anchor, { v: 2 });
    delete v2.face;
    const legacy = lib.rangeForAnchor(v2, container, lib.renderedBlocks(container, 0));
    out.legacy = legacy ? legacy.toString() : null;
    out.version = lib.ANCHOR_VERSION;
    return out;
  })()`);

  const r = result as {
    plainAnchor: { anchor: { face?: string; startOffset: number | null; endOffset: number | null; blockIndex: number; endBlockIndex: number | null; v: number }; quotedText: string | null; plainQuotedText: string | null; anchorCharOffset: number } | null;
    plainOwnFace: string | null;
    plainOnOriginal: string | null;
    originalP1: string;
    expectedOffset: number;
    originalAnchor: { anchor: { face?: string; startOffset: number | null } } | null;
    originalOwnFace: string | null;
    originalOnPlain: string | null;
    plainP2: string;
    legacy: string | null;
    version: number;
  };

  console.log("plain-face mark");
  check("anchor scheme is v3", r.version === 3);
  check("a selection in a plain paragraph makes a plain-face anchor", r.plainAnchor?.anchor.face === "plain");
  check("it is block-only", r.plainAnchor?.anchor.startOffset === null && r.plainAnchor?.anchor.endOffset === null);
  check("its quote is the author's paragraph", r.plainAnchor?.quotedText === r.originalP1, r.plainAnchor?.quotedText ?? "");
  check("it keeps the plain sentence", r.plainAnchor?.plainQuotedText === "in plain words");
  check("anchor_char_offset is the block's start", r.plainAnchor?.anchorCharOffset === r.expectedOffset, `${r.plainAnchor?.anchorCharOffset} vs ${r.expectedOffset}`);
  check("R21: it paints exactly on the plain face", r.plainOwnFace === "in plain words", r.plainOwnFace ?? "null");
  check("R21: it paints the whole paragraph on the original face", r.plainOnOriginal === r.originalP1, r.plainOnOriginal ?? "null");

  console.log("original-face mark");
  check("an original selection is an original-face anchor with offsets", r.originalAnchor?.anchor.face === "original" && r.originalAnchor?.anchor.startOffset != null);
  check("it paints exactly on its own face", r.originalOwnFace === "no less elaborate");
  check("it paints the whole paragraph on the plain face", r.originalOnPlain === r.plainP2, r.originalOnPlain ?? "null");
  check("a v2 anchor resolves identically under v3", r.legacy === "no less elaborate", r.legacy ?? "null");
} finally {
  await browser?.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
