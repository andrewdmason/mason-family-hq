/**
 * The conversations set into the page, checked against a real paginated book.
 *
 * A chat anchored to a paragraph break leaves a one-line mark in the text. Three
 * things about that fail silently, so they are measured here rather than
 * reasoned about:
 *
 *  - THE MARK MUST NOT BE A BLOCK. Every stored anchor is an index into
 *    `querySelectorAll(BLOCK_SELECTOR)`. If an injected element matched that
 *    selector it would shift every index after it, moving every highlight in the
 *    chapter — on the page and in the database's eyes, permanently.
 *  - THE CHARACTER SPACE MUST NOT MOVE. `blockMap` rebuilds the converter's
 *    offsets from the same HTML the browser renders. Splicing markup into that
 *    string must leave every block's text and charStart byte-identical.
 *  - THE BREAK MUST BE ON THE PAGE. Where a new conversation goes is derived
 *    from the character range the reader reports, with no measurement — so it is
 *    checked against what the browser actually fragmented, in both engines,
 *    including the case where the page opens mid-paragraph and the case where
 *    one paragraph fills the whole spread.
 *
 * Runs in real Chromium and real WebKit, because column fragmentation is the
 * browser's opinion and the device that matters runs WebKit.
 *
 *   npx tsx scripts/verify-inline-chat-blocks.mts
 */

import { build } from "esbuild";
import { chromium, webkit, type Browser } from "playwright";
import { blockMap } from "../src/lib/reading/block-stream";
import {
  INLINE_MARK_ATTR,
  INLINE_MARK_CLASS,
  markText,
  pageBlocks,
  withInlineChats,
  type InlineChatMark,
} from "../src/lib/reading/inline-chat-blocks";
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
 * A converted book: <p> and <h2> only, with zero-height page anchors riding
 * along the way convert.ts emits them. Each block opens with its own index, so
 * "block 412" can be checked against what block 412 actually says.
 */
function buildBook(blockCount: number): string {
  let seed = 20260805;
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
  for (let i = 0; i < blockCount; i++) {
    const tag = `[b${i}]`;
    if (i % 40 === 0) {
      out.push(`<h2 id="sec-${i}" class="reader-heading reader-h2">${tag} Chapter ${i / 40 + 1}</h2>`);
      continue;
    }
    const anchor = i % 3 === 0 ? `<span class="page-anchor" id="pg-${i}"></span>` : "";
    // Long paragraphs on purpose: the interesting cases are a page that opens
    // mid-paragraph and a paragraph that fills a whole column.
    const body = Array.from({ length: 3 + Math.floor(rand() * 6) }, sentence).join(" ");
    out.push(`${anchor}<p>${tag} ${body}</p>`);
  }
  return out.join("");
}

const HTML = buildBook(600);
const BLOCKS = blockMap(HTML);

/* ------------------------------------------------------------------ *
 * The splice, checked as a string.
 * ------------------------------------------------------------------ */

console.log("\nsplicing");

{
  const marks: InlineChatMark[] = [
    { chatId: "a", blockIndex: 5, text: "Who is Hoffman talking about?" },
    { chatId: "b", blockIndex: 9, text: "Why does the gallery keep coming back?" },
    { chatId: "c", blockIndex: 41, text: "What changed at the chapter break?" },
  ];
  const marked = withInlineChats(HTML, BLOCKS, marks, 0);

  check(
    "every mark is in the output once",
    marks.every((m) => marked.split(`${INLINE_MARK_ATTR}="${m.chatId}"`).length === 2)
  );

  const misplaced = marks.filter((m) => {
    const at = marked.indexOf(`${INLINE_MARK_ATTR}="${m.chatId}"`);
    if (at < 0) return true;
    const closed = marked.indexOf("</aside>", at);
    const tag = marked.indexOf(`[b${m.blockIndex}]`, closed);
    // Between the mark and the paragraph it names there must be exactly one
    // thing: that paragraph's own opening tag. Anything else means it landed
    // above the wrong block, or inside one.
    return !/^<(p|h[1-6])\b[^>]*>$/i.test(marked.slice(closed + "</aside>".length, tag));
  });
  check(
    "each mark sits immediately above its own block",
    misplaced.length === 0,
    misplaced.map((m) => m.chatId).join(", ")
  );

  // The load-bearing one: the converter's character space is rebuilt from this
  // string, and it must not have noticed.
  const after = blockMap(marked);
  check("the block stream is unchanged", after.length === BLOCKS.length, `${after.length} vs ${BLOCKS.length}`);
  const drift = after.findIndex(
    (b, i) => b.text !== BLOCKS[i].text || b.charStart !== BLOCKS[i].charStart
  );
  check(
    "every block keeps its text and its character offset",
    drift === -1,
    drift >= 0 ? `block ${drift} moved to char ${after[drift].charStart}` : undefined
  );

  const nasty: InlineChatMark[] = [
    { chatId: 'x"y', text: '<script>alert("x")</script> & "quotes"', blockIndex: 7 },
  ];
  const escaped = withInlineChats(HTML, BLOCKS, nasty, 0);
  check("a question can't smuggle markup into the book", !escaped.includes("<script>"));

  check(
    "a long question is capped to a line",
    markText("word ".repeat(200)).length <= 160 && markText("word ".repeat(200)).endsWith("…")
  );
  check("whitespace in a question is collapsed", markText("a\n\n  b\t c ") === "a b c");
}

