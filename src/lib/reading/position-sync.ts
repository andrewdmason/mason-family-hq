/**
 * Two devices, one place in the book.
 *
 * Position is a single shared number — an offset into the conversion char space
 * — so a book genuinely is in the same place everywhere. What isn't shared is
 * knowing when it moved. The reader is rendered once per navigation and never
 * refetched, and on a cold launch its page can come from the service worker's
 * cache, so an open reader's idea of where the book is has no expiry at all. A
 * Boox left on chapter nine and woken a day later still believes chapter nine.
 *
 * That belief is not merely stale, it's dangerous: a page turn publishes it, and
 * publishing is last-write-wins, so one arrow key on the device that knows least
 * erases an evening's reading on the device that knows most.
 *
 * The reader therefore asks the server again on open and on every return to the
 * foreground, and this is the arithmetic on the answer. Deliberately pure, and
 * deliberately not a merge: the two rules below are the entire policy, and each
 * one exists because breaking it is worse than the sync it would buy.
 */

/**
 * How far another device has to have moved before it's worth mentioning.
 *
 * Roughly a paragraph. Two devices landing a few characters apart is just the
 * two of them rounding a position to their own column breaks — a book laid out
 * on a phone and on a 13" panel does not break pages in the same places, and
 * offering to "go" to the line already on screen is noise, not sync.
 */
export const ELSEWHERE_MIN_CHARS = 400;

/**
 * Whether the device's own unsynced position beats the one the page opened with.
 *
 * A position the server never received is usually the newest thing there is —
 * three chapters read on a plane, or a page the service worker's cached copy of
 * this very page knows nothing about — and restoring it is what makes reading
 * offline survive closing the book.
 *
 * Usually, not always. An iPad that read to chapter five offline on Monday, left
 * alone while a phone read to chapter twelve on Tuesday, and opened on Wednesday
 * has an unsynced position that is genuinely behind. Restoring it there would
 * take the reader backwards, and — because a page turn publishes where you are —
 * the phone's Tuesday would then be quietly overwritten by the iPad's Monday.
 * The server already refuses the stale write; this is what stops the reader
 * showing the stale place in the first place.
 */
export function localPositionWins(
  storedSavedAt: string,
  resumeSavedAt: string | null
): boolean {
  if (!resumeSavedAt) return true;
  return Date.parse(storedSavedAt) > Date.parse(resumeSavedAt);
}

export type ElsewhereInput = {
  /** What the server says, and when it was recorded. Null if never read. */
  remote: { charOffset: number; savedAt: string | null } | null;
  /**
   * When this device last wrote a position — starting from the timestamp on the
   * position the book was opened with, so a reader that has been sitting open
   * untouched still knows how old the place it's showing is.
   */
  ourSavedAt: string | null;
  /** Where this device is now. */
  current: number;
  /** A place already offered and turned down, if any. */
  answered: number | null;
};

/**
 * Whether to offer another device's position — never to take it.
 *
 * Moving the page under someone mid-sentence is a worse failure than showing the
 * wrong place, so this only ever decides whether to ask. Note that "ahead" is
 * not the test: someone who flips back a chapter on their phone has left off
 * there just as truly as someone who read on, and a furthest-page-wins rule
 * would make going back impossible to sync.
 */
export function shouldOfferElsewhere({
  remote,
  ourSavedAt,
  current,
  answered,
}: ElsewhereInput): boolean {
  if (!remote?.savedAt) return false;

  // Nobody has read since we last wrote, so this is our own position coming back
  // to us. Everything the reader does — opening a book, saving a page turn —
  // makes the server's row and ours the same row, so this is the common answer.
  if (ourSavedAt && Date.parse(remote.savedAt) <= Date.parse(ourSavedAt)) {
    return false;
  }

  if (Math.abs(remote.charOffset - current) < ELSEWHERE_MIN_CHARS) return false;

  // "No thanks" means no thanks to that place. A device left open on it goes on
  // re-saving the same position with a new time, and being asked about it again
  // at every glance is the fastest way to make the whole thing unwelcome.
  // Somewhere genuinely different is new information and gets to ask.
  if (answered != null && Math.abs(remote.charOffset - answered) < ELSEWHERE_MIN_CHARS) {
    return false;
  }

  return true;
}
