// Service worker for the DonutSMP Admin PWA.
// Caches only the static app shell so it is installable and opens offline.
// API calls (/api/...) are ALWAYS network — never cached.
const CACHE = 'donut-admin-v1';
const SHELL = ['/admin.html', '/theme.css', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept API or non-GET requests.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // App shell: cache-first, fall back to network.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res && res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('/admin.html')))
  );
});
