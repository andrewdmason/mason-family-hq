"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Optimistic-mutation bookkeeping for the todos client components.
 *
 * The pattern everywhere here: local state mutates instantly, the server
 * action fires, and the next server snapshot (via router.refresh()) reconciles.
 * Two production realities make the naive version — refresh after every
 * action, adopt every snapshot — feel broken on a real network:
 *
 * - Bursts: a multi-select drop fires one action per task, and refreshing per
 *   action stacks N full page re-renders behind N serialized POSTs. `run`
 *   refreshes once, when the *last* in-flight action settles.
 * - Races: a snapshot rendered before a later optimistic change committed
 *   resurrects the old row when it lands (completed tasks popping back in).
 *   `idle` lets the snapshot-sync effects ignore server props while anything
 *   is in flight — the drain refresh that follows carries consistent truth.
 */
export function useReconciler() {
  const router = useRouter();
  const pending = useRef(0);

  /** True when no mutation is in flight — server snapshots are safe to adopt. */
  const idle = useCallback(() => pending.current === 0, []);

  /** Await a mutation, then refresh once the in-flight set drains to zero. */
  const run = useCallback(
    async (action: Promise<unknown>) => {
      pending.current += 1;
      try {
        await action;
      } finally {
        pending.current -= 1;
        if (pending.current === 0) router.refresh();
      }
    },
    [router]
  );

  return { run, idle };
}
