// Tachyread service worker — makes the app installable (PWA) and usable offline.
//
// Strategy: precache the shell, then for same-origin GETs serve cache-first with a background
// refresh (fast + eventually fresh); navigations are network-first with an offline fallback to the
// cached app shell. Cross-origin requests (OCR engine CDN, Google sign-in, Drive) are left untouched
// so nothing is cached or intercepted that shouldn't be.

const VERSION = 'tachyread-v2';
const BASE = new URL('./', self.location).pathname; // '/' in dev, '/Tachyread/' on Pages
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.webmanifest',
  BASE + 'favicon.svg',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL).catch(() => {}); // tolerate any single 404 during precache
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // don't touch cross-origin

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);

    if (req.mode === 'navigate') {
      try {
        const net = await fetch(req);
        cache.put(req, net.clone());
        return net;
      } catch {
        return (await cache.match(req)) || (await cache.match(BASE + 'index.html')) || (await cache.match(BASE)) || Response.error();
      }
    }

    const cached = await cache.match(req);
    if (cached) {
      fetch(req).then((r) => { if (r && r.status === 200) cache.put(req, r.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const net = await fetch(req);
      if (net && net.status === 200) cache.put(req, net.clone());
      return net;
    } catch {
      return Response.error();
    }
  })());
});
