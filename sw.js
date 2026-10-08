// Keeps the app itself available with no signal. Data calls to Supabase are never cached.
const CACHE = 'gospel-tracker-v6';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'config.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Serve from cache right away, refresh the cache in the background.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const cacheable = e.request.method === 'GET' &&
    (url.origin === location.origin || ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'].includes(url.hostname));
  if (!cacheable) return;

  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
