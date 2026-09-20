/**
 * Turning a book's flat list of headings into the contents a reader actually
 * wants: nested the way the book nests it, with the matter that isn't the story
 * folded out of the way.
 *
 * Pure and dependency-free (types plus two shared helpers), like chapter-target.ts
 * — everything here is a function of the stored contents, so it can be reasoned
 * about and verified without a database, a browser, or a book.
 *
 * NOTHING in this module changes what the book *is*. Progress, weekly chapter
 * goals, quiz coverage and the audiobook plan all read the stored contents
 * directly and are untouched by any grouping decided here. This is presentation.
 */

import { isContentSection } from "@/lib/reading/chapter-target";
import { minutesToRead } from "@/lib/reading/reading-time";
import type { ReadingTocEntry } from "@/lib/types";

/** One row in the contents, with whatever the book nested inside it. */
export type ContentsNode = {
  title: string;
  /** The heading's id in the converted HTML — how the reader scrolls to it. */
  anchorId: string;
  /** Resolved nesting depth, 1-based. */
  depth: number;
  /**
   * Minutes to read this entry INCLUDING everything nested inside it, so a
   * chapter's estimate covers the chapter rather than stopping at its first
   * subheading. Null when the conversion recorded no word offsets.
   */
  minutes: number | null;
  children: ContentsNode[];
};

/** The contents split into the story and the matter bracketing it. */
export type Contents = {
  /** Non-story entries before the book starts. Collapsed by default. */
  front: ContentsNode[];
  /** The book. */
  body: ContentsNode[];
  /** Non-story entries after the book ends. Collapsed by default. */
  back: ContentsNode[];
};

/**
 * Front/back matter that this module hides but `isContentSection` does not.
 *
 * Two lists rather than one because they answer different questions.
 * `isContentSection` decides what counts as a chapter for weekly goals and
 * progress — changing it would move the numbers on books that are already part
 * read, which is exactly what "the contents tidy-up is display-only" rules out.
 * These titles are additionally uninteresting to *navigate* to, which is a
 * weaker claim and belongs here.
 *
 * Safe to be liberal, because of where this is applied: only to an unbroken run
 * at the very start or the very end of the contents (see `buildContents`). A
 * book with a mid-book section called "Notes" keeps it in place — the word only
 * costs it something if it is already in the back matter.
 */
