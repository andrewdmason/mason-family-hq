/**
 * The "start a chat here" gaps, measured against a real paginated page.
 *
 * Hovering between two paragraphs offers a target that, when clicked, stores an
 * anchor. Two things about it fail silently and are therefore checked here
 * rather than reasoned about:
 *
 *  - The index it hands back is GLOBAL, while the paged reader renders a window
 *    of a chapter. A base missing at creation time stores a window-local index
 *    that resolves to the wrong paragraph forever (see RenderedBlocks).
 *  - A paragraph that continues from the previous column has a fragment at the
 *    top of this one. That edge is a column break, not a paragraph boundary, and
 *    offering it would put a chat "between" two paragraphs that aren't adjacent.
 *
 * It also pins the placement claim the affordance rests on in paged mode: the
 * button centres on its column's left text edge, and so never lands on the
 * chat markers already sitting centred in the column gap.
 *
 * Runs the real `measureGapTargets` in real Chromium and real WebKit, because
 * column fragmentation is the browser's opinion and the device that matters runs
 * WebKit.
 *
 *   npx tsx scripts/verify-gap-targets.mts
 */

import { build } from "esbuild";
import { chromium, webkit, type Browser } from "playwright";
import { COLUMN_GAP } from "../src/lib/reading/reader-settings";
import { PAGE_PAD_TOP, type PageGeometry } from "../src/lib/reading/paged-geometry";

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
      import { measureGapTargets } from "./src/components/reading/annotations/gutter-placement";
      Object.assign(globalThis, { measureGapTargets });
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "silent",
});
// tsx compiles this file with keepNames, so the callbacks handed to
// page.evaluate reach the browser referring to esbuild's helper. Same shim as
// verify-anchor-windows.mts.
const MEASURE_JS = `globalThis.__name = globalThis.__name || ((fn) => fn);\n${bundle.outputFiles[0].text}`;

/**
 * A book as an array of blocks, so the test can say what block 412 actually is.
 * Each block opens with its own index in the text, which is what makes the
 * global-index check meaningful rather than circular.
 *
 * Page anchors ride along with the block that follows them, the way the
 * converter emits them — they are not block elements and must not be counted.
 */
function buildBook(blockCount: number): string[] {
  let seed = 20260729;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words =
    "the quick brown fox jumps over a lazy dog while reading quietly by lamplight in winter".split(
      " "
    );
  const sentence = () => {
    const n = 8 + Math.floor(rand() * 22);
    return Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ") + ".";
  };

  const blocks: string[] = [];
  for (let i = 0; i < blockCount; i++) {
    const tag = `[b${i}]`;
    if (i % 40 === 0) {
      blocks.push(`<h2 class="reader-heading reader-h2">${tag} Chapter ${i / 40 + 1}</h2>`);
      continue;
    }
    const anchor = i % 3 === 0 ? `<span class="page-anchor" id="pg-${i}"></span>` : "";
    // Long paragraphs on purpose: the interesting case is one that spills across
    // a column boundary, and short ones never would.
    const body = Array.from({ length: 3 + Math.floor(rand() * 6) }, sentence).join(" ");
    blocks.push(
      i % 17 === 0
        ? `${anchor}<blockquote>${tag} ${body}</blockquote>`
        : `${anchor}<p>${tag} ${body}</p>`
    );
  }
  return blocks;
}

/** The effective stylesheet, hand-written from reader-prose.ts. */
const PROSE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; }
  p { margin-bottom: 1.25rem; }
  blockquote { margin: 1rem 0; border-left: 2px solid #ccc; padding-left: 1rem; font-style: italic;
               break-inside: avoid; }
  .page-anchor { display: block; height: 0; }
  .reader-heading { margin-top: 0; text-align: center; text-wrap: balance;
                    break-before: column; -webkit-column-break-before: always;
                    break-inside: avoid; }
  .reader-h2 { margin-bottom: 1.75rem; font-size: 1.25rem; font-weight: 500; }
  #flow { font-size: 1.125rem; line-height: 1.6; text-align: left; hyphens: manual;
          column-fill: auto; overflow: visible; }
