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
//
// Deliberately untouched: /reader/api/content/*, the book text itself. It isn't
// a navigation and isn't a static asset, so it falls straight through to the
// network here — the reader caches it from the page instead, into its own
// `reader-content-v1` cache, because that code can also read and write the
// IndexedDB registry that says what has been downloaded. See
// src/lib/reading/offline/content-cache.ts.

const VERSION = "v2";
const STATIC_CACHE = `static-${VERSION}`;
const PAGES_CACHE = `pages-${VERSION}`;

// New worker takes over on next launch without waiting for old tabs to close.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older worker versions — but never the downloaded
      // books. Those aren't versioned with the worker and aren't ours to throw
      // away: they're the user's library, and re-downloading them needs exactly
      // the network they may not have.
      const keep = new Set([STATIC_CACHE, PAGES_CACHE, "reader-content-v1"]);
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

// A cached page is only as good as the JS it asks for. Next.js chunk URLs are
// content-hashed, so a deploy renames them — and a reader page cached after that
// deploy would reference chunks this device has never fetched, leaving it unable
// to hydrate offline. So whenever we cache a reader page, we make sure the exact
// chunks that copy of the HTML names are in the static cache too.
async function prefetchAssets(html) {
  const urls = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) || []);
  if (urls.size === 0) return;
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    [...urls].map(async (url) => {
      if (await cache.match(url)) return;
      try {
        const response = await fetch(url);
        if (response && response.ok) await cache.put(url, response);
      } catch {
        // Best effort: a missing chunk just means this one stays network-bound.
      }
    })
  );
}

// Serve the cached page instantly; refresh it in the background. A revalidation
// that comes back redirected (e.g. middleware bounced us to /login) or non-200
// evicts the entry so we don't keep serving a stale signed-in page.
async function staleWhileRevalidate(request, event) {
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
        if (isReaderPath(new URL(request.url).pathname)) {
          // Keep the worker alive for this: it outlives the response we're
          // about to return, and it's the whole reason offline hydration works.
          event?.waitUntil(response.clone().text().then(prefetchAssets));
        }
      } else {
        cache.delete(request);
      }
      return response;
    })
    .catch(() => null);

  return cached || (await network) || readerFallback(request);
}

function isReaderPath(pathname) {
  return pathname === "/reader" || pathname.startsWith("/reader/");
}

// Offline, with nothing cached for this exact URL. The shelf is the best place
// to land — it was rendered while online, its covers are inline data URLs, and
// every book on it that has been opened will open again from here.
//
// It matters most for the installed app's own start_url, /reader, which always
// redirects and so is never cached in the first place.
async function readerFallback(request) {
  if (!isReaderPath(new URL(request.url).pathname)) return fetch(request);
  const cache = await caches.open(PAGES_CACHE);
  const shelf = await cache.match("/reader/library");
  if (shelf) return shelf;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>body{font-family:ui-serif,Georgia,serif;margin:0;min-height:100vh;display:flex;
align-items:center;justify-content:center;padding:2rem;color:#3f3f46;background:#fafaf9}
p{max-width:24rem;text-align:center;line-height:1.6}</style></head>
<body><p>You're offline, and this page hasn't been opened on this device yet.
Books you've already opened will still open from your shelf.</p></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
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
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
