/**
 * A chapter opens a page, and never the middle of one.
 *
 * On a two-column spread the browser's own break rule is only half an answer: it
 * puts a chapter at the top of a fresh COLUMN, and every other column is the
 * right-hand half of a page. So a chapter came up beside the last column of the
 * chapter before it, with the page turn — the thing that says "a new chapter
 * starts here" — already behind you.
 *
 * The fix cuts that page short instead: the closing column keeps its half, the
 * other half goes white, and the chapter opens the next page. Nothing about the
 * text moves to arrange it, which is the whole reason it's done by cutting pages
 * rather than by inserting blank columns — see Pages in paged-geometry.ts.
 *
 * Checked against real browsers, in the layout the reader actually paints: a
 * strip-wide multi-column flow, translated by whole columns behind a clip box.
 * Column breaking is the engine's opinion, and the device this family reads on
 * runs WebKit.
 *
 *   npx tsx scripts/verify-chapter-pages.mts
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

/**
 * A book whose chapters land in both parities.
 *
 * Irregular lengths on purpose: a chapter every 40 paragraphs would open on the
 * same side of the spread every time, which is the one case the old arithmetic
 * got right. Two of them are a part title with a chapter directly under it, which
 * is the case that has to take two pages.
 */
function buildBook(): string {
  let seed = 20260807;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words =
    "the quick brown fox jumps over a lazy dog while reading quietly by lamplight in winter".split(
      " "
    );
  const sentence = () => {
    const n = 8 + Math.floor(rand() * 22);
    return (
      Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ") + "."
    );
  };

  const out: string[] = [];
  let chapter = 0;
  for (let i = 0; i < 600; i++) {
    // 17, 23, 31, 41 paragraphs and so on: no two chapters the same length, so
    // the openings walk through every offset within a spread.
    if (i === 0 || i % 17 === 0 || i % 23 === 0 || i % 31 === 0) {
      chapter += 1;
      // Every fifth chapter opens a part, so a heading follows a heading.
      if (chapter % 5 === 0) {
        out.push(`<h1 class="reader-heading reader-h1">Part ${chapter / 5}</h1>`);
      }
      out.push(`<h2 id="sec-${chapter}" class="reader-heading reader-h2">Chapter ${chapter}</h2>`);
      continue;
    }
    const body = Array.from({ length: 2 + Math.floor(rand() * 5) }, sentence).join(" ");
    out.push(`<p>${body}</p>`);
  }
  return out.join("");
}

const HTML = buildBook();

/** The effective stylesheet, hand-written from reader-prose.ts. */
const PROSE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; }
  p { margin-bottom: 1.25rem; }
  .reader-heading { margin-top: 0; text-align: center; text-wrap: balance;
                    break-before: column; -webkit-column-break-before: always;
                    break-inside: avoid; }
  .reader-h1 { margin-bottom: 0.75rem; font-size: 1.875rem; font-weight: 600; }
  .reader-h2 { margin-bottom: 1.75rem; font-size: 1.25rem; font-weight: 500; }
  #flow { font-size: 1.125rem; line-height: 1.6; text-align: left; hyphens: manual;
          column-fill: auto; overflow: visible; }
`;

const bundle = await build({
  stdin: {
    contents: `
      import { measurePages } from "./src/lib/reading/paged-position";
      import {
        colsOnPage, columnsInWidth, firstColOfPage, pageCount, pageOffset, pageWidth,
      } from "./src/lib/reading/paged-geometry";
      Object.assign(globalThis, {
        measurePages, colsOnPage, columnsInWidth, firstColOfPage, pageCount, pageOffset, pageWidth,
      });
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "silent",
});
// tsx compiles this file with keepNames, so the callback handed to page.evaluate
// reaches the browser referring to esbuild's helper. Same shim as the other
// measurement scripts.
const MEASURE_JS = `globalThis.__name = globalThis.__name || ((fn) => fn);\n${bundle.outputFiles[0].text}`;

function geometryFor(colW: number, pageH: number, cols: 1 | 2, clipW: number): PageGeometry {
  const viewW = cols * colW + (cols - 1) * COLUMN_GAP;
  return {
    colW,
    gap: COLUMN_GAP,
    pageH,
    cols,
    viewW,
    colStride: colW + COLUMN_GAP,
    offsetX: Math.max(0, Math.round((clipW - viewW) / 2)),
  };
}

