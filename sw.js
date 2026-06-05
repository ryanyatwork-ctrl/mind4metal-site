const CACHE_NAME = 'mind4metal-v7';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/apple-touch-icon.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache the audio stream or metadata endpoints
  if (url.hostname === 'radio.mind4metal.com') return;

  // Never cache the dynamic API (art resolver / recent tracks) — always live.
  if (url.pathname.startsWith('/api/')) return;

  const cachePut = response => {
    if (response && response.status === 200 && response.type === 'basic') {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
    }
    return response;
  };

  // Network-first for HTML/navigations so deployed code reaches listeners on the
  // next reload (falls back to cache only when offline). This prevents stale-page
  // bugs where a fix is live but the browser keeps serving an old cached page.
  const isHTML = event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname.endsWith('.html');

  if (isHTML) {
    event.respondWith(
      fetch(event.request).then(cachePut)
        .catch(() => caches.match(event.request).then(c => c || caches.match('/')))
    );
    return;
  }

  // Cache-first for static assets (icons, scripts, manifest) — fast and rarely change.
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetched = fetch(event.request).then(cachePut).catch(() => cached);
      return cached || fetched;
    })
  );
});
