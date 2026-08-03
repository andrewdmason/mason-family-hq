/**
 * The invariants that keep the voice and the page in step.
 *
 * Everything asserted here is silent when it breaks. A chapter plan with a gap
 * in it drops a few pages of a book from the audio and nobody notices until
 * they're listening to the wrong scene. A cue whose character range points at
 * the wrong paragraph highlights the wrong paragraph — for hours, with no error
 * anywhere. An MP3 duration that's estimated rather than counted drifts a few
 * tens of milliseconds per join and ends a long chapter visibly behind the
 * voice. None of it throws; all of it is arithmetic; so it can simply be checked.
 *
 *   npx tsx scripts/verify-audiobook.mts
 */

import { planChapters } from "../src/lib/reading/audio/chapters";
import {
  MAX_CHAPTER_CHARS,
  MAX_REQUEST_CHARS,
  MIN_CHAPTER_CHARS,
} from "../src/lib/reading/audio/constants";
import { concatMp3, mp3DurationMs } from "../src/lib/reading/audio/mp3";
import { splitSentences } from "../src/lib/reading/audio/sentences";
import {
  characterTimes,
  cuesForChunk,
  normaliseCues,
  planChunks,
} from "../src/lib/reading/audio/script";
import { cueAt, cueOnPage, timeAtChar } from "../src/lib/reading/audio/types";
import type { NarrationBlock } from "../src/lib/reading/audio/clean";
import type { BookBlock } from "../src/lib/reading/block-stream";
import type { ReadingTocEntry } from "../src/lib/types";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// A synthetic book
// ---------------------------------------------------------------------------

/**
 * Build a block stream the way convert.ts would: every block contributes
 * `text.length + 1` to the running offset. Headings get `sec-N` ids, which is
 * what a table of contents points at.
 */
function buildBook(
  spec: { heading?: string; paragraphs: number; words?: number }[]
): { blocks: BookBlock[]; toc: ReadingTocEntry[]; totalChars: number } {
  const blocks: BookBlock[] = [];
  const toc: ReadingTocEntry[] = [];
  let charStart = 0;
  let sec = 0;

  const push = (text: string, tag: string, id: string | null) => {
    blocks.push({
      index: blocks.length,
      charStart,
      text,
      id,
      tag,
      htmlStart: 0,
      htmlEnd: 0,
    });
    charStart += text.length + 1;
  };

  for (const part of spec) {
    if (part.heading) {
      const id = `sec-${sec++}`;
      toc.push({ anchorId: id, title: part.heading, level: 1 } as ReadingTocEntry);
      push(part.heading, "h1", id);
    }
    const words = part.words ?? 120;
    for (let p = 0; p < part.paragraphs; p++) {
      // Deterministic prose with real sentence boundaries.
      const sentences: string[] = [];
      for (let s = 0; s < 4; s++) {
        sentences.push(
          `${["The", "A", "This", "Each"][s]} ${"word ".repeat(words / 4).trim()}.`
        );
      }
      push(sentences.join(" "), "p", null);
    }
  }

  return { blocks, toc, totalChars: charStart };
}

// ---------------------------------------------------------------------------
// Chapter planning
// ---------------------------------------------------------------------------

console.log("\nchapter planning covers the book without gaps or overlaps");
{
  const { blocks, toc, totalChars } = buildBook([
    { paragraphs: 3 }, // front matter, before any heading
    { heading: "Dedication", paragraphs: 1, words: 8 },
    { heading: "Chapter One", paragraphs: 12 },
    { heading: "Chapter Two", paragraphs: 14 },
    { heading: "Chapter Three", paragraphs: 10 },
  ]);
  const plan = planChapters(blocks, toc, "A Book", totalChars);

  check("produces chapters", plan.length > 0, `${plan.length}`);
  check(
    "front matter is not narrated",
    plan[0].charStart > blocks[2].charStart,
    `first chapter starts at ${plan[0].charStart}, front matter ends at ${blocks[3].charStart}`
  );
  check(
    "the last chapter runs to the end of the book",
    plan[plan.length - 1].charEnd === totalChars,
    `${plan[plan.length - 1].charEnd} vs ${totalChars}`
  );

  let contiguous = true;
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].charStart !== plan[i - 1].charEnd) contiguous = false;
  }
  check("chapters are contiguous", contiguous, plan.map((c) => `${c.charStart}-${c.charEnd}`).join(" "));
  check(
    "every chapter has length",
    plan.every((c) => c.charEnd > c.charStart)
  );
  check(
    "the nine-second dedication was folded away",
    !plan.some((c) => c.title === "Dedication"),
    plan.map((c) => c.title).join(", ")
  );
  check(
    "no chapter is shorter than the floor",
    plan.every((c, i) => i === plan.length - 1 || c.charEnd - c.charStart >= MIN_CHAPTER_CHARS),
    plan.map((c) => c.charEnd - c.charStart).join(", ")
  );
}

