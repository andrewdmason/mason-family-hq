"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { LAST_APP_STORAGE_KEY, getPwaAppByPath } from "@/lib/pwa/apps";

/**
 * Records the app you're currently in to localStorage on every navigation, so
 * the root `/` can jump back to it in local dev. Mounted dev-only from the root
 * layout. Renders nothing.
 */
export function LastAppTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const app = getPwaAppByPath(pathname);
    if (!app) return; // routes outside an app (e.g. "/", "/settings") don't count
    try {
      localStorage.setItem(LAST_APP_STORAGE_KEY, app.startUrl);
    } catch {
      /* localStorage unavailable (private mode, etc.) — ignore */
    }
  }, [pathname]);

  return null;
}
