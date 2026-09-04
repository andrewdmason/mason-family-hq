/**
 * The contract between the translator and the reader, checked without a model.
 *
 * Two pure pieces decide whether a translation is trustworthy before a single
 * paragraph is stored: how a chapter is cut into requests, and whether an
 * answer is accepted. Both fail silently in the wrong direction — a chunk that
 * dropped a paragraph, or a "kept" quotation that smuggled a rewrite through —
 * so they are pinned here.
 *
 *   npx tsx scripts/verify-plain-translate.mts
 */

import { blockMap } from "../src/lib/reading/block-stream";
import { chunkChapter, splitChunk } from "../src/lib/reading/plain/chunk";
import { batchCustomId, parseBatchCustomId } from "../src/lib/reading/plain/constants";
import {
  parsePlainOutput,
  validateChunk,
  type PlainOutput,
} from "../src/lib/reading/plain/validate";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A converted chapter: a heading, forty paragraphs, one of them a quotation. */
function buildChapter(paragraphs: number, charsEach: number): string {
  let html = `<h2 id="sec-1" class="reader-heading reader-h2">Chapter One</h2>`;
  for (let i = 0; i < paragraphs; i++) {
    const words = Math.ceil(charsEach / 6);
    const text = Array.from({ length: words }, (_, w) => `w${i}x${w}`).join(" ");
    if (i % 9 === 0) html += `<span class="page-anchor" id="page-${i}"></span>`;
    html += `<p>${text}</p>`;
  }
  return html;
}

console.log("chunking");
{
  const blocks = blockMap(buildChapter(40, 700));
  const chunks = chunkChapter(blocks, 0, 0, blocks.length);
  const covered = chunks.flatMap((c) => c.blocks.map((b) => b.index));
  const paragraphs = blocks.filter((b) => b.tag === "p").map((b) => b.index);
  check("every paragraph is in exactly one chunk", JSON.stringify(covered) === JSON.stringify(paragraphs));
  check("no heading travels", chunks.every((c) => c.blocks.every((b) => b.tag === "p")));
  check(
    "chunks stay under the cap",
    chunks.every((c) => c.blocks.reduce((n, b) => n + b.text.length, 0) <= 10_000)
  );
  check("a 28k-char chapter is several chunks", chunks.length >= 3, `${chunks.length}`);
  check(
    "context is the previous ORIGINAL paragraph",
    chunks.slice(1).every((c, i) => c.contextBefore === chunks[i].blocks.at(-1)!.text)
  );
  check("first chunk of the book has no context", chunks[0].contextBefore === null);
  const halves = splitChunk(chunks[0]);
  check(
    "a split keeps every paragraph and hands the second half its context",
    !!halves &&
      halves[0].blocks.length + halves[1].blocks.length === chunks[0].blocks.length &&
      halves[1].contextBefore === halves[0].blocks.at(-1)!.text
  );
  check("a one-paragraph chunk can't split", splitChunk({ ...chunks[0], blocks: chunks[0].blocks.slice(0, 1) }) === null);

  const huge = blockMap(`<p>${"x".repeat(25_000)}</p><p>short</p>`);
  const hugeChunks = chunkChapter(huge, 0, 0, 2);
  check("an oversized paragraph gets a chunk to itself", hugeChunks.length === 2 && hugeChunks[0].blocks.length === 1);
}

console.log("batch ids");
{
  const id = batchCustomId(12, 3);
  check("id is short and legal", id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id), id);
  check("id round-trips", JSON.stringify(parseBatchCustomId(id)) === JSON.stringify({ chapterIndex: 12, chunkIndex: 3 }));
  check("garbage does not parse", parseBatchCustomId("abc") === null);
}

console.log("validation");
{
  const blocks = blockMap(buildChapter(40, 300));
  const [chunk] = chunkChapter(blocks, 0, 0, blocks.length, 1_000_000);
  const input = chunk.blocks;
  const good = (): PlainOutput => ({
    paragraphs: input.map((b) => ({
      n: b.index,
      action: b.index === 12 ? ("keep" as const) : ("translate" as const),
      text: b.index === 12 ? "" : `plain ${b.text.slice(0, Math.ceil(b.text.length * 0.8))}`,
    })),
    terms: [
      { term: "samadhi", definition: "The trance state yoga aims at." },
      { term: " Samadhi ", definition: "duplicate, different case" },
      { term: "", definition: "no term" },
    ],
  });

  const ok = validateChunk(input, good());
  check("AE1: 40 entries with a kept quotation validate", ok.ok);
  if (ok.ok) {
    check("kept entry stores null text", ok.entries.find((e) => e.blockIndex === 12)?.text === null);
    check("kept entry is flagged", ok.entries.find((e) => e.blockIndex === 12)?.kept === true);
    check("terms are deduplicated by key and cleaned", ok.terms.length === 1 && ok.terms[0].term === "samadhi");
  }

  const short = good();
  short.paragraphs.pop();
  const r1 = validateChunk(input, short);
  check("39 entries fail and name the missing paragraph", !r1.ok && r1.blockIndex === input.at(-1)!.index, JSON.stringify(r1));

  const keptWithText = good();
  keptWithText.paragraphs.find((p) => p.n === 12)!.text = "a rewrite";
  const r2 = validateChunk(input, keptWithText);
  check("a kept entry carrying text is rejected", !r2.ok && r2.blockIndex === 12);

  const half = good();
  half.paragraphs[3].text = input[3].text.slice(0, Math.floor(input[3].text.length * 0.5));
  const r3 = validateChunk(input, half);
  check("a translation at 50% of original fails", !r3.ok && r3.blockIndex === input[3].index);

  const seventy = good();
  seventy.paragraphs[3].text = input[3].text.slice(0, Math.ceil(input[3].text.length * 0.7));
  check("a translation at 70% passes", validateChunk(input, seventy).ok);

  const dup = good();
  dup.paragraphs[5].n = dup.paragraphs[4].n;
  check("a repeated index fails", !validateChunk(input, dup).ok);

  const empty = good();
  empty.paragraphs[7].text = "   ";
  check("an empty translation fails", !validateChunk(input, empty).ok);

  check("parse rejects non-JSON", parsePlainOutput("not json") === null);
  check("parse rejects the wrong shape", parsePlainOutput('{"paragraphs":[{"n":"1"}]}') === null);
  check(
    "parse accepts a good answer and tolerates a malformed term",
    parsePlainOutput(JSON.stringify({ paragraphs: [{ n: 1, action: "keep", text: "" }], terms: [{ term: 1 }] }))
      ?.paragraphs.length === 1
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
