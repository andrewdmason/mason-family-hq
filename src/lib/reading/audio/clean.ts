import "server-only";
import { anthropic } from "@/lib/journal/anthropic";
import type { BookBlock } from "@/lib/reading/block-stream";

/**
 * Turning a page of a book into something worth listening to.
 *
 * This is the difference between an audiobook and a screen reader, and it is
 * the step that is easiest to skip and hardest to forgive. Text that reads
 * perfectly well on screen is often junk when spoken:
 *
 *   "THE POWER BROKER 214"        a running header, every ninety seconds
 *   "as Caro argued 47 the ..."   a footnote marker landing mid-sentence
 *   "under- stood"                a word broken across a line
 *   "Ch. 4, 1914-18"              abbreviations the voice will mangle
 *   a table of contents           thirty minutes of nothing before chapter one
 *
 * Two passes. A mechanical one that needs no model and can never fail, and a
 * language-model one that catches everything the rules can't name. The model
 * pass costs a fraction of what voicing the same text costs — a few cents
 * against a few dollars — so it is close to free in context, and if it fails
 * for any reason the mechanical result still plays.
 *
 * The one rule that matters: this is STRICTLY SUBTRACTIVE. Remove furniture,
 * normalise abbreviations, rejoin broken words — never rewrite, never
 * summarise, never improve. The failure mode to design against is listening to
 * a paraphrase of a book instead of the book, and it would be almost impossible
 * to notice by ear.
 */

/**
 * The cleanup model. Sonnet rather than Haiku: the judgement calls here are
 * contextual ("St." is Saint in one line and Street in the next) and the whole
 * pass costs a rounding error next to the narration it feeds.
 */
export const NARRATION_CLEANUP_MODEL =
  process.env.READING_NARRATION_MODEL ?? "claude-sonnet-5";

/**
 * Source characters per model request.
 *
 * Small enough that each call's output stays well inside a non-streaming
 * response, and that one failed batch costs one batch rather than a chapter.
 */
const CLEANUP_BATCH_CHARS = 10_000;

const MAX_OUTPUT_TOKENS = 16_000;

/**
 * A block of the book, prepared for narration.
 *
 * `source` is kept alongside `text` because the follow-along highlight is
 * computed by lining the two up — see script.ts. Losing the pairing would mean
 * the voice and the highlight drift apart.
 */
export type NarrationBlock = {
  /** Index into the chapter's block list. */
  index: number;
  /** Where this block starts in the book's char space. */
  charStart: number;
  /** The book's own text, untouched. */
  source: string;
  /** What the narrator actually says. */
  text: string;
};

