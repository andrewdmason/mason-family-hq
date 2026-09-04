/**
 * Rendering the plain face: the book's own markup with the paragraphs swapped.
 *
 * The one rule everything here rests on: THE ORIGINAL BLOCK MAP IS THE
 * COORDINATE SYSTEM. Positions, anchors, the table of contents, the spoiler
 * boundary and the page map are all measured against `blockMap(html)` of the
 * original, and none of them ever sees plain text. So this emits exactly one
 * element per original block — same tag, same attributes, same `id` — and only
 * the text inside changes. `querySelectorAll(BLOCK_SELECTOR)` over the result
 * counts the same blocks in the same order, which is what keeps every stored
 * anchor pointing at the right paragraph in either face.
 *
 * Three things ride along, each as a string insert that is NOT a block:
 *
 *   - the chat and summary marks (inline-chat-blocks.ts), spliced above their
 *     block exactly as they are in the original face;
 *   - a marker under a chapter's heading saying what state its translation is
 *     in, when it is not (yet) the face being shown;
 *   - a `<span class="reader-term">` around the first occurrence of a glossary
 *     term in each chapter. Inline, inside the block, so `blockMap` strips it
 *     and the block's text is unchanged.
 *
 * Only paragraphs from chapters the caller says are APPLIED are substituted.
 * A chapter whose translation has landed but which the reader is currently
 * looking at stays original until they navigate — see KTD13 — and a chapter
 * with a few peeked paragraphs stored is never rendered as a patchwork.
 *
 * Client-safe and pure. Verified by scripts/verify-plain-face.mts.
 */

import type { BookBlock } from "@/lib/reading/block-stream";
import { markHtml, type InlineChatMark } from "@/lib/reading/inline-chat-blocks";
import type { BookWindow } from "@/lib/reading/paged-window";
import type { PlainBlock, PlainChapter, PlainChapterStatus, PlainTerm } from "./types";

/** Class on a glossary term's span, for the reader's typography and click delegation. */
export const PLAIN_TERM_CLASS = "reader-term";
/** Attribute on a term span carrying the term as stored. */
export const PLAIN_TERM_ATTR = "data-reader-term";

/**
 * Class on a chapter's translation marker. Carries the chat-mark class too so
 * it inherits the hairline treatment and, crucially, the paged `break-inside`
 * rule — see reader-prose.ts.
 */
export const PLAIN_MARK_CLASS = "reader-plain-mark";
/** Attribute on a marker carrying the chapter index it speaks for. */
export const PLAIN_MARK_ATTR = "data-reader-plain";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Everything the renderer needs to know about the translation's state.
 *
 * `applied` is the set of chapters whose plain text is shown; `chapters` and
 * `face` decide which markers appear. A caller rendering the original face
 * passes `face: "original"` and gets the original with no markers at all.
 */
export type PlainRenderState = {
  face: "original" | "plain";
  chapters: PlainChapter[];
  /** Chapter indices whose paragraphs are swapped in. */
  applied: ReadonlySet<number>;
  /** Stored paragraphs by block index. */
  blocks: ReadonlyMap<number, PlainBlock>;
  terms: PlainTerm[];
};

/** The text a block shows in the current face, or null if it shows the original. */
export function plainTextOf(state: PlainRenderState | null, block: BookBlock): string | null {
  if (!state || state.face !== "plain") return null;
  const plain = state.blocks.get(block.index);
  if (!plain || plain.kept || plain.text == null) return null;
  if (!state.applied.has(plain.chapterIndex)) return null;
  return plain.text;
}

/** What a chapter's marker should say, or null for no marker. */
export function markerLabel(status: PlainChapterStatus, applied: boolean): string | null {
  if (applied) return null;
  switch (status) {
    case "ready":
      return "Plain English ready · tap to switch";
    case "failed":
      return "Couldn't translate this chapter · Retry";
    case "pending":
    case "preparing":
    case "batched":
      return "Translating…";
  }
}

function markerHtml(chapter: PlainChapter): string | null {
  const label = markerLabel(chapter.status, false);
  if (!label) return null;
  return (
    `<aside class="reader-chat-mark ${PLAIN_MARK_CLASS}" ${PLAIN_MARK_ATTR}="${chapter.index}" ` +
    `data-reader-plain-status="${chapter.status}">${escapeHtml(label)}</aside>`
  );
}

/** The opening tag of a block's original markup, attributes included. */
function openingTag(html: string, block: BookBlock): string {
  const slice = html.slice(block.htmlStart, block.htmlEnd);
  const m = /^<[a-z0-9]+\b[^>]*>/i.exec(slice);
  return m ? m[0] : `<${block.tag}>`;
}

