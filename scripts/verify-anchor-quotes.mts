/**
 * A differential test on the context stored with every annotation anchor.
 *
 * `quoteForRange` used to flatten the whole book into one string to slice 64
 * characters out of the middle of it, which is why creating a highlight in a
 * 1.1M-character book had a visible pause before anything appeared. It now walks
 * out from the selection only as far as it needs.
 *
 * That's a rewrite of code that decides where a stored highlight lands when its
 * indices go stale, so "it looks right" isn't good enough: this runs the real
 * `anchorFromRange` against a reference implementation of the ORIGINAL algorithm
 * over hundreds of selections, and requires the two to agree exactly. If they
 * ever disagree, anchors written before and after the change would disambiguate
 * differently, and the wrong paragraph gets highlighted.
 *
 *   npx tsx scripts/verify-anchor-quotes.mts
 */

import { build } from "esbuild";
import { chromium, webkit, type Browser } from "playwright";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The real module, bundled so the page runs the code we actually ship. */
const bundle = await build({
  stdin: {
    contents: `
      import { anchorFromRange } from "./src/lib/reading/annotation-anchors";
      globalThis.__anchorFromRange = anchorFromRange;
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "silent",
});
const ANCHOR_BUNDLE = bundle.outputFiles[0].text;

/** Books, articles, and the awkward shapes in between. */
function buildDocument(kind: "book" | "nested"): string {
  let seed = 424242;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words =
    "the quick brown fox jumps over a lazy dog reading quietly by lamplight in deep winter".split(" ");
  const sentence = () =>
    Array.from({ length: 6 + Math.floor(rand() * 14) }, () => words[Math.floor(rand() * words.length)]).join(" ") + ".";

  let html = "";
  for (let i = 0; i < 220; i++) {
    if (i % 30 === 0) html += `<h2 class="reader-heading reader-h2">Chapter ${i / 30 + 1}</h2>`;
    // Zero-length marks between blocks: these contribute no characters, and they
    // are exactly what a naive walk outward can get stuck on.
    if (i % 4 === 0) html += `<span class="page-anchor" id="pg-${i}"></span>`;
    const body = Array.from({ length: 1 + Math.floor(rand() * 3) }, sentence).join(" ");
    if (kind === "nested" && i % 7 === 0) {
      // Inline markup, so boundaries land on elements and not only on text nodes.
      html += `<p>${body} <em>emphasis ${i}</em> <strong>and bold</strong> tail.</p>`;
    } else if (i % 17 === 0) {
      html += `<blockquote>${body}</blockquote>`;
    } else {
      html += `<p>${body}</p>`;
    }
  }
  return html;
}

/**
 * The original implementation, verbatim in spirit: flatten every text node in the
 * container, find the selection's absolute offset with a probe Range, and slice.
 * This is the answer the new code has to reproduce.
 */
function referenceQuoteInPage() {
  const QUOTE_MAX = 300;
  const QUOTE_CONTEXT = 32;
  return (range: Range, container: HTMLElement) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) text += (n as Text).data;

    const probe = document.createRange();
    probe.selectNodeContents(container);
    probe.setEnd(range.startContainer, range.startOffset);
    const startAt = probe.toString().length;

    const full = range.toString();
    const endAt = startAt + full.length;
    return {
      exact: full.slice(0, QUOTE_MAX),
      prefix: text.slice(Math.max(0, startAt - QUOTE_CONTEXT), startAt),
      suffix: text.slice(endAt, endAt + QUOTE_CONTEXT),
      length: full.length,
    };
  };
}

/** Run every selection through both implementations and compare the quotes. */
function comparePage(sampleCount: number) {
  const container = document.getElementById("content") as HTMLElement;
  const reference = (globalThis as never as { __reference: ReturnType<typeof referenceQuoteInPage> })
    .__reference;
  const anchorFromRange = (
    globalThis as never as {
      __anchorFromRange: (r: Range, c: HTMLElement, s: unknown) => { anchor: { quote: unknown } } | null;
    }
  ).__anchorFromRange;

  // Every text node, so selections land in headings, quotes, inline markup and
  // right up against the zero-length marks.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);

  let seed = 987654321;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const mismatches: string[] = [];
  let compared = 0;
  let elementBoundaries = 0;

  for (let i = 0; i < sampleCount; i++) {
    const node = texts[Math.floor(rand() * texts.length)];
    if (!node.data.length) continue;
    const a = Math.floor(rand() * node.data.length);
    const b = Math.min(node.data.length, a + 1 + Math.floor(rand() * 120));
    if (a >= b) continue;

    const range = document.createRange();
    // A fifth of the samples start on the element rather than inside a text node,
    // which is what a selection dragged to the very edge of a paragraph produces
    // and the case the walk has to get exactly right.
    const onElement = rand() < 0.2 && node.parentElement;
    if (onElement) {
      const parent = node.parentElement!;
      const idx = Array.prototype.indexOf.call(parent.childNodes, node);
      range.setStart(parent, idx);
      elementBoundaries++;
    } else {
      range.setStart(node, a);
    }
    range.setEnd(node, b);
    if (range.collapsed) continue;

    const resolved = anchorFromRange(range, container, { kind: "dom" });
    if (!resolved) continue;
    compared++;

    const expected = reference(range, container);
    const actual = resolved.anchor.quote as typeof expected;
    for (const key of ["exact", "prefix", "suffix", "length"] as const) {
      if (actual[key] !== expected[key]) {
        mismatches.push(
          `${key}: ${JSON.stringify(actual[key])} !== ${JSON.stringify(expected[key])}`
        );
        break;
      }
    }
  }
  return { compared, mismatches: mismatches.slice(0, 5), total: mismatches.length, elementBoundaries };
}

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

  for (const kind of ["book", "nested"] as const) {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>.page-anchor{display:block;height:0}</style></head>
       <body><div id="content">${buildDocument(kind)}</div></body></html>`
    );
    // tsx compiles this file with esbuild's keepNames, which leaves `__name`
    // calls inside the functions we hand to page.evaluate. Give the page one.
    await page.addScriptTag({
      content: `globalThis.__name = globalThis.__name || ((fn) => fn);\n${ANCHOR_BUNDLE}`,
    });
    await page.evaluate(`globalThis.__reference = (${referenceQuoteInPage.toString()})()`);
    const result = await page.evaluate(comparePage, 400);
    await page.close();

    check(
      `${kind}: quotes match the whole-document implementation`,
      result.total === 0,
      result.mismatches.join(" | ")
    );
    check(
      `${kind}: the comparison actually ran`,
      result.compared > 200 && result.elementBoundaries > 10,
      `${result.compared} selections, ${result.elementBoundaries} on element boundaries`
    );
  }

  await browser.close();
}

console.log(
  failures === 0
    ? "\nAnchor quotes are unchanged by the bounded walk."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
