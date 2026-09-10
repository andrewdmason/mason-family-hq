"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { reloadForNewBuild, requestRefresh } from "@/lib/sync/refresh";

/**
 * Notices when the document on screen wasn't rendered for this screen.
 *
 * The app-shell service worker (public/sw.js) answers a page load — a cold PWA
 * launch, and a plain reload in a browser tab too — with the HTML it saved last
 * time, then fetches a fresh copy only for the *next* load. That's what makes a
 * launch paint instantly, and it means the data on screen is however old the
 * cache is. This is the one place that asks, for every app, "was I replayed?"
 * and does something about it:
 *
 *  1. Ask the worker. It remembers whether it served this URL from cache a
 *     moment ago. If the worker can't say (killed, or not in control yet), fall
 *     back to the render stamp the layout put on <body>: a document more than a
 *     minute old on arrival was not rendered for this launch.
 *  2. If replayed, re-read in place through whatever refresher the mounted
 *     screen registered (see src/lib/sync/refresh.ts), else re-run the route.
 *     This happens at t=0, before anyone has started typing — which is the
 *     whole point of doing it here rather than on the next window focus.
 *  3. When the worker's background fetch comes back from a *newer build*, the
 *     page on screen is one the server has moved past: its server actions will
 *     404 once Vercel's skew window closes, and any route refresh turns into a
 *     surprise full reload. Reload on our own terms instead — now if nothing is
 *     focused, otherwise when the field blurs.
 */

/**
 * How long after its server render a document still counts as "this launch's".
 * The question isn't "how old exactly" but "made for this screen, or replayed
 * from the cache" — milliseconds versus hours. A minute separates those with
 * room to spare.
 */
const FRESH_RENDER_MS = 60_000;

/** How long to wait on the worker before falling back to the render stamp. */
const WORKER_REPLY_MS = 1_000;

type ServedStatus = {
  fromCache: boolean;
  fresh?: { build: string | null } | null;
} | null;

function isReplayedStamp(renderedAt: number): boolean {
  if (!Number.isFinite(renderedAt)) return false;
  const age = Date.now() - renderedAt;
  // A render from the future means this device's clock and the server's
  // disagree, not time travel. Read again rather than trust it.
  return age < 0 || age > FRESH_RENDER_MS;
}

/**
 * null: the worker served this document straight from the network, or never
 * saw it. "none": no worker is in control, so nothing could have replayed us
 * (the first visit, dev, a browser without workers). undefined: a worker is in
 * control but didn't answer — fall back to the render stamp.
 */
function askWorker(url: string): Promise<ServedStatus | "none" | undefined> {
  return new Promise((resolve) => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) return resolve("none");
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(undefined), WORKER_REPLY_MS);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve((e.data ?? null) as ServedStatus);
    };
    try {
      controller.postMessage({ type: "hq:status", url }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

export function FreshnessGuard() {
  const router = useRouter();

  useEffect(() => {
    // The URL this document was loaded at — not wherever a pushState has since
    // moved the address bar. It's the key the worker filed us under.
    const docUrl = window.location.href;
    const build = document.body.dataset.build ?? null;
    const renderedAt = Number(document.body.dataset.renderedAt);
    let cancelled = false;

    const refreshInPlaceOrRoute = () => {
      if (requestRefresh()) return;
      // A route refresh with no network turns into a full navigation (Next
      // falls back to one when the RSC fetch fails), which offline would just
      // replay this same document. Nothing to gain.
      if (!navigator.onLine) return;
      router.refresh();
    };

    const isNewBuild = (fresh: { build: string | null } | null | undefined) =>
      !!fresh?.build && !!build && fresh.build !== build;

    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; url?: string; fresh?: { build: string | null } } | null;
      if (!m || m.type !== "hq:revalidated" || m.url !== docUrl) return;
      if (isNewBuild(m.fresh)) reloadForNewBuild();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    void askWorker(docUrl).then((status) => {
      if (cancelled || status === "none") return;
      const replayed =
        status === undefined ? isReplayedStamp(renderedAt) : !!status?.fromCache;
      if (!replayed) return;
      if (status && isNewBuild(status.fresh)) {
        reloadForNewBuild();
        return;
      }
      refreshInPlaceOrRoute();
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [router]);

  return null;
}