{
  // A window, the way the paged reader renders one: a slice of the source, with
  // offsets measured from where the slice starts.
  const from = 120;
  const to = 200;
  const slice = HTML.slice(BLOCKS[from].htmlStart, BLOCKS[to - 1].htmlEnd);
  const marked = withInlineChats(
    slice,
    BLOCKS,
    [
      { chatId: "in", blockIndex: 150, text: "inside the window" },
      { chatId: "before", blockIndex: 3, text: "another chapter" },
      { chatId: "after", blockIndex: 400, text: "another chapter" },
      { chatId: "missing", blockIndex: 99_999, text: "not a block at all" },
    ],
    BLOCKS[from].htmlStart
  );
  check("a mark inside the window is spliced in", marked.includes('="in"'));
  check(
    "marks from other windows are left out",
    !marked.includes('="before"') && !marked.includes('="after"') && !marked.includes('="missing"')
  );
}

/* ------------------------------------------------------------------ *
 * Where a new conversation goes, as arithmetic.
 * ------------------------------------------------------------------ */

console.log("\nchoosing the break");

{
  // A page opening part-way through block 3 and ending inside block 8.
  const from = BLOCKS[3].charStart + 20;
  const through = BLOCKS[8].charStart + 5;
  const page = pageBlocks(BLOCKS, from, through)!;
  check("the page starts at the block it opens inside", page.start === 3);
  check("the break is the first block that starts on the page", page.breakIndex === 4);
  check("the page ends before the first block past it", page.end === 9, `end ${page.end}`);

  // One long paragraph filling the whole spread: nothing starts on screen.
  const noBreak = pageBlocks(BLOCKS, BLOCKS[3].charStart + 5, BLOCKS[3].charStart + 9)!;
  check(
    "with no break on screen the mark goes above the visible line",
    noBreak.breakIndex === 3 && noBreak.start === 3
  );

  // The last page of a window reports no next page. Unknown, not empty.
  const unbounded = pageBlocks(BLOCKS, BLOCKS[3].charStart + 5, BLOCKS[3].charStart + 5)!;
  check("an unknown page end still finds the next break", unbounded.breakIndex === 4);

  check("a book with no blocks has nowhere to put one", pageBlocks([], 0, 10) === null);

  const last = BLOCKS.length - 1;
  const atEnd = pageBlocks(BLOCKS, BLOCKS[last].charStart + 1, BLOCKS[last].charStart + 2)!;
  check("the last block of the book is its own break", atEnd.breakIndex === last);
}

/* ------------------------------------------------------------------ *
 * The same rules, against a browser that has actually laid the book out.
 * ------------------------------------------------------------------ */

