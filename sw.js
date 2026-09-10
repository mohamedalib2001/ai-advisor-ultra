/* Service Worker - AI Advisor Ultra 6.0 */
const CACHE_NAME = 'ai-advisor-v6.5';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './ultra.js',
  './ultra-tools.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.0/dist/tesseract.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    ))
  );
  self.clients.claim();
});

/* لا يمر عبر الكاش أي طلب لخادم محلي أو طلب غير GET، حتى يبقى اكتشاف النماذج فورياً وصحيحاً */
function isLocalAI(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || isLocalAI(req.url)) return;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
      }
      return response;
    }).catch(() => cached))
  );
});
