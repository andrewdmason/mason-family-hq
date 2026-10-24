"use client";

import { useEffect, useState } from "react";
import {
  describeDownload,
  listDownloads,
  loadBookHtml,
} from "@/lib/reading/offline/content-cache";
import { postToReaderApp } from "@/lib/reading/reader-app";

export type KeepOfflineBook = {
  bookId: string;
  title: string;
  author: string | null;
  isArticle: boolean;
  contentUrl: string;
};

/** Downloads each book, then tells the app which books are on the device. */
export function KeepOffline({ books }: { books: KeepOfflineBook[] }) {
  const [done, setDone] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const book of books) {
        if (cancelled) return;
        try {
          await loadBookHtml(book.bookId, book.contentUrl);
          await describeDownload(book.bookId, {
            title: book.title,
            author: book.author,
            isArticle: book.isArticle,
          });
        } catch {
          // Offline or failed: it stays whatever it was, and the next pass
          // tries again.
        }
        if (!cancelled) setDone((n) => n + 1);
      }
      // The reading pages themselves, so they open with no signal.
      const registration = await navigator.serviceWorker?.ready.catch(() => null);
      registration?.active?.postMessage({
        type: "hq:keep-pages",
        urls: books.map((b) => `${location.origin}/reader/${b.bookId}/read`),
      });
      const downloads = await listDownloads().catch(() => []);
      postToReaderApp({ type: "offline", bookIds: downloads.map((d) => d.bookId) });
    })();
    return () => {
      cancelled = true;
    };
  }, [books]);

  return (
    <p className="p-8 text-sm text-muted-foreground">
      Kept {done} of {books.length} books on this device.
    </p>
  );
}
