/**
 * Selecting text across a page has to move in the direction the reader is
 * dragging — including over the parts of a page with no text under them.
 *
 * The paged reader lays a book out as one multi-column flow, one column wide,
 * and slides it. That means the flow's own box covers only the FIRST column of
 * the book, and every point on the page that isn't on a line of text — the gap
 * between two paragraphs, the space between the two columns of a spread, the
 * blank under a chapter's last column — is outside it. Mid-drag the browser
 * resolves such a point against the un-fragmented flow and returns a position
 * near the start of the text, so the selection inverts: everything BEFORE where
 * the reader started, until the pointer finds a line again.
 *
 * usePagination's fitFlowToStrip gives the flow a box as wide as the strip it
 * paints, so those points land on the flow after all. This checks the two things
 * that has to be true of it, in both engines, because the device that matters
 * runs WebKit:
 *
 *   1. a drag across each kind of dead zone never flips backwards, and
 *   2. widening the box moves no text and changes no strip width — it must not
 *      cost a single column break, or every saved position in every book shifts.
 *
 *   npx tsx scripts/verify-paged-selection.mts
 */

import { chromium, webkit, type Browser, type Page } from "playwright";
import { COLUMN_GAP } from "../src/lib/reading/reader-settings";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The same deterministic book verify-paged-fragmentation.mts uses. */
function buildBook(blockCount: number): string {
  let seed = 20260725;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words =
    "the quick brown fox jumps over a lazy dog while reading quietly by lamplight in winter".split(
      " "
    );
  const sentence = () => {
    const n = 8 + Math.floor(rand() * 22);
    return Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ") + ".";
  };

  let html = "";
  for (let i = 0; i < blockCount; i++) {
    if (i % 40 === 0) {
      html += `<h2 class="reader-heading reader-h2">Chapter ${i / 40 + 1}</h2>`;
      continue;
    }
    if (i % 3 === 0) html += `<span class="page-anchor" id="pg-${i}"></span>`;
    const body = Array.from({ length: 2 + Math.floor(rand() * 4) }, sentence).join(" ");
    html += i % 17 === 0 ? `<blockquote>${body}</blockquote>` : `<p>${body}</p>`;
  }
  return html;
}

/** From reader-prose.ts — the rules that put white space inside a page. */
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
  #flow { font-size: 1.125rem; line-height: 1.6; text-align: justify; hyphens: auto;
          column-fill: auto; box-sizing: content-box; }
`;

const LAYOUT = { colW: 505, gap: COLUMN_GAP, pageH: 726, offsetX: 100, top: 56 };
const STRIDE = LAYOUT.colW + LAYOUT.gap;
/** A spread, and a page deep enough into the book to be far from the flow's own box. */
const VIEW_W = LAYOUT.colW * 2 + LAYOUT.gap;
const PAGE = 8;

/** The reader's page, as PagedView builds it: a clip box over a sliding flow. */
async function open(browser: Browser, html: string, widened: boolean): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${PROSE_CSS}</style></head>
     <body style="margin:0">
       <div id="clip" style="position:absolute;left:${LAYOUT.offsetX}px;top:${LAYOUT.top}px;
            width:${VIEW_W}px;height:${LAYOUT.pageH}px;overflow:hidden">
         <div id="flow" style="width:${LAYOUT.colW}px;height:${LAYOUT.pageH}px;
              column-width:${LAYOUT.colW}px;column-gap:${LAYOUT.gap}px">${html}</div>
       </div>
     </body></html>`
  );
  if (widened) {
    // fitFlowToStrip, exactly as usePagination does it.
    await page.evaluate((gap) => {
      const flow = document.getElementById("flow")!;
      const stride = flow.clientWidth + gap;
      const cols = Math.max(1, Math.round((flow.scrollWidth + gap) / stride));
      flow.style.width = `${cols * stride - gap}px`;
    }, LAYOUT.gap);
  }
  return page;
}

/** Turn to a page, the way the reader does: one translate of the whole strip. */
async function turnTo(page: Page, pageIndex: number) {
  await page.evaluate((x) => {
    document.getElementById("flow")!.style.transform = `translate3d(${x}px, 0, 0)`;
  }, -pageIndex * STRIDE * 2);
}

/**
 * A column that a chapter ends part-way down, leaving blank page under it — the
 * third kind of white space, and the one that can't be assumed to exist at any
 * particular page of a generated book.
 */
async function shortColumn(page: Page): Promise<{ col: number; contentBottom: number } | null> {
  return page.evaluate(
    ([colStride, pageH]) => {
      const flow = document.getElementById("flow")!;
      const base = flow.getBoundingClientRect();
      const bottoms = new Map<number, number>();
      for (const el of flow.children) {
        for (const r of el.getClientRects()) {
          const col = Math.round((r.left - base.left) / colStride);
          bottoms.set(col, Math.max(bottoms.get(col) ?? 0, r.bottom - base.top));
        }
      }
      // Deep enough in to be a long way from the flow's own box, short enough to
      // leave room to drag into, and not the last column of the book.
      const last = Math.max(...bottoms.keys());
      for (let col = 6; col < last; col++) {
        const bottom = bottoms.get(col);
        if (bottom !== undefined && bottom < pageH - 140) return { col, contentBottom: bottom };
      }
      return null;
    },
    [STRIDE, LAYOUT.pageH] as const
  );
}

