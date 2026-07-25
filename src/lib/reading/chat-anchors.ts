/**
 * Turning places in the rendered reader into durable reader-chat anchors, and
 * back again.
 *
 * The trick is that we never measure or fingerprint text to re-find a spot.
 * block-stream.ts rebuilds the exact character space the converter recorded, and
 * because the converter emits only <p>/<h1>/<h2>, the Nth element matched by
 * BLOCK_SELECTOR in the DOM is the Nth entry of blockMap(html). So a block index
 * is a stable, exact address, and its char offset is derivable on both sides.
 *
 * Anything in this module may touch the DOM and is therefore client-only; the
 * pure char-space half lives in block-stream.ts so the server can share it.
 */

import type { BookBlock } from "@/lib/reading/block-stream";

/**
 * The tags convert.ts emits for visible blocks. Must stay in sync with the
 * regex in block-stream.ts, or DOM index and char index stop agreeing.
 */
export const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6";

/** Bumped only if the stored shape changes incompatibly. */
export const ANCHOR_VERSION = 1;

export type ChatAnchor = {
  v: number;
  kind: "between" | "selection";
  /** Block the chat sits at: the block BELOW the gap, or where a selection starts. */
  blockIndex: number;
  endBlockIndex: number | null;
  startOffset: number | null;
  endOffset: number | null;
};

export type ResolvedAnchor = {
  anchor: ChatAnchor;
  /** Position in the conversion char space; the server derives the page from it. */
  anchorCharOffset: number;
  /** Verbatim selected text, for selection anchors. */
  quotedText: string | null;
};

export function blockElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
}

/** An anchor for the gap above `blockIndexBelow` (the hover-between-paragraphs target). */
export function anchorForGap(
  blockIndexBelow: number,
  blocks: BookBlock[]
): ResolvedAnchor | null {
  const block = blocks[blockIndexBelow];
  if (!block) return null;
  return {
    anchor: {
      v: ANCHOR_VERSION,
      kind: "between",
      blockIndex: blockIndexBelow,
      endBlockIndex: null,
      startOffset: null,
      endOffset: null,
    },
    anchorCharOffset: block.charStart,
    quotedText: null,
  };
}

/**
 * An anchor for the current text selection, or null when the selection is
 * collapsed, outside the book, or otherwise unusable.
 *
 * `quotedText` is stored verbatim alongside the offsets deliberately: it is what
 * feeds the prompt and renders in the thread, so an offset that somehow fails to
 * resolve later degrades the marker position, never the conversation.
 */
export function anchorFromRange(
  range: Range,
  container: HTMLElement,
  blocks: BookBlock[]
): ResolvedAnchor | null {
  if (range.collapsed) return null;

  const quotedText = range.toString().trim();
  if (!quotedText) return null;

  const startEl = closestBlock(range.startContainer, container);
  const endEl = closestBlock(range.endContainer, container);
  if (!startEl || !endEl) return null;

  const els = blockElements(container);
  const blockIndex = els.indexOf(startEl);
  const endBlockIndex = els.indexOf(endEl);
  if (blockIndex < 0 || endBlockIndex < 0) return null;

  const block = blocks[blockIndex];
  if (!block) return null;

  const startOffset = offsetWithinBlock(startEl, range.startContainer, range.startOffset);
  const endOffset = offsetWithinBlock(endEl, range.endContainer, range.endOffset);

  return {
    anchor: {
      v: ANCHOR_VERSION,
      kind: "selection",
      blockIndex,
      endBlockIndex,
      startOffset,
      endOffset,
    },
    anchorCharOffset: block.charStart + startOffset,
    quotedText,
  };
}

/**
 * Vertical position of a block within the article, for placing gutter markers.
 * Uses rects rather than offsetTop so it doesn't depend on which ancestor
 * happens to be the offsetParent.
 */
export function blockTopWithin(el: HTMLElement, container: HTMLElement): number {
  return (
    el.getBoundingClientRect().top - container.getBoundingClientRect().top
  );
}

/** The element a stored anchor points at, if it's still in range. */
export function elementForAnchor(
  anchor: ChatAnchor,
  els: HTMLElement[]
): HTMLElement | null {
  return els[anchor.blockIndex] ?? null;
}

/**
 * Rebuild the DOM Range a selection-anchored chat was created from, so the
 * passage can be highlighted in the text. Returns null for gap anchors, or when
 * the anchor no longer resolves (e.g. the book was re-converted).
 */
export function rangeForAnchor(
  anchor: ChatAnchor,
  container: HTMLElement
): Range | null {
  if (anchor.kind !== "selection") return null;
  if (anchor.startOffset == null || anchor.endOffset == null) return null;

  const els = blockElements(container);
  const startEl = els[anchor.blockIndex];
  const endEl = els[anchor.endBlockIndex ?? anchor.blockIndex];
  if (!startEl || !endEl) return null;

  const start = textPositionAt(startEl, anchor.startOffset);
  const end = textPositionAt(endEl, anchor.endOffset);
  if (!start || !end) return null;

  const range = container.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

/**
 * Walk a block's text nodes to find the one containing `charOffset`. Converted
 * blocks normally hold a single text node, but this stays correct if that ever
 * changes.
 */
function textPositionAt(
  el: HTMLElement,
  charOffset: number
): { node: Text; offset: number } | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, charOffset);
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  // Offset past the end (stale anchor): clamp to the block's last position.
  return last ? { node: last, offset: last.data.length } : null;
}

/** Nearest block element at or above `node`, stopping at the article container. */
function closestBlock(node: Node, container: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  while (el && el !== container) {
    if (el.matches(BLOCK_SELECTOR)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Character offset of a (container, offset) boundary within its block, measured
 * the way the char space counts: rendered text length from the block's start.
 */
function offsetWithinBlock(
  blockEl: HTMLElement,
  node: Node,
  nodeOffset: number
): number {
  const probe = blockEl.ownerDocument.createRange();
  probe.selectNodeContents(blockEl);
  try {
    probe.setEnd(node, nodeOffset);
  } catch {
    return 0;
  }
  return probe.toString().length;
}
