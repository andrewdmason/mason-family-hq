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

  const pending = useMemo(() => {
    const map = new Map<string, PracticeRecordingStatus>();
    for (const day of days) {
      for (const task of day.tasks) {
        for (const rec of task.recordings) {
          if (PENDING_STATUSES.has(rec.status)) map.set(rec.id, rec.status);
        }
      }
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
        const changed = ids.some(
          (id) => statuses[id] !== pendingRef.current.get(id)
        );
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
