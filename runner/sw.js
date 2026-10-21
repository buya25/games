// Retired: the whole arcade now uses one service worker at ../sw.js. Phones that installed the
// old Neon Dash app still have this one registered, so it clears its caches and unregisters
// itself; the arcade worker takes over on the next load.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('neon-dash-')).map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