console.log("\nan over-long chapter becomes parts, and nothing exceeds the ceiling");
{
  const { blocks, toc, totalChars } = buildBook([
    { heading: "Chapter One", paragraphs: 6 },
    // ~500 paragraphs of 120 words is comfortably past the ceiling.
    { heading: "The Long One", paragraphs: 520 },
    { heading: "Chapter Three", paragraphs: 6 },
  ]);
  const plan = planChapters(blocks, toc, "A Book", totalChars);

  check(
    "no chapter exceeds what one request can prepare",
    plan.every((c) => c.charEnd - c.charStart <= MAX_CHAPTER_CHARS * 1.05),
    plan.map((c) => c.charEnd - c.charStart).join(", ")
  );
  check(
    "the parts are named after the chapter",
    plan.filter((c) => c.title.startsWith("The Long One")).length > 1,
    plan.map((c) => c.title).join(", ")
  );

  let contiguous = true;
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].charStart !== plan[i - 1].charEnd) contiguous = false;
  }
  check("split chapters stay contiguous", contiguous);
}

console.log("\na book with no usable contents is sliced rather than left as one track");
{
  const { blocks, toc, totalChars } = buildBook([{ heading: "A Book", paragraphs: 200 }]);
  const plan = planChapters(blocks, toc, "A Book", totalChars);
  check("more than one track", plan.length > 1, `${plan.length}`);
  check(
    "covers the whole book",
    plan[0].charStart === 0 && plan[plan.length - 1].charEnd === totalChars
  );
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

console.log("\nsentence splitting survives the things that look like sentence ends");
{
  const cases: { text: string; expected: number; why: string }[] = [
    { text: "One. Two. Three.", expected: 3, why: "plain" },
    { text: "Dr. Reed went home. He slept.", expected: 2, why: "an abbreviation" },
    { text: "J. R. R. Tolkien wrote it. It sold.", expected: 2, why: "initials" },
    { text: "It cost 3.50 in total. Cheap.", expected: 2, why: "a decimal" },
    { text: "Really?! He left. Yes.", expected: 3, why: "stacked marks" },
    { text: "No breaks here at all", expected: 1, why: "no terminator" },
    { text: '"Stop," she said. He stopped.', expected: 2, why: "a closing quote" },
  ];
  for (const c of cases) {
    const got = splitSentences(c.text);
    check(`${c.why}: ${c.expected} sentence(s)`, got.length === c.expected, `got ${got.length}`);
    check(
      `${c.why}: ranges cover the text exactly`,
      got[0].start === 0 &&
        got[got.length - 1].end === c.text.length &&
        got.every((s, i) => i === 0 || s.start === got[i - 1].end)
    );
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function narrationBlocks(count: number, chars: number): NarrationBlock[] {
  const out: NarrationBlock[] = [];
  let charStart = 0;
  for (let i = 0; i < count; i++) {
    const source = `${"Alpha beta gamma delta. ".repeat(Math.ceil(chars / 24)).slice(0, chars - 1)}.`;
    out.push({ index: i, charStart, source, text: source });
    charStart += source.length + 1;
  }
  return out;
}

console.log("\nnarration requests stay inside the API limit and land on paragraph boundaries");
{
  const blocks = narrationBlocks(40, 900);
  const chunks = planChunks(blocks);

  check(
    "every chunk fits a request",
    chunks.every((c) => c.text.length <= MAX_REQUEST_CHARS),
    chunks.map((c) => c.text.length).join(", ")
  );
  check(
    "every block appears exactly once",
    chunks.reduce((n, c) => n + c.segments.length, 0) === blocks.length
  );
  check(
    "segments point at their own text",
    chunks.every((c) =>
      c.segments.every((s) => c.text.slice(s.start, s.end) === s.block.text)
    )
  );
  check(
    "the middle chunks are given both neighbours for context",
    chunks.length > 2 &&
      chunks[1].previousText.length > 0 &&
      chunks[1].nextText.length > 0
  );
  check(
    "the first chunk has nothing before it and the last nothing after",
    chunks[0].previousText === "" && chunks[chunks.length - 1].nextText === ""
  );
}

console.log("\na single paragraph longer than a request is sent whole rather than cut");
{
  const blocks = narrationBlocks(1, MAX_REQUEST_CHARS + 2000);
  const chunks = planChunks(blocks);
  check("one chunk", chunks.length === 1);
  check("nothing was dropped", chunks[0].text === blocks[0].text);
}

// ---------------------------------------------------------------------------
// Cues — the mapping that decides what gets highlighted
// ---------------------------------------------------------------------------

/** A fake alignment: every character spoken at a steady rate. */
function evenAlignment(text: string, msPerChar: number) {
  return {
    characters: [...text],
    starts: [...text].map((_, i) => (i * msPerChar) / 1000),
  };
}

console.log("\ncues point at the right words when cleaning left the sentences alone");
{
  const source =
    "The first sentence here. The second sentence follows. And a third one ends it.";
  // What cleanup does to it: a footnote marker removed, nothing else.
  const cleaned =
    "The first sentence here. The second sentence follows. And a third one ends it.";
  const block: NarrationBlock = { index: 0, charStart: 5000, source, text: cleaned };
  const chunks = planChunks([block]);
  const { characters, starts } = evenAlignment(chunks[0].text, 60);
  const times = characterTimes(chunks[0].text, characters, starts);
  const cues = normaliseCues(cuesForChunk(chunks[0], times, 0));

  check("one cue per sentence", cues.length === 3, `${cues.length}`);
  check(
    "every cue lands inside the block's own characters",
    cues.every((c) => c.s >= block.charStart && c.e <= block.charStart + source.length),
    cues.map((c) => `${c.s}-${c.e}`).join(" ")
  );
  check(
    "the cues are the source sentences, exactly",
    cues.map((c) => source.slice(c.s - block.charStart, c.e - block.charStart).trim()).join("|") ===
      "The first sentence here.|The second sentence follows.|And a third one ends it.",
    cues.map((c) => source.slice(c.s - block.charStart, c.e - block.charStart)).join("|")
  );
  check("times increase", cues.every((c, i) => i === 0 || c.t >= cues[i - 1].t));
}

console.log("\ncues stay inside the right paragraph when cleaning changed the sentence count");
{
  const source = "Chapter head. [12] The text runs on. It ends here. 214";
  // Cleanup dropped the marker and the folio, merging two sentences into one.
  const cleaned = "Chapter head. The text runs on and ends here.";
  const block: NarrationBlock = { index: 0, charStart: 900, source, text: cleaned };
  const chunks = planChunks([block]);
  const { characters, starts } = evenAlignment(chunks[0].text, 60);
  const times = characterTimes(chunks[0].text, characters, starts);
  const cues = normaliseCues(cuesForChunk(chunks[0], times, 0));

  check("still produces cues", cues.length > 0);
  check(
    "no cue escapes the paragraph it came from",
    cues.every((c) => c.s >= block.charStart && c.e <= block.charStart + source.length),
    cues.map((c) => `${c.s}-${c.e}`).join(" ")
  );
  check("every cue has width", cues.every((c) => c.e > c.s));
}

console.log("\nthe timing map answers both directions consistently");
{
  const blocks = narrationBlocks(6, 400);
  const chunks = planChunks(blocks);
  const { characters, starts } = evenAlignment(chunks[0].text, 55);
  const times = characterTimes(chunks[0].text, characters, starts);
  const cues = normaliseCues(cuesForChunk(chunks[0], times, 0));

  check("cue times are non-decreasing", cues.every((c, i) => i === 0 || c.t >= cues[i - 1].t));

  let roundTrips = true;
  for (const cue of cues) {
    const at = timeAtChar(cues, cue.s);
    const back = cueAt(cues, at);
    if (!back || back.s !== cue.s) roundTrips = false;
  }
  check("character → time → character returns the same sentence", roundTrips);

  check(
    "a time before the first cue still resolves",
    cueAt(cues, -1)?.s === cues[0].s
  );
  check(
    "a time past the end resolves to the last sentence",
    cueAt(cues, 10 ** 9)?.s === cues[cues.length - 1].s
  );
}

console.log("\na chapter with no alignment still plays, it just can't follow along");
{
  const chunks = planChunks(narrationBlocks(3, 400));
  check("no timings means no cues, not a crash", cuesForChunk(chunks[0], null, 0).length === 0);
  check("a mismatched alignment is rejected", characterTimes("abc", ["a", "b"], [0]) === null);
}

// ---------------------------------------------------------------------------
// Is the voice on this page?
// ---------------------------------------------------------------------------

/**
 * The question both halves of following along come down to, asked from two
 * sides: the voice moved off the page, so turn it; you turned the page away
 * from the voice, so stop steering and offer both ways back. A wrong answer is
 * silent either way — the page stops following, or it fights every page turn —
 * so the boundaries are worth pinning down.
 */
console.log("\nthe page knows whether the voice is on it");
{
  const at = (s: number, e: number) => ({ t: 0, s, e });

  check("a sentence inside the page is on it", cueOnPage(at(1200, 1260), 1000, 2000));
  check(
    "a sentence starting on the page's first character is on it",
    cueOnPage(at(1000, 1060), 1000, 2000)
  );
  check("the page before is not this page", !cueOnPage(at(900, 960), 1000, 2000));
  check("the page after is not this page", !cueOnPage(at(2000, 2060), 1000, 2000));
  check(
    "a sentence ending exactly at the top of the page belongs to the page before",
    !cueOnPage(at(940, 1000), 1000, 2000)
  );
  check(
    "a sentence spanning the top of the page counts as here",
    cueOnPage(at(980, 1040), 1000, 2000)
  );
  check(
    "a sentence spanning the bottom of the page counts as here",
    cueOnPage(at(1960, 2040), 1000, 2000)
  );
  // The last page has no character after it, so the caller passes its own start
  // and the page has to read as running to the end of the book. Getting this
  // wrong turns the final page of every chapter into an unturnable one.
  check(
    "the last page of a book holds everything after it",
    cueOnPage(at(9000, 9060), 1000, 1000)
  );
  check(
    "the last page still doesn't hold what came before it",
    !cueOnPage(at(400, 460), 1000, 1000)
  );
}

// ---------------------------------------------------------------------------
// MP3 stitching
// ---------------------------------------------------------------------------

/**
 * A valid MPEG-1 Layer III frame: 44.1kHz, 128kbps, no padding. 1152 samples,
 * 417 bytes — 26.122ms of audio.
 */
function mp3Frame(marker = 0): Uint8Array {
  const frame = new Uint8Array(417);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG1, Layer III, no CRC
  frame[2] = 0x90; // bitrate index 9 (128k), sample rate index 0 (44.1k)
  frame[3] = 0x00;
  frame[4] = marker;
  return frame;
}

function mp3File(frames: number, opts: { id3?: boolean; xing?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (opts.id3) {
    // A 20-byte ID3v2 tag: 10 header bytes plus a syncsafe size of 10.
    const tag = new Uint8Array(20);
    tag[0] = 0x49;
    tag[1] = 0x44;
    tag[2] = 0x33;
    tag[9] = 10;
    parts.push(tag);
  }
  if (opts.xing) {
    const header = mp3Frame();
    header.set([0x58, 0x69, 0x6e, 0x67], 36); // "Xing"
    parts.push(header);
  }
  for (let i = 0; i < frames; i++) parts.push(mp3Frame(i));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const FRAME_MS = (1152 / 44100) * 1000;

console.log("\nMP3 duration is counted from frames, not estimated");
{
  check(
    "100 frames is the right length",
    Math.abs(mp3DurationMs(mp3File(100)) - 100 * FRAME_MS) < 1,
    `${mp3DurationMs(mp3File(100))} vs ${Math.round(100 * FRAME_MS)}`
  );
  check(
    "an ID3 tag doesn't count as audio",
    mp3DurationMs(mp3File(100, { id3: true })) === mp3DurationMs(mp3File(100))
  );
}

console.log("\nstitching reports each piece's exact length and drops metadata frames");
{
  const parts = [
    mp3File(40, { id3: true, xing: true }),
    mp3File(25, { xing: true }),
    mp3File(35),
  ];
  const joined = concatMp3(parts);

  check(
    "each piece's duration is its own frame count",
    joined.durationsMs.every((ms, i) => Math.abs(ms - [40, 25, 35][i] * FRAME_MS) < 1),
    joined.durationsMs.join(", ")
  );
  check(
    "the total is the sum, with no drift",
    Math.abs(joined.totalMs - 100 * FRAME_MS) < 2,
    `${joined.totalMs} vs ${Math.round(100 * FRAME_MS)}`
  );
  check(
    "the joined file is only audio frames",
    joined.audio.length === 100 * 417,
    `${joined.audio.length} vs ${100 * 417}`
  );
  check(
    "reading the joined file back agrees",
    Math.abs(mp3DurationMs(joined.audio) - joined.totalMs) < 2
  );
  check("it still starts with a frame sync", joined.audio[0] === 0xff);
}

console.log("\noffsets accumulated across pieces stay exact over a long chapter");
{
  // Twelve pieces is a long chapter. Estimating each piece's length from its
  // last spoken character instead of its frames is what used to put the
  // highlight a second ahead of the voice by the end of one.
  const parts = Array.from({ length: 12 }, () => mp3File(400));
  const joined = concatMp3(parts);
  const summed = joined.durationsMs.reduce((a, b) => a + b, 0);
  check(
    "the sum of the pieces is the whole",
    Math.abs(summed - joined.totalMs) <= 12,
    `${summed} vs ${joined.totalMs}`
  );
  check(
    "and matches the bytes actually written",
    Math.abs(mp3DurationMs(joined.audio) - joined.totalMs) < 12
  );
}

console.log(
  failures === 0
    ? "\nAll audiobook invariants hold."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
