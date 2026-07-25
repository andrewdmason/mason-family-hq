/**
 * Turning places in the rendered reader into durable annotation anchors, and
 * back again. Works on both converted books and saved web articles.
 *
 * The trick is that we never measure or fingerprint text to re-find a spot: an
 * anchor is a block index plus a character offset inside that block, and both
 * are read off the same rendered DOM at create time and at resolve time. Only
 * the client ever enumerates blocks, so nesting in article HTML cannot
 * desynchronize anything — there is no second enumeration to disagree with.
 *
 * What DOES differ between the two content types is the meaning of
 * `anchorCharOffset`, and it matters:
 *
 *   books    - the conversion character space that block-stream.ts rebuilds
 *              byte-for-byte from the same HTML the browser fetched. It is the
 *              same space as reading_book_pages.char_start, which is what lets
 *              the server turn an offset into a page number, freeze a
 *              spoiler-free boundary, and resolve [p.N] citations.
 *   articles - a plain DOM text offset over the rendered container, used ONLY
 *              to sort annotations into reading order. Articles have no page
 *              map, so it is never resolved to a page and never used to cut
 *              context. Do not add a consumer that assumes otherwise without
 *              branching on content type.
 *
 * Anything in this module may touch the DOM and is therefore client-only; the
 * pure char-space half lives in block-stream.ts so the server can share it.
 */

import type { BookBlock } from "@/lib/reading/block-stream";

/**
 * Blocks we are willing to anchor inside.
 *
 * Converted books emit only <p>/<h1>/<h2> (convert.ts), so the extra tags here
 * match nothing in a book and a book's block list stays byte-identical to what
 * v1 produced. They exist for articles, whose sanitizer keeps real structure.
 *
 * `div` is a deliberate safety net rather than an oversight: article-sanitize
 * allows it, and Readability sometimes leaves text sitting directly in one. A
 * selection whose block matches nothing here produces no anchor at all, which
 * reads to the user as "the button did nothing".
 */
export const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, dt, dd, th, td, caption, div";

/**
 * Bumped to 2 for the article-capable scheme. v1 rows read as v2 with no quote:
 * the positional fields are unchanged, and the widened selector adds no elements
 * to a converted book's DOM, so a v1 book anchor resolves identically under v2.
 */
export const ANCHOR_VERSION = 2;

/**
 * How to turn a block index + in-block offset into `anchorCharOffset`. Built by
 * the reader from whether it is showing a book or an article.
 */
export type AnchorSpace =
  | { kind: "book"; blocks: BookBlock[] }
  | { kind: "dom" };

/**
 * Enough of the surrounding text to re-find a passage whose HTML moved under it.
 *
 * Only articles really need this — a book's HTML is written once at conversion
 * and never rewritten, whereas re-saving an article from the same URL overwrites
 * content.html in place (save-article.ts), which can shift every block index in
 * the document. Captured for books too, because it costs a few bytes and makes
 * a re-conversion survivable.
 */
export type AnchorQuote = {
  /** The selected text, capped — see QUOTE_MAX. */
  exact: string;
  /** Up to QUOTE_CONTEXT chars either side, to disambiguate a repeated phrase. */
  prefix: string;
  suffix: string;
  /** Full length of the original selection, so a capped `exact` can still size the range. */
  length: number;
};

export type AnnotationAnchor = {
  v: number;
  kind: "between" | "selection";
  /** Block the annotation sits at: the block BELOW the gap, or where a selection starts. */
  blockIndex: number;
  endBlockIndex: number | null;
  startOffset: number | null;
  endOffset: number | null;
  /** Selection anchors only; null for gaps, which have no text to match. */
  quote: AnchorQuote | null;
};

export type ResolvedAnchor = {
  anchor: AnnotationAnchor;
  /** Book: conversion char space. Article: DOM text offset. See the module comment. */
  anchorCharOffset: number;
  /** Verbatim selected text, for selection anchors. */
  quotedText: string | null;
};

/**
 * Every way anchoring can fail looks identical to the reader — the selection
 * clears and nothing appears — so each one says which it was. Chasing this
 * without that distinction cost more than the logging ever will.
 */
function fail(reason: string): null {
  console.warn(`[reader] couldn't anchor that selection: ${reason}`);
  return null;
}

const QUOTE_MAX = 300;
const QUOTE_CONTEXT = 32;

export function blockElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
}

/** An anchor for the gap above `blockIndexBelow` (the hover-between-paragraphs target). */
export function anchorForGap(
  blockIndexBelow: number,
  space: AnchorSpace,
  container: HTMLElement
): ResolvedAnchor | null {
  const anchor: AnnotationAnchor = {
    v: ANCHOR_VERSION,
    kind: "between",
    blockIndex: blockIndexBelow,
    endBlockIndex: null,
    startOffset: null,
    endOffset: null,
    quote: null,
  };

  if (space.kind === "book") {
    const block = space.blocks[blockIndexBelow];
    if (!block) return null;
    return { anchor, anchorCharOffset: block.charStart, quotedText: null };
  }

  const el = blockElements(container)[blockIndexBelow];
  if (!el) return null;
  return {
    anchor,
    anchorCharOffset: domOffsetOfNodeStart(container, el),
    quotedText: null,
  };
}