/** A regex that matches a term as a whole word, case-insensitively. */
function termPattern(term: string): RegExp | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return null;
  // Word boundaries that survive non-ASCII: not preceded/followed by a letter.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * Escape a paragraph's text and wrap the first occurrence of each still-unseen
 * term. `seen` is per chapter and mutated as terms are found.
 */
export function termsHtml(
  text: string,
  terms: { term: string; pattern: RegExp }[],
  seen: Set<string>
): string {
  type Hit = { start: number; end: number; term: string };
  const hits: Hit[] = [];
  for (const { term, pattern } of terms) {
    if (seen.has(term)) continue;
    const m = pattern.exec(text);
    if (!m) continue;
    hits.push({ start: m.index, end: m.index + m[0].length, term });
  }
  if (hits.length === 0) return escapeHtml(text);

  hits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue; // overlapping term; the earlier one wins
    seen.add(hit.term);
    out += escapeHtml(text.slice(cursor, hit.start));
    out +=
      `<span class="${PLAIN_TERM_CLASS}" ${PLAIN_TERM_ATTR}="${escapeHtml(hit.term)}">` +
      escapeHtml(text.slice(hit.start, hit.end)) +
      `</span>`;
    cursor = hit.end;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

/**
 * The window's markup with the plain face applied.
 *
 * Emits, in order: any chat marks above a block, the block itself (original
 * slice or substituted), and — immediately after a chapter's first block — its
 * marker when the chapter is not applied. Inter-block gaps (the zero-height
 * page anchors) are carried over as original slices.
 *
 * `marks` are the chat and summary marks for the WHOLE book; only those inside
 * the window are placed. Several can share a block and come out oldest first,
 * matching withInlineChats.
 */
export function plainWindowHtml(
  html: string,
  blocks: BookBlock[],
  win: BookWindow,
  marks: InlineChatMark[],
  state: PlainRenderState
): string {
  if (win.endBlock <= win.startBlock) return "";

  const marksByBlock = new Map<number, InlineChatMark[]>();
  for (const mark of marks) {
    if (mark.blockIndex < win.startBlock || mark.blockIndex >= win.endBlock) continue;
    const list = marksByBlock.get(mark.blockIndex) ?? [];
    list.push(mark);
    marksByBlock.set(mark.blockIndex, list);
  }

  const chapterAtBlock = new Map<number, PlainChapter>();
  const chapterOf = new Array<number | undefined>(win.endBlock - win.startBlock);
  for (const chapter of state.chapters) {
    chapterAtBlock.set(chapter.blockStart, chapter);
    const from = Math.max(chapter.blockStart, win.startBlock);
    const to = Math.min(chapter.blockEnd, win.endBlock);
    for (let i = from; i < to; i++) chapterOf[i - win.startBlock] = chapter.index;
  }

  const patterns = state.terms
    .map((t) => ({ term: t.term, firstChapterIndex: t.firstChapterIndex, pattern: termPattern(t.term) }))
    .filter((t): t is { term: string; firstChapterIndex: number; pattern: RegExp } => t.pattern != null);
  const seenByChapter = new Map<number, Set<string>>();

  let out = "";
  for (let i = win.startBlock; i < win.endBlock; i++) {
    const block = blocks[i];
    if (i > win.startBlock) {
      // Whatever sat between the two blocks in the source — page anchors.
      out += html.slice(blocks[i - 1].htmlEnd, block.htmlStart);
    }
    for (const mark of marksByBlock.get(i) ?? []) out += markHtml(mark);

    const plain = plainTextOf(state, block);
    if (plain == null) {
      out += html.slice(block.htmlStart, block.htmlEnd);
    } else {
      const chapterIndex = chapterOf[i - win.startBlock];
      let seen = seenByChapter.get(chapterIndex ?? -1);
      if (!seen) {
        seen = new Set();
        seenByChapter.set(chapterIndex ?? -1, seen);
      }
      const eligible =
        chapterIndex == null
          ? []
          : patterns.filter((t) => t.firstChapterIndex <= chapterIndex);
      out += openingTag(html, block) + termsHtml(plain, eligible, seen) + `</${block.tag}>`;
    }

    if (state.face === "plain") {
      const chapter = chapterAtBlock.get(i);
      if (chapter && !state.applied.has(chapter.index)) {
        const marker = markerHtml(chapter);
        if (marker) out += marker;
      }
    }
  }
  return out;
}

/** Class on a translation cell in the parallel spread. Not a block: an <aside>. */
export const PLAIN_CELL_CLASS = "reader-plain-cell";
/** Attribute on a cell naming the block it translates. */
export const PLAIN_CELL_ATTR = "data-plain-block";

/**
 * The window as a parallel text: every original block, each paragraph followed
 * by an <aside> carrying its translation, so a two-column grid lays them level.
 *
 * The left cells ARE the book's block elements — same tags, ids and text as the
 * original, in order — so the block map still counts exactly them. The right
 * cells are asides, which the block selector never sees. Headings, chat marks
 * and page anchors are emitted alone and the stylesheet spans them across both
 * columns (reader-prose.ts, PARALLEL_PROSE).
 *
 * A translation that isn't applied yet leaves its cell empty and puts the
 * chapter's marker under the heading, exactly as the plain face does. `state`
 * may be null when nothing at all is translated: every right cell is empty.
 */
export function parallelWindowHtml(
  html: string,
  blocks: BookBlock[],
  win: BookWindow,
  marks: InlineChatMark[],
  state: PlainRenderState | null
): string {
  if (win.endBlock <= win.startBlock) return "";

  const marksByBlock = new Map<number, InlineChatMark[]>();
  for (const mark of marks) {
    if (mark.blockIndex < win.startBlock || mark.blockIndex >= win.endBlock) continue;
    const list = marksByBlock.get(mark.blockIndex) ?? [];
    list.push(mark);
    marksByBlock.set(mark.blockIndex, list);
  }

  const chapterAtBlock = new Map<number, PlainChapter>();
  const chapterOf = new Array<number | undefined>(win.endBlock - win.startBlock);
  for (const chapter of state?.chapters ?? []) {
    chapterAtBlock.set(chapter.blockStart, chapter);
    const from = Math.max(chapter.blockStart, win.startBlock);
    const to = Math.min(chapter.blockEnd, win.endBlock);
    for (let i = from; i < to; i++) chapterOf[i - win.startBlock] = chapter.index;
  }
  const patterns = (state?.terms ?? [])
    .map((t) => ({ term: t.term, firstChapterIndex: t.firstChapterIndex, pattern: termPattern(t.term) }))
    .filter((t): t is { term: string; firstChapterIndex: number; pattern: RegExp } => t.pattern != null);
  const seenByChapter = new Map<number, Set<string>>();

  let out = "";
  for (let i = win.startBlock; i < win.endBlock; i++) {
    const block = blocks[i];
    if (i > win.startBlock) out += html.slice(blocks[i - 1].htmlEnd, block.htmlStart);
    for (const mark of marksByBlock.get(i) ?? []) out += markHtml(mark);

    // The original, always — the left column is the book.
    out += html.slice(block.htmlStart, block.htmlEnd);

    if (block.tag === "p") {
      const plain = state ? plainTextOf({ ...state, face: "plain" }, block) : null;
      const stored = state?.blocks.get(i);
      let inner = "";
      let extra = "";
      if (plain != null) {
        const chapterIndex = chapterOf[i - win.startBlock];
        let seen = seenByChapter.get(chapterIndex ?? -1);
        if (!seen) {
          seen = new Set();
          seenByChapter.set(chapterIndex ?? -1, seen);
        }
        const eligible =
          chapterIndex == null ? [] : patterns.filter((t) => t.firstChapterIndex <= chapterIndex);
        inner = termsHtml(plain, eligible, seen);
      } else if (stored?.kept && state && state.applied.has(stored.chapterIndex)) {
        // Kept on purpose: the author's words, shown quieter on the right so the
        // row still reads as a pair.
        inner = escapeHtml(block.text);
        extra = " reader-plain-kept";
      }
      out += `<aside class="${PLAIN_CELL_CLASS}${extra}" ${PLAIN_CELL_ATTR}="${i}">${inner}</aside>`;
    }

    if (state) {
      const chapter = chapterAtBlock.get(i);
      if (chapter && !state.applied.has(chapter.index)) {
        const marker = markerHtml(chapter);
        if (marker) out += marker;
      }
    }
  }
  return out;
}

/** The whole document in the plain face — the scrolling reader. */
export function plainDocumentHtml(
  html: string,
  blocks: BookBlock[],
  marks: InlineChatMark[],
  state: PlainRenderState
): string {
  if (blocks.length === 0) return html;
  const win: BookWindow = {
    startBlock: 0,
    endBlock: blocks.length,
    charStart: blocks[0].charStart,
    charEnd: blocks[blocks.length - 1].charStart + blocks[blocks.length - 1].text.length + 1,
  };
  // Anything before the first block (a wrapper's opening tag) and after the
  // last one is carried over unchanged, so the document stays well-formed.
  const head = html.slice(0, blocks[0].htmlStart);
  const tail = html.slice(blocks[blocks.length - 1].htmlEnd);
  return head + plainWindowHtml(html, blocks, win, marks, state) + tail;
}
