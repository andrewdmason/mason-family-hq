/**
 * Whether the marks panel is collapsed to starred marks only, remembered per
 * book.
 *
 * Per-book rather than per-device, which is a different call from every other
 * persisted reader setting — reader:layout and reader:listen (see
 * reader-settings.ts) describe the DEVICE: how wide a line is, how fast the
 * voice reads. This describes a book you are in the middle of. Turning the
 * filter on in a five-hundred-page novel you have marked forty passages in says
 * nothing about the article you open next, and carrying it over would hide marks
 * in a book where the reader never asked for anything to be hidden.
 *
 * Sticky at all because end-of-book review is a mode you stay in for a while:
 * closing the panel to look something up and reopening it should not put the
 * other thirty marks back.
 *
 * localStorage rather than the server, for the same reason the layout settings
 * are there: it is view state, it has to survive a panel close without a round
 * trip, and there is nothing in it worth a migration. One key per book rather
 * than one map of all of them, so an entry dies with the browser's storage
 * instead of accumulating a record of everything ever read.
 */
const key = (bookId: string) => `reader:starred-only:${bookId}`;

export function loadStarredOnly(bookId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key(bookId)) === "1";
  } catch {
    return false;
  }
}

export function saveStarredOnly(bookId: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key(bookId), "1");
    // Removed rather than written as "0": the default is off, and an absent key
    // is the same answer with nothing left behind for a book you stop reading.
    else window.localStorage.removeItem(key(bookId));
  } catch {
    // Private browsing, or quota. The filter stops persisting; nothing else
    // about the panel is affected, so there is nothing to tell the reader.
  }
}
