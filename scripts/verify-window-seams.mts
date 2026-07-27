/**
 * Does a chapter fragment identically on its own as it does inside the whole
 * book? That is the assumption windowing rests on: chapters carry
 * `break-before: column`, so a chapter should start at a column boundary and
 * lay out the same whether or not the preceding chapters are in the DOM.
 *
 * If it holds, a window seam is invisible. If it doesn't, every chapter
 * boundary shifts the text and stored positions drift — so this is the single
 * assumption the whole of paged-window.ts rests on, and it is checked against
 * real engines rather than argued from the spec.
 *
 *   npx tsx scripts/verify-window-seams.mts
 */
import { chromium, webkit, type Browser } from "playwright";

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const COL_W = 448, GAP = 56, PAGE_H = 726;
const CHAPTERS = 12, BLOCKS_PER_CHAPTER = 30;

function buildChapters() {
  let seed = 7654321;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words = "the quick brown fox jumps over a lazy dog reading quietly by lamplight in deep winter snow".split(" ");
  const sentence = () =>
    Array.from({ length: 6 + Math.floor(rand() * 16) }, () => words[Math.floor(rand() * words.length)]).join(" ") + ".";

  const chapters: string[] = [];
  for (let c = 0; c < CHAPTERS; c++) {
    let html = `<h2 class="reader-heading reader-h2" id="sec-${c}">Chapter ${c + 1}</h2>`;
    // Deliberately uneven chapters, so some end mid-column and some near a boundary.
    const n = BLOCKS_PER_CHAPTER + Math.floor(rand() * 25);
    for (let i = 0; i < n; i++) {
      if (i % 4 === 0) html += `<span class="page-anchor" id="pg-${c}-${i}"></span>`;
      const body = Array.from({ length: 1 + Math.floor(rand() * 4) }, sentence).join(" ");
      html += i % 13 === 0 ? `<blockquote>${body}</blockquote>` : `<p data-b="${c}-${i}">${body}</p>`;
    }
    chapters.push(html);
  }
  return chapters;
}

const CSS = `
  * { margin:0; padding:0; box-sizing:border-box }
  body { font-family: Georgia, "Times New Roman", serif }
  p { margin-bottom: 1.25rem }
  blockquote { margin:1rem 0; border-left:2px solid #ccc; padding-left:1rem; font-style:italic; break-inside:avoid }
  .page-anchor { display:block; height:0 }
  .reader-heading { margin-top:0; text-align:center; text-wrap:balance;
                    break-before:column; -webkit-column-break-before:always; break-inside:avoid }
  .reader-h2 { margin-bottom:1.75rem; font-size:1.25rem; font-weight:500 }
  #flow { font-size:1.125rem; line-height:1.6; text-align:left; hyphens:manual;
          column-fill:auto; column-count:1; overflow:visible }
`;

/** Column index + in-column offset for every block, keyed by its data-b. */
function measure(stride: number) {
  const flow = document.getElementById("flow")!;
  const base = flow.getBoundingClientRect().left;
  const out: Record<string, number[][]> = {};
  for (const el of flow.querySelectorAll<HTMLElement>("[data-b]")) {
    const rects = [...el.getClientRects()].map((r) => {
      const x = r.left - base;
      const col = Math.round(x / stride);
      return [col, +(r.top).toFixed(2), +(r.height).toFixed(2)];
    });
    if (el.dataset.b) out[el.dataset.b] = rects;
  }
  return out;
}

async function render(browser: Browser, bodyHtml: string) {
  const page = await browser.newPage();
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
     #flow{width:${COL_W}px;height:${PAGE_H}px;column-gap:${GAP}px}</style></head>
     <body><div id="flow">${bodyHtml}</div></body></html>`
  );
  const r = await page.evaluate(measure, COL_W + GAP);
  await page.close();
  return r;
}

const chapters = buildChapters();
const whole = chapters.join("");

for (const [name, launcher] of [["chromium", chromium], ["webkit", webkit]] as const) {
  console.log(`\n${name}`);
  const browser = await launcher.launch();
  const full = await render(browser, whole);

  const mismatches: string[] = [];
  let checkedBlocks = 0;
  for (let c = 0; c < CHAPTERS; c++) {
    const windowed = await render(browser, chapters[c]);
    const keys = Object.keys(windowed);
    // The chapter's own first block tells us where it sits in the full book.
    const firstKey = keys[0];
    if (!full[firstKey] || !full[firstKey].length) { mismatches.push(`${firstKey} missing in full`); continue; }
    const colOffset = full[firstKey][0][0] - windowed[firstKey][0][0];

    for (const k of keys) {
      checkedBlocks++;
      const a = full[k], b = windowed[k];
      if (!a || a.length !== b.length) { mismatches.push(`${k}: ${a?.length} vs ${b.length} fragments`); continue; }
      for (let i = 0; i < a.length; i++) {
        if (a[i][0] - colOffset !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) {
          mismatches.push(`${k}[${i}]: full col${a[i][0]}-${colOffset} top${a[i][1]} vs win col${b[i][0]} top${b[i][1]}`);
          break;
        }
      }
    }
  }

  check(`a chapter alone fragments as it does inside the whole book`,
    mismatches.length === 0, mismatches.slice(0, 4).join(" | "));
  check(`the comparison actually ran`, checkedBlocks > 300, `${checkedBlocks} blocks over ${CHAPTERS} chapters`);

  // And the seam itself: every chapter must begin at column 0 of its own window.
  const startsAtBoundary: string[] = [];
  for (let c = 0; c < CHAPTERS; c++) {
    const w = await render(browser, chapters[c]);
    const first = w[Object.keys(w)[0]];
    if (!first || first[0][0] !== 0) startsAtBoundary.push(`ch${c} starts at col ${first?.[0]?.[0]}`);
  }
  check(`every chapter starts at a column boundary`, startsAtBoundary.length === 0, startsAtBoundary.join(" | "));

  await browser.close();
}

console.log(failures === 0
  ? "\nWindow seams are safe: chapters fragment independently of their neighbours."
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
