import { BOOKS_STORE, idbDelete, idbGet, idbGetAll, idbPut } from "./db";

/**
 * Keeping a book on the device.
 *
 * Opening a book is what downloads it — there is no separate "make available
 * offline" step, because the expectation is simply that a book you have read
 * once opens again later whether or not there is a network.
 *
 * The bytes go in the Cache API under the book's own content URL with the
 * version stripped, so there is exactly one entry per book and no old versions
 * to garbage-collect. A re-converted book changes its version, misses, and
 * overwrites the single entry.
 *
 * The cache is treated as lossy on purpose. iOS will evict under disk pressure,
 * and a miss is not an error: online we quietly re-download, offline we say so.
 */

const CONTENT_CACHE = "reader-content-v1";

export type OfflineBook = {
  bookId: string;
  title: string;
  author: string | null;
  isArticle: boolean;
  /** The content version this copy is of — the ?v= from the content URL. */
  version: string | null;
  bytes: number | null;
  savedAt: string;
};

function cachesAvailable(): boolean {
  return typeof caches !== "undefined";
}

/**
 * One entry per book, regardless of version: the URL the page hands us carries a
 * `?v=`, but a cached page hands us a stale one, and both must find the same
 * entry. Version skew is settled by the registry, not by the cache key.
 */
function cacheKey(contentUrl: string): string {
  const url = new URL(contentUrl, location.origin);
  url.search = "";
  return url.pathname;
}

function versionOf(contentUrl: string): string | null {
  return new URL(contentUrl, location.origin).searchParams.get("v");
}

/**
 * Ask for the storage to be treated as persistent rather than best-effort.
 *
 * Only meaningful the first time; browsers that decline just carry on evicting
 * as they see fit, which the rest of this module already tolerates.
 */
async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Never load-bearing.
  }
}

/**
 * The book's HTML, from the device when we already have this version of it and
 * from the network otherwise — falling back to whatever is on the device when
 * the network isn't there.
 *
 * Returns the text plus whether it came from the device, so the reader can say
 * "you're offline, this is your downloaded copy" rather than silently differing.
 */
export async function loadBookHtml(
  bookId: string,
  contentUrl: string
): Promise<{ html: string; fromCache: boolean }> {
  const key = cacheKey(contentUrl);
  const wanted = versionOf(contentUrl);
  const cache = cachesAvailable() ? await caches.open(CONTENT_CACHE).catch(() => null) : null;
  const stored = await idbGet<OfflineBook>(BOOKS_STORE, bookId);

  // The common case once a book has been opened: we already have exactly the
  // version the page is asking for, so nothing touches the network.
  if (cache && stored && wanted && stored.version === wanted) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return { html: await hit.text(), fromCache: true };
  }

  try {
    const response = await fetch(contentUrl);
    if (!response.ok) throw new Error("Couldn't load this book.");
    if (cache) {
      // Clone before reading: the body can only be consumed once, and the copy
      // going into the cache must be the untouched response.
      await cache.put(key, response.clone()).catch(() => {});
      void requestPersistence();
    }
    const html = await response.text();
    await idbPut(BOOKS_STORE, {
      bookId,
      // Overwritten by the caller's richer snapshot; these keep an entry valid
      // even if that never runs.
      title: stored?.title ?? "",
      author: stored?.author ?? null,
      isArticle: stored?.isArticle ?? false,
      version: response.headers.get("X-Content-Version") ?? wanted,
      bytes: html.length,
      savedAt: new Date().toISOString(),
    } satisfies OfflineBook);
    return { html, fromCache: false };
  } catch (err) {
    // No network. Anything we have beats failing, even a version behind — the
    // alternative is refusing to open a book that is sitting right there.
    const hit = cache ? await cache.match(key).catch(() => null) : null;
    if (hit) return { html: await hit.text(), fromCache: true };
    throw err instanceof Error ? err : new Error("Couldn't load this book.");
  }
}

/** Fill in what only the reader page knows, so the shelf can list this properly. */
export async function describeDownload(
  bookId: string,
  about: { title: string; author: string | null; isArticle: boolean }
): Promise<void> {
  const stored = await idbGet<OfflineBook>(BOOKS_STORE, bookId);
  if (!stored) return;
  await idbPut(BOOKS_STORE, { ...stored, ...about } satisfies OfflineBook);
}

export function listDownloads(): Promise<OfflineBook[]> {
  return idbGetAll<OfflineBook>(BOOKS_STORE);
}

/** Forget a book entirely — deleted from the shelf, or dropped by hand. */
export async function removeDownload(bookId: string): Promise<void> {
  await idbDelete(BOOKS_STORE, bookId);
  if (!cachesAvailable()) return;
  const cache = await caches.open(CONTENT_CACHE).catch(() => null);
  await cache?.delete(`/reader/api/content/${bookId}`).catch(() => {});
}