const SYSTEM_PROMPT = `You prepare book text for audiobook narration.

You will be given numbered blocks of text from one chapter of a book, exactly as they appear in the source. Return the blocks that should be SPOKEN, cleaned for the ear.

Your edits are STRICTLY SUBTRACTIVE AND NORMALISING. This is the most important rule and it has no exceptions:
- NEVER paraphrase, summarise, condense, expand, improve, or reorder the prose.
- NEVER change the author's wording, sentence structure, or punctuation beyond what is listed below.
- If you are unsure whether something is furniture or text, KEEP IT. A stray page number that gets read aloud is a small annoyance; a deleted paragraph is a hole in the book.

REMOVE a block entirely (omit it from your output) when it is not part of the book's prose:
- Running headers and footers: a repeated book title, chapter title, or author name; a bare page number.
- Front matter that survived into the chapter: copyright notices, ISBNs, "Printed in the United States", publisher addresses, table-of-contents entries.
- Figure and table captions, image credits, and the contents of tables — these do not survive being read aloud.
- Footnote and endnote bodies.

CLEAN the text of a block you keep:
- Rejoin words broken across a line: "under- stood" becomes "understood".
- Delete footnote and endnote markers that interrupt a sentence: superscript numbers, bracketed numbers like [12], and asterisks and daggers used as markers. Delete the marker only, never the surrounding words.
- Delete inline page markers and cross-references of the form "(see p. 214)" ONLY when they are the publisher's apparatus rather than the author's own words.
- Expand abbreviations to how they are SAID, using the surrounding sentence to decide: "Ch. 4" becomes "Chapter four"; "St. Petersburg" becomes "Saint Petersburg" but "42 Baker St." becomes "42 Baker Street"; "Dr. Reed" becomes "Doctor Reed"; "vol. II" becomes "volume two"; "1914-18" becomes "1914 to 18"; "e.g." becomes "for example". Leave an abbreviation alone if you cannot tell how it is meant to be said.
- Normalise whitespace to single spaces.
- Leave a heading as a heading, but written the way it would be announced: "CHAPTER SEVEN" becomes "Chapter Seven".

Return the kept blocks in their original order, each with its original index number.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          text: { type: "string" },
        },
        required: ["i", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["blocks"],
  additionalProperties: false,
} as const;

/** A bare page number, a folio, or a heading that is only a number. */
const PAGE_NUMBER_ONLY = /^[\s\d.,:;|–—-]*$/;
/** Publisher apparatus that shows up as its own block. */
const FRONT_MATTER =
  /^(copyright|all rights reserved|isbn\b|printed in\b|first published|library of congress|published by)/i;

/**
 * The pass that can't fail.
 *
 * Runs first and always. On its own it is roughly right — it catches the page
 * numbers and the obvious apparatus and leaves everything else alone — which is
 * exactly what we want as the floor under the model pass.
 */
export function mechanicalClean(blocks: BookBlock[], from: number): NarrationBlock[] {
  const out: NarrationBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const raw = block.text.trim();
    if (!raw) continue;
    if (PAGE_NUMBER_ONLY.test(raw)) continue;
    if (FRONT_MATTER.test(raw)) continue;

    const text = raw
      // A word broken across a line by the typesetter.
      .replace(/(\p{Ll})-\s+(\p{Ll})/gu, "$1$2")
      // Bracketed footnote markers.
      .replace(/\[\d{1,3}\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    out.push({ index: from + i, charStart: block.charStart, source: block.text, text });
  }
  return out;
}

/** Split into request-sized batches without splitting a block. */
function batch(blocks: NarrationBlock[]): NarrationBlock[][] {
  const batches: NarrationBlock[][] = [];
  let current: NarrationBlock[] = [];
  let size = 0;
  for (const block of blocks) {
    if (current.length > 0 && size + block.text.length > CLEANUP_BATCH_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function cleanBatch(blocks: NarrationBlock[]): Promise<NarrationBlock[]> {
  const numbered = blocks
    .map((block, i) => `<block n="${i}">\n${block.text}\n</block>`)
    .join("\n\n");

  const response = await anthropic().messages.create({
    model: NARRATION_CLEANUP_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    // Off deliberately. Every decision here is local — each block is judged on
    // its own text — and thinking would share the output budget with the prose
    // we actually need back.
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: numbered }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The cleanup model declined this passage.");
  }

  const block = response.content.find((c) => c.type === "text");
  if (!block || block.type !== "text") throw new Error("No cleanup returned.");

  const parsed = JSON.parse(block.text) as { blocks: { i: number; text: string }[] };

  const out: NarrationBlock[] = [];
  for (const entry of parsed.blocks) {
    const source = blocks[entry.i];
    // An index we didn't send, or an empty result, is the model having lost
    // track. Dropping it is right — the alternative is attributing one block's
    // audio to another block's character range, which puts the follow-along
    // highlight on the wrong paragraph for the rest of the chapter.
    if (!source) continue;
    const text = entry.text.trim();
    if (!text) continue;
    out.push({ ...source, text });
  }

  // A batch that came back nearly empty means the model misread the task rather
  // than that the chapter was all furniture. Keep the mechanical version.
  if (out.length < blocks.length / 4) {
    throw new Error("Cleanup returned too little of the passage.");
  }
  return out;
}

/**
 * Prepare a chapter's blocks for narration.
 *
 * Never throws. If the model pass fails — no key, an outage, a batch that came
 * back wrong — the mechanically-cleaned text is returned instead and the chapter
 * still plays. A slightly rougher listen beats a chapter that won't prepare, and
 * the caller has no better answer to give the reader than we do.
 */
export async function cleanForNarration(
  blocks: BookBlock[],
  from: number
): Promise<NarrationBlock[]> {
  const mechanical = mechanicalClean(blocks, from);
  if (mechanical.length === 0) return [];

  const batches = batch(mechanical);
  const results = await Promise.all(
    batches.map(async (group) => {
      try {
        return await cleanBatch(group);
      } catch (err) {
        console.warn(
          `[reader] narration cleanup fell back to rules: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return group;
      }
    })
  );

  return results.flat();
}
