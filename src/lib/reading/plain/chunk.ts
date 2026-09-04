/**
 * Cutting a chapter into the requests a translator can hold in view.
 *
 * Pure and deterministic. The batch path and the live path both cut the same
 * chapter into the same chunks, which is what lets a batch result be matched
 * back to its paragraphs by nothing more than a chapter and chunk number.
 *
 * Headings never travel. They are the book's structure, not its style, and the
 * reader renders them from the original block map regardless of face. Empty
 * blocks are skipped for the same reason: there is nothing to translate.
 */

import type { BookBlock } from "@/lib/reading/block-stream";
import { PLAIN_CHUNK_CHARS } from "./constants";

export type PlainChunk = {
  chapterIndex: number;
  chunkIndex: number;
  /** The paragraphs to translate, in book order. Never headings, never empty. */
  blocks: BookBlock[];
  /**
   * The paragraph immediately before this chunk, in the ORIGINAL, as read-only
   * context. The original rather than the translation because a batch submits
   * every chunk at once, before any of them has been translated; using the
   * original gives live and batched requests the same continuity signal and
   * lets a chapter's chunks run in parallel.
   */
  contextBefore: string | null;
};

/** Whether a block is a paragraph worth translating. */
export function isTranslatable(block: BookBlock): boolean {
  return block.tag === "p" && block.text.trim().length > 0;
}

/**
 * The chunks for one chapter, given the whole book's block map and the
 * chapter's half-open block range.
 *
 * Cuts fall on block boundaries. A single paragraph longer than the cap gets a
 * chunk to itself rather than being split mid-sentence.
 */
export function chunkChapter(
  blocks: BookBlock[],
  chapterIndex: number,
  blockStart: number,
  blockEnd: number,
  maxChars: number = PLAIN_CHUNK_CHARS
): PlainChunk[] {
  const out: PlainChunk[] = [];
  let current: BookBlock[] = [];
  let currentChars = 0;

  // The paragraph before the chapter opens, so the first chunk isn't cold.
  let lastBefore: string | null = null;
  for (let i = blockStart - 1; i >= 0; i--) {
    if (isTranslatable(blocks[i])) {
      lastBefore = blocks[i].text;
      break;
    }
  }

  const flush = () => {
    if (current.length === 0) return;
    out.push({
      chapterIndex,
      chunkIndex: out.length,
      blocks: current,
      contextBefore: lastBefore,
    });
    lastBefore = current[current.length - 1].text;
    current = [];
    currentChars = 0;
  };

  for (let i = blockStart; i < blockEnd && i < blocks.length; i++) {
    const block = blocks[i];
    if (!isTranslatable(block)) continue;
    if (current.length > 0 && currentChars + block.text.length > maxChars) flush();
    current.push(block);
    currentChars += block.text.length;
  }
  flush();
  return out;
}

/**
 * Chunks for an arbitrary block range — the on-demand peek. Same cutting rule,
 * chapter index supplied by the caller from the plan.
 */
export function chunkRange(
  blocks: BookBlock[],
  chapterIndex: number,
  from: number,
  to: number
): PlainChunk[] {
  return chunkChapter(blocks, chapterIndex, from, to);
}

/** Split one chunk into two halves on a block boundary. Null when it can't. */
export function splitChunk(chunk: PlainChunk): [PlainChunk, PlainChunk] | null {
  if (chunk.blocks.length < 2) return null;
  const mid = Math.ceil(chunk.blocks.length / 2);
  const first = chunk.blocks.slice(0, mid);
  const second = chunk.blocks.slice(mid);
  return [
    { ...chunk, blocks: first },
    { ...chunk, blocks: second, contextBefore: first[first.length - 1].text },
  ];
}
