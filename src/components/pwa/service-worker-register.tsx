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

    // Dev: never register. The app-shell cache exists for the installed PWA's
    // cold launch; on localhost it only serves stale HTML (endless hard-refresh
    // loops), and because registrations are per localhost:PORT origin they
    // outlive the dev server and hijack OTHER projects later run on the same
    // port. Actively unregister + drop this worker's caches so any machine
    // that already picked up the worker in dev heals itself on next load.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          for (const reg of regs) void reg.unregister();
        })
        .catch(() => {});
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) => {
            for (const key of keys) {
              // Only this worker's own app-shell caches. Deliberately NOT
              // reader-content-*: that's the user's downloaded books, written by
              // the page rather than the worker, and dropping it here would mean
              // developing on this machine silently emptied the library.
              if (/^(static|pages)-/.test(key)) void caches.delete(key);
            }
          })
          .catch(() => {});
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
