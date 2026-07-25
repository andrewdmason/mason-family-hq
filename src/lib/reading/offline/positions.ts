import { POSITIONS_STORE, idbGet, idbGetAll, idbPut } from "./db";

/**
 * Where you are in a book, written to the device first and to the server when it
 * can be reached.
 *
 * Losing your place is the one offline failure that would actually be felt —
 * you read three chapters on a plane and the book reopens at the start. So the
 * local write is the one that counts, and the server sync is what catches up.
 *
 * `savedAt` travels with the position so the server can refuse a stale one: an
 * iPad coming back online on Wednesday must not overwrite Tuesday's reading with
 * Monday's position.
 */

export type StoredPosition = {
  bookId: string;
  charOffset: number;
  scrollRatio: number | null;
  savedAt: string;
  /** Still owed to the server. */
  dirty: boolean;
};

export async function rememberPosition(
  bookId: string,
  charOffset: number,
  scrollRatio: number | null
): Promise<StoredPosition> {
  const record: StoredPosition = {
    bookId,
    charOffset,
    scrollRatio,
    savedAt: new Date().toISOString(),
    dirty: true,
  };
  await idbPut(POSITIONS_STORE, record);
  return record;
}

export function readPosition(bookId: string): Promise<StoredPosition | null> {
  return idbGet<StoredPosition>(POSITIONS_STORE, bookId);
}

/** Positions the server hasn't accepted yet, oldest first. */
export async function pendingPositions(): Promise<StoredPosition[]> {
  const all = await idbGetAll<StoredPosition>(POSITIONS_STORE);
  return all.filter((p) => p.dirty).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

/**
 * Mark a position as synced — but only if nothing newer has been recorded since
 * the flush started, or a page turn during a slow request would be forgotten.
 */
export async function markPositionSynced(position: StoredPosition): Promise<void> {
  const current = await readPosition(position.bookId);
  if (!current || current.savedAt !== position.savedAt) return;
  await idbPut(POSITIONS_STORE, { ...current, dirty: false } satisfies StoredPosition);
}
