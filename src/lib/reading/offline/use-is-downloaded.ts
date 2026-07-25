"use client";

import { useEffect, useState } from "react";
import { BOOKS_STORE, idbGet } from "./db";
import type { OfflineBook } from "./content-cache";

/**
 * Whether this book is held on this device.
 *
 * Per-book rather than one list for the whole shelf: it's a single indexed
 * lookup, it needs no coordination between tiles, and a shelf is tens of books
 * rather than thousands. Starts false so the shelf never claims a book is
 * available offline before it has actually looked.
 */
export function useIsDownloaded(bookId: string): boolean {
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void idbGet<OfflineBook>(BOOKS_STORE, bookId).then((book) => {
      if (!cancelled) setDownloaded(!!book);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return downloaded;
}
