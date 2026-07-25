/**
 * THE canonical definition of a converted book's block stream and character
 * space. Client-safe on purpose (no "server-only"): the reader fetches the book
 * HTML as a string, so the browser can recompute byte-identical offsets to the
 * ones the server stored — which is what makes reader-chat anchors durable
 * without any DOM measurement.
 *
 * Three things must agree byte-for-byte or stored anchors and quiz page-scoping
 * both drift:
 *   1. convert.ts  `advance()` — charCursor += text.length + 1 per emitted block
 *   2. this file   `blockMap()` — the inverse, rebuilt from the generated HTML
 *   3. reading_book_pages.char_start/char_end — recorded against (1)
 * extract-text.ts and chat-anchors.ts both consume this module rather than
 * re-implementing the regex, so there is only one place to keep in sync.
 *
 * A converted book contains exactly three element kinds — <p>, <h1 id="sec-N">,
 * <h2 id="sec-N"> — plus zero-height <span class="page-anchor"> marks, which
 * contribute no characters. Block text is escapeHtml'd with no inline tags, so
 * a block element's DOM textContent equals its decoded text here.
 */

/** Inverse of convert.ts escapeHtml — undone in reverse order to be exact. */
function decodeEntities(text: string): string {
  return text
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export type BookBlock = {
  /**
   * Document-order index. Corresponds 1:1 with
   * container.querySelectorAll("p, h1, h2, h3, h4, h5, h6")[index] in the
   * rendered reader, because the converter emits only those tags.
   */
  index: number;
  /** Offset of this block's first character in the conversion char space. */
  charStart: number;
  /** Entity-decoded block text (no trailing separator). */
  text: string;
};

/**
 * Rebuild the block stream from converted content HTML. Each block contributes
 * `text.length + 1` to the running offset, matching the converter's `+ 1`
 * separator per block.
 */
export function blockMap(html: string): BookBlock[] {
  const blockRe = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks: BookBlock[] = [];
  let charStart = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    // Strip any inline tags (there shouldn't be any inside a block, but be safe),
    // then decode entities to recover the raw text the converter counted.
    const inner = match[2].replace(/<[^>]+>/g, "");
    const text = decodeEntities(inner);
    blocks.push({ index: blocks.length, charStart, text });
    charStart += text.length + 1;
  }
  return blocks;
}

/**
 * The full plain-text stream — every block's text followed by one separator.
 * Slicing this by reading_book_pages.char_start/char_end yields exactly the
 * text of that page range.
 */
export function stripHtmlToText(html: string): string {
  let out = "";
  for (const block of blockMap(html)) out += block.text + "\n";
  return out;
}

/**
 * The block containing (or immediately following) a char offset. Used to turn a
 * page's char_start into something scrollable on books whose synthetic pages
 * have no anchor element in the DOM. Returns 0 for an empty map.
 */
export function blockIndexForCharOffset(
  blocks: BookBlock[],
  charOffset: number
): number {
  let lo = 0;
  let hi = blocks.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].charStart <= charOffset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
