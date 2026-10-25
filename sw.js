// Service Worker: кешує оболонку застосунку для роботи офлайн.
// Стратегія «спершу мережа»: онлайн завжди свіжі файли (без суміші старих і нових модулів),
// офлайн — копія з кешу.
// Додали новий файл — допишіть його в ASSETS і збільште VERSION.

const VERSION = 'v2';
const CACHE = `suffler-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/prompter.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/markup.js',
  'js/matcher.js',
  'js/speech.js',
  'js/prompter.js',
  'js/library.js',
  'js/settings.js',
  'js/recorder.js',
  'js/stats.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('suffler-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.origin + url.pathname; // без ?query, щоб кеш не розростався копіями
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // no-cache: перевіряємо в сервера свіжість, а не беремо застарілу копію з HTTP-кешу.
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') e.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch {
      const cached = await cache.match(key)
        ?? (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
      return cached ?? new Response('Офлайн', { status: 503, statusText: 'Offline' });
    }
  })());
});
