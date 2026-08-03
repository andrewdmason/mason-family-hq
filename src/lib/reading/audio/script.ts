/**
 * The bridge between what is spoken and where you are in the book.
 *
 * Two coordinate spaces meet here and they are not the same space. The
 * narration API knows about the SCRIPT — the cleaned text it was handed — and
 * returns times against that. The reader knows about the BOOK — the conversion
 * character space that every position, annotation and page range is expressed
 * in. Cleaning the text for the ear is exactly what pulls them apart: a
 * footnote marker deleted here shifts everything after it there.
 *
 * The mapping is kept honest by construction rather than by matching text
 * afterwards. Cleaning happens per BLOCK, so every piece of script is already
 * tied to the paragraph it came from and to that paragraph's character range —
 * an offset can only ever be wrong within one paragraph, never across the
 * chapter. Inside a block, sentences are lined up one for one when the cleanup
 * left the sentence count alone (the overwhelmingly common case, since it only
 * removes furniture), which makes the highlight land exactly. When the counts
 * differ we fall back to interpolating across the block, which is off by at
 * most a few words and still highlights the right paragraph.
 *
 * Pure and client-safe, so the same reasoning can be checked by a script
 * without a database or an API key — see scripts/verify-audio-cues.mts.
 */

import type { NarrationBlock } from "./clean";
import { splitSentences } from "./sentences";
import type { AudioCue } from "./types";
import { MAX_REQUEST_CHARS, STITCH_CONTEXT_CHARS } from "./constants";

/** One block's text, positioned within the script it was joined into. */
export type ScriptSegment = {
  /** Offset of this block's text within its chunk. */
  start: number;
  end: number;
  block: NarrationBlock;
};

/** One narration request: the text to speak and what it came from. */
export type ScriptChunk = {
  text: string;
  segments: ScriptSegment[];
  /** Tail of the previous chunk, for prosody continuity across the join. */
  previousText: string;
  /** Head of the next chunk, likewise. */
  nextText: string;
};

/** Blocks are joined by a blank line, which the narrator reads as a pause. */
const BLOCK_SEPARATOR = "\n\n";

/**
 * Cut a chapter's narration into requests.
 *
 * Always on a block boundary — a request that ended mid-sentence would make the
 * voice fall off a cliff and pick up flat, which no amount of stitch context
 * repairs. A single block longer than the request limit is sent alone and
 * over-length rather than split; the API's own handling of that is better than
 * cutting a paragraph in half.
 */
export function planChunks(blocks: NarrationBlock[]): ScriptChunk[] {
  const groups: NarrationBlock[][] = [];
  let current: NarrationBlock[] = [];
  let size = 0;

  for (const block of blocks) {
    const cost = block.text.length + BLOCK_SEPARATOR.length;
    if (current.length > 0 && size + cost > MAX_REQUEST_CHARS) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += cost;
  }
  if (current.length > 0) groups.push(current);

  const chunks: ScriptChunk[] = groups.map((group) => {
    const segments: ScriptSegment[] = [];
    let text = "";
    for (const block of group) {
      if (text.length > 0) text += BLOCK_SEPARATOR;
      segments.push({ start: text.length, end: text.length + block.text.length, block });
      text += block.text;
    }
    return { text, segments, previousText: "", nextText: "" };
  });

  // The context each request is shown either side of itself. Not spoken and not
  // billed — it exists so the voice knows what it is in the middle of.
  for (let i = 0; i < chunks.length; i++) {
    const before = chunks[i - 1]?.text ?? "";
    const after = chunks[i + 1]?.text ?? "";
    chunks[i].previousText = before.slice(-STITCH_CONTEXT_CHARS);
    chunks[i].nextText = after.slice(0, STITCH_CONTEXT_CHARS);
  }

  return chunks;
}

/**
 * How far ahead we will look for a character the alignment reports but the
 * script doesn't have at that exact offset.
 *
 * The API's alignment normally reproduces the input character for character, in
 * which case this never engages. It's a bounded tolerance for the case where it
 * doesn't — it keeps the walk linear, and it means a small disagreement costs
 * one lost timing rather than throwing the rest of the chapter out of step.
 */
const ALIGNMENT_SCAN_WINDOW = 64;

