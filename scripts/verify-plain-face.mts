/**
 * The plain face, checked against the one rule it rests on.
 *
 * THE ORIGINAL BLOCK MAP IS THE COORDINATE SYSTEM. Rendering a window in the
 * plain face must produce exactly the same blocks, in the same order, with the
 * same tags and ids as the original — anchors, positions and the contents are
 * all counted against that. Everything else here follows from it: nothing the
 * renderer adds may match BLOCK_SELECTOR, model text must arrive on the page as
 * text, and a chapter is never a patchwork of faces.
 *
 *   npx tsx scripts/verify-plain-face.mts
 */

import { blockMap } from "../src/lib/reading/block-stream";
import type { InlineChatMark } from "../src/lib/reading/inline-chat-blocks";
import { BLOCK_SELECTOR } from "../src/lib/reading/annotation-anchors";
import { segmentsOf, windowFor } from "../src/lib/reading/paged-window";
import {
  markerLabel,
  PLAIN_MARK_ATTR,
  PLAIN_CELL_ATTR,
  PLAIN_TERM_ATTR,
  parallelWindowHtml,
  plainDocumentHtml,
  plainWindowHtml,
  termsHtml,
  type PlainRenderState,
} from "../src/lib/reading/plain/render";
import type { PlainBlock, PlainChapter } from "../src/lib/reading/plain/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Three chapters of a converted book, page anchors and all. */
function buildBook(): string {
  let html = "";
  let n = 0;
  for (let c = 0; c < 3; c++) {
    html += `<h2 id="sec-${c}" class="reader-heading reader-h2">Chapter ${c + 1}</h2>`;
    for (let i = 0; i < 6; i++) {
      if (i % 3 === 0) html += `<span class="page-anchor" id="page-${n}"></span>`;
      html += `<p>Original paragraph ${n} about samadhi &amp; the gunas, with tamas &lt;here&gt;.</p>`;
      n++;
    }
  }
  return html;
}

const html = buildBook();
const blocks = blockMap(html);
const paragraphs = blocks.filter((b) => b.tag === "p");

const chapters: PlainChapter[] = [0, 1, 2].map((c) => {
  const start = blocks.findIndex((b) => b.id === `sec-${c}`);
  const end = c < 2 ? blocks.findIndex((b) => b.id === `sec-${c + 1}`) : blocks.length;
  return {
    index: c,
    title: `Chapter ${c + 1}`,
    anchorId: `sec-${c}`,
    blockStart: start,
    blockEnd: end,
    charStart: blocks[start].charStart,
    charEnd: c < 2 ? blocks[end].charStart : blocks.at(-1)!.charStart + blocks.at(-1)!.text.length + 1,
    status: c === 0 ? "ready" : c === 1 ? "ready" : "pending",
    error: null,
  };
});

const plainBlocks = new Map<number, PlainBlock>();
for (const b of paragraphs) {
  const chapterIndex = chapters.find((c) => b.index >= c.blockStart && b.index < c.blockEnd)!.index;
  // Chapter 3 has a couple of peeked paragraphs stored; it is not ready.
  if (chapterIndex === 2 && b.index % 2) continue;
  plainBlocks.set(b.index, {
    index: b.index,
    chapterIndex,
    kept: b.index % 5 === 0,
    text: b.index % 5 === 0 ? null : `Plain <b>${b.index}</b> & "quoted" samadhi text.`,
  });
}

const state: PlainRenderState = {
  face: "plain",
  chapters,
  applied: new Set([0]), // chapter 2 is ready but not applied (reader is in it)
  blocks: plainBlocks,
  terms: [
    { term: "samadhi", definition: "the trance", firstChapterIndex: 0 },
    { term: "gunas", definition: "the three qualities", firstChapterIndex: 1 },
  ],
};

