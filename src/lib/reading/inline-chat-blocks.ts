/**
 * The conversations you started about a place in the book, set into the page.
 *
 * A chat anchored to a paragraph break leaves a one-line mark there carrying the
 * question you asked. It is how you find that conversation again: by reading
 * past it, rather than by opening an index and guessing which "In the text"
 * entry was the one you meant.
 *
 * Two rules make this safe, and both fail silently if broken:
 *
 *  1. THE MARK IS NOT A BLOCK. Every stored anchor is a block index counted by
 *     `querySelectorAll(BLOCK_SELECTOR)` over the rendered content
 *     (annotation-anchors.ts). An injected element matching that selector would
 *     shift every index after it — moving every highlight in the chapter, on the
 *     page and in the database's eyes, permanently. `<aside>` and `<span>` are
 *     outside the selector; `<p>`, `<div>`, `<li>`, `<blockquote>` and friends
 *     are not. Checked in scripts/verify-inline-chat-blocks.mts.
 *  2. THE SPLICE IS A STRING INSERT AT A BLOCK BOUNDARY. `BookBlock` records the
 *     half-open span of its own markup in the source HTML, so a mark goes in at
 *     `htmlStart` — never inside a tag, never inside text the char space counts.
 *     Nothing downstream re-derives offsets from the injected string.
 *
 * Done as an input to the render rather than as a DOM mutation after it, because
 * React re-applies the book's innerHTML and would wipe injected nodes mid-
 * pagination. Feeding the marks into the same memo that produces the window's
 * HTML also means the paged reader repaginates through its existing lifecycle,
 * keeping the character at the top of the page fixed — so the paragraphs below
 * the new mark shift down and nothing you are reading disappears.
 */

import type { BookBlock } from "@/lib/reading/block-stream";

/** Class the mark carries, for the reader's typography (see reader-prose.ts). */
export const INLINE_MARK_CLASS = "reader-chat-mark";

/**
 * Attribute carrying the annotation id. The annotation layer's existing click
 * handler on the content container looks for this, so opening a mark needs no
 * React inside the book's markup.
 */
export const INLINE_MARK_ATTR = "data-reader-chat";

/** One line at a comfortable measure, with room for the ellipsis. */
const MARK_MAX_CHARS = 160;

export type InlineChatMark = {
  chatId: string;
  /**
   * Global index of the block the mark sits ABOVE — the same index the gap
   * anchor stores. See RenderedBlocks in annotation-anchors.ts.
   */
  blockIndex: number;
  /** The reader's own question. Already collapsed and capped by `markText`. */
  text: string;
};

/** Collapse a question to the single line the page has room for. */
export function markText(raw: string): string {
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length > MARK_MAX_CHARS ? `${line.slice(0, MARK_MAX_CHARS - 1)}…` : line;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function markHtml(mark: InlineChatMark): string {
  return (
    `<aside class="${INLINE_MARK_CLASS}" ${INLINE_MARK_ATTR}="${escapeHtml(mark.chatId)}">` +
    `${escapeHtml(markText(mark.text))}</aside>`
  );
}

/**
 * The HTML to render, with each mark spliced in above its block.
 *
 * `html` is whatever slice of the source is being rendered, and `htmlOffset` is
 * where that slice starts in the source — `blocks[startBlock].htmlStart` for the
 * paged reader's window, zero when the whole document is being rendered.
 *
 * Walked in descending order so that inserting one mark can't invalidate the
 * offset of the next.
 */
export function withInlineChats(
  html: string,
  blocks: BookBlock[],
  marks: InlineChatMark[],
  htmlOffset: number
): string {
  if (marks.length === 0) return html;

  const placed = marks
    .map((mark) => {
      const block = blocks[mark.blockIndex];
      return block ? { mark, at: block.htmlStart - htmlOffset } : null;
    })
    .filter((p): p is { mark: InlineChatMark; at: number } => p != null)
    // Outside this slice — another chapter's window, so there is nothing to
    // mark here.
    .filter((p) => p.at >= 0 && p.at <= html.length)
    .sort((a, b) => b.at - a.at);

  let out = html;
  for (const { mark, at } of placed) {
    out = out.slice(0, at) + markHtml(mark) + out.slice(at);
  }
  return out;
}

/**
 * What the current page holds, and where a conversation about it would go.
 *
 * The paged reader already knows the exact character range on screen, so this is
 * arithmetic rather than measurement — and it gets one subtlety right for free:
 * a paragraph continuing from the previous page starts before `fromChar`, so it
 * is never mistaken for a paragraph break. A column edge is not a place to
 * write.
 *
 * `throughChar` is where the page ends. It can be unknown — the reader reports
 * no next page on the last page of a window, which happens once every couple of
 * chapters — and "unknown" is read as unbounded rather than empty: the next
 * paragraph start is still the right place for the mark, and on that page it is
 * still on screen.
 *
 * `start`/`end` are a half-open range of GLOBAL block indices, used to decide
 * whether this page already has a conversation on it. `breakIndex` is where a
 * new one goes: the first block that STARTS on the page, or — when one long
 * paragraph fills the whole spread — the block the page opens inside, so the
 * mark lands above the first visible line rather than nowhere.
 */
export type PageBlocks = {
  start: number;
  end: number;
  breakIndex: number;
};

export function pageBlocks(
  blocks: BookBlock[],
  fromChar: number,
  throughChar: number
): PageBlocks | null {
  if (blocks.length === 0) return null;

  let start = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].charStart > fromChar) break;
    start = i;
  }

  const bounded = throughChar > fromChar;
  let breakIndex: number | null = null;
  let end = blocks.length;
  for (let i = start + 1; i < blocks.length; i++) {
    if (bounded && blocks[i].charStart >= throughChar) {
      end = i;
      break;
    }
    if (breakIndex == null) breakIndex = i;
    if (!bounded) {
      end = i + 1;
      break;
    }
  }

  return {
    start,
    end: Math.max(end, start + 1),
    breakIndex: breakIndex ?? start,
  };
}