const CASES = [
  { name: "MacBook, two columns", colW: 576, pageH: 792, cols: 2 as const, clipW: 1512 },
  { name: "iPad landscape, two columns", colW: 505, pageH: 726, cols: 2 as const, clipW: 1194 },
  { name: "phone, one column", colW: 320, pageH: 600, cols: 1 as const, clipW: 390 },
];

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
    const geom = geometryFor(c.colW, c.pageH, c.cols, c.clipW);
    const page = await browser.newPage({
      viewport: { width: c.clipW, height: c.pageH + PAGE_PAD_TOP + 52 },
    });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${PROSE_CSS}
         #viewport { position: fixed; inset: 0; overflow: hidden; }
         #clip { position: absolute; overflow: hidden;
                 left: ${geom.offsetX}px; top: ${PAGE_PAD_TOP}px;
                 width: ${geom.viewW}px; height: ${geom.pageH}px; }
         #flow { width: ${geom.colW}px; height: ${geom.pageH}px;
                 column-width: ${geom.colW}px; column-gap: ${geom.gap}px; }
       </style></head>
       <body><div id="viewport"><div id="clip"><div id="flow">${HTML}</div></div></div></body></html>`
    );
    await page.addScriptTag({ content: MEASURE_JS });

    const report = await page.evaluate(({ geom }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = globalThis as any;
      const clip = document.getElementById("clip")!;
      const flow = document.getElementById("flow")!;

      // The reader's own two-step: fragment at one column wide, then give the box
      // every column the book turned out to need (fitFlowToStrip).
      const columns = g.columnsInWidth(flow.scrollWidth, geom) as number;
      flow.style.width = `${columns * geom.colStride - geom.gap}px`;

      const pages = g.measurePages(flow, geom);
      const total = g.pageCount(pages) as number;
      const headings = Array.from(document.querySelectorAll<HTMLElement>(".reader-heading"));

      /** Pages where a heading is visible, and where in the page it appeared. */
      const seen = headings.map(() => [] as { page: number; dx: number; top: number }[]);
      const widths: number[] = [];
      for (let p = 0; p < total; p++) {
        flow.style.transform = `translate3d(${-(g.pageOffset(p, pages, geom) as number)}px, 0, 0)`;
        const width = g.pageWidth(p, pages, geom) as number;
        clip.style.width = `${width}px`;
        widths.push(width);
        const box = clip.getBoundingClientRect();
        headings.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          // Visible means "inside the clip", which is the only thing the reader
          // can see. A heading in the column immediately past the clip's right
          // edge is the next page's, and that is the entire point.
          if (r.right <= box.left + 1 || r.left >= box.right - 1) return;
          seen[i].push({ page: p, dx: Math.round(r.left - box.left), top: Math.round(r.top - box.top) });
        });
      }

      // Every page is `cols` columns wide unless a chapter opens the next one —
      // or unless the book ran out, which the last page of a strip is allowed to
      // do and has always done.
      const wrongWidth: number[] = [];
      let shortForAChapter = 0;
      for (let p = 0; p < total; p++) {
        const short = (g.colsOnPage(p, pages) as number) < geom.cols;
        const expected = short ? geom.colW : geom.viewW;
        const opensNext =
          p + 1 < total && pages.opens.includes(g.firstColOfPage(p + 1, pages) as number);
        if (widths[p] !== expected || (short && !opensNext && p !== total - 1)) {
          wrongWidth.push(p);
        }
        if (short && opensNext) shortForAChapter += 1;
      }

      return {
        columns,
        total,
        headings: headings.length,
        // A chapter anywhere but flush with the top-left of a page it appears on.
        misplaced: seen
          .map((where, i) => ({ i, where }))
          .filter(({ where }) => where.some((w) => w.dx > 1))
          .map(({ i, where }) => `#${i} at +${where.map((w) => w.dx).join("/")}px`),
        // A chapter no page shows at all, or one showing twice.
        unreachable: seen
          .map((where, i) => ({ i, count: where.length }))
          .filter(({ count }) => count !== 1)
          .map(({ i, count }) => `#${i} on ${count} pages`),
        wrongWidth,
        // What it costs: how many pages give up a column so a chapter can open.
        short: shortForAChapter,
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }, { geom });

    check(
      `${c.name}: the book laid out`,
      report.columns > 10 && report.total > 5 && report.headings > 20,
      `${report.headings} chapters over ${report.columns} columns and ${report.total} pages`
    );
    check(
      `${c.name}: every chapter opens the page it appears on`,
      report.misplaced.length === 0,
      report.misplaced.join(", ")
    );
    check(
      `${c.name}: every chapter is on exactly one page`,
      report.unreachable.length === 0,
      report.unreachable.join(", ")
    );
    check(
      `${c.name}: a page is only ever cut short to open a chapter`,
      report.wrongWidth.length === 0,
      `pages ${report.wrongWidth.slice(0, 8).join(", ")}`
    );
    // Recorded rather than asserted: it is the price of the rule, and print pays
    // it too. A one-column layout pays nothing, which is why it reads as zero on
    // the phone. High here because this book's chapters are deliberately two or
    // three columns long — a real one turns fewer pages per chapter, so it pays
    // this on far fewer of them.
    console.log(
      `  note ${c.name}: ${report.short} of ${report.total} pages give up a column ` +
        `so one of ${report.headings} chapters can open`
    );

    await page.close();
  }

  await browser.close();
}

console.log(
  failures === 0
    ? "\nChapters always open a page."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
