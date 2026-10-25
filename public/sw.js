// Offline support. Pages are fetched from the network first and fall back to the cache; hashed files in
// /assets/ never change, so they are served from the cache first. Only files the user has already
// opened are stored, so a tool works offline after its first visit. Nothing leaves the device.
const CACHE = 'xrdtk-v1';

self.addEventListener('install', () => self.skipWaiting());

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
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
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
    event.respondWith(fromNetwork(request).catch(() => caches.match(request)));
  }
});
