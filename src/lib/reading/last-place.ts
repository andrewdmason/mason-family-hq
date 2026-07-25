/**
 * Where you last were in Reader, so opening the app puts you back there — in
 * your book if you were reading, on the shelf if that's where you left off.
 *
 * It's a cookie rather than a column because the only moment we can record it
 * is a plain page navigation, and middleware is the one place that can write to
 * the response. That makes it per-device, which is the honest reading of "where
 * was I": your phone and your laptop can genuinely be in different places. A
 * device with no cookie yet falls back to your most recently read book.
 */

export const READER_PLACE_COOKIE = "reader-place";

export type ReaderPlace =
  | { kind: "library" }
  | { kind: "book"; bookId: string };

const LIBRARY_VALUE = "library";
const BOOK_PREFIX = "book:";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Reader screen a path represents, or null if it isn't one worth returning
 * to. Settings deliberately isn't a place — dipping into it and back out should
 * leave you wherever you were actually reading.
 */
export function readerPlaceForPath(pathname: string): ReaderPlace | null {
  if (pathname === "/reader/library" || pathname === "/reader/library/") {
    return { kind: "library" };
  }
  const read = /^\/reader\/([^/]+)\/read\/?$/.exec(pathname);
  if (read && UUID.test(read[1])) return { kind: "book", bookId: read[1] };
  return null;
}

export function serializeReaderPlace(place: ReaderPlace): string {
  return place.kind === "library" ? LIBRARY_VALUE : `${BOOK_PREFIX}${place.bookId}`;
}

/** Parse the cookie back, rejecting anything that isn't a shape we wrote. */
export function parseReaderPlace(value: string | undefined): ReaderPlace | null {
  if (!value) return null;
  if (value === LIBRARY_VALUE) return { kind: "library" };
  if (!value.startsWith(BOOK_PREFIX)) return null;
  const bookId = value.slice(BOOK_PREFIX.length);
  return UUID.test(bookId) ? { kind: "book", bookId } : null;
}
