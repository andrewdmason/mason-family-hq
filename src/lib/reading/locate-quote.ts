/**
 * Finding a passage's exact position inside a converted book, from its text.
 *
 * Written for the Kindle importer and now shared with sharing, which has the
 * same problem from the other end: when the person you mentioned already owns
 * the book from a different file, their block boundaries are not yours, and the
 * only thing the two copies certainly have in common is the words.
 *
 * A Reader highlight is anchored by a character range in the conversion char
 * space plus the block index and in-block offsets the DOM needs. A Kindle
 * highlight is just the passage's text. So the whole job is locating that text,
 * and the difficulty is that the two copies are never byte-identical: Amazon
 * normalizes curly quotes, em dashes and ellipses differently from the EPUB, and
 * a highlight that spans a paragraph break arrives with its own idea of
 * whitespace.
 *
 * The fix is to search in a normalized copy of the book text while keeping a map
 * back to real offsets, so a fuzzy search still yields an exact anchor.
 */

import {
  blockMap,
  textFromBlocks,
  blockIndexForCharOffset,
  type BookBlock,
} from "@/lib/reading/block-stream";
import {
  ANCHOR_VERSION,
  type AnnotationAnchor,
} from "@/lib/reading/annotation-anchors";

/** Mirrors the reader's own limits so imported anchors look locally produced. */
const QUOTE_MAX = 300;
const QUOTE_CONTEXT = 32;

export type BookIndex = {
  blocks: BookBlock[];
  /** The conversion char space: index into this === anchor_char_offset. */
  text: string;
  /** Searchable form of `text`. */
  norm: string;
  /** normIndex -> index in `text`. */
  map: Int32Array;
};

/**
 * Fold away every difference that isn't the words themselves. Runs of
 * whitespace collapse to one space, so a highlight spanning a paragraph break
 * still matches the "\n" the block stream puts there.
 */
function normalizeChar(ch: string): string {
  switch (ch) {
    case "‘":
    case "’":
    case "‛":
    case "ʼ":
    case "´":
    case "`":
      return "'";
    case "“":
    case "”":
    case "‟":
      return '"';
    case "–":
    case "—":
    case "‒":
    case "―":
    case "−":
      return "-";
    case " ":
    case " ":
    case " ":
    case " ":
      return " ";
    case "…":
      // One char becomes three, which the index map handles fine.
      return "...";
    default:
      return ch.toLowerCase();
  }
}

/** Normalize while recording where each output character came from. */
function normalizeWithMap(source: string): { norm: string; map: Int32Array } {
  const out: string[] = [];
  const idx: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      // Collapse a run; the space belongs to the first character of the run.
      if (out.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out.push(" ");
      idx.push(i);
      pendingSpace = false;
    }
    const mapped = normalizeChar(ch);
    for (const c of mapped) {
      out.push(c);
      idx.push(i);
    }
  }

  return { norm: out.join(""), map: Int32Array.from(idx) };
}

export function buildIndex(html: string): BookIndex {
  const blocks = blockMap(html);
  const text = textFromBlocks(blocks);
  const { norm, map } = normalizeWithMap(text);
  return { blocks, text, norm, map };
}

/** Normalize a highlight the same way, discarding the position map. */
export function normalizeQuery(s: string): string {
  return normalizeWithMap(s).norm;
}

export type Located = {
  /** Half-open range in the conversion char space. */
  start: number;
  end: number;
  /** exact | trimmed | partial — how much confidence the caller should have. */
  how: string;
};

/**
 * Where a highlight's text sits in the book.
 *
 * `searchFrom` biases toward the first match at or after a character offset.
 * Highlights arrive in reading order, so threading the previous match through
 * disambiguates a phrase that recurs — which is the common failure mode for
 * short highlights, and one that position alone solves.
 */
export function locate(
  index: BookIndex,
  quote: string,
  searchFrom = 0
): Located | null {
  const needle = normalizeQuery(quote);
  if (needle.length < 8) return null;

  const fromNorm = normIndexAtOrAfter(index, searchFrom);

  const exact = findFrom(index.norm, needle, fromNorm);
  if (exact >= 0) return toRange(index, exact, needle.length, "exact");

  // Kindle sometimes appends or clips a fragment at either end of a selection.
  // Both ends trimmed to a word boundary usually recovers it.
  const trimmed = needle.replace(/^\S+\s|\s\S+$/g, "").trim();
  if (trimmed.length >= 16 && trimmed !== needle) {
    const hit = findFrom(index.norm, trimmed, fromNorm);
    if (hit >= 0) return toRange(index, hit, trimmed.length, "trimmed");
  }

  // A highlight dragged across a chapter break arrives as one string but exists
  // in the book as several — the running text, then a heading, then an epigraph,
  // with the EPUB ordering and spacing them differently. It can't be one range,
  // so anchor the longest leading run that does exist: the mark lands where the
  // reader started highlighting, which is where they'd expect to find it.
  const prefix = longestPrefix(index.norm, needle, fromNorm);
  if (prefix) return toRange(index, prefix.at, prefix.length, "prefix");

  // Last resort: a distinctive window from the middle, then grow back out to the
  // highlight's length. Survives a word or two differing inside the passage.
  const probeLen = Math.min(48, Math.floor(needle.length / 2));
  if (probeLen >= 16) {
    const mid = Math.floor((needle.length - probeLen) / 2);
    const probe = needle.slice(mid, mid + probeLen);
    const hit = findFrom(index.norm, probe, fromNorm);
    if (hit >= 0) {
      const start = Math.max(0, hit - mid);
      const len = Math.min(needle.length, index.norm.length - start);
      return toRange(index, start, len, "partial");
    }
  }

  return null;
}