/**
 * An anchor for the current text selection, or null when the selection is
 * collapsed, outside the content, or otherwise unusable.
 *
 * `quotedText` is stored verbatim alongside the offsets deliberately: it is what
 * feeds the prompt and renders in the panel, so an offset that somehow fails to
 * resolve later degrades the marker position, never the annotation's content.
 */
export function anchorFromRange(
  range: Range,
  container: HTMLElement,
  space: AnchorSpace
): ResolvedAnchor | null {
  if (range.collapsed) return null;

  const quotedText = range.toString().trim();
  if (!quotedText) return null;

  const startEl = closestBlock(range.startContainer, container);
  if (!startEl) return fail("selection starts outside any block");

  const end = endBoundary(range, container, startEl);

  const els = blockElements(container);
  const blockIndex = els.indexOf(startEl);
  const endBlockIndex = els.indexOf(end.el);
  if (blockIndex < 0 || endBlockIndex < 0) {
    return fail(`block not in list (start ${blockIndex}, end ${endBlockIndex}, of ${els.length})`);
  }

  const startOffset = offsetWithinBlock(startEl, range.startContainer, range.startOffset);
  const endOffset = end.node
    ? offsetWithinBlock(end.el, end.node, end.offset)
    : textLengthOf(end.el);

  const anchor: AnnotationAnchor = {
    v: ANCHOR_VERSION,
    kind: "selection",
    blockIndex,
    endBlockIndex,
    startOffset,
    endOffset,
    quote: quoteForRange(range, container),
  };

  let anchorCharOffset: number;
  if (space.kind === "book") {
    const block = space.blocks[blockIndex];
    if (!block) {
      // The converter's block stream and the rendered DOM have gone out of
      // step. Worth naming precisely: it means an index that is valid against
      // the page is invalid against the character space the server reasons in.
      return fail(
        `block ${blockIndex} missing from the converter stream (${space.blocks.length} blocks)`
      );
    }
    anchorCharOffset = block.charStart + startOffset;
  } else {
    anchorCharOffset = domOffsetOfBoundary(
      container,
      range.startContainer,
      range.startOffset
    );
  }

  return { anchor, anchorCharOffset, quotedText };
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
  anchor: AnnotationAnchor,
  els: HTMLElement[]
): HTMLElement | null {
  return els[anchor.blockIndex] ?? null;
}

/**
 * Rebuild the DOM Range a selection anchor was created from, so the passage can
 * be painted. Returns null for gap anchors, or when the anchor no longer
 * resolves at all.
 *
 * Index first, quote second. The index is exact whenever the HTML is unchanged,
 * which is always true for books and usually true for articles; the quote is
 * what rescues an article that was re-saved and re-laid-out underneath us.
 */
export function rangeForAnchor(
  anchor: AnnotationAnchor,
  container: HTMLElement
): Range | null {
  if (anchor.kind !== "selection") return null;
  if (anchor.startOffset == null || anchor.endOffset == null) return null;

  const byIndex = rangeFromIndices(anchor, container);
  if (byIndex && matchesQuote(byIndex, anchor.quote)) return byIndex;

  // The text under the stored indices is not what was annotated. Go find it.
  return rangeFromQuote(anchor.quote, container) ?? byIndex;
}

