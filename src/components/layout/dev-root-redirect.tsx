"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LAST_APP_STORAGE_KEY, getPwaAppByPath } from "@/lib/pwa/apps";

/**
 * Dev-only root redirect: sends `/` to whichever app you were last in (recorded
 * by LastAppTracker), falling back to the Home dashboard. Production redirects
 * to /home server-side instead — see app/page.tsx.
 */
export function DevRootRedirect() {
  const router = useRouter();

  useEffect(() => {
    let target = "/home";
    try {
      const stored = localStorage.getItem(LAST_APP_STORAGE_KEY);
      // Validate against the known app list so a stale/garbage value can't
      // bounce you somewhere broken.
      if (stored && getPwaAppByPath(stored)) target = stored;
    } catch {
      /* localStorage unavailable — fall back to /home */
    }
    router.replace(target);
  }, [router]);

  return null;
}
