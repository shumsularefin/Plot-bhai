// Offline support. Pages are fetched from the network first and fall back to the cache; hashed files in
// /assets/ never change, so they are served from the cache first. Core shell assets are precached on
// install so the app loads offline after first visit.
const CACHE = 'plot-bhai-v2';
const PRECACHE = ['/', '/theme-init.js', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

async function fromNetwork(request) {
  const response = await fetch(request);
  if (response.ok) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    } catch {
      // Ignore Cache Storage quota errors so network responses still succeed.
    }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fromNetwork(request)));
  } else {
    event.respondWith(
      fromNetwork(request).catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }),
    );
  }
});