const ALSO_NOT_THE_STORY =
  /^(epigraphs?|index|notes|endnotes|footnotes|bibliography|selected bibliography|works cited|further reading|suggested reading|glossary|permissions|(illustration|photo|image|picture) credits|credits|what'?s next|biographical notes?|about the (translator|illustrator|editor|type)|a note (on|about) the (author|translator|type|text))\b/i;

/** Whether an entry is part of the book itself, for contents-display purposes. */
function isStory(title: string): boolean {
  return isContentSection(title) && !ALSO_NOT_THE_STORY.test(title.trim());
}

/**
 * The depth to lay each entry out at, resolved in one pass.
 *
 * Three rules, in order of how much they're trusted:
 *
 * 1. The book's own nesting (`depth`), read from its nav document at import.
 * 2. An entry with NO nesting recorded sits one level inside the last entry that
 *    HAD some. These are headings the converter found in the book's markup that
 *    the nav never listed — an index's A–Z letters, the per-chapter headings
 *    inside a notes section. They belong inside the section they appear in, and
 *    this is what puts twenty-six single letters underneath "Index" instead of
 *    beside the chapters.
 *
 *    Anchoring to the last KNOWN depth rather than to the previous row is the
 *    whole trick: a run of unlisted headings are siblings of each other, and
 *    measuring each from the one before it staircases them — A inside Index, B
 *    inside A, C inside B — until the alphabet is twenty-six indents deep and
 *    every letter's reading estimate has swallowed the rest of the book.
 * 3. If NOT ONE entry has nesting, the book predates this being recorded (or is
 *    a PDF, whose headings are guessed from font size, or an article). Fall back
 *    to `level` — a two-value guess, but a flat, stable one that leaves those
 *    books looking exactly as they did before any of this.
 *
 *    `level` is NOT a claim about containment — it says 1 for a part divider and
 *    2 for everything else, including every chapter of the very many books that
 *    have no parts at all. Read literally as depth it makes each of those
 *    chapters a child of whatever level-1 row happened to precede it, which in a
 *    partless book is the last page of the front matter: an entire book nested
 *    inside its own epigraph, with nothing left in the body.
 *
 *    So under this rule a level-2 entry only indents when there is a part
 *    genuinely open above it, and matter is never a parent OR a child — a
 *    trailing "Index" stays at the top level where the grouping below can reach
 *    it, and a chapter is never filed under a copyright page. Rule 1 is exempt
 *    from all of this: if a book's own nav nests something inside its notes,
 *    that's a fact about the book rather than a guess, and it is honoured.
 *
 * Depth is also never allowed to jump by more than one at a time, so a nav that
 * skips a level can't open an indent for a row that doesn't exist.
 */
function resolveDepths(entries: ReadingTocEntry[]): number[] {
  const anyDepth = entries.some((e) => typeof e.depth === "number" && e.depth > 0);
  const out: number[] = [];
  let previous = 0;
  let lastKnown = 0;
  // Rule 3 only: whether a part divider is open to be nested inside of. Any
  // matter closes it — back matter follows the last part, it doesn't join it.
  let partOpen = false;
  for (const entry of entries) {
    const known = typeof entry.depth === "number" && entry.depth > 0 ? entry.depth : null;
    if (known != null) lastKnown = known;

    let raw: number;
    if (anyDepth) {
      raw = known ?? lastKnown + 1;
    } else if (!isStory(entry.title)) {
      raw = 1;
      partOpen = false;
    } else if (entry.level <= 1) {
      raw = 1;
      partOpen = true;
    } else {
      raw = partOpen ? 2 : 1;
    }

    const depth = Math.max(1, Math.min(raw, previous + 1));
    out.push(depth);
    previous = depth;
  }
  return out;
}

/**
 * Where each entry's reading ends: the next entry at the same depth or shallower.
 *
 * Not "the next entry", which would cut a chapter short at its first subheading
 * and report eight minutes for an hour-long chapter. A chapter's estimate has to
 * cover everything nested inside it, because that is what a reader is asking
 * about when they look at it.
 */
function endWordAt(
  index: number,
  entries: ReadingTocEntry[],
  depths: number[],
  totalWords: number | null
): number | null {
  for (let i = index + 1; i < entries.length; i++) {
    if (depths[i] <= depths[index]) {
      const next = entries[i].startWord;
      return typeof next === "number" ? next : null;
    }
  }
  return totalWords;
}

/** Two titles compared the way a reader would: case and spacing don't count. */
function sameTitle(a: string, b: string): boolean {
  const flatten = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return flatten(a) === flatten(b);
}

/**
 * A section can't contain a section of the same name.
 *
 * When a book's contents points a row at the wrong file — and publishers do,
 * most often by repeating the link the row above it uses — that row lands
 * somewhere it doesn't belong, and the heading the book actually prints for the
 * section turns up later as one the contents never listed. Rule 2 above then
 * files that heading INSIDE the stray row, and the contents shows "Future"
 * containing "Future": one of them seconds long in the middle of the previous
 * chapter, the other the real thing, an indent too deep.
 *
 * So an unlisted heading that repeats the row directly above it isn't a section
 * inside that one — it is where that section actually starts. The row moves to
 * it. Nothing is added and nothing is lost: the row keeps the nesting the book
 * gave it, and the chapter before it gets back the pages the stray row took.
 *
 * Only the row DIRECTLY above qualifies. A book that lists "Notes" once and
 * prints an unlisted "Notes" heading in every chapter is a different situation —
 * those are real, separate sections, and the rows in between say so.
 */
function mergeStrayRows(toc: ReadingTocEntry[]): ReadingTocEntry[] {
  const listed = (e: ReadingTocEntry | undefined) =>
    e != null && typeof e.depth === "number" && e.depth > 0;
  const out: ReadingTocEntry[] = [];
  for (const entry of toc) {
    const previous = out[out.length - 1];
    if (!listed(entry) && listed(previous) && sameTitle(previous.title, entry.title)) {
      out[out.length - 1] = { ...entry, depth: previous.depth };
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Drop the rows that only say the book's own name back to you, lifting whatever
 * was nested inside them into their place.
 *
 * The lifting is the point. A contents that opens the story with a row naming
 * the book and lists every section inside it is completely ordinary — and
 * dropping that row on its own orphans all of them: they keep the indent the
 * book gave them with no parent left to sit under, and slide inside whichever
 * row happens to precede them, which is the last page of the front matter. That
 * is a whole novel folded into its own epigraph, with nothing left in the body.
 */
function dropTitleRows(
  entries: ReadingTocEntry[],
  depths: number[],
  bookTitle: string
): { entries: ReadingTocEntry[]; depths: number[] } {
  const keptEntries: ReadingTocEntry[] = [];
  const keptDepths: number[] = [];
  // Depths of the dropped rows we are still inside — one level of lift each.
  const open: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const depth = depths[i];
    while (open.length > 0 && depth <= open[open.length - 1]) open.pop();
    if (sameTitle(entries[i].title, bookTitle)) {
      open.push(depth);
      continue;
    }
    keptEntries.push(entries[i]);
    keptDepths.push(Math.max(1, depth - open.length));
  }
  return { entries: keptEntries, depths: keptDepths };
}

/**
 * Build the reader's contents from the stored heading list.
 *
 * A row that merely repeats `bookTitle` is dropped — some contents lead with the
 * book's own name, and a row that says the book back to you is noise — but
 * anything nested inside it is lifted into its place rather than orphaned.
 * `chapterBounds` in reading-progress.ts drops the same row for the same reason;
 * the two agreeing is what stops the contents and the running head disagreeing
 * about where the book begins.
 */
export function buildContents(
  toc: ReadingTocEntry[],
  bookTitle: string,
  totalWords: number | null
): Contents {
  const merged = mergeStrayRows(toc);
  if (merged.length === 0) return { front: [], body: [], back: [] };

  const { entries, depths } = dropTitleRows(merged, resolveDepths(merged), bookTitle);
  if (entries.length === 0) return { front: [], body: [], back: [] };

  // Flat nodes first, then nest — a single pass with a stack of open ancestors.
  const flat: ContentsNode[] = entries.map((entry, i) => {
    const start = entry.startWord;
    const end = endWordAt(i, entries, depths, totalWords);
    const words =
      typeof start === "number" && end != null && end > start ? end - start : null;
    return {
      title: entry.title,
      anchorId: entry.anchorId,
      depth: depths[i],
      minutes: minutesToRead(words),
      children: [],
    };
  });

  const roots: ContentsNode[] = [];
  const open: ContentsNode[] = [];
  for (const node of flat) {
    while (open.length >= node.depth) open.pop();
    if (open.length === 0) roots.push(node);
    else open[open.length - 1].children.push(node);
    open.push(node);
  }

  // Group only the unbroken runs at each end. A non-story entry in the middle of
  // the book stays where the book put it — moving it would reorder the contents,
  // and an interlude, a part divider or an author's note between chapters is
  // where it is for a reason.
  let firstStory = roots.findIndex((n) => isStory(n.title));
  if (firstStory < 0) firstStory = roots.length;
  let lastStory = -1;
  for (let i = roots.length - 1; i >= 0; i--) {
    if (isStory(roots[i].title)) {
      lastStory = i;
      break;
    }
  }

  return {
    front: roots.slice(0, firstStory),
    body: lastStory < 0 ? [] : roots.slice(firstStory, lastStory + 1),
    back: lastStory < 0 ? [] : roots.slice(lastStory + 1),
  };
}

/**
 * The chain of anchor ids from a root down to `anchorId`, or an empty array if
 * it isn't in this list. The dialog opens with the reader's own chapter already
 * expanded and in view, which means expanding every ancestor above it — and if
 * they're mid-way through the back matter, the group holding it too.
 */
export function pathToAnchor(nodes: ContentsNode[], anchorId: string): string[] {
  for (const node of nodes) {
    if (node.anchorId === anchorId) return [node.anchorId];
    const below = pathToAnchor(node.children, anchorId);
    if (below.length > 0) return [node.anchorId, ...below];
  }
  return [];
}
