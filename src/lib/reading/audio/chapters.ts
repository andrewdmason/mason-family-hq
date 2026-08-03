/**
 * Cutting a book into the units you listen to.
 *
 * The table of contents is the starting point, but it is not the answer: a TOC
 * routinely lists a dedication, an epigraph and a part title alongside real
 * chapters, and it says nothing about how long anything is. Three corrections
 * turn it into a track list —
 *
 *   front matter is dropped   nothing before the first heading is narrated, so
 *                             a book opens on chapter one rather than on half an
 *                             hour of title page, copyright and contents
 *   short entries are merged  a nine-second track makes "skip chapter" useless
 *   long entries are split    preparation runs inside one request with a
 *                             five-minute ceiling, so a chapter has a size
 *                             beyond which it becomes parts
 *
 * Pure and shared: the server derives the plan and persists it, and the result
 * is what the player reads back. Deliberately NOT recomputed on the client —
 * two derivations that disagree by one character would put the highlight in the
 * wrong chapter, so there is exactly one.
 */

import type { BookBlock } from "@/lib/reading/block-stream";
import { chapterBounds } from "@/lib/reading/reading-progress";
import type { ReadingTocEntry } from "@/lib/types";
import { MAX_CHAPTER_CHARS, MIN_CHAPTER_CHARS } from "./constants";

export type PlannedChapter = {
  title: string;
  charStart: number;
  charEnd: number;
};

/**
 * How long a stretch of a book with no usable table of contents runs before it
 * becomes the next track. About twenty minutes of narration — long enough to be
 * a real listening unit, short enough that the first play doesn't feel stuck.
 */
const UNCHAPTERED_TARGET_CHARS = 20_000;

/** The block boundary nearest `target`, so a split never lands mid-paragraph. */
function snapToBlock(blocks: BookBlock[], target: number): number {
  let best = target;
  let bestDistance = Infinity;
  // Blocks are sorted by charStart, so this could binary-search; a book has a
  // few thousand blocks and this runs once per split, which is not worth the
  // extra edge cases.
  for (const block of blocks) {
    const distance = Math.abs(block.charStart - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = block.charStart;
    }
    if (block.charStart > target && distance > bestDistance) break;
  }
  return best;
}

/**
 * Split a chapter that is too long to synthesize in one go into equal parts,
 * each landing on a paragraph boundary. Titled "Chapter Nine (2)" so the track
 * list still reads as the book's own chapters rather than as arbitrary chunks.
 */
function splitLong(chapter: PlannedChapter, blocks: BookBlock[]): PlannedChapter[] {
  const length = chapter.charEnd - chapter.charStart;
  if (length <= MAX_CHAPTER_CHARS) return [chapter];

  const parts = Math.ceil(length / MAX_CHAPTER_CHARS);
  const stride = length / parts;
  const cuts: number[] = [chapter.charStart];
  for (let i = 1; i < parts; i++) {
    const snapped = snapToBlock(blocks, chapter.charStart + stride * i);
    // A book whose paragraphs are enormous can snap two cuts onto the same
    // block; keeping only strictly increasing cuts turns that into fewer, longer
    // parts rather than a zero-length one.
    if (snapped > cuts[cuts.length - 1]) cuts.push(snapped);
  }
  cuts.push(chapter.charEnd);

  const out: PlannedChapter[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    out.push({
      title: cuts.length > 2 ? `${chapter.title} (${i + 1})` : chapter.title,
      charStart: cuts[i],
      charEnd: cuts[i + 1],
    });
  }
  return out;
}

/**
 * Fold away entries too short to be worth their own track.
 *
 * A short entry joins the one AFTER it and takes that one's title: "Dedication"
 * followed by "Chapter One" becomes a single Chapter One that happens to open
 * with the dedication. Naming it after the substantive half is the point — the
 * alternative is a track list where the first three entries are furniture.
 *
 * A short entry at the very end has nothing after it, so it joins the one before
 * and keeps that title instead.
 */
function mergeShort(chapters: PlannedChapter[]): PlannedChapter[] {
  if (chapters.length <= 1) return chapters;
  const out: PlannedChapter[] = [];
  let pendingStart: number | null = null;

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const start: number = pendingStart ?? chapter.charStart;
    const isLast = i === chapters.length - 1;

    if (chapter.charEnd - start < MIN_CHAPTER_CHARS && !isLast) {
      pendingStart = start;
      continue;
    }

    if (isLast && chapter.charEnd - start < MIN_CHAPTER_CHARS && out.length > 0) {
      out[out.length - 1].charEnd = chapter.charEnd;
      pendingStart = null;
      continue;
    }

    out.push({ title: chapter.title, charStart: start, charEnd: chapter.charEnd });
    pendingStart = null;
  }

  return out;
}

/** Even slices of a book that never told us where its chapters are. */
function unchaptered(blocks: BookBlock[], totalChars: number): PlannedChapter[] {
  const parts = Math.max(1, Math.round(totalChars / UNCHAPTERED_TARGET_CHARS));
  const stride = totalChars / parts;
  const cuts: number[] = [0];
  for (let i = 1; i < parts; i++) {
    const snapped = snapToBlock(blocks, stride * i);
    if (snapped > cuts[cuts.length - 1]) cuts.push(snapped);
  }
  cuts.push(totalChars);

  const out: PlannedChapter[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    out.push({
      title: cuts.length > 2 ? `Part ${i + 1}` : "The whole book",
      charStart: cuts[i],
      charEnd: cuts[i + 1],
    });
  }
  return out;
}

/**
 * The track list for a book.
 *
 * `totalChars` is the end of the character space (totalCharsOf), which is where
 * the final chapter stops — a TOC gives starts, never ends.
 */
export function planChapters(
  blocks: BookBlock[],
  toc: ReadingTocEntry[],
  bookTitle: string,
  totalChars: number
): PlannedChapter[] {
  if (blocks.length === 0 || totalChars <= 0) return [];

  const bounds = chapterBounds(toc, bookTitle, blocks);

  // One heading is not a table of contents — it is a book with a title on its
  // first page. Slice it evenly instead of producing a single 12-hour track.
  if (bounds.length < 2) return unchaptered(blocks, totalChars);

  // Everything before the first heading is front matter and is not narrated.
  // This is the single biggest quality win in the whole pipeline: it is the
  // difference between a book that opens on chapter one and one that opens on
  // the copyright page.
  const raw: PlannedChapter[] = bounds.map((bound, i) => ({
    title: bound.title,
    charStart: bound.charStart,
    charEnd: bounds[i + 1]?.charStart ?? totalChars,
  }));

  const merged = mergeShort(raw.filter((c) => c.charEnd > c.charStart));
  return merged.flatMap((chapter) => splitLong(chapter, blocks));
}
