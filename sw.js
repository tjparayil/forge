// sw.js
// Phase 6: offline app shell caching. Bump CACHE_VERSION whenever the
// precached file list changes or you want to force clients to pick up a
// fresh copy of everything -- there's no build step to hash filenames, so
// this manual version string is the cache-busting mechanism.
//
// Strategy: precache the whole app shell (HTML/JS/JSON/icons) on install.
// On fetch, serve same-origin GET requests cache-first for instant offline
// loads, but always refresh the cache from the network in the background
// (stale-while-revalidate) so the next load picks up any update. IndexedDB
// (the actual logged data) is untouched by any of this -- it already
// persists independently of the network and this cache.

const CACHE_VERSION = 'forge-v2-1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './data/program.json',
  './js/store.js',
  './js/program.js',
  './js/volume.js',
  './js/progression.js',
  './js/stats.js',
  './js/nutrition.js',
  './js/util.js',
  './js/validator.js',
  './js/workout-screen.js',
  './js/notes-screen.js',
  './js/plan-screen.js',
  './js/agent-screen.js',
  './js/agents/weekly-review.js',
  './js/agents/research.js',
  './js/agents/program-designer.js',
  './js/agents/nutrition.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only handle same-origin GET requests -- everything else (cross-origin
  // fonts, any future POST) passes straight through to the network as if
  // this service worker weren't here.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async cache => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      if (cached) {
        // Stale-while-revalidate: return the cached copy immediately, let
        // the network fetch update the cache for next time in the background.
        networkFetch;
        return cached;
      }
      // Nothing cached yet: wait for the network. If that also fails and
      // this was a page navigation, fall back to the cached shell so the
      // app still opens offline instead of showing the browser's error page.
      const fresh = await networkFetch;
      if (fresh) return fresh;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline and not cached yet.', { status: 503, statusText: 'Offline' });
    })
  );
});
