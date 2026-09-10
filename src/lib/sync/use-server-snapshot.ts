"use client";

import { useEffect, useRef, useState } from "react";
import {
  isStaleBuildError,
  registerRefresher,
  reloadForNewBuild,
} from "@/lib/sync/refresh";

/**
 * Holds a screen's data: the server render to begin with, then whatever the
 * latest in-place re-read returned. A fresh server render (a real navigation,
 * a reload) always wins — it's newer than anything fetched before it.
 *
 * `load` is a server action returning the same shape the route rendered. It's
 * read through a ref, so callers can pass a fresh closure every render (to
 * carry a ?as= param, say) without re-subscribing.
 *
 * While mounted, this is the screen's registered refresher (see refresh.ts):
 * the freshness guard's "you were replayed from cache" re-read, the
 * return-to-window refresh, and the app's own mutation reconcile all land here
 * and simply re-render the mounted tree with newer data.
 */
export function useServerSnapshot<T extends object>(
  server: T,
  load: () => Promise<T>
): T {
  const [snapshot, setSnapshot] = useState<T | null>(null);

  // Drop a stale snapshot during render, not in an effect, so the new server
  // data can't paint a frame behind the snapshot it replaces.
  const [renderedServerData, setRenderedServerData] = useState(server);
  if (renderedServerData !== server) {
    setRenderedServerData(server);
    setSnapshot(null);
  }

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    // Refreshes can overlap (a burst of mutations, a focus-return landing on
    // top of one); only the newest answer may win, or an older payload would
    // resurrect rows the newer one knows are gone.
    let latest = 0;
    let retryWhenOnline: (() => void) | null = null;

    const cancelRetry = () => {
      if (!retryWhenOnline) return;
      window.removeEventListener("online", retryWhenOnline);
      retryWhenOnline = null;
    };

    const read = () => {
      const mine = ++latest;
      cancelRetry();
      void loadRef
        .current()
        .then((next) => {
          if (mine === latest) setSnapshot(next);
        })
        .catch((err: unknown) => {
          if (mine !== latest) return;
          // A page from a build the server has retired can't read anything
          // through its actions — every one of them 404s. Swallowing that is
          // how a whole morning of stale to-dos survives being looked at.
          if (isStaleBuildError(err)) {
            reloadForNewBuild();
            return;
          }
          // Otherwise best effort, like the refresh it replaces: the state on
          // screen stays and the next mutation tries again. The one case worth
          // chasing is the read that failed because there was no network yet —
          // coming back to a laptop that slept, the wifi can land a few seconds
          // after we do.
          retryWhenOnline = () => read();
          window.addEventListener("online", retryWhenOnline);
        });
    };

    const unregister = registerRefresher(read);
    return () => {
      unregister();
      cancelRetry();
    };
  }, []);

  return snapshot ? { ...server, ...snapshot } : server;
}