`;

function geometryFor(colW: number, pageH: number, cols: 1 | 2, clipW: number): PageGeometry {
  const colStride = colW + COLUMN_GAP;
  const viewW = cols * colW + (cols - 1) * COLUMN_GAP;
  return {
    colW,
    gap: COLUMN_GAP,
    pageH,
    cols,
    viewW,
    colStride,
    pageStride: cols * colStride,
    offsetX: Math.max(0, Math.round((clipW - viewW) / 2)),
  };
}

/**
 * What the page looks like from the outside: the targets the reader would be
 * offered, plus an independent reading of the same DOM to check them against.
 */
type PageReport = {
  targets: { blockIndex: number; top: number; column: { left: number; width: number } | null }[];
  /** Block index → the [bN] tag actually in that element, for the global-index check. */
  tags: Record<number, string>;
  /** Independently computed: blocks whose own start is on this page, below a column top. */
  expected: number[];
  /** Blocks with a fragment at a column top on this page that do NOT start there. */
  continued: number[];
  /** Viewport x of every marker the right gutter would place on this page. */
  markerCentres: number[];
};

async function readPage(
  browser: Browser,
  blocksHtml: string,
  geom: PageGeometry,
  pageIndex: number,
  base: number,
  clip: { w: number; h: number }
): Promise<PageReport> {
  const page = await browser.newPage({ viewport: { width: clip.w, height: clip.h } });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${PROSE_CSS}
       #viewport { position: fixed; inset: 0; overflow: hidden; }
       #clip { position: absolute; overflow: hidden;
               left: ${geom.offsetX}px; top: ${PAGE_PAD_TOP}px;
               width: ${geom.viewW}px; height: ${geom.pageH}px; }
       #flow { width: ${geom.colW}px; height: ${geom.pageH}px; column-count: 1;
               column-gap: ${geom.gap}px;
               transform: translate3d(${-pageIndex * geom.pageStride}px, 0, 0); }
     </style></head>
     <body><div id="viewport"><div id="clip"><div id="flow">${blocksHtml}</div></div></div></body></html>`
  );
  await page.addScriptTag({ content: MEASURE_JS });

  const report = await page.evaluate(
    ({ geom, pageIndex, base, padTop }) => {
      const flow = document.getElementById("flow")!;
      const viewport = document.getElementById("viewport") as HTMLDivElement;
      const paged = { geom, pageIndex, viewport };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const targets = (globalThis as any).measureGapTargets(flow, paged, base);

      const flowLeft = flow.getBoundingClientRect().left;
      const view = viewport.getBoundingClientRect();
      const els = Array.from(
        flow.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre")
      );
      const colOf = (x: number) => Math.max(0, Math.floor((x - flowLeft + 2) / geom.colStride));

      const tags: Record<number, string> = {};
      const expected: number[] = [];
      const continued: number[] = [];
      els.forEach((el, i) => {
        const blockIndex = base + i;
        const match = /\[b(\d+)\]/.exec(el.textContent ?? "");
        if (match) tags[blockIndex] = match[0];
        const rects = Array.from(el.getClientRects());
        if (rects.length === 0) return;
        const startsHere =
          Math.floor(colOf(rects[0].left) / geom.cols) === pageIndex &&
          rects[0].top - view.top > padTop + 2;
        if (startsHere && blockIndex > 0) expected.push(blockIndex);
        // A fragment sitting at a column top on this page that isn't the block's
        // own beginning — the false-gap case.
        const atTop = rects.some(
          (r, k) =>
            k > 0 &&
            Math.floor(colOf(r.left) / geom.cols) === pageIndex &&
            r.top - view.top <= padTop + 2
        );
        if (atTop) continued.push(blockIndex);
      });

      // Where the right-hand chat markers land, for the no-collision check: the
      // rule from useGutterPlacement, applied to every block on this page.
      const markerCentres: number[] = [];
      for (const el of els) {
        for (const r of el.getClientRects()) {
          const col = colOf(r.left);
          if (Math.floor(col / geom.cols) !== pageIndex) continue;
          const textRight = flowLeft + col * geom.colStride + geom.colW;
          const isOuter = col % geom.cols === geom.cols - 1;
          markerCentres.push(
            Math.round((isOuter ? textRight + 12 : textRight + geom.gap / 2) - view.left)
          );
          break;
        }
      }

      return { targets, tags, expected, continued, markerCentres };
    },
    { geom, pageIndex, base, padTop: PAGE_PAD_TOP }
  );

  await page.close();
  return report as PageReport;
}

const BOOK = buildBook(600);
const CASES = [
  { name: "MacBook, two columns", colW: 576, pageH: 792, cols: 2 as const, clipW: 1440 },
  { name: "iPad landscape, two columns", colW: 505, pageH: 726, cols: 2 as const, clipW: 1180 },
  { name: "phone, one column", colW: 320, pageH: 600, cols: 1 as const, clipW: 390 },
];

/** The window the paged reader would render: a slice of the book, not the book. */
const WINDOW_BASE = 120;
const WINDOW_END = 400;

