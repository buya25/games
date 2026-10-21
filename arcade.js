'use strict';

// Neon Arcade launcher: shows the player's runner, coins and bests, and links into each game.
(() => {
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const $ = (id) => document.getElementById(id);

  const name = get('neonDash.name', '');
  const look = Object.assign({ outfit: 'classic', skin: 2, hair: 'short', hairColor: 0 }, get('neonDash.look', {}));
  $('hi').textContent = name ? `Hi ${name}, welcome to` : 'Welcome to';
  $('coins').textContent = get('neonDash.wallet', 0);

  const best = get('neonDash.best', 0), bestMaze = get('neonDash.bestMaze', 0);
  if (best) $('bestDash').textContent = `Best ${best}`;
  if (bestMaze) $('bestMaze').textContent = `Best: maze ${bestMaze}`;
  if (!(window.NEON_FIREBASE && window.NEON_FIREBASE.apiKey)) $('raceState').textContent = 'Setup needed';

  // your own runner, in your outfit, jogging on the spot
  const cv = $('me'), ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = 60 * dpr; cv.height = 75 * dpr;
  const outfit = window.NeonLooks ? NeonLooks.byId(NeonLooks.OUTFITS, look.outfit) : null;
  let t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 60, 75);
    if (outfit) NeonLooks.drawRunner(ctx, 30, 72, 34, { phase: t * 7, stride: 0.45 }, outfit, t, look);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // install as an app
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('installBtn').classList.remove('hidden'); });
  $('installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    deferred = null;
    $('installBtn').classList.add('hidden');
  });
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('iosHint').classList.remove('hidden');

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
