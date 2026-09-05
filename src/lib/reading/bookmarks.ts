/**
 * A bookmark: somewhere in a book the reader wants to get back to.
 *
 * Deliberately not a mark. A star (00187) says "these words mattered" and needs
 * a selection to exist; a bookmark says "I stopped here" and needs nothing but a
 * place. They live in different tables, different lists and different parts of
 * the UI, and nothing that reads marks ever sees one.
 *
 * Client-safe, like block-stream.ts: the reader, the header ribbon and the
 * contents dialog all handle these, and only the actions file touches the row.
 */

export type ReaderBookmark = {
  id: string;
  /** Conversion char space — the same offsets as position and chapter starts. */
  charOffset: number;
  /** The block it was taken on, for display and for "am I standing on one". */
  blockIndex: number;
  /** Resolved server-side at save time. Null when the book has no page map. */
  page: number | null;
  /** The opening of the bookmarked line, captured when it was saved. */
  excerpt: string | null;
  /** The reader's own name for it, when they typed one. */
  name: string | null;
  createdAt: string;
};

/** How much of the bookmarked line is kept as its fallback label. */
const EXCERPT_CHARS = 100;

/**
 * The opening of a line, cut at a word so the list doesn't show half a word.
 *
 * The cut is generous rather than tight: this is the label for every bookmark
 * nobody named, and four rows that all begin "In the same way, the" are exactly
 * the failure the excerpt exists to prevent.
 */
export function bookmarkExcerpt(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= EXCERPT_CHARS) return clean;
  const cut = clean.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * What the row is called: the reader's name when there is one, the line itself
 * when there isn't.
 *
 * An unnamed bookmark is the fast path, not a degraded one — the dialog opens
 * empty and Enter saves — so the fallback has to read like a label rather than
 * like something missing.
 */
export function bookmarkLabel(b: Pick<ReaderBookmark, "name" | "excerpt">): string {
  return b.name?.trim() || b.excerpt || "Bookmark";
}

/**
 * Where it is, said the way a reader would say it.
 *
 * Pages only when the book HAS pages — most books here carry a synthetic page
 * map, and "p. 212" that corresponds to nothing in any printed copy is worse
 * than a percentage, which is at least always true.
 */
export function bookmarkPlace(
  b: Pick<ReaderBookmark, "page">,
  percent: number,
  hasRealPages: boolean
): string {
  return hasRealPages && b.page != null ? `p. ${b.page}` : `${percent}%`;
}

/**
 * The bookmark the reader is standing on, if any — the whole of the ribbon's
 * state, and of what tapping it does.
 *
 * The two reading modes ask different questions, and both are right. A PAGE
 * shows many lines at once, so anything bookmarked between its first character
 * and its last counts as here; asking only about the top line would leave the
 * ribbon hollow while a bookmark sat visible three inches down, and a second tap
 * would then make a second bookmark on the same page. SCROLLING has no last
 * character — the page keeps going — so it asks about the reading line's own
 * block, which is the same block a new bookmark would be saved to.
 *
 * `spotCharOffset` is the START of that block, never the raw position: in pages
 * the raw position is wherever the column happened to break, so comparing
 * against it would miss the bookmark saved on the paragraph the page opens
 * halfway through.
 *
 * Here rather than inside the hook so the rule can be checked without a browser
 * — see verify-bookmarks.mts.
 */
export function bookmarkAtSpot<T extends Pick<ReaderBookmark, "charOffset">>(
  bookmarks: T[],
  spotCharOffset: number,
  visibleThroughChar: number | null
): T | null {
  return (
    bookmarks.find((b) =>
      visibleThroughChar == null
        ? b.charOffset === spotCharOffset
        : b.charOffset >= spotCharOffset && b.charOffset <= visibleThroughChar
    ) ?? null
  );
}
