// Mason Family HQ service worker — the "instant chrome" app shell.
//
// With no service worker, every cold PWA launch is fully network-bound: iOS boots
// a fresh webview, hits the network, waits on the auth middleware, and only then
// can paint anything — that's the 3–5s white screen. This worker keeps a local
// copy of the static app shell and the last page you saw, so a re-launch paints
// chrome instantly (zero network) and revalidates in the background — the way
// Google Calendar / Gmail feel native.
//
// Two strategies:
//   • CacheFirst   — immutable, content-hashed assets (/_next/static/*, the
//                    self-hosted fonts under it, /app-icons/*, /app-splash/*).
//                    The URL changes whenever the bytes change, so a cache hit is
//                    always correct and never needs revalidation.
//   • StaleWhileRevalidate — full-document navigations to app routes. Serve the
//                    last rendered HTML immediately, fetch a fresh copy in the
//                    background for next time. The app already re-syncs data after
//                    paint (SyncTrigger → router.refresh), so a flash of
//                    last-known content is the intended native feel.
//
// Never cached (always network): /login, /auth/*, /api/*, /family-status, any
// non-GET, cross-origin, redirected, or non-200 response — so auth and writes are
// never served stale. RSC payloads for in-app navigation (mode !== "navigate")
// fall through to the network untouched, so client-side transitions stay fresh.

const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGES_CACHE = `pages-${VERSION}`;

// New worker takes over on next launch without waiting for old tabs to close.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older worker versions.
      const keep = new Set([STATIC_CACHE, PAGES_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
      await self.clients.claim();
    })()
  );
});

// Same-origin, immutable, content-hashed asset paths.
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/app-icons/") ||
    url.pathname.startsWith("/app-splash/")
  );
}

// Navigations we must never serve from cache (auth + dynamic endpoints).
function isBypassedPath(pathname) {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/family-status")
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

// Serve the cached page instantly; refresh it in the background. A revalidation
// that comes back redirected (e.g. middleware bounced us to /login) or non-200
// evicts the entry so we don't keep serving a stale signed-in page.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(PAGES_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      const cacheable =
        response &&
        response.status === 200 &&
        !response.redirected &&
        response.type === "basic";
      if (cacheable) {
        cache.put(request, response.clone());
      } else {
        cache.delete(request);
      }
      return response;
    })
    .catch(() => null);

  return cached || (await network) || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Only full-document loads (cold launch, hard refresh) — not RSC fetches.
  if (request.mode === "navigate" && !isBypassedPath(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
