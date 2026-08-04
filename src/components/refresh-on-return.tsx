"use client";

import { useCallback, useEffect, useRef } from "react";
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

/**
 * The return-to-window trigger, minus the decision about *how* to refresh —
 * todos re-reads its data in place instead of re-running the route (see
 * shell-refresh.ts), and passes its own refresher here.
 */
export function useRefreshOnReturn(refresh: () => void) {
  const lastRefresh = useRef(0);

  useEffect(() => {
    // The page just rendered fresh; don't refresh again for the focus click
    // that often immediately follows a load.
    lastRefresh.current = Date.now();

    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < MIN_GAP_MS) return;
      lastRefresh.current = now;
      refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // Callers pass a stable refresher, so this subscribes once per mount.
  }, [refresh]);
}

export function RefreshOnReturn() {
  const router = useRouter();
  useRefreshOnReturn(useCallback(() => router.refresh(), [router]));
  return null;
}
