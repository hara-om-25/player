// /player/ — тепер лише сторінка-меню. Спершу мережа, без мережі — кеш.
const CACHE = 'player-v59';
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './icon-192.png'])).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('player-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, e.request.mode === 'navigate' ? { cache: 'reload' } : undefined)
    .then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});
