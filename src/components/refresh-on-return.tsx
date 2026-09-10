"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { whenNotTyping } from "@/lib/sync/refresh";

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
 *
 * Unless the caller says its refresh is `safeWhileTyping`, the refresh waits
 * for the cursor to leave whatever field it's in. The focus event that brings
 * us here is very often the click *into* a field — and a route refresh that
 * lands a second later can remount the tree or, if the page is from a build the
 * server has retired, turn into a full reload. Either way the cursor is gone.
 */
export function useRefreshOnReturn(
  refresh: () => void,
  opts: { safeWhileTyping?: boolean } = {}
) {
  const lastRefresh = useRef(0);
  const { safeWhileTyping = false } = opts;

  useEffect(() => {
    // Don't refresh again for the focus click that often immediately follows a
    // load. (A document replayed from the app-shell cache is the freshness
    // guard's job — src/components/freshness-guard.tsx — not this hook's.)
    lastRefresh.current = Date.now();
    let cancelDeferred: (() => void) | null = null;

    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < MIN_GAP_MS) return;
      lastRefresh.current = now;
      if (safeWhileTyping) {
        refresh();
        return;
      }
      cancelDeferred?.();
      cancelDeferred = whenNotTyping(refresh);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cancelDeferred?.();
    };
    // Callers pass a stable refresher, so this subscribes once per mount.
  }, [refresh, safeWhileTyping]);
}

export function RefreshOnReturn() {
  const router = useRouter();
  useRefreshOnReturn(useCallback(() => router.refresh(), [router]));
  return null;
}
