"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { triggerAssignmentSync } from "@/app/(assignments)/assignments/actions";

/**
 * Fire a one-shot Blackbaud sync on mount, then refresh ONLY when the sync
 * actually changed the assignments — otherwise the refresh re-suspends the
 * route and flashes the loading skeleton a couple seconds into every visit.
 * No-ops until a parent connects a portal session. Guarded against React
 * StrictMode's double-mount. A cron can take over later.
 */
export function SyncTrigger() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    triggerAssignmentSync()
      .then((res) => {
        if (res?.changed) router.refresh();
      })
      .catch(() => {});
  }, [router]);

  return null;
}
