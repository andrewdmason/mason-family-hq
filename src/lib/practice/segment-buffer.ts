// IndexedDB buffer for finalized capture segments (plan U4/KTD6). A segment's
// blob is buffered here before its practice_recordings row is created and
// deleted only after the upload is confirmed (markSegmentUploaded), so a
// lid-close right after stopping the timer can't lose the day's last segment.
// U5's sweep uses list() to re-upload blobs for rows stuck at 'recorded'
// (matched via `recordingId`). Everything is best-effort: callers must treat
// failures as "no buffer", never as a blocking error (R17).

const DB_NAME = "practice-segment-buffer";
const DB_VERSION = 1;
const STORE = "segments";

export type BufferedSegment = {
  /** Fresh client id — the store key. Independent of the server row. */
  id: string;
  blob: Blob;
  ext: string;
  taskId: string | null;
  pieceId: string | null;
  durationSeconds: number;
  /** Set (via a second put) once the practice_recordings row exists, so a
   * sweep can match buffered blobs to rows stuck at 'recorded'. */
  recordingId: string | null;
  /** Epoch ms — lets a sweep age out buffers whose upload never completed. */
  createdAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        };
      })
  );
}

/** Insert or overwrite a buffered segment (overwrite = same id). */
export function putSegment(segment: BufferedSegment): Promise<void> {
  return withStore("readwrite", (store) => store.put(segment)).then(() => {});
}

export function getSegment(id: string): Promise<BufferedSegment | null> {
  return withStore<BufferedSegment | undefined>("readonly", (store) =>
    store.get(id)
  ).then((seg) => seg ?? null);
}

export function deleteSegment(id: string): Promise<void> {
  return withStore("readwrite", (store) => store.delete(id)).then(() => {});
}

export function listSegments(): Promise<BufferedSegment[]> {
  return withStore<BufferedSegment[]>("readonly", (store) => store.getAll());
}