function rangeFromIndices(
  anchor: AnnotationAnchor,
  container: HTMLElement
): Range | null {
  const els = blockElements(container);
  const startEl = els[anchor.blockIndex];
  const endEl = els[anchor.endBlockIndex ?? anchor.blockIndex];
  if (!startEl || !endEl) return null;

  const start = textPositionAt(startEl, anchor.startOffset ?? 0);
  const end = textPositionAt(endEl, anchor.endOffset ?? 0);
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
 * True when the range still holds the text the anchor was made from. Whitespace
 * is normalized because re-rendering can change wrapping, and a capped `exact`
 * is compared as a prefix rather than for equality.
 */
function matchesQuote(range: Range, quote: AnchorQuote | null): boolean {
  // No quote (a v1 anchor): trust the index, which is all v1 ever had.
  if (!quote) return true;
  const expected = normalize(quote.exact);
  if (!expected) return true;
  const actual = normalize(range.toString());
  return actual.startsWith(expected) || expected.startsWith(actual);
}

/**
 * Find the annotated passage by its text when the indices have gone stale.
 * Prefix and suffix disambiguate a phrase that occurs more than once; with no
 * context to go on the first occurrence wins, which still beats painting an
 * unrelated paragraph.
 */
function rangeFromQuote(
  quote: AnchorQuote | null,
  container: HTMLElement
): Range | null {
  if (!quote || !quote.exact) return null;

  const index = buildTextIndex(container);
  const hay = index.text;
  const needle = quote.exact;

  let best = -1;
  let bestScore = -1;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    // Score by how much of the stored context also lines up around this hit.
    const before = hay.slice(Math.max(0, at - QUOTE_CONTEXT), at);
    const after = hay.slice(at + needle.length, at + needle.length + QUOTE_CONTEXT);
    const score =
      commonSuffixLength(before, quote.prefix) +
      commonPrefixLength(after, quote.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
    from = at + 1;
  }
  if (best < 0) return null;

  const start = positionInIndex(index, best);
  const end = positionInIndex(index, best + Math.max(needle.length, quote.length));
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

function quoteForRange(range: Range, container: HTMLElement): AnchorQuote {
  const full = range.toString();
  const index = buildTextIndex(container);
  const startAt = domOffsetOfBoundary(
    container,
    range.startContainer,
    range.startOffset
  );
  const endAt = startAt + full.length;
  return {
    exact: full.slice(0, QUOTE_MAX),
    prefix: index.text.slice(Math.max(0, startAt - QUOTE_CONTEXT), startAt),
    suffix: index.text.slice(endAt, endAt + QUOTE_CONTEXT),
    length: full.length,
  };
}

/* ------------------------------------------------------------------ *
 * DOM text space — the article half of the coordinate story.
 * ------------------------------------------------------------------ */

type TextIndex = {
  text: string;
  /** Parallel arrays: nodes[i] starts at starts[i] in `text`. */
  nodes: Text[];
  starts: number[];
};

/**
 * Flatten the container's text nodes into one string plus a map back to them.
 * Walks the same text nodes Range.toString() concatenates, so an offset measured
 * here and one measured with a probe Range agree exactly.
 */
function buildTextIndex(container: HTMLElement): TextIndex {
  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT
  );
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  let node = walker.nextNode() as Text | null;
  while (node) {
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
    node = walker.nextNode() as Text | null;
  }
  return { text, nodes, starts };
}

function positionInIndex(
  index: TextIndex,
  offset: number
): { node: Text; offset: number } | null {
  if (index.nodes.length === 0) return null;
  const clamped = Math.max(0, Math.min(offset, index.text.length));
  // Rightmost node whose start is <= clamped.
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (index.starts[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  const node = index.nodes[lo];
  return { node, offset: Math.min(clamped - index.starts[lo], node.data.length) };
}

/** Character offset of a (node, offset) boundary within the whole container. */
function domOffsetOfBoundary(
  container: HTMLElement,
  node: Node,
  nodeOffset: number
): number {
  const probe = container.ownerDocument.createRange();
  probe.selectNodeContents(container);
  try {
    probe.setEnd(node, nodeOffset);
  } catch {
    return 0;
  }
  return probe.toString().length;
}

/** Character offset at which `el`'s own text begins, within the container. */
function domOffsetOfNodeStart(container: HTMLElement, el: HTMLElement): number {
  const probe = container.ownerDocument.createRange();
  probe.selectNodeContents(container);
  try {
    probe.setEndBefore(el);
  } catch {
    return 0;
  }
  return probe.toString().length;
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/**
 * Walk a block's text nodes to find the one containing `charOffset`. Converted
 * blocks normally hold a single text node; article blocks routinely do not
 * (inline <em>/<a> split them), which is why this walks rather than indexes.
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

/**
 * Which block a range's END boundary belongs to, and where inside it.
 *
 * The subtlety that makes this its own function: a selection does not have to
 * end inside a block. Triple-clicking a paragraph ends the range at whatever
 * comes NEXT — usually the following block (fine), but in a converted book the
 * next sibling is often a zero-height `<span class="page-anchor">`, and at the
 * end of the content it is the container itself. Neither is a block, so walking
 * up from them finds nothing.
 *
 * That used to sink the whole anchor: no end block, return null, no annotation,
 * and — because the toolbar clears the selection either way — a Highlight
 * button that visibly did nothing on exactly the paragraphs that happen to sit
 * on a page boundary.
 *
 * When the boundary isn't in a block, the honest reading of the gesture is "to
 * the end of the block it started in", which is what a triple-click means.
 */
function endBoundary(
  range: Range,
  container: HTMLElement,
  startEl: HTMLElement
): { el: HTMLElement; node: Node | null; offset: number } {
  const direct = closestBlock(range.endContainer, container);
  if (direct) {
    return { el: direct, node: range.endContainer, offset: range.endOffset };
  }
  // `node: null` means "the whole block", resolved by the caller.
  return { el: startEl, node: null, offset: 0 };
}

/** Rendered text length of a block, i.e. its last valid in-block offset. */
function textLengthOf(el: HTMLElement): number {
  const probe = el.ownerDocument.createRange();
  probe.selectNodeContents(el);
  return probe.toString().length;
}

/** Nearest block element at or above `node`, stopping at the content container. */
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

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++;
  }
  return i;
}
