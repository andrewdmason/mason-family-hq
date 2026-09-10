"use client";

import { ReaderShelf } from "@/components/reading/reader-shelf";
import {
  loadLibrarySnapshot,
  type LibrarySnapshot,
} from "@/app/(reading)/reader/library/actions";
import { useRefreshOnReturn } from "@/components/refresh-on-return";
import { requestRefresh } from "@/lib/sync/refresh";
import { useServerSnapshot } from "@/lib/sync/use-server-snapshot";

/**
 * The shelf, kept true after it paints.
 *
 * The library is one of the pages the app-shell service worker replays to a
 * cold launch and a reload (public/sw.js), so the covers on screen can be last
 * night's. This holds the server's render and swaps in a fresh read of the same
 * shape whenever one is asked for — by the freshness guard when the document
 * was replayed, or by a return to the window. The shelf itself never remounts,
 * so the tab you're on, the filters you set and the optimistic edits you've
 * made all stay put; only the books under them update.
 */
export function LibraryShelf({
  snapshot,
  actions,
}: {
  snapshot: LibrarySnapshot;
  actions?: React.ReactNode;
}) {
  const data = useServerSnapshot(snapshot, loadLibrarySnapshot);
  // Same trigger the other apps use for "you came back to the window". The
  // re-read replaces props on a mounted tree, so it's safe while typing.
  useRefreshOnReturn(refreshLibrary, { safeWhileTyping: true });
  return (
    <ReaderShelf
      books={data.books}
      recommendations={data.recommendations}
      recsHasSignal={data.recsHasSignal}
      recsGenres={data.recsGenres}
      actions={actions}
    />
  );
}

function refreshLibrary() {
  requestRefresh();
}
