"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell service worker (public/sw.js) once, after first paint.
 * The worker caches static assets and the last page you visited so re-launching
 * the installed PWA paints chrome instantly instead of staring at a white screen
 * while the network and auth middleware respond. See public/sw.js for strategy.
 *
 * No-op where service workers aren't available (e.g. server render, older
 * browsers). Registration failures are swallowed — a missing worker just means
 * we fall back to today's network-only behaviour, never a broken page.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
