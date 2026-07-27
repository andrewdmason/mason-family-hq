/**
 * An annotation anchor must mean the same passage whoever is looking at it.
 *
 * Stored anchors are global: `blockIndex` counts from the front of the book. The
 * DOM is not — the paged reader renders a few chapters — so every crossing goes
 * through a base offset. Get that wrong at creation time and the database holds
 * a window-local index that resolves to the wrong paragraph forever; get it
 * wrong at resolution time and existing highlights paint over the wrong text.
 *
 * So this creates anchors against one window and resolves them against a
 * different window and against the whole book, and requires all three to select
 * byte-identical text. It runs the real `anchorFromRange` and `rangeForAnchor`,
 * bundled from source, in real Chromium and real WebKit.
 *
 * It also checks the case that would be worst to get wrong quietly: an anchor
 * whose blocks are NOT in the window must resolve to nothing, even when the very
 * same sentence appears verbatim somewhere inside the window. Answering "not
 * here" is correct; finding the lookalike is not.
 *
 *   npx tsx scripts/verify-anchor-windows.mts
 */

import { build } from "esbuild";
import { chromium, webkit, type Browser, type Page } from "playwright";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const bundle = await build({
  stdin: {
    contents: `
      import { blockMap } from "./src/lib/reading/block-stream";
      import { anchorFromRange, rangeForAnchor, renderedBlocks } from "./src/lib/reading/annotation-anchors";
      import { segmentsOf, windowFor, windowHtml } from "./src/lib/reading/paged-window";
      Object.assign(globalThis, { blockMap, anchorFromRange, rangeForAnchor, renderedBlocks, segmentsOf, windowFor, windowHtml });
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "silent",
});
const BUNDLE = bundle.outputFiles[0].text;

/** The sentence deliberately repeated in two chapters, to bait a mis-resolve. */
const DECOY = "The bell above the door rang twice and nobody looked up at all.";

function buildBook(): string {
  let seed = 13579;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words = "the quick brown fox jumps over a lazy dog reading quietly by lamplight in deep winter".split(" ");
  const sentence = () =>
    Array.from({ length: 6 + Math.floor(rand() * 14) }, () => words[Math.floor(rand() * words.length)]).join(" ") + ".";

  let html = "";
  for (let c = 0; c < 10; c++) {
    html += `<h2 class="reader-heading reader-h2" id="sec-${c}">Chapter ${c + 1}</h2>`;
    const n = 8 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      if (i % 4 === 0) html += `<span class="page-anchor" id="pg-${c}-${i}"></span>`;
      // Chapters 2 and 7 carry the identical decoy paragraph.
      if (i === 3 && (c === 2 || c === 7)) html += `<p>${DECOY}</p>`;
      else html += `<p>${Array.from({ length: 1 + Math.floor(rand() * 3) }, sentence).join(" ")}</p>`;
    }
  }
  return html;
}

/** Runs in the page: create anchors in one window, resolve them in others. */
function crossResolve([fullHtml, decoy]: [string, string]) {
  const g = globalThis as never as Record<string, (...a: never[]) => never>;
  const blockMap = g.blockMap as unknown as (h: string) => never[];
  const anchorFromRange = g.anchorFromRange as unknown as (r: Range, c: HTMLElement, s: unknown) => never;
  const rangeForAnchor = g.rangeForAnchor as unknown as (a: unknown, c: HTMLElement, v: unknown) => Range | null;
  const segmentsOf = g.segmentsOf as unknown as (b: unknown[]) => { startBlock: number; endBlock: number; charStart: number }[];
  const windowHtml = g.windowHtml as unknown as (h: string, b: unknown[], w: unknown) => string;

  const blocks = blockMap(fullHtml) as unknown as {
    index: number; charStart: number; text: string; tag: string;
  }[];
  const segments = segmentsOf(blocks);

  const host = document.getElementById("host")!;
  /** Render blocks [a,b) and hand back the container plus its base. */
  const mount = (startBlock: number, endBlock: number) => {
    host.innerHTML = "";
    const el = document.createElement("div");
    el.innerHTML = windowHtml(fullHtml, blocks, { startBlock, endBlock, charStart: 0, charEnd: 0 });
    host.appendChild(el);
    return { el, base: startBlock };
  };

  const results = {
    compared: 0, mismatches: [] as string[],
    offsetChecked: 0, offsetBad: [] as string[],
    outOfWindow: 0, outOfWindowBad: [] as string[],
    decoyChecked: 0, decoyBad: [] as string[],
  };

  let seed = 24680;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // Windows A and B overlap on the middle segments, so the same blocks are
  // reachable from two different bases.
  const winA = { startBlock: segments[3].startBlock, endBlock: segments[6].endBlock };
  const winB = { startBlock: segments[4].startBlock, endBlock: segments[8].endBlock };
  const overlapStart = winB.startBlock;
  const overlapEnd = winA.endBlock;

  for (let n = 0; n < 120; n++) {
    // Pick a block inside the overlap, so every view can see it.
    const gi = overlapStart + Math.floor(rand() * (overlapEnd - overlapStart));
    const a = mount(winA.startBlock, winA.endBlock);
    const el = a.el.querySelectorAll("p, h1, h2, h3, h4, h5, h6")[gi - a.base] as HTMLElement;
    if (!el || !el.firstChild || !el.textContent) continue;
    const text = el.textContent;
    const from = Math.floor(rand() * Math.max(1, text.length - 20));
    const to = Math.min(text.length, from + 5 + Math.floor(rand() * 60));
    if (to <= from) continue;

    const range = document.createRange();
    range.setStart(el.firstChild, from);
    range.setEnd(el.firstChild, to);
    const expected = range.toString();

    const resolved = anchorFromRange(range, a.el, {
      kind: "book", blocks, base: a.base,
    } as never) as unknown as { anchor: { blockIndex: number }; anchorCharOffset: number } | null;
    if (!resolved) continue;
    results.compared++;

    // The stored index is global, and the char offset agrees with the stream.
    results.offsetChecked++;
    if (resolved.anchor.blockIndex !== gi) {
      results.offsetBad.push(`blockIndex ${resolved.anchor.blockIndex} !== ${gi}`);
    } else if (resolved.anchorCharOffset !== blocks[gi].charStart + from) {
      results.offsetBad.push(`charOffset ${resolved.anchorCharOffset} !== ${blocks[gi].charStart + from}`);
    }

    // Same anchor, three different views of the book.
    for (const [label, win] of [
      ["window B", winB],
      ["whole book", { startBlock: 0, endBlock: blocks.length }],
      ["window A again", winA],
    ] as const) {
      const v = mount(win.startBlock, win.endBlock);
      const els = Array.from(v.el.querySelectorAll("p, h1, h2, h3, h4, h5, h6")) as HTMLElement[];
      const got = rangeForAnchor(resolved.anchor, v.el, { base: v.base, els });
      const actual = got ? got.toString() : null;
      if (actual !== expected) {
        results.mismatches.push(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
        break;
      }
    }
  }

  // The decoy: an anchor on chapter 7's copy of a duplicated paragraph, resolved
  // against a window that holds chapter 2's identical copy. Must be null.
  const decoyBlocks = blocks.filter((b) => b.text === decoy).map((b) => b.index);
  results.decoyChecked = decoyBlocks.length;
  if (decoyBlocks.length === 2) {
    const [earlier, later] = decoyBlocks;
    const home = mount(later, later + 1);
    const el = home.el.querySelector("p") as HTMLElement;
    const r = document.createRange();
    r.setStart(el.firstChild!, 0);
    r.setEnd(el.firstChild!, decoy.length);
    const res = anchorFromRange(r, home.el, { kind: "book", blocks, base: home.base } as never) as unknown as
      { anchor: { blockIndex: number } } | null;
    if (!res) results.decoyBad.push("could not anchor the decoy");
    else {
      if (res.anchor.blockIndex !== later) results.decoyBad.push(`anchored ${res.anchor.blockIndex}, wanted ${later}`);
      // Now resolve it in a window containing ONLY the earlier, identical copy.
      const away = mount(earlier, earlier + 1);
      const els = Array.from(away.el.querySelectorAll("p, h1, h2, h3, h4, h5, h6")) as HTMLElement[];
      const got = rangeForAnchor(res.anchor, away.el, { base: away.base, els });
      if (got !== null) results.decoyBad.push(`resolved to a lookalike: ${JSON.stringify(got.toString().slice(0, 40))}`);
    }
  }

  // Any anchor well outside the window must simply be null.
  {
    const v = mount(segments[8].startBlock, segments[9].endBlock);
    const els = Array.from(v.el.querySelectorAll("p, h1, h2, h3, h4, h5, h6")) as HTMLElement[];
    for (const bi of [0, 1, 5, segments[2].startBlock]) {
      results.outOfWindow++;
      const got = rangeForAnchor(
        { v: 2, kind: "selection", blockIndex: bi, endBlockIndex: bi, startOffset: 0, endOffset: 5, quote: null },
        v.el,
        { base: v.base, els }
      );
      if (got !== null) results.outOfWindowBad.push(`block ${bi} resolved from a window that excludes it`);
    }
  }

  return results;
}

const html = buildBook();

for (const [engineName, launcher] of [["chromium", chromium], ["webkit", webkit]] as const) {
  console.log(`\n${engineName}`);
  let browser: Browser;
  try {
    browser = await launcher.launch();
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${engineName} wouldn't launch — ${(err as Error).message.split("\n")[0]}`);
    continue;
  }
  const page: Page = await browser.newPage();
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>.page-anchor{display:block;height:0}</style></head>
     <body><div id="host"></div></body></html>`
  );
  await page.addScriptTag({
    content: `globalThis.__name = globalThis.__name || ((fn) => fn);\n${BUNDLE}`,
  });
  const r = await page.evaluate(crossResolve, [html, DECOY] as [string, string]);
  await page.close();
  await browser.close();

  check("an anchor selects the same text from any window", r.mismatches.length === 0, r.mismatches.slice(0, 3).join(" | "));
  check("stored indices and char offsets are global, not window-local", r.offsetBad.length === 0, r.offsetBad.slice(0, 3).join(" | "));
  check("an anchor outside the window resolves to nothing", r.outOfWindowBad.length === 0, r.outOfWindowBad.join(" | "));
  check("a duplicate passage elsewhere is not mistaken for it", r.decoyBad.length === 0, r.decoyBad.join(" | "));
  check(
    "the comparison actually ran",
    r.compared > 60 && r.offsetChecked > 60 && r.outOfWindow === 4 && r.decoyChecked === 2,
    `${r.compared} anchors, ${r.outOfWindow} out-of-window, ${r.decoyChecked} decoys`
  );
}

console.log(
  failures === 0
    ? "\nAnchors mean the same passage from any window."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