for (const [engineName, launcher] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  console.log(`\n${engineName}`);
  let browser: Browser;
  try {
    browser = await launcher.launch();
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${engineName} wouldn't launch — ${(err as Error).message.split("\n")[0]}`);
    continue;
  }

  for (const c of CASES) {
    const clipH = c.pageH + PAGE_PAD_TOP + 52;
    const geom = geometryFor(c.colW, c.pageH, c.cols, c.clipW);
    const windowHtml = BOOK.slice(WINDOW_BASE, WINDOW_END).join("");

    const seen = new Set<number>();
    let sawContinued = false;
    let anyTargets = 0;

    for (const pageIndex of [0, 1, 2, 3]) {
      const r = await readPage(browser, windowHtml, geom, pageIndex, WINDOW_BASE, {
        w: c.clipW,
        h: clipH,
      });
      anyTargets += r.targets.length;
      if (r.continued.length > 0) sawContinued = true;

      const got = r.targets.map((t) => t.blockIndex).sort((a, b) => a - b);
      check(
        `${c.name} p${pageIndex}: offers exactly the gaps that are on the page`,
        JSON.stringify(got) === JSON.stringify(r.expected.slice().sort((a, b) => a - b)),
        `got ${got.length}, expected ${r.expected.length}`
      );

      // The false-gap case: a paragraph flowing in from the previous column.
      const falseGaps = r.targets.filter(
        (t) => r.continued.includes(t.blockIndex) && !r.expected.includes(t.blockIndex)
      );
      check(
        `${c.name} p${pageIndex}: no gap offered at a column break`,
        falseGaps.length === 0,
        `${falseGaps.length} of ${r.continued.length} continued blocks offered`
      );

      // Global indices. The window starts at block 120, so a target whose index
      // is its DOM position would name a paragraph 120 blocks earlier.
      const misnamed = r.targets.filter((t) => r.tags[t.blockIndex] !== `[b${t.blockIndex}]`);
      check(
        `${c.name} p${pageIndex}: indices are global, not window-local`,
        misnamed.length === 0,
        misnamed.length > 0
          ? `block ${misnamed[0].blockIndex} is actually ${r.tags[misnamed[0].blockIndex]}`
          : undefined
      );

      const columnLefts = new Set(
        Array.from({ length: geom.cols }, (_, i) => geom.offsetX + i * geom.colStride)
      );
      const offColumn = r.targets.filter(
        (t) => !t.column || !columnLefts.has(t.column.left) || t.column.width !== geom.colW
      );
      check(
        `${c.name} p${pageIndex}: every target belongs to a column on this page`,
        offColumn.length === 0,
        offColumn.length > 0 ? `first at left ${offColumn[0].column?.left}` : undefined
      );

      // The placement claim: a 24px button centred on the column's left text edge
      // never overlaps a 24px marker centred in the gap to its left.
      const collisions = r.targets.filter((t) =>
        r.markerCentres.some((m) => Math.abs(m - (t.column?.left ?? 0)) < 24)
      );
      check(
        `${c.name} p${pageIndex}: the add button clears the chat markers`,
        collisions.length === 0,
        collisions.length > 0
          ? `button at ${collisions[0].column?.left} vs markers ${[...new Set(r.markerCentres)].join(",")}`
          : undefined
      );

      const overlap = got.filter((i) => seen.has(i));
      check(
        `${c.name} p${pageIndex}: no gap is offered on two pages`,
        overlap.length === 0,
        `${overlap.length} repeated`
      );
      got.forEach((i) => seen.add(i));
    }

    check(`${c.name}: pages actually offered gaps`, anyTargets > 0, `${anyTargets} across 4 pages`);
    check(
      `${c.name}: the sample included paragraphs continuing across a column`,
      sawContinued,
      "nothing was tested — widen the sample"
    );
  }

  // Scrolling: the whole book in one column, every top-level block but the first.
  {
    const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${PROSE_CSS}
         #flow { width: 600px; column-count: initial; }</style></head>
       <body><div id="flow">${BOOK.join("")}</div></body></html>`
    );
    await page.addScriptTag({ content: MEASURE_JS });
    const ok = await page.evaluate(() => {
      const flow = document.getElementById("flow")!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const targets = (globalThis as any).measureGapTargets(flow, null, 0);
      const els = Array.from(
        flow.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre")
      );
      const flowTop = flow.getBoundingClientRect().top;
      return {
        count: targets.length,
        expected: els.length - 1,
        indicesOk: targets.every(
          (t: { blockIndex: number }, i: number) => t.blockIndex === i + 1
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        topsOk: targets.every((t: any, i: number) => {
          const want = els[i + 1].getBoundingClientRect().top - flowTop;
          return Math.abs(t.top - want) < 0.5 && t.column === null;
        }),
      };
    });
    await page.close();
    check("scrolling: one target per block after the first", ok.count === ok.expected,
      `${ok.count} vs ${ok.expected}`);
    check("scrolling: indices line up with the blocks", ok.indicesOk);
    check("scrolling: tops sit on the block, with no column", ok.topsOk);
  }

  await browser.close();
}

console.log(
  failures === 0
    ? "\nGap targets land on real paragraph boundaries, on the right page, with global indices."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
