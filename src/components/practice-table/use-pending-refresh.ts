"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSegmentStatuses } from "@/app/practice/recordings/sweep-actions";
import type { FeedDay, PracticeRecordingStatus } from "@/lib/types";

const POLL_INTERVAL_MS = 25_000;

/** Statuses still moving through the pipeline (recorded → uploaded → processing). */
const PENDING_STATUSES: ReadonlySet<PracticeRecordingStatus> = new Set([
  "recorded",
  "uploaded",
  "processing",
]);

/**
 * Near-live enrichment refresh (U9). While the rendered day feed carries
 * segments still moving through the pipeline, poll their statuses every ~25s
 * and `router.refresh()` on any transition so the revalidated feed flows in
 * through PracticeTable's existing merge. Zero network calls when nothing is
 * pending; polling pauses while the tab is hidden and resumes (with an
 * immediate catch-up poll) when it becomes visible again.
 */
export function usePendingRefresh(days: FeedDay[]) {
  const router = useRouter();

  // Ids the poll has already seen transition to a terminal server status.
  // Because practice-table only merges fresh data for page-1 days
  // (`fresh.get(d.date) ?? d`), a recording that settles on an older
  // paginated day never gets its client-side status updated — without this
  // set, the poll would see server !== client for that id forever and
  // router.refresh() every tick. Once we've fired the one-time refresh for a
  // transition, the id is excluded from further pending/changed checks.
  const settledRef = useRef<Set<string>>(new Set());

  const pending = useMemo(() => {
    const map = new Map<string, PracticeRecordingStatus>();
    const stillRendered = new Set<string>();
    for (const day of days) {
      for (const task of day.tasks) {
        for (const rec of task.recordings) {
          stillRendered.add(rec.id);
          // Memory hygiene: if the client's own data later shows this id as
          // non-pending (e.g. a fresh page-1 merge caught up), it's settled
          // from the client's own perspective too — drop it from the set.
          if (!PENDING_STATUSES.has(rec.status)) {
            settledRef.current.delete(rec.id);
            continue;
          }
          if (settledRef.current.has(rec.id)) continue;
          map.set(rec.id, rec.status);
        }
      }
    }
    // Memory hygiene: forget settled ids that no longer render at all.
    for (const id of settledRef.current) {
      if (!stillRendered.has(id)) settledRef.current.delete(id);
    }
    return map;
  }, [days]);

  // The poll compares against the freshest client state without restarting the
  // interval on every refreshed-days identity — the effect keys off the id set.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const pendingKey = useMemo(
    () => [...pending.keys()].sort().join(","),
    [pending]
  );

  useEffect(() => {
    if (!pendingKey) return; // Nothing pending → no listeners, no timers, no polls.

    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    let cancelled = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const ids = [...pendingRef.current.keys()];
        if (!ids.length) return;
        const statuses = await getSegmentStatuses(ids);
        if (cancelled) return;
        // Any drift from what the client has — including a vanished row
        // (null) — means the server moved on; pull the revalidated feed.
        // Ids that just settled are marked so subsequent ticks (before the
        // client's own data catches up, e.g. on an older paginated day)
        // don't see the same drift and refresh again forever.
        let changed = false;
        for (const id of ids) {
          const serverStatus = statuses[id];
          const clientStatus = pendingRef.current.get(id);
          if (serverStatus === clientStatus) continue;
          changed = true;
          if (serverStatus === null || !PENDING_STATUSES.has(serverStatus)) {
            settledRef.current.add(id);
          }
        }
        if (changed) router.refresh();
      } catch {
        // Transient failure (offline, auth blip) — the next tick retries.
      } finally {
        inFlight = false;
      }
    };

    const start = () => {
      if (timer === null) timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll(); // Catch up on anything that finished while hidden.
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") start();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [pendingKey, router]);
}
