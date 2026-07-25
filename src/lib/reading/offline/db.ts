/**
 * The reader's offline database — a few dozen lines of IndexedDB rather than a
 * dependency, matching how the service worker is hand-written here.
 *
 * Two stores, each doing what it is actually good at:
 *   • `books`     — what has been downloaded, and enough about it to list and
 *                   account for it without reading a megabyte back off disk.
 *   • `positions` — where you are in each book, written locally first so that
 *                   reading offline doesn't lose your place.
 *
 * The book text itself is NOT here; it lives in the Cache API as a real
 * Response, which is the natural home for an HTTP body (see content-cache.ts).
 *
 * Every call resolves to a benign empty value rather than rejecting when
 * IndexedDB is unavailable — private browsing, a wedged upgrade, a browser that
 * simply says no. Offline storage is an enhancement; losing it must never stop
 * you reading a book that is already on screen.
 */

const DB_NAME = "reader-offline";
const DB_VERSION = 1;

export const BOOKS_STORE = "books";
export const POSITIONS_STORE = "positions";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: "bookId" });
      }
      if (!db.objectStoreNames.contains(POSITIONS_STORE)) {
        db.createObjectStore(POSITIONS_STORE, { keyPath: "bookId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A second tab holding an old version open would otherwise hang us forever.
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

// Deliberately untyped in, cast out: the store holds whatever the caller put
// there, and IDBRequest's result type is invariant enough that threading a
// generic through it costs more than it proves.
function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
  fallback: T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(fallback);
        let request: IDBRequest;
        try {
          request = work(db.transaction(store, mode).objectStore(store));
        } catch {
          return resolve(fallback);
        }
        request.onsuccess = () => resolve((request.result as T | undefined) ?? fallback);
        request.onerror = () => resolve(fallback);
      })
  );
}

export function idbGet<T>(store: string, key: string): Promise<T | null> {
  return run<T | null>(store, "readonly", (s) => s.get(key), null);
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.getAll(), []);
}

export function idbPut(store: string, value: unknown): Promise<void> {
  return run<void>(store, "readwrite", (s) => s.put(value), undefined);
}

export function idbDelete(store: string, key: string): Promise<void> {
  return run<void>(store, "readwrite", (s) => s.delete(key), undefined);
}