/** Shortest prefix worth anchoring on — below this a match means nothing. */
const MIN_PREFIX = 40;

/**
 * The longest leading portion of `needle` that appears in `haystack`, found by
 * binary search on length. Word-boundary-aligned so the stored quote never ends
 * mid-word.
 */
function longestPrefix(
  haystack: string,
  needle: string,
  from: number
): { at: number; length: number } | null {
  if (needle.length <= MIN_PREFIX) return null;
  if (findFrom(haystack, needle.slice(0, MIN_PREFIX), from) < 0) return null;

  let lo = MIN_PREFIX;
  let hi = needle.length - 1;
  let best = MIN_PREFIX;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (findFrom(haystack, needle.slice(0, mid), from) >= 0) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Back off to the last word boundary so the quote reads as a whole phrase.
  const lastSpace = needle.lastIndexOf(" ", best);
  const length = lastSpace >= MIN_PREFIX ? lastSpace : best;
  const at = findFrom(haystack, needle.slice(0, length), from);
  return at >= 0 ? { at, length } : null;
}

/** indexOf from a hint, falling back to a search from the top. */
function findFrom(haystack: string, needle: string, from: number): number {
  const ahead = haystack.indexOf(needle, from);
  return ahead >= 0 ? ahead : haystack.indexOf(needle);
}

/** First normalized index whose source offset is at or after `charOffset`. */
function normIndexAtOrAfter(index: BookIndex, charOffset: number): number {
  if (charOffset <= 0) return 0;
  let lo = 0;
  let hi = index.map.length - 1;
  let best = index.map.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.map[mid] >= charOffset) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

function toRange(
  index: BookIndex,
  normStart: number,
  normLength: number,
  how: string
): Located {
  const start = index.map[normStart];
  const lastNorm = Math.min(normStart + normLength - 1, index.map.length - 1);
  // `map` points at a character's first source index, so the end of the range is
  // one past the last matched source character.
  const end = index.map[lastNorm] + 1;
  return { start, end: Math.max(end, start + 1), how };
}

export type BuiltAnchor = {
  anchor: AnnotationAnchor;
  anchorCharOffset: number;
  quotedText: string;
};

/**
 * Turn a located range into the anchor the reader stores, in the same shape
 * `anchorFromRange` produces from a live selection.
 */
export function buildAnchor(index: BookIndex, at: Located): BuiltAnchor | null {
  const { blocks, text } = index;
  if (blocks.length === 0) return null;

  const startBlockIndex = blockIndexForCharOffset(blocks, at.start);
  const endBlockIndex = blockIndexForCharOffset(blocks, Math.max(at.start, at.end - 1));
  const startBlock = blocks[startBlockIndex];
  const endBlock = blocks[endBlockIndex];
  if (!startBlock || !endBlock) return null;

  // A range can begin or end on the "\n" a block contributes as its separator,
  // which is not a position any DOM selection can hold. Pull it inside the block.
  const startOffset = Math.min(at.start - startBlock.charStart, startBlock.text.length);
  const endOffset = Math.min(at.end - endBlock.charStart, endBlock.text.length);
  if (startOffset < 0 || endOffset < 0) return null;

  const quotedText = text.slice(at.start, at.end).trim();
  if (!quotedText) return null;

  return {
    anchor: {
      v: ANCHOR_VERSION,
      kind: "selection",
      blockIndex: startBlockIndex,
      endBlockIndex,
      startOffset,
      endOffset,
      quote: {
        exact: quotedText.slice(0, QUOTE_MAX),
        prefix: text.slice(Math.max(0, at.start - QUOTE_CONTEXT), at.start),
        suffix: text.slice(at.end, at.end + QUOTE_CONTEXT),
        length: quotedText.length,
      },
    },
    anchorCharOffset: startBlock.charStart + startOffset,
    quotedText,
  };
}
