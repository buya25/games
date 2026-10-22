// One service worker for the whole arcade: the launcher and every game, so it all works offline.
// Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'neon-arcade-v7';
const FILES = [
  './',
  'index.html',
  'arcade.css',
  'arcade.js',
  'manifest.webmanifest',
  'runner/',
  'runner/index.html',
  'runner/style.css',
  'runner/city.js',
  'runner/looks.js',
  'runner/maze.js',
  'runner/ghost.js',
  'runner/net.js',
  'runner/firebase-config.js',
  'runner/game.js',
  'market/',
  'market/index.html',
  'market/style.css',
  'market/engine.js',
  'market/shop.js',
  'market/ui.js',
  'runner/icons/icon-192.png',
  'runner/icons/icon-512.png',
  'runner/icons/maskable-512.png',
  'runner/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up when online), cache as offline fallback.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
