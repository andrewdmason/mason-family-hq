"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadShellSnapshot } from "@/app/(todos)/todos/actions";
import type { TodosShellData } from "@/lib/todos/shell-data";

/**
 * How the todos app asks for fresh data.
 *
 * Not router.refresh(). The views shell switches destinations with a bare
 * history.pushState — that's what makes a sidebar click instant — so from the
 * moment you switch, the URL names a route that Next's router has no tree for.
 * A refresh against that mismatch isn't a refresh at all: Next treats it as a
 * navigation to a new page and remounts everything below it. If you happened to
 * be typing a new to-do when it landed, the row you were writing in was gone and
 * focus was back on the page body — the "it just refreshed on me" glitch.
 *
 * So instead the mounted shell registers a refresher here, and freshness rides a
 * server action that returns the same payload the route would have rendered. The
 * shell stays mounted and simply re-renders with newer data, exactly like the
 * optimistic mutations it already reconciles. When no shell is mounted (todos
 * settings, the browse list) there's nothing to protect, and we fall back to the
 * router.
 *
 * A module singleton rather than context, so callers anywhere in the tree — and
 * the globally-mounted quick-add — reach it without threading a provider
 * through every layout (cf. view-switch.ts, which registers the same way).
 */

let refresher: (() => void) | null = null;

/**
 * How long after its server render a document still counts as "this launch's".
 *
 * Generous on purpose: the question isn't "how old exactly" but "was this
 * rendered for the screen I'm looking at, or replayed from the app-shell cache" —
 * milliseconds versus hours. A minute separates those with room to spare.
 */
const FRESH_RENDER_MS = 60_000;

/**
 * Did this render arrive on screen long after it was made? True for the launch
 * the service worker serves out of its pages cache (public/sw.js), and for a
 * window Chrome discarded and reloaded while it sat behind other apps.
 */
function isReplayedRender(renderedAt: number): boolean {
  const age = Date.now() - renderedAt;
  // A render that claims to be from the future means this device's clock and the
  // server's disagree, not time travel. Read again rather than trust it: the cost
  // of guessing wrong here is one query, and the cost of guessing wrong the other
  // way is a screen that stays wrong.
  return age < 0 || age > FRESH_RENDER_MS;
}

function registerShellRefresher(fn: () => void): () => void {
  refresher = fn;
  return () => {
    if (refresher === fn) refresher = null;
  };
}

/** Refresh the mounted shell's data; false = caller should use the router. */
function requestShellRefresh(): boolean {
  if (!refresher) return false;
  refresher();
  return true;
}

/**
 * The todos app's replacement for router.refresh(): re-read the shell's data in
 * place, falling back to a route refresh on the pages that have no shell.
 */
export function useTodosRefresh(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (!requestShellRefresh()) router.refresh();
  }, [router]);
}

/**
 * Holds the shell's data: the server render to begin with, then whatever the
 * latest refresh returned. A fresh server render (a real navigation, a reload)
 * always wins — it's newer than anything fetched before it.
 *
 * Also the one place that asks whether the render it was handed is actually about
 * today, because it's the only one holding the timestamp: a launch served out of
 * the app-shell cache re-reads immediately instead of waiting for the next time
 * you leave the window and come back.
 */
export function useShellData<T extends TodosShellData>(server: T): T {
  const [snapshot, setSnapshot] = useState<TodosShellData | null>(null);

  // Drop a stale snapshot during render, not in an effect, so the new server
  // data can't paint a frame behind the snapshot it replaces.
  const [renderedServerData, setRenderedServerData] = useState(server);
  if (renderedServerData !== server) {
    setRenderedServerData(server);
    setSnapshot(null);
  }

  const data = snapshot ? { ...server, ...snapshot } : server;

  // The render this document *arrived* with — not the merged data's, which moves
  // forward with every snapshot. Only the first one says anything about how the
  // screen got here.
  const arrivedFrom = useRef(server.renderedAt);

  // Impersonation (?as=) has to ride the refetch, or a parent looking at a kid's
  // list would silently reload their own.
  const as =
    data.viewed.email === data.selfEmail ? undefined : data.viewed.email;
  const viewedAs = useRef(as);
  useEffect(() => {
    viewedAs.current = as;
  }, [as]);

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
      void loadShellSnapshot(viewedAs.current)
        .then((next) => {
          if (mine === latest) setSnapshot(next);
        })
        .catch(() => {
          // Mostly best effort, like the refresh it replaces: the optimistic
          // state on screen stays and the next mutation tries again. The one case
          // worth chasing is the read that failed because there was no network
          // yet — coming back to a laptop that slept, the wifi can land a few
          // seconds after we do, and dropping that read silently is how a whole
          // morning of stale to-dos survives being looked at.
          if (mine !== latest) return;
          retryWhenOnline = () => read();
          window.addEventListener("online", retryWhenOnline);
        });
    };

    const unregister = registerShellRefresher(read);

    // A replayed render means the to-dos on screen are however old the cache is,
    // and the launch's own focus event is the one useRefreshOnReturn deliberately
    // swallows as "the page just rendered" — so nothing else here would ask.
    // Read once now: the shell stays mounted, so this costs a flash of yesterday
    // rather than the screen the service worker exists to paint instantly.
    if (isReplayedRender(arrivedFrom.current)) read();

    return () => {
      unregister();
      cancelRetry();
    };
  }, []);

  return data;
}