/**
 * Drag from one point to another, watching for the selection turning round.
 *
 * "Backwards" is measured against the drag, not against the document: dragging
 * down and to the right, the end of the selection must never sit before its
 * start. One sample of that mid-drag is the bug — it corrects itself as soon as
 * the pointer is over a line again, which is exactly why it reads as a flicker.
 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  let flips = 0;
  let worst = 0;
  const STEPS = 48;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / STEPS,
      from.y + ((to.y - from.y) * i) / STEPS
    );
    const s = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
      const backwards =
        (sel.anchorNode.compareDocumentPosition(sel.focusNode) &
          Node.DOCUMENT_POSITION_PRECEDING) !==
        0;
      return { backwards, length: sel.getRangeAt(0).toString().length };
    });
    if (s?.backwards) flips += 1;
    worst = Math.max(worst, s?.length ?? 0);
  }
  await page.mouse.up();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  return { flips, worst };
}

/** Where every block landed, and how long the strip is. Must not move. */
function measureInPage(colStride: number) {
  const flow = document.getElementById("flow")!;
  const base = flow.getBoundingClientRect().left;
  const rects: number[][] = [];
  for (const el of flow.children) {
    for (const r of el.getClientRects()) {
      const x = r.left - base;
      const col = Math.round(x / colStride);
      rects.push([col, +(x - col * colStride).toFixed(3), +r.top.toFixed(2), +r.height.toFixed(2)]);
    }
  }
  return { rects, scrollWidth: flow.scrollWidth };
}

const left = LAYOUT.offsetX + LAYOUT.colW / 2;
const right = LAYOUT.offsetX + LAYOUT.colW + LAYOUT.gap + LAYOUT.colW / 2;
const top = LAYOUT.top;

/**
 * The kinds of white space a reader drags through on a page. The first two are
 * on any page of any book; the third needs a chapter that ends part-way down a
 * column, so it's found rather than assumed — see runDrags.
 */
const DRAGS = [
  {
    name: "down a column, across paragraph breaks",
    page: PAGE,
    from: { x: left, y: top + 150 },
    to: { x: left, y: top + LAYOUT.pageH - 60 },
  },
  {
    name: "across the gap between the two columns",
    page: PAGE,
    from: { x: left + 120, y: top + 300 },
    to: { x: right, y: top + 320 },
  },
];

type Drag = (typeof DRAGS)[number];

/** DRAGS, plus the one that depends on where this book's chapters end. */
async function dragsFor(page: Page): Promise<Drag[]> {
  const short = await shortColumn(page);
  if (!short) return DRAGS;
  const x = (short.col % 2 === 0 ? left : right) + 40;
  return [
    ...DRAGS,
    {
      name: "off the end of a chapter into the blank below it",
      page: Math.floor(short.col / 2),
      from: { x, y: top + short.contentBottom - 40 },
      to: { x, y: top + LAYOUT.pageH - 10 },
    },
  ];
}

async function runDrags(page: Page, drags: Drag[]) {
  const results: { drag: Drag; flips: number; worst: number }[] = [];
  for (const d of drags) {
    await turnTo(page, d.page);
    results.push({ drag: d, ...(await drag(page, d.from, d.to)) });
  }
  return results;
}

const html = buildBook(3500);

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
    console.error(
      `  FAIL ${engineName} wouldn't launch — ${(err as Error).message.split("\n")[0]}`
    );
    continue;
  }

  const bare = await open(browser, html, false);
  const wide = await open(browser, html, true);
  const drags = await dragsFor(bare);
  check("found a chapter that ends part-way down a column", drags.length === 3);

  // The bug itself, in the layout as it was: if this stops reproducing, the
  // checks below have stopped proving anything and the wide box may no longer be
  // earning its keep.
  const before = await runDrags(bare, drags);
  check(
    "a one-column flow still inverts the selection over white space",
    before.every((r) => r.flips > 0),
    `${before.filter((r) => r.flips > 0).length}/${drags.length} drags flipped`
  );

  for (const r of await runDrags(wide, drags)) {
    const name = r.drag.name;
    check(`selection holds its direction: ${name}`, r.flips === 0, `${r.flips} samples inverted`);
    // A flip also balloons the selection to everything back to the start of the
    // window, so an absurd length is the same bug seen from the other side.
    check(`selection stays plausible: ${name}`, r.worst < 4000, `${r.worst} characters`);
  }

  const narrow = await bare.evaluate(measureInPage, STRIDE);
  const widened = await wide.evaluate(measureInPage, STRIDE);
  check(
    "widening the box moves no text",
    narrow.rects.length === widened.rects.length &&
      narrow.rects.every((r, i) => r.every((v, j) => v === widened.rects[i][j])),
    `${narrow.rects.length} vs ${widened.rects.length} fragments`
  );
  check(
    "widening the box doesn't lengthen the strip",
    narrow.scrollWidth === widened.scrollWidth,
    `${narrow.scrollWidth} vs ${widened.scrollWidth}`
  );

  await bare.close();
  await wide.close();
  await browser.close();
}

console.log(
  failures === 0
    ? "\nSelection follows the drag over every kind of white space, and the text hasn't moved."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
