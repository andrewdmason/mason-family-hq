"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the server snapshot when the user comes back to an already-open
 * window (focus or tab-visible), so data changed elsewhere — another device,
 * another family member — appears without a manual reload. Also re-derives
 * anything the Server Component computes from "now" (e.g. a Today/Tomorrow
 * grouping), since the whole route re-renders.
 *
 * Throttled: focus and visibilitychange fire together on a tab switch, and a
 * quick alt-tab dance shouldn't stack refreshes.
 */
const MIN_GAP_MS = 5_000;

export function RefreshOnReturn() {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    // The page just rendered fresh; don't refresh again for the focus click
    // that often immediately follows a load.
    lastRefresh.current = Date.now();

    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < MIN_GAP_MS) return;
      lastRefresh.current = now;
      router.refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