/**
 * When each character of `text` is spoken, in seconds.
 *
 * Returns null when there is no usable alignment — a chapter without timings
 * still plays, it just can't follow along, and that is much better than not
 * playing at all.
 */
export function characterTimes(
  text: string,
  characters: string[] | undefined,
  startTimes: number[] | undefined
): Float64Array | null {
  if (!characters || !startTimes || characters.length !== startTimes.length) return null;
  if (text.length === 0) return null;

  const times = new Float64Array(text.length).fill(-1);
  let cursor = 0;
  for (let i = 0; i < characters.length && cursor < text.length; i++) {
    const ch = characters[i];
    const limit = Math.min(text.length, cursor + ALIGNMENT_SCAN_WINDOW);
    let scan = cursor;
    while (scan < limit && text[scan] !== ch) scan++;
    if (scan >= limit) continue;
    times[scan] = startTimes[i];
    cursor = scan + 1;
  }

  // Carry the last known time forward over anything unmatched, so every offset
  // answers with a time rather than a hole. Monotonic by construction.
  let last = 0;
  let any = false;
  for (let i = 0; i < times.length; i++) {
    if (times[i] < 0) {
      times[i] = last;
    } else {
      any = true;
      last = Math.max(last, times[i]);
      times[i] = last;
    }
  }
  return any ? times : null;
}

/**
 * The book character range a cleaned sentence covers.
 *
 * Exact when cleaning left the block's sentence count alone, which is what
 * subtractive editing almost always does. Otherwise the sentence's position
 * within the cleaned block is projected onto the source block, which keeps the
 * highlight inside the right paragraph and within a few words of the right
 * sentence.
 */
function bookRangeFor(
  segment: ScriptSegment,
  cleanStart: number,
  cleanEnd: number,
  cleanLength: number,
  sourceSentences: { start: number; end: number }[],
  cleanSentenceIndex: number,
  exact: boolean
): { s: number; e: number } {
  const { block } = segment;
  const sourceLength = block.source.length;

  if (exact) {
    const sentence = sourceSentences[cleanSentenceIndex];
    return {
      s: block.charStart + sentence.start,
      e: block.charStart + Math.min(sourceLength, sentence.end),
    };
  }

  const scale = cleanLength > 0 ? sourceLength / cleanLength : 1;
  const s = Math.round(cleanStart * scale);
  const e = Math.round(cleanEnd * scale);
  return {
    s: block.charStart + Math.min(s, sourceLength),
    e: block.charStart + Math.min(Math.max(e, s + 1), sourceLength),
  };
}

/**
 * The follow-along cues for one narration request.
 *
 * `offsetMs` is where this request's audio sits inside the finished chapter —
 * the exact duration of everything before it, measured from the MP3's frames
 * rather than estimated from the alignment. See mp3.ts for why that distinction
 * is what stops the highlight drifting over a long chapter.
 */
export function cuesForChunk(
  chunk: ScriptChunk,
  times: Float64Array | null,
  offsetMs: number
): AudioCue[] {
  if (!times) return [];
  const cues: AudioCue[] = [];

  for (const segment of chunk.segments) {
    const cleanText = segment.block.text;
    const cleanSentences = splitSentences(cleanText);
    const sourceSentences = splitSentences(segment.block.source);
    const exact = cleanSentences.length === sourceSentences.length;

    for (let i = 0; i < cleanSentences.length; i++) {
      const sentence = cleanSentences[i];
      const at = segment.start + sentence.start;
      if (at >= times.length) continue;

      const range = bookRangeFor(
        segment,
        sentence.start,
        sentence.end,
        cleanText.length,
        sourceSentences,
        i,
        exact
      );
      cues.push({ t: Math.round(offsetMs + times[at] * 1000), s: range.s, e: range.e });
    }
  }

  return cues;
}

/**
 * Put the chapter's cues in order and make the times strictly non-decreasing.
 *
 * The player binary-searches this by time, so a single out-of-order cue would
 * make the search land anywhere. Cheaper to guarantee the invariant once here
 * than to defend against it on every animation frame.
 */
export function normaliseCues(cues: AudioCue[]): AudioCue[] {
  const sorted = [...cues].sort((a, b) => a.t - b.t);
  let last = 0;
  for (const cue of sorted) {
    if (cue.t < last) cue.t = last;
    last = cue.t;
  }
  return sorted;
}
