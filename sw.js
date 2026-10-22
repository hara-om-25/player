// /player/ — тепер лише сторінка-меню. Спершу мережа (до 2,5 с), без мережі — кеш: меню відкривається й офлайн.
const CACHE = 'player-v62';
const FILES = ['./', './icon-192.png', './icon-512.png', './apps/audio-player.png', './apps/video-player.png', './apps/video-editor.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('player-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const net = fetch(req, req.mode === 'navigate' ? { cache: 'reload' } : undefined)
    .then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; });
  const cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./'));
  e.respondWith(Promise.race([net, new Promise((_, no) => setTimeout(no, 2500))]).catch(() => cached().then(r => r || net)));
});
