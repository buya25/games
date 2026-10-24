// One service worker for the whole arcade: the launcher and every game, so it all works offline.
// Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'neon-arcade-v16';
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
  'market/shopart.js',
  'market/shop.js',
  'market/shop3d.js',
  'market/vendor/three.module.min.js',
  'market/assets/models/Textures/colormap.png',
  'market/assets/models/building-garage.glb',
  'market/assets/models/building-small-a.glb',
  'market/assets/models/building-small-b.glb',
  'market/assets/models/building-small-c.glb',
  'market/assets/models/building-small-d.glb',
  'market/assets/models/grass-trees-tall.glb',
  'market/assets/models/grass-trees.glb',
  'market/assets/models/pavement-fountain.glb',
  'market/assets/models/road-straight-lightposts.glb',
  'market/assets/models/trucks/Textures/colormap.png',
  'market/assets/models/trucks/vehicle-truck-green.glb',
  'market/assets/models/trucks/vehicle-truck-purple.glb',
  'market/assets/models/trucks/vehicle-truck-red.glb',
  'market/assets/sounds/city-ambience.ogg',
  'market/assets/sounds/city-placement-a.ogg',
  'market/assets/sounds/city-toggle.ogg',
  'market/assets/sounds/coin.ogg',
  'market/assets/sounds/land.ogg',
  'market/assets/sounds/race-engine.ogg',
  'market/assets/sounds/race-impact.ogg',
  'market/assets/sounds/walking.ogg',
  'market/vendor/jsm/environments/RoomEnvironment.js',
  'market/vendor/jsm/loaders/GLTFLoader.js',
  'market/vendor/jsm/postprocessing/EffectComposer.js',
  'market/vendor/jsm/postprocessing/MaskPass.js',
  'market/vendor/jsm/postprocessing/OutputPass.js',
  'market/vendor/jsm/postprocessing/Pass.js',
  'market/vendor/jsm/postprocessing/RenderPass.js',
  'market/vendor/jsm/postprocessing/ShaderPass.js',
  'market/vendor/jsm/postprocessing/UnrealBloomPass.js',
  'market/vendor/jsm/shaders/CopyShader.js',
  'market/vendor/jsm/shaders/LuminosityHighPassShader.js',
  'market/vendor/jsm/shaders/OutputShader.js',
  'market/vendor/jsm/utils/BufferGeometryUtils.js',
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
