const CACHE = 'shuyin-reading-shell-v010l';
const BASE = new URL('./', self.registration.scope);
const SHELL = [
  './', './index.html', './manifest.webmanifest', './shuyin-icon.svg',
  './icons/shuyin-192.png', './icons/shuyin-512.png', './icons/apple-touch-icon.png',
  './styles.css?v=20261018-r87', './direct-web.js?v=20261018-r86', './app.js?v=20261018-r87',
  './reader-extras.js?v=20261017-r53', './reader-mobile-fix.js?v=20261017-r53',
  './reader-nas-tts.js?v=20261018-r62', './reader-floating.js?v=20261017-r69',
  './reader-tts-plus.js?v=20261018-r70', './reader-library-tools.js?v=20261018-r70',
  './reader-chapter-guard.js?v=20261018-r85', './reader-offline-manager.js?v=20261018-r85',
  './reader-source-guard.js?v=20261018-r86',
  './reader-reading-polish.js?v=20261018-r86',
  './reader-font-choice.js?v=20261018-r87',
  './vendor/jszip.min.js', './vendor/mammoth.browser.min.js', './vendor/pdf.mjs', './vendor/pdf.worker.mjs',
  './offline-formats.js', './local-backup.js', './reading-tools.js',
  './vendor/shuyin-browser.js', './vendor/shuyin-audio.js', './vendor/shuyin-secure-store.js', './vendor/shuyin-share.js', './vendor/shuyin-ocr.js',
  './nas-sync.js', './ebook-export.js', './reader-offline-download.js', './reader-native-audio.js', './shuyin-native.js',
  './mobile-local-services.js?v=20261018-r68', './mobile-enhancements.js?v=20261017-r69'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map(async url => {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.ok) await cache.put(url, response);
  }));
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('shuyin-reading-shell-') && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  const basePath = new URL('./', BASE).pathname;
  if (url.origin !== BASE.origin || request.method !== 'GET' || url.pathname.startsWith(`${basePath}api/`)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return (await caches.match(new URL('./index.html', BASE).href)) || Response.error();
      return Response.error();
    }
  })());
});