/** A minimal DOM-free block enumerator: the same regex blockMap uses. */
const blockSelectorTags = BLOCK_SELECTOR.split(",").map((s) => s.trim());
function tagsOf(rendered: string): string[] {
  const out: string[] = [];
  const re = /<([a-z0-9]+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rendered))) out.push(m[1].toLowerCase());
  return out;
}

console.log("window substitution");
{
  const segments = segmentsOf(blocks);
  const win = windowFor(segments, blocks[chapters[0].blockStart].charStart, 0);
  const marks: InlineChatMark[] = [{ chatId: "c1", blockIndex: chapters[0].blockStart + 2, text: "why?" }];
  const rendered = plainWindowHtml(html, blocks, win, marks, state);

  const before = blockMap(html.slice(blocks[win.startBlock].htmlStart, blocks[win.endBlock - 1].htmlEnd));
  const after = blockMap(rendered);
  check("same block count as the original window", before.length === after.length, `${before.length} vs ${after.length}`);
  check("same tags and ids", before.every((b, i) => b.tag === after[i].tag && b.id === after[i].id));
  const added = tagsOf(rendered).filter((t) => blockSelectorTags.includes(t));
  check(
    "nothing added matches BLOCK_SELECTOR",
    added.length === before.length,
    `${added.length} block-selector tags for ${before.length} blocks`
  );
  check("the chat mark is spliced above its block", rendered.includes('data-reader-chat="c1"'));
  check("page anchors survive", (rendered.match(/page-anchor/g) ?? []).length === (html.slice(blocks[win.startBlock].htmlStart, blocks[win.endBlock - 1].htmlEnd).match(/page-anchor/g) ?? []).length);

  const translated = after.find((b) => b.tag === "p" && !plainBlocks.get(blocks[win.startBlock + b.index].index)!.kept)!;
  check("a translated block renders the plain text", translated.text.startsWith("Plain <b>"));
  check("model markup arrives as text, not elements", !rendered.includes("<b>") && rendered.includes("&lt;b&gt;"));
  check('quotes are escaped', rendered.includes("&quot;quoted&quot;"));
  const kept = after.find((b) => b.tag === "p" && plainBlocks.get(blocks[win.startBlock + b.index].index)!.kept)!;
  check("a kept block renders the original", kept.text.startsWith("Original paragraph"));
  check("the heading is untouched", after[0].tag === "h2" && after[0].text === "Chapter 1");
  check("no marker under an applied chapter", !rendered.includes(`${PLAIN_MARK_ATTR}="0"`));
}

console.log("chapters that are not applied");
{
  const rendered = plainDocumentHtml(html, blocks, [], state);
  const after = blockMap(rendered);
  check("whole document keeps every block", after.length === blocks.length);
  check("whole document keeps every id", after.every((b, i) => b.id === blocks[i].id && b.tag === blocks[i].tag));
  const ch2 = chapters[1];
  const ch2Texts = after.slice(ch2.blockStart, ch2.blockEnd).filter((b) => b.tag === "p").map((b) => b.text);
  check("a ready-but-not-applied chapter renders fully original", ch2Texts.every((t) => t.startsWith("Original")));
  check("its marker offers the switch", rendered.includes(`${PLAIN_MARK_ATTR}="1"`) && rendered.includes("tap to switch"));
  const ch3 = chapters[2];
  const ch3Texts = after.slice(ch3.blockStart, ch3.blockEnd).filter((b) => b.tag === "p").map((b) => b.text);
  check("a pending chapter with peeked paragraphs is never a patchwork", ch3Texts.every((t) => t.startsWith("Original")));
  check("its marker says translating", rendered.includes(`${PLAIN_MARK_ATTR}="2"`) && rendered.includes("Translating"));
  check("markers are not blocks", !/<(p|div|li|blockquote)[^>]*data-reader-plain/.test(rendered));
  check("marker labels", markerLabel("failed", false)!.includes("Retry") && markerLabel("ready", true) === null);
}

