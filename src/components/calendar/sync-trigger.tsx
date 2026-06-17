"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { triggerSync } from "@/app/(calendar)/calendar/actions";

/**
 * Fire a one-shot source sync on mount, then refresh the route ONLY when the
 * sync actually changed the events — otherwise the refresh re-suspends the
 * route and flashes the loading skeleton a couple seconds into every visit.
 * Cheap enough for one household; a cron can take over later. Guarded so React
 * StrictMode's double-mount doesn't double-sync.
 */
export function SyncTrigger() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    triggerSync()
      .then((res) => {
        if (res?.changed) router.refresh();
      })
      .catch(() => {});
  }, [router]);

  return null;
}
