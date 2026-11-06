const CACHE_NAME = 'baby-diary-m-v20261105b';
const ASSETS = [
  '/static/m/index.html',
  '/static/m/manifest.json',
  '/static/m/m_style.css?v=20261105b',
  '/static/m/idb.js?v=20261105b',
  '/static/m/m_app.js?v=20261105b',
  '/static/m/vendor/jszip.min.js?v=20261105b',
  '/static/m/icons/icon-192.png',
  '/static/m/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只缓存移动端静态资源；API 与数据走网络
  if (url.pathname.startsWith('/static/m/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        }).catch(() => cached);
      })
    );
  }
});
