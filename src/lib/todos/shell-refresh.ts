"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { loadShellSnapshot } from "@/app/(todos)/todos/actions";
import type { TodosShellData } from "@/lib/todos/shell-data";
import { requestRefresh, whenNotTyping } from "@/lib/sync/refresh";
import { useServerSnapshot } from "@/lib/sync/use-server-snapshot";

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
 * So instead the mounted shell is the registered refresher (the shared registry
 * in src/lib/sync/refresh.ts), and freshness rides a server action that returns
 * the same payload the route would have rendered. The shell stays mounted and
 * simply re-renders with newer data, exactly like the optimistic mutations it
 * already reconciles. When no shell is mounted (todos settings, the browse list)
 * there's nothing to protect, and we fall back to the router — but never while
 * you're typing.
 *
 * Whether the render on screen was replayed from the app-shell cache is no
 * longer this file's question: the freshness guard in the root layout asks the
 * service worker and, when it was, calls the same refresher.
 */

/**
 * The todos app's replacement for router.refresh(): re-read the shell's data in
 * place, falling back to a route refresh on the pages that have no shell.
 */
export function useTodosRefresh(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (requestRefresh()) return;
    whenNotTyping(() => router.refresh());
  }, [router]);
}

/**
 * Holds the shell's data: the server render to begin with, then whatever the
 * latest refresh returned. A fresh server render (a real navigation, a reload)
 * always wins — it's newer than anything fetched before it.
 */
export function useShellData<T extends TodosShellData>(server: T): T {
  // Impersonation (?as=) has to ride the refetch, or a parent looking at a kid's
  // list would silently reload their own. Read through a ref so the snapshot
  // hook subscribes once and still sees the current value.
  const as =
    server.viewed.email === server.selfEmail ? undefined : server.viewed.email;
  const viewedAs = useRef(as);
  useEffect(() => {
    viewedAs.current = as;
  }, [as]);

  const load = useCallback(
    () => loadShellSnapshot(viewedAs.current) as Promise<T>,
    []
  );
  return useServerSnapshot(server, load);
}
