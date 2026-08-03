/**
 * Marking up a slice of a book for a model to read.
 *
 * A converted book is flattened to one line per block (block-stream.ts), which is
 * exactly right for the character space every annotation and chat anchor is
 * recorded against, and completely structureless to read: "Chapter 21" arrives
 * looking like any other short line, indistinguishable from a sentence. So the
 * chat's copy gets two kinds of mark spliced into it — page labels to cite, and
 * chapter headings to navigate by.
 *
 * The hard rule, and the reason this is its own module: marks are added while
 * BUILDING the output and never enter the counted stream. `spliceMarks` is the
 * only thing that may widen the text, and removing what it inserted must give
 * back `fullText.slice(from, to)` byte for byte — a single stray character in the
 * canonical space would silently move every stored highlight in the book.
 *
 * Pure and client-safe on purpose, like block-stream.ts: extract-text.ts supplies
 * the storage and the page rows, this decides what the model sees.
 */
import type { BookBlock } from "@/lib/reading/block-stream";

/**
 * The prefix that turns a heading block into a visible chapter marker. Markdown
 * because that is the structure every model already reads fluently, and because
 * the heading's own text follows it — nothing is duplicated or invented.
 */
export const CHAPTER_MARKER_PREFIX = "\n\n## ";

/**
 * Cap on the chapter index. A book with more headings than this almost certainly
 * converted heading-per-paragraph rather than having real chapters, and listing
 * them all would be noise rather than a map.
 */
export const MAX_CHAPTER_INDEX_ENTRIES = 500;

/**
 * Text to splice in at a character offset. `order` breaks a tie at the same
 * offset: a page label belongs above the chapter heading it lands on, never
 * inside it.
 */
export type ContextMark = { at: number; text: string; order: number };

const PAGE_MARK_ORDER = 0;
const CHAPTER_MARK_ORDER = 1;

/** A page row as stored: the char range the page covers. */
export type PageRange = { page_number: number; char_start: number; char_end: number };

/**
 * "[p.212]" labels for every page overlapping [from, to). Anything ahead of the
 * first page mark (front matter) stays unlabelled rather than being attributed to
 * the page that follows it, which is why the label sits at the page's own start.
 */
export function pageMarks(rows: PageRange[], from: number, to: number): ContextMark[] {
  const marks: ContextMark[] = [];
  for (const row of rows) {
    const start = Math.max(row.char_start, from);
    const end = Math.min(row.char_end, to);
    if (end <= start) continue;
    marks.push({ at: start, text: `\n[p.${row.page_number}]\n`, order: PAGE_MARK_ORDER });
  }
  return marks;
}

/**
 * Chapter markers for every heading block starting inside [from, to), plus the
 * headings themselves as an index. The titles are returned exactly as they appear
 * in the text, so a chapter named in the index can be found in the prose verbatim.
 */
export function chapterMarks(
  blocks: BookBlock[],
  from: number,
  to: number
): { marks: ContextMark[]; titles: string[] } {
  const marks: ContextMark[] = [];
  const titles: string[] = [];
  for (const block of blocks) {
    if (block.tag === "p") continue; // headings are the only other kind
    if (block.charStart < from || block.charStart >= to) continue;
    const title = block.text.trim();
    if (!title) continue;
    marks.push({ at: block.charStart, text: CHAPTER_MARKER_PREFIX, order: CHAPTER_MARK_ORDER });
    titles.push(title);
  }
  return { marks, titles };
}

/**
 * `fullText.slice(from, to)` with the marks spliced in at their offsets. Marks
 * outside the range are ignored; with none, this is the plain slice.
 */
export function spliceMarks(
  fullText: string,
  from: number,
  to: number,
  marks: ContextMark[]
): string {
  const inRange = marks.filter((m) => m.at >= from && m.at < to);
  if (inRange.length === 0) return fullText.slice(from, to);

  inRange.sort((a, b) => a.at - b.at || a.order - b.order);
  const parts: string[] = [];
  let cursor = from;
  for (const mark of inRange) {
    if (mark.at > cursor) parts.push(fullText.slice(cursor, mark.at));
    parts.push(mark.text);
    cursor = Math.max(cursor, mark.at);
  }
  if (cursor < to) parts.push(fullText.slice(cursor, to));
  return parts.join("");
}