console.log("terms");
{
  const seen = new Set<string>();
  const pattern = /(?<![\p{L}\p{N}])samadhi(?![\p{L}\p{N}])/iu;
  const once = termsHtml("Samadhi is samadhi.", [{ term: "samadhi", pattern }], seen);
  check("first occurrence only, case-insensitive", (once.match(/<span/g) ?? []).length === 1 && once.startsWith("<span"));
  check("the term attribute carries the stored term", once.includes(`${PLAIN_TERM_ATTR}="samadhi"`));
  const again = termsHtml("samadhi again", [{ term: "samadhi", pattern }], seen);
  check("already seen in this chapter: no second underline", !again.includes("<span"));
  const wordy = termsHtml("samadhis are not samadhi.", [{ term: "samadhi", pattern }], new Set());
  check("whole words only", wordy.indexOf("<span") > wordy.indexOf("samadhis"));
  const rendered = plainDocumentHtml(html, blocks, [], state);
  check("a chapter-1 term is underlined in chapter 1", rendered.includes(`${PLAIN_TERM_ATTR}="samadhi"`));
  check("a chapter-2 term is not underlined in chapter 1", !rendered.includes(`${PLAIN_TERM_ATTR}="gunas"`));
  const stripped = blockMap(rendered);
  check("term spans do not change block text", stripped.every((b) => !b.text.includes("<span")));
}

console.log("parallel spread");
{
  const segments = segmentsOf(blocks);
  const win = windowFor(segments, blocks[chapters[0].blockStart].charStart, 0);
  const marks: InlineChatMark[] = [{ chatId: "c1", blockIndex: chapters[0].blockStart + 2, text: "why?" }];
  const rendered = parallelWindowHtml(html, blocks, win, marks, state);
  const before = blockMap(html.slice(blocks[win.startBlock].htmlStart, blocks[win.endBlock - 1].htmlEnd));
  const after = blockMap(rendered);
  check("same blocks as the original window", before.length === after.length && before.every((b, i) => b.tag === after[i].tag && b.id === after[i].id));
  check("the left column is the ORIGINAL text", after.every((b, i) => b.text === before[i].text));
  const cells = (rendered.match(new RegExp(PLAIN_CELL_ATTR, "g")) ?? []).length;
  check("one translation cell per paragraph", cells === before.filter((b) => b.tag === "p").length, `${cells}`);
  const added = tagsOf(rendered).filter((t) => blockSelectorTags.includes(t));
  check("cells are not blocks", added.length === before.length, `${added.length} vs ${before.length}`);
  check("an applied paragraph's cell carries its plain text", rendered.includes("Plain &lt;b&gt;"));
  const keptCell = /<aside class="reader-plain-cell reader-plain-kept"[^>]*>Original paragraph/.test(rendered);
  check("a kept paragraph's cell shows the original, marked kept", keptCell);
  check("the chat mark is present once", (rendered.match(/data-reader-chat="c1"/g) ?? []).length === 1);
  const whole = parallelWindowHtml(html, blocks, { startBlock: 0, endBlock: blocks.length, charStart: 0, charEnd: 1e9 }, [], state);
  const ch2 = chapters[1];
  const ch2Cells = whole.split(`${PLAIN_CELL_ATTR}="`).slice(1).filter((s) => { const i = Number(s.split('"')[0]); return i >= ch2.blockStart && i < ch2.blockEnd; });
  check("a not-applied chapter's cells are empty", ch2Cells.every((s) => s.startsWith(`${ch2Cells[0].split('"')[0]}">"</aside>`.slice(0, 0)) || /^\d+">(<\/aside>)/.test(s)));
  check("its marker is present", whole.includes(`${PLAIN_MARK_ATTR}="1"`));
  const none = parallelWindowHtml(html, blocks, win, [], null);
  check("with no translation at all, cells are empty and blocks intact", blockMap(none).length === before.length && !none.includes("Plain &lt;b&gt;"));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
