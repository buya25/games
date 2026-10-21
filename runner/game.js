'use strict';

(() => {
  // ---------- Tuning ----------
  const ROAD = 3;            // road half-width in world units
  const PLAYER_HW = 0.32;    // player half-width
  const PLAYER_HD = 0.25;    // player half-depth
  const CAM_D = 4;           // camera distance behind the player
  const SPAWN_Z = 95;        // where new obstacles appear
  const GRAVITY = 30;
  const JUMP_V = 10.5;       // ~1.8 units high, ~0.7 s airtime
  const START_SPEED = 15;
  const MAX_SPEED = 36;
  const ACCEL = 0.28;        // speed gained per second
  const KEY_STEER = 11;      // units/second when steering with the keyboard
  const DRAG_SENS = 1.5;     // finger drag -> world movement multiplier

  const C = {
    skyTop: '#0b0221', skyMid: '#2a0845', skyLow: '#6a0f5c',
    sun1: '#ffd23f', sun2: '#ff2a6d',
    road: '#120622', roadStripe: '#1b0a33',
    cyan: '#05d9e8', pink: '#ff2a6d', yellow: '#f9c80e', gold: '#ffd23f',
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    hud: $('hud'), score: $('score'), coins: $('coins'),
    menu: $('menu'), paused: $('paused'), over: $('over'),
    bestMenu: $('bestMenu'), bestOver: $('bestOver'), newBest: $('newBest'),
    finalScore: $('finalScore'), finalDist: $('finalDist'), finalCoins: $('finalCoins'),
    muteBtn: $('muteBtn'), installBtn: $('installBtn'), iosHint: $('iosHint'),
    walletMenu: $('walletMenu'), walletOver: $('walletOver'), walletCity: $('walletCity'),
    earned: $('earned'), goal: $('goal'), city: $('city'), shop: $('shop'), cityCanvas: $('cityCanvas'),
  };

  // ---------- Storage (may be unavailable in private mode) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  let best = store.get('neonDash.best', 0);
  let muted = store.get('neonDash.muted', false);
  let wallet = store.get('neonDash.wallet', 0);
  let city = store.get('neonDash.city', {});      // { buildingId: level }
  let playerName = store.get('neonDash.name', '');

  // ---------- Audio ----------
  let actx = null;
  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
  }
  function tone(freq, dur, type = 'square', vol = 0.08, slideTo = 0) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur);
  }
  const sfx = {
    jump: () => tone(320, 0.18, 'square', 0.06, 640),
    coin: () => { tone(988, 0.07, 'square', 0.05); setTimeout(() => tone(1319, 0.12, 'square', 0.05), 60); },
    crash: () => { tone(200, 0.5, 'sawtooth', 0.12, 40); tone(90, 0.6, 'triangle', 0.15, 30); },
    build: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.05), i * 80)),
  };
  function updateMuteBtn() { ui.muteBtn.textContent = muted ? '🔇' : '🔊'; }
  updateMuteBtn();

  // ---------- Screen / projection ----------
  let W = 0, H = 0, s0 = 1, horizon = 0, feetY = 0, camH = 1;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    feetY = H * 0.84;
    horizon = H * 0.36;
    s0 = Math.min((W * 0.44) / ROAD, H * 0.12); // pixels per unit at the player's depth
    camH = (feetY - horizon) / s0;
  }
  window.addEventListener('resize', resize);
  resize();

  let camX = 0;
  // World (x right, y up, z forward from the player) -> screen.
  function project(x, y, z) {
    const d = z + CAM_D;
    const s = (s0 * CAM_D) / Math.max(d, 0.05);
    return { x: W / 2 + (x - camX) * s, y: horizon + (camH - y) * s, s };
  }

  // ---------- Background decoration ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.9, r: rand(0.4, 1.4), tw: rand(0, 6) }));
  const skyline = [];
  for (let x = -1.2; x < 2.2; x += rand(0.025, 0.06)) {
    skyline.push({ x, w: rand(0.02, 0.06), h: rand(0.03, 0.16), lit: Math.random() < 0.6 });
  }

  // ---------- Game state ----------
  let state = 'menu'; // menu | play | paused | dying | over
  let speed, distance, coinCount, player, targetX, objects, untilNext, shake, deathTimer, particles, jumpBuffer, time;

  function reset() {
    speed = START_SPEED;
    distance = 0;
    coinCount = 0;
    player = { x: 0, y: 0, vy: 0, lean: 0, phase: 0 };
    targetX = 0;
    camX = 0;
    objects = [];
    untilNext = 35;
    shake = 0;
    deathTimer = 0;
    particles = [];
    jumpBuffer = 0;
    time = 0;
  }
  reset();

  const score = () => Math.floor(distance) + coinCount * 10;

  // ---------- Spawning ----------
  const clampX = (x, hw) => Math.max(-ROAD + hw, Math.min(ROAD - hw, x));

  function wall(x0, x1, z, h = 2.4) {
    if (x1 - x0 < 0.2) return;
    objects.push({ kind: 'wall', x: (x0 + x1) / 2, hw: (x1 - x0) / 2, z, hd: 0.6, h });
  }
  function barrier(x0, x1, z) {
    if (x1 - x0 < 0.2) return;
    objects.push({ kind: 'barrier', x: (x0 + x1) / 2, hw: (x1 - x0) / 2, z, hd: 0.3, h: 0.9 });
  }
  function coin(x, z, y = 0.9) {
    objects.push({ kind: 'coin', x, z, y, hw: 0.35, hd: 0.35, h: 0, taken: false });
  }
  function coinLine(x, z, n, step = 2.5) {
    for (let i = 0; i < n; i++) coin(x, z + i * step);
  }

  // Each pattern spawns at z and returns how much road it occupies.
  function spawnPattern() {
    const z = SPAWN_Z;
    const diff = Math.min(1, distance / 3000); // 0 -> 1 over ~3 km
    const roll = Math.random();
    const options = [];
    options.push(['single', 3], ['gate', 3], ['jump', 2], ['half', 2]);
    if (diff > 0.1) options.push(['slalom', 2 + diff * 2]);
    if (diff > 0.25) options.push(['mover', 1 + diff * 2]);
    if (diff > 0.4) options.push(['double', 1 + diff]);
    const total = options.reduce((a, o) => a + o[1], 0);
    let pick = roll * total, type = options[0][0];
    for (const [name, w] of options) { if ((pick -= w) <= 0) { type = name; break; } }

    switch (type) {
      case 'single': {
        const w = rand(1.2, 2.2 + diff);
        const x = rand(-ROAD + w / 2, ROAD - w / 2);
        wall(x - w / 2, x + w / 2, z);
        const free = x > 0 ? (-ROAD + (x - w / 2)) / 2 : (ROAD + (x + w / 2)) / 2;
        if (Math.random() < 0.6) coinLine(free, z - 6, 4);
        return 6;
      }
      case 'gate': {
        const gap = rand(2.6, 3.2) - diff * 1.0;
        const gx = rand(-ROAD + gap / 2, ROAD - gap / 2);
        wall(-ROAD, gx - gap / 2, z);
        wall(gx + gap / 2, ROAD, z);
        coinLine(gx, z - 7.5, 4);
        return 6;
      }
      case 'jump': {
        barrier(-ROAD, ROAD, z);
        // arc of coins following the jump
        const cx = rand(-ROAD + 0.6, ROAD - 0.6);
        for (let i = -2; i <= 2; i++) coin(cx, z + i * 1.6, 0.9 + (1.4 - i * i * 0.25));
        return 8;
      }
      case 'half': {
        const left = Math.random() < 0.5;
        if (left) { barrier(-ROAD, 0, z); wall(0, ROAD, z); } else { wall(-ROAD, 0, z); barrier(0, ROAD, z); }
        coin(left ? -ROAD / 2 : ROAD / 2, z, 2.2);
        return 8;
      }
      case 'slalom': {
        const n = 3 + Math.floor(diff * 2);
        const spacing = Math.max(12, speed * 0.6);
        let side = Math.random() < 0.5 ? -1 : 1;
        const cover = 0.55 + diff * 0.1;
        for (let i = 0; i < n; i++) {
          const zz = z + i * spacing;
          if (side < 0) wall(-ROAD, -ROAD + ROAD * 2 * cover, zz);
          else wall(ROAD - ROAD * 2 * cover, ROAD, zz);
          coin(side < 0 ? ROAD - (ROAD * 2 * (1 - cover)) / 2 : -ROAD + (ROAD * 2 * (1 - cover)) / 2, zz);
          side = -side;
        }
        return (n - 1) * spacing + 8;
      }
      case 'mover': {
        const hw = rand(0.7, 1.0);
        objects.push({
          kind: 'wall', moving: true, x: 0, hw, z, hd: 0.6, h: 2.4,
          amp: ROAD - hw, freq: rand(1.2, 1.8 + diff), phase: rand(0, Math.PI * 2),
        });
        return 10;
      }
      case 'double': {
        // jump barrier then quickly a gate
        barrier(-ROAD, ROAD, z);
        const gap = 2.4 - diff * 0.6;
        const gx = rand(-ROAD + gap / 2, ROAD - gap / 2);
        const z2 = z + Math.max(10, speed * 0.55);
        wall(-ROAD, gx - gap / 2, z2);
        wall(gx + gap / 2, ROAD, z2);
        coinLine(gx, z2 - 5, 2);
        return z2 - z + 6;
      }
    }
    return 6;
  }

  // ---------- Input ----------
  const keys = new Set();
  function requestJump() {
    if (state !== 'play') return;
    jumpBuffer = 0.14; // remember the press briefly so early taps still count
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (drag && drag.id !== e.pointerId) { requestJump(); return; } // second finger = jump
    drag = { id: e.pointerId, lastX: e.clientX, sx: e.clientX, sy: e.clientY, t: performance.now(), jumped: false, moved: 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId || state !== 'play') return;
    const dx = e.clientX - drag.lastX;
    drag.lastX = e.clientX;
    drag.moved += Math.abs(dx);
    targetX = clampX(targetX + (dx / s0) * DRAG_SENS, PLAYER_HW);
    const up = drag.sy - e.clientY;
    if (!drag.jumped && up > 40 && up > Math.abs(e.clientX - drag.sx)) { requestJump(); drag.jumped = true; }
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const quick = performance.now() - drag.t < 280;
    if (!drag.jumped && quick && drag.moved < 14 && Math.abs(drag.sy - e.clientY) < 14) requestJump();
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (e) => { if (drag && drag.id === e.pointerId) drag = null; });

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (e.target instanceof HTMLInputElement || !ui.city.classList.contains('hidden')) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'a', 'd', 'w'].includes(k)) e.preventDefault();
    if (k === ' ' || k === 'ArrowUp' || k === 'w') {
      if (state === 'play') requestJump();
      else if (state === 'menu' || state === 'over') start();
      else if (state === 'paused') resume();
    }
    if (k === 'p' || k === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));

  // ---------- Flow ----------
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function start() {
    initAudio();
    reset();
    state = 'play';
    show(ui.menu, false); show(ui.over, false); show(ui.paused, false); show(ui.hud, true);
    last = performance.now();
  }
  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    drag = null;
    show(ui.paused, true);
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'play';
    show(ui.paused, false);
    last = performance.now();
  }
  function toMenu() {
    reset();
    state = 'menu';
    ui.bestMenu.textContent = best;
    ui.walletMenu.textContent = wallet;
    show(ui.paused, false); show(ui.over, false); show(ui.hud, false); show(ui.menu, true);
  }
  function crash() {
    state = 'dying';
    deathTimer = 0.9;
    shake = 0.45;
    sfx.crash();
    try { navigator.vibrate && navigator.vibrate([60, 40, 120]); } catch { /* ignore */ }
    const p = project(player.x, player.y + 1, 0);
    for (let i = 0; i < 40; i++) {
      particles.push({ x: p.x, y: p.y, vx: rand(-260, 260), vy: rand(-380, 60), life: rand(0.5, 1), c: Math.random() < 0.5 ? C.cyan : C.pink });
    }
  }
  function gameOver() {
    state = 'over';
    const s = score();
    const record = s > best;
    if (record) { best = s; store.set('neonDash.best', best); }
    ui.finalScore.textContent = s;
    ui.finalDist.textContent = Math.floor(distance);
    ui.finalCoins.textContent = coinCount;
    ui.bestOver.textContent = best;
    ui.newBest.firstChild.textContent = record ? 'NEW BEST! ' : 'Best: ';
    ui.newBest.classList.toggle('record', record);
    wallet += coinCount;
    store.set('neonDash.wallet', wallet);
    ui.earned.textContent = coinCount;
    ui.walletOver.textContent = wallet;
    ui.goal.innerHTML = goalText();
    show(ui.hud, false);
    show(ui.over, true);
  }

  // ---------- Neon City shop ----------
  const ICONS = { apartment: '🏢', house: '🏠', garage: '🚗', club: '🪩', tower: '🏙️', billboard: '📺' };
  const nextCost = (b) => b.costs[city[b.id] || 0]; // undefined when maxed

  function goalText() {
    const open = NeonCity.BUILDINGS.filter((b) => nextCost(b) !== undefined);
    if (!open.length) return 'Your city is complete. Legend! 🏆';
    const affordable = open.filter((b) => nextCost(b) <= wallet);
    if (affordable.length) {
      const b = affordable.reduce((a, c) => (nextCost(c) > nextCost(a) ? c : a));
      return `You can ${city[b.id] ? 'upgrade' : 'build'} <b>${b.name}</b> now! Visit Neon City 🏙️`;
    }
    const b = open.reduce((a, c) => (nextCost(c) < nextCost(a) ? c : a));
    return `Next: <b>${b.name}</b>, ${nextCost(b) - wallet} more coins`;
  }

  function renderShop() {
    ui.walletCity.textContent = wallet;
    ui.shop.innerHTML = '';
    for (const b of NeonCity.BUILDINGS) {
      const lv = city[b.id] || 0, max = b.costs.length, cost = nextCost(b);
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = b.id;
      const desc = cost === undefined ? b.levels[max - 1] : b.levels[lv];
      card.innerHTML = `
        <div class="icon">${ICONS[b.id]}</div>
        <div class="info">
          <div class="name">${b.name}<span class="lvl">${lv ? `LV ${lv}/${max}` : 'NOT BUILT'}</span></div>
          <div class="desc">${cost === undefined ? 'Fully upgraded ✓' : (lv ? 'Next: ' : '') + desc}</div>
        </div>`;
      if (b.id === 'billboard') {
        const input = document.createElement('input');
        input.maxLength = 12;
        input.placeholder = 'Your name';
        input.value = playerName;
        input.addEventListener('input', () => { playerName = input.value.trim(); store.set('neonDash.name', playerName); });
        card.querySelector('.info').appendChild(input);
      }
      const btn = document.createElement('button');
      if (cost === undefined) { btn.textContent = 'MAX'; btn.className = 'max'; btn.disabled = true; }
      else {
        btn.textContent = `${lv ? 'Upgrade' : 'Build'} 🪙${cost}`;
        btn.disabled = cost > wallet;
        btn.addEventListener('click', () => buy(b));
      }
      card.appendChild(btn);
      ui.shop.appendChild(card);
    }
  }

  function buy(b) {
    const cost = nextCost(b);
    if (cost === undefined || cost > wallet) return;
    initAudio();
    wallet -= cost;
    city[b.id] = (city[b.id] || 0) + 1;
    store.set('neonDash.wallet', wallet);
    store.set('neonDash.city', city);
    sfx.build();
    try { navigator.vibrate && navigator.vibrate(40); } catch { /* ignore */ }
    renderShop();
    ui.shop.querySelector(`[data-id="${b.id}"]`).classList.add('bought');
  }

  let cityFrom = 'menu';
  function openCity(from) {
    cityFrom = from;
    renderShop();
    show(ui.menu, false); show(ui.over, false); show(ui.city, true);
    sizeCityCanvas();
  }
  function closeCity() {
    show(ui.city, false);
    if (cityFrom === 'over') { ui.walletOver.textContent = wallet; ui.goal.innerHTML = goalText(); show(ui.over, true); }
    else toMenu();
  }

  const cctx = ui.cityCanvas.getContext('2d');
  let CW = 0, CH = 0;
  function sizeCityCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    CW = ui.cityCanvas.clientWidth; CH = ui.cityCanvas.clientHeight;
    ui.cityCanvas.width = Math.round(CW * dpr); ui.cityCanvas.height = Math.round(CH * dpr);
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => { if (!ui.city.classList.contains('hidden')) sizeCityCanvas(); });

  function renderCityPreview() {
    const base = CH * 0.86;
    const g = cctx.createLinearGradient(0, 0, 0, base);
    g.addColorStop(0, C.skyTop); g.addColorStop(0.65, C.skyMid); g.addColorStop(1, C.skyLow);
    cctx.fillStyle = g; cctx.fillRect(0, 0, CW, base);
    for (const s of stars) { cctx.globalAlpha = 0.3 + 0.3 * Math.sin(time * 2 + s.tw); cctx.fillStyle = '#fff'; cctx.fillRect(s.x * CW, s.y * base * 0.7, s.r, s.r); }
    cctx.globalAlpha = 1;
    const r = Math.min(CW, CH) * 0.3;
    const sg = cctx.createLinearGradient(0, base - r, 0, base);
    sg.addColorStop(0, C.sun1); sg.addColorStop(1, C.sun2);
    cctx.save(); cctx.beginPath(); cctx.rect(0, 0, CW, base); cctx.clip();
    cctx.fillStyle = sg; cctx.beginPath(); cctx.arc(CW / 2, base, r, 0, Math.PI * 2); cctx.fill();
    cctx.restore();
    cctx.fillStyle = '#2a0845'; cctx.fillRect(0, base, CW, CH - base);
    cctx.fillStyle = C.pink; cctx.fillRect(0, base - 1, CW, 2);
    const u = Math.min(CW / 108, (base - 8) / 70);
    NeonCity.drawCity(cctx, city, CW / 2, base, u, time, { ghosts: true, name: playerName });
  }

  $('cityBtn').addEventListener('click', () => openCity('menu'));
  $('cityBtn2').addEventListener('click', () => openCity('over'));
  $('cityBack').addEventListener('click', closeCity);

  $('playBtn').addEventListener('click', start);
  $('againBtn').addEventListener('click', start);
  $('menuBtn').addEventListener('click', toMenu);
  $('quitBtn').addEventListener('click', toMenu);
  $('pauseBtn').addEventListener('click', pause);
  $('resumeBtn').addEventListener('click', resume);
  ui.muteBtn.addEventListener('click', () => { muted = !muted; store.set('neonDash.muted', muted); updateMuteBtn(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  ui.bestMenu.textContent = best;
  ui.walletMenu.textContent = wallet;

  // Install prompt (Android/Chrome) and iOS hint
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    show(ui.installBtn, true);
  });
  ui.installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { /* ignore */ }
    deferredPrompt = null;
    show(ui.installBtn, false);
  });
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) show(ui.iosHint, true);

  // ---------- Update ----------
  function update(dt) {
    time += dt;

    if (state === 'dying') {
      deathTimer -= dt;
      if (deathTimer <= 0) gameOver();
    }
    if (shake > 0) shake = Math.max(0, shake - dt);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);

    if (state !== 'play') return;

    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);

    // steering
    if (keys.has('ArrowLeft') || keys.has('a')) targetX -= KEY_STEER * dt;
    if (keys.has('ArrowRight') || keys.has('d')) targetX += KEY_STEER * dt;
    targetX = clampX(targetX, PLAYER_HW);
    const prevX = player.x;
    player.x += (targetX - player.x) * Math.min(1, dt * 14);
    const vx = (player.x - prevX) / Math.max(dt, 1e-4);
    player.lean += (Math.max(-1, Math.min(1, vx / 12)) - player.lean) * Math.min(1, dt * 10);
    camX = player.x * 0.55;

    // jumping
    if (jumpBuffer > 0) {
      jumpBuffer -= dt;
      if (player.y <= 0) { player.vy = JUMP_V; jumpBuffer = 0; sfx.jump(); }
    }
    if (player.y > 0 || player.vy > 0) {
      player.vy -= GRAVITY * dt;
      player.y = Math.max(0, player.y + player.vy * dt);
      if (player.y === 0) player.vy = 0;
    }
    player.phase += dt * speed * 0.55;

    // spawning
    untilNext -= speed * dt;
    if (untilNext <= 0) {
      const used = spawnPattern();
      const diff = Math.min(1, distance / 3000);
      untilNext = used + rand(16, 26) - diff * 6;
    }

    // move world in small sub-steps so fast objects can't skip past the player
    const move = speed * dt;
    const steps = Math.max(1, Math.ceil(move / 0.35));
    const stepMove = move / steps;
    for (let s = 0; s < steps && state === 'play'; s++) {
      distance += stepMove;
      for (const o of objects) {
        o.z -= stepMove;
        if (o.moving) o.x = Math.sin(time * o.freq + o.phase) * o.amp;
        if (Math.abs(o.z) > o.hd + PLAYER_HD) continue;
        if (o.kind === 'coin') {
          if (!o.taken && Math.abs(o.x - player.x) < 0.75 && Math.abs(o.y - (player.y + 0.9)) < 1.1) {
            o.taken = true;
            coinCount++;
            sfx.coin();
          }
        } else if (Math.abs(o.x - player.x) < o.hw + PLAYER_HW && player.y < o.h) {
          crash();
          break;
        }
      }
    }
    objects = objects.filter((o) => o.z > -CAM_D + 0.6 && !(o.kind === 'coin' && o.taken));

    ui.score.textContent = score();
    ui.coins.textContent = coinCount;
  }

  // ---------- Render ----------
  function poly(pts, fill, stroke, lw = 1) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  function line(a, b, color, w) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, C.skyTop); g.addColorStop(0.6, C.skyMid); g.addColorStop(1, C.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 1);

    for (const s of stars) {
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(time * 2 + s.tw);
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x * W, s.y * horizon * 0.8, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // sun with stripes
    const sx = W / 2 - camX * 6, r = Math.min(W, H) * 0.22, sy = horizon - r * 0.15;
    const sg = ctx.createLinearGradient(0, sy - r, 0, sy + r);
    sg.addColorStop(0, C.sun1); sg.addColorStop(0.7, C.sun2);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, horizon); ctx.clip();
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.skyLow;
    for (let i = 0; i < 6; i++) {
      const y = sy + r * (-0.05 + i * 0.17);
      ctx.fillRect(sx - r, y, r * 2, 1.5 + i * 1.6);
    }
    ctx.restore();

    // skyline silhouette with parallax
    const base = horizon + 1;
    const off = -camX * 14;
    for (const b of skyline) {
      const x = W / 2 + (b.x - 0.5) * W + off, w = b.w * W, h = b.h * H * 0.6;
      if (x + w < 0 || x > W) continue;
      ctx.fillStyle = '#16052e';
      ctx.fillRect(x, base - h, w, h);
      if (b.lit) { ctx.fillStyle = 'rgba(5,217,232,.2)'; ctx.fillRect(x + w * 0.3, base - h + 3, w * 0.12, h - 6); }
    }

    // the player's own Neon City, a little closer (more parallax)
    const u = Math.min(W, H * 0.6) / 110;
    NeonCity.drawCity(ctx, city, W / 2 - camX * 22, base, u, time, { name: playerName });
  }

  function drawGround() {
    // ground below horizon
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, '#2a0845'); g.addColorStop(1, '#0b0221');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon);

    const zFar = 200, zNear = -CAM_D + 0.3;
    // synthwave grid outside the road
    ctx.globalAlpha = 0.35;
    const off = distance % 6;
    for (let z = 6 - off; z < zFar; z += 6) {
      const a = project(-60, 0, z), b = project(60, 0, z);
      line(a, b, C.pink, Math.max(0.5, a.s * 0.02));
    }
    for (let x = ROAD + 2; x < 40; x += 2.5) {
      line(project(x, 0, zNear), project(x, 0, zFar), C.pink, 1);
      line(project(-x, 0, zNear), project(-x, 0, zFar), C.pink, 1);
    }
    ctx.globalAlpha = 1;

    // road surface with moving stripes
    poly([project(-ROAD, 0, zNear), project(ROAD, 0, zNear), project(ROAD, 0, zFar), project(-ROAD, 0, zFar)], C.road);
    const so = distance % 8;
    for (let z = -so; z < zFar; z += 8) {
      if (z + 4 < zNear) continue;
      poly([project(-ROAD, 0, Math.max(z, zNear)), project(ROAD, 0, Math.max(z, zNear)),
        project(ROAD, 0, z + 4), project(-ROAD, 0, z + 4)], C.roadStripe);
    }
    // centre dashes
    for (let z = -so; z < 120; z += 8) {
      if (z + 3 < zNear) continue;
      for (const lx of [-ROAD / 3, ROAD / 3]) {
        const a = project(lx - 0.05, 0, Math.max(z, zNear)), b = project(lx + 0.05, 0, Math.max(z, zNear));
        const c = project(lx + 0.05, 0, z + 3), d = project(lx - 0.05, 0, z + 3);
        poly([a, b, c, d], 'rgba(5,217,232,.35)');
      }
    }
    // neon edges
    for (const ex of [-ROAD, ROAD]) {
      const a = project(ex, 0, zNear), b = project(ex, 0, zFar);
      ctx.globalAlpha = 0.3; line(a, b, C.cyan, 10);
      ctx.globalAlpha = 1; line(a, b, C.cyan, 3);
    }
    // horizon glow
    ctx.fillStyle = C.pink;
    ctx.fillRect(0, horizon - 1, W, 2);
  }

  function drawBox(o) {
    const zf = o.z - o.hd, zb = o.z + o.hd;
    if (zb < -CAM_D + 0.3) return;
    const x0 = o.x - o.hw, x1 = o.x + o.hw;
    const zfc = Math.max(zf, -CAM_D + 0.3);
    const fbl = project(x0, 0, zfc), fbr = project(x1, 0, zfc);
    const ftl = project(x0, o.h, zfc), ftr = project(x1, o.h, zfc);
    const btl = project(x0, o.h, zb), btr = project(x1, o.h, zb);
    const bbl = project(x0, 0, zb), bbr = project(x1, 0, zb);
    const isWall = o.kind === 'wall';
    const edge = isWall ? (o.moving ? C.yellow : C.pink) : C.yellow;
    const fade = Math.min(1, Math.max(0, (SPAWN_Z + 10 - o.z) / 25)); // fade in at distance
    ctx.globalAlpha = fade;

    if (x1 < camX) poly([fbr, ftr, btr, bbr], isWall ? '#2b0f55' : '#3a2a05');
    if (x0 > camX) poly([fbl, ftl, btl, bbl], isWall ? '#2b0f55' : '#3a2a05');
    poly([ftl, ftr, btr, btl], isWall ? '#3d1670' : '#5a4208', edge, Math.max(1, fbl.s * 0.03));

    // front face
    poly([fbl, fbr, ftr, ftl], isWall ? '#1d0a3d' : '#2a1c00');
    if (isWall) {
      // window grid on the front
      ctx.fillStyle = o.moving ? 'rgba(249,200,14,.25)' : 'rgba(255,42,109,.22)';
      const cols = Math.max(1, Math.round(o.hw * 2 / 0.7)), rows = 3;
      const fw = fbr.x - fbl.x, fh = fbl.y - ftl.y;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillRect(fbl.x + fw * (c + 0.2) / cols, ftl.y + fh * (r + 0.2) / rows, fw * 0.6 / cols, fh * 0.5 / rows);
        }
      }
    } else {
      // hazard stripes
      ctx.save();
      ctx.beginPath(); ctx.rect(fbl.x, ftl.y, fbr.x - fbl.x, fbl.y - ftl.y); ctx.clip();
      ctx.fillStyle = C.yellow;
      const h = fbl.y - ftl.y, step = h * 1.6;
      for (let x = fbl.x - h; x < fbr.x + h; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, fbl.y); ctx.lineTo(x + step / 2, fbl.y); ctx.lineTo(x + step / 2 + h, ftl.y); ctx.lineTo(x + h, ftl.y);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    poly([fbl, fbr, ftr, ftl], null, edge, Math.max(1.5, fbl.s * 0.05));
    ctx.globalAlpha = 1;
  }

  function drawCoin(o) {
    if (o.z < -CAM_D + 0.5) return;
    const p = project(o.x, o.y + Math.sin(time * 4 + o.z) * 0.08, o.z);
    const r = 0.3 * p.s;
    if (r < 0.6) return;
    const spin = Math.abs(Math.cos(time * 5 + o.z * 0.3));
    ctx.globalAlpha = Math.min(1, Math.max(0, (SPAWN_Z + 10 - o.z) / 25));
    ctx.fillStyle = 'rgba(255,210,63,.25)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.6 * Math.max(spin, 0.3), r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * Math.max(spin, 0.15), r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff5c2';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 0.45 * Math.max(spin, 0.15), r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const base = project(player.x, 0, 0);
    const p = project(player.x, player.y, 0);
    const s = p.s;
    // shadow
    const sh = Math.max(0.3, 1 - player.y * 0.25);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.ellipse(base.x, base.y, 0.42 * s * sh, 0.12 * s * sh, 0, 0, Math.PI * 2); ctx.fill();

    if (state === 'dying' || state === 'over') return; // runner "explodes" into particles

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(player.lean * 0.18);
    ctx.lineCap = 'round';
    const air = player.y > 0.01;
    const run = air ? 0 : Math.sin(player.phase);
    const hipY = -0.85 * s;

    // legs (from behind: the leg pushing off is down, the swinging one is lifted)
    const legs = [[-0.13, air ? 0.25 : Math.max(0, run) * 0.32], [0.13, air ? 0.12 : Math.max(0, -run) * 0.32]];
    for (const [lx, lift] of legs) {
      const fx = lx * s, fy = -lift * s;
      line({ x: lx * s * 0.8, y: hipY }, { x: fx, y: fy - 0.06 * s }, '#1b1035', 0.17 * s);
      ctx.fillStyle = C.yellow;
      ctx.fillRect(fx - 0.09 * s, fy - 0.1 * s, 0.18 * s, 0.1 * s);
    }
    // arms
    const swing = air ? -0.25 : run * 0.18;
    line({ x: -0.3 * s, y: -1.38 * s }, { x: -0.36 * s, y: (-0.95 + swing) * s }, '#04a8b4', 0.13 * s);
    line({ x: 0.3 * s, y: -1.38 * s }, { x: 0.36 * s, y: (-0.95 - swing) * s }, '#04a8b4', 0.13 * s);
    // torso
    ctx.fillStyle = C.cyan;
    roundRect(-0.3 * s, -1.48 * s, 0.6 * s, 0.68 * s, 0.12 * s);
    ctx.fill();
    ctx.fillStyle = C.pink;
    ctx.fillRect(-0.3 * s, -1.2 * s, 0.6 * s, 0.07 * s);
    // head
    ctx.fillStyle = '#1b1035';
    ctx.beginPath(); ctx.arc(0, -1.66 * s, 0.17 * s, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 22, rand(-1, 1) * shake * 22);
    drawSky();
    drawGround();

    // far to near; the player sits at z = 0
    const sorted = objects.slice().sort((a, b) => b.z - a.z);
    let playerDrawn = false;
    for (const o of sorted) {
      if (!playerDrawn && o.z < 0) { drawPlayer(); playerDrawn = true; }
      if (o.kind === 'coin') drawCoin(o); else drawBox(o);
    }
    if (!playerDrawn) drawPlayer();

    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 1.5));
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (state === 'dying') {
      ctx.fillStyle = `rgba(255,42,109,${Math.max(0, deathTimer - 0.5) * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'menu') {
      // gentle attract-mode scroll behind the menu
      distance += 8 * dt;
      time += dt;
      camX = Math.sin(time * 0.5) * 0.6;
    } else if (state !== 'paused') {
      update(dt);
    }
    render();
    if (!ui.city.classList.contains('hidden')) renderCityPreview();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
