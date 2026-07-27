/**
 * The claim the paged reader's performance now rests on: a flow that is one
 * column wide fragments a book into exactly the same columns as a flow that is
 * two columns wide.
 *
 * If that holds, then how many columns a page shows is a property of the clip
 * box and not of the text, and the chat panel can open on an iPad without
 * re-laying-out a million characters. If it ever stops holding — a browser
 * change, a stylesheet change, someone reintroducing `columnCount: cols` — the
 * reader would quietly start showing the wrong page, deep into long books, and
 * nothing else here would notice.
 *
 * So it is checked against real browsers rather than reasoned about. Both
 * engines, because the device that matters runs WebKit.
 *
 *   npx tsx scripts/verify-paged-fragmentation.mts
 */

import { chromium, webkit, type Browser } from "playwright";
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

/**
 * A book, deterministically. Matches what convert.ts emits: headings carrying
 * the break rules, paragraphs, the odd blockquote, and zero-height page anchors.
 */
function buildBook(blockCount: number): string {
  let seed = 20260725;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words = "the quick brown fox jumps over a lazy dog while reading quietly by lamplight in winter".split(" ");
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

/**
 * The effective stylesheet for a book, hand-written from reader-prose.ts.
 *
 * Tailwind's arbitrary-variant classes can't apply in a bare page, so the rules
 * that matter to fragmentation — the margins, and above all the break rules —
 * are spelled out here. If BOOK_PROSE / BOOK_PROSE_PAGED change, change these.
 */
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

/**
 * Where every block landed: which column, and how far into it. Compared between
 * the two flow shapes — any difference at all means the text moved.
 */
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

async function measure(
  browser: Browser,
  html: string,
  opts: { widthCols: 1 | 2; colW: number; gap: number; pageH: number }
) {
  const page = await browser.newPage();
  const flowW = opts.widthCols === 2 ? opts.colW * 2 + opts.gap : opts.colW;
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${PROSE_CSS}
     #flow { width: ${flowW}px; height: ${opts.pageH}px; column-count: ${opts.widthCols};
             column-gap: ${opts.gap}px; }</style></head>
     <body><div id="flow">${html}</div></body></html>`
  );
  const result = await page.evaluate(measureInPage, opts.colW + opts.gap);
  await page.close();
  return result;
}

const CASES = [
  { name: "iPad landscape", colW: 505, pageH: 726, blocks: 450 },
  { name: "MacBook", colW: 576, pageH: 792, blocks: 450 },
  { name: "whole book", colW: 505, pageH: 726, blocks: 3500 },
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
    // A missing browser download shouldn't fail the whole check silently — say
    // so loudly, because WebKit is the one that actually matters here.
    failures += 1;
    console.error(`  FAIL ${engineName} wouldn't launch — ${(err as Error).message.split("\n")[0]}`);
    continue;
  }

  for (const c of CASES) {
    const html = buildBook(c.blocks);
    const opts = { colW: c.colW, gap: COLUMN_GAP, pageH: c.pageH };
    const two = await measure(browser, html, { ...opts, widthCols: 2 });
    const one = await measure(browser, html, { ...opts, widthCols: 1 });

    const same =
      two.rects.length === one.rects.length &&
      two.rects.every((r, i) => r.every((v, j) => v === one.rects[i][j]));
    check(
      `${c.name} (${c.blocks} blocks): one-column flow fragments identically`,
      same,
      `${two.rects.length} vs ${one.rects.length} fragments`
    );
    check(
      `${c.name}: same strip length`,
      two.scrollWidth === one.scrollWidth,
      `${two.scrollWidth} vs ${one.scrollWidth}`
    );

    // Every column has to sit exactly on a stride, or page turns drift.
    const stride = c.colW + COLUMN_GAP;
    const maxResidual = Math.max(0, ...one.rects.map((r) => Math.abs(r[1])));
    check(`${c.name}: columns land on the stride`, maxResidual < 0.01, `max ${maxResidual}px off`);
    const strideCount = (one.scrollWidth + COLUMN_GAP) / stride;
    check(
      `${c.name}: strip is a whole number of strides`,
      Math.abs(strideCount - Math.round(strideCount)) < 0.01,
      `${strideCount}`
    );
  }

  await browser.close();
}

console.log(
  failures === 0
    ? "\nOne-column and two-column flows fragment identically."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