const bundle = await build({
  stdin: {
    contents: `
      import { blockElements } from "./src/lib/reading/annotation-anchors";
      import { charOffsetAtTopOfPage } from "./src/lib/reading/paged-position";
      import { pageBlocks } from "./src/lib/reading/inline-chat-blocks";
      Object.assign(globalThis, { blockElements, charOffsetAtTopOfPage, pageBlocks });
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

/** The effective stylesheet, hand-written from reader-prose.ts. */
const PROSE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; }
  p { margin-bottom: 1.25rem; }
  .page-anchor { display: block; height: 0; }
  .reader-heading { margin-top: 0; text-align: center; text-wrap: balance;
                    break-before: column; -webkit-column-break-before: always;
                    break-inside: avoid; }
  .reader-h2 { margin-bottom: 1.75rem; font-size: 1.25rem; font-weight: 500; }
  .${INLINE_MARK_CLASS} { display: block; margin: 1.25rem 0; padding: 0.375rem 0;
                          border-top: 1px solid #0002; border-bottom: 1px solid #0002;
                          font-family: system-ui, sans-serif; font-size: 0.72em;
                          line-height: 1.5; text-align: left; text-indent: 0;
                          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                          break-inside: avoid; }
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

const WINDOW_BASE = 120;
const WINDOW_END = 400;
const WINDOW_BLOCKS = BLOCKS.slice(WINDOW_BASE, WINDOW_END);

/** Marks scattered through the window, including one at a chapter heading. */
const WINDOW_MARKS: InlineChatMark[] = [
  { chatId: "m1", blockIndex: 131, text: "What is he actually apologising for here?" },
  { chatId: "m2", blockIndex: 160, text: "Why does the gallery keep coming back?" },
  { chatId: "m3", blockIndex: 200, text: "Is this the same night as chapter four?" },
  { chatId: "m4", blockIndex: 240, text: "A question long enough to need the whole measure and then some more" },
];

const WINDOW_HTML = withInlineChats(
  HTML.slice(BLOCKS[WINDOW_BASE].htmlStart, BLOCKS[WINDOW_END - 1].htmlEnd),
  BLOCKS,
  WINDOW_MARKS,
  BLOCKS[WINDOW_BASE].htmlStart
);

const CASES = [
  { name: "MacBook, two columns", colW: 576, pageH: 792, cols: 2 as const, clipW: 1440 },
  { name: "iPad landscape, two columns", colW: 505, pageH: 726, cols: 2 as const, clipW: 1180 },
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
         #flow { width: ${geom.colW}px; height: ${geom.pageH}px; column-count: 1;
                 column-gap: ${geom.gap}px; }
       </style></head>
       <body><div id="viewport"><div id="clip"><div id="flow">${WINDOW_HTML}</div></div></div></body></html>`
    );
    await page.addScriptTag({ content: MEASURE_JS });

    const report = await page.evaluate(
      ({ geom, base, blocks, allBlocks, padTop, markAttr, markClass }) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const g = globalThis as any;
        const flow = document.getElementById("flow")!;
        const blockEls = g.blockElements(flow) as HTMLElement[];

        // THE invariant: the marks are in the DOM, and the block list is exactly
        // what it would have been without them.
        const misaligned: number[] = [];
        blockEls.forEach((el, i) => {
          if (!(el.textContent ?? "").includes(`[b${base + i}]`)) misaligned.push(base + i);
        });

        const marks = Array.from(flow.querySelectorAll<HTMLElement>(`.${markClass}`));
        const split = marks
          .filter((el) => el.getClientRects().length > 1)
          .map((el) => el.getAttribute(markAttr));
        const tooWide = marks
          .filter((el) => el.getBoundingClientRect().width > geom.colW + 1)
          .map((el) => el.getAttribute(markAttr));
        const markIsBlock = marks.filter((el) => blockEls.includes(el)).length;

        const ctx = { flow, blocks, blockEls, geom };
        const flowLeft = flow.getBoundingClientRect().left;
        const view = document.getElementById("viewport")!.getBoundingClientRect();
        const colOf = (x: number) =>
          Math.max(0, Math.floor((x - flowLeft + 2) / geom.colStride));

        const pages: {
          pageIndex: number;
          fromChar: number;
          throughChar: number;
          chose: number | null;
          firstStarting: number | null;
        }[] = [];
        for (const pageIndex of [0, 1, 2, 3, 4]) {
          const fromChar = g.charOffsetAtTopOfPage(pageIndex, ctx) as number;
          const throughChar = g.charOffsetAtTopOfPage(pageIndex + 1, ctx) as number;

          // Read independently off the DOM: the first block whose OWN start is on
          // this page, clear of the column top (a fragment flowing in from the
          // previous column is a column break, not a paragraph boundary).
          let firstStarting: number | null = null;
          for (let i = 0; i < blockEls.length; i++) {
            const rect = blockEls[i].getClientRects()[0];
            if (!rect) continue;
            if (Math.floor(colOf(rect.left) / geom.cols) !== pageIndex) continue;
            if (rect.top - view.top <= padTop + 2) continue;
            firstStarting = base + i;
            break;
          }

          const chosen = g.pageBlocks(allBlocks, fromChar, throughChar);
          pages.push({
            pageIndex,
            fromChar,
            throughChar,
            chose: chosen ? chosen.breakIndex : null,
            firstStarting,
          });
        }

        return { misaligned, split, tooWide, markIsBlock, markCount: marks.length, pages };
        /* eslint-enable @typescript-eslint/no-explicit-any */
      },
      {
        geom,
        base: WINDOW_BASE,
        blocks: WINDOW_BLOCKS,
        allBlocks: BLOCKS,
        padTop: PAGE_PAD_TOP,
        markAttr: INLINE_MARK_ATTR,
        markClass: INLINE_MARK_CLASS,
      }
    );

    check(
      `${c.name}: the marks are on the page`,
      report.markCount === WINDOW_MARKS.length,
      `${report.markCount} of ${WINDOW_MARKS.length}`
    );
    check(
      `${c.name}: block indices are untouched by the marks`,
      report.misaligned.length === 0,
      report.misaligned.length > 0 ? `first wrong at ${report.misaligned[0]}` : undefined
    );
    check(
      `${c.name}: a mark is not a block`,
      report.markIsBlock === 0,
      `${report.markIsBlock} matched the anchor selector`
    );
    check(
      `${c.name}: no mark is split across a column`,
      report.split.length === 0,
      report.split.join(", ")
    );
    check(
      `${c.name}: no mark runs past its column`,
      report.tooWide.length === 0,
      report.tooWide.join(", ")
    );

    for (const p of report.pages) {
      if (p.firstStarting == null) continue;
      check(
        `${c.name} p${p.pageIndex}: the break is a paragraph that starts on the page`,
        p.chose === p.firstStarting,
        `chose ${p.chose}, page starts ${p.firstStarting} (chars ${p.fromChar}–${p.throughChar})`
      );
    }
    check(
      `${c.name}: pages were actually examined`,
      report.pages.some((p) => p.firstStarting != null)
    );

    await page.close();
  }

  await browser.close();
}

console.log(
  failures === 0
    ? "\nChat marks sit above the right paragraph, split no column, and move no anchor."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
