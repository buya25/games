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
  const TRAIL_Z = -2.4;      // how far behind the runner trails reach (toward the camera)
  const POWER_CHANCE = 0.3;  // chance of a power-up in the gap after each obstacle pattern
  const CONTINUE_TIME = 5;   // seconds to decide on a continue
  const CONTINUE_BASE = 25;  // first continue costs this, then doubles each time in the same run

  // Power-ups: duration = base + per * upgrade level. costs[i] buys level i + 1.
  const POWERS = {
    magnet: { name: 'Coin Magnet', icon: '🧲', color: '#ff2a6d', base: 8, per: 2, desc: 'Pulls in every coin nearby' },
    shield: { name: 'Shield', icon: '🛡️', color: '#05d9e8', base: 10, per: 3, desc: 'Survive one crash' },
    double: { name: 'Double Coins', icon: '×2', color: '#ffd23f', base: 10, per: 3, desc: 'Every coin counts twice' },
  };
  const POWER_COSTS = [200, 500, 1000, 2000];

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
    cont: $('cont'), contTime: $('contTime'), contCost: $('contCost'), contWallet: $('contWallet'), contRing: $('contRing'),
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
  const owned = Object.assign({ outfits: ['classic'], trails: ['none'] }, store.get('neonDash.owned', {}));
  const look = Object.assign({ outfit: 'classic', trail: 'none', skin: 2 }, store.get('neonDash.look', {}));
  const boosts = Object.assign({ magnet: 0, shield: 0, double: 0 }, store.get('neonDash.boosts', {}));
  const powerTime = (id) => POWERS[id].base + POWERS[id].per * boosts[id];

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
    power: () => { tone(440, 0.25, 'triangle', 0.08, 1760); setTimeout(() => tone(880, 0.2, 'square', 0.04, 1320), 120); },
    shieldBreak: () => { tone(1200, 0.25, 'sawtooth', 0.06, 200); tone(300, 0.3, 'triangle', 0.1, 80); },
    thud: () => { tone(110, 0.18, 'triangle', 0.18, 50); tone(70, 0.25, 'sine', 0.15, 40); },
    revive: () => [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.07), i * 60)),
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
  let speed, distance, coinCount, player, targetX, objects, untilNext, shake, deathTimer, particles, jumpBuffer, time, trail;
  let power, powerMax, invuln, continues, contTimer, fall;

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
    trail = NeonLooks.createTrail();
    power = { magnet: 0, shield: 0, double: 0 };
    powerMax = { magnet: 1, shield: 1, double: 1 };
    invuln = 0;
    continues = 0;
    contTimer = 0;
    fall = null;
    jumpBuffer = 0;
    time = 0;
  }
  reset();

  const score = () => Math.floor(distance) + coinCount * 10;
  const cadence = (v) => Math.PI * 2 * (1.3 + v * 0.025); // stride phase per second

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
    store.set('neonDash.wallet', wallet);
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
  // Stumble and fall: walls knock the runner back, barriers trip them forward.
  // Either way they topple sideways (away from the obstacle) and slide to a stop.
  function crash(o) {
    state = 'dying';
    store.set('neonDash.wallet', wallet);
    deathTimer = 1.7;
    shake = 0.35;
    sfx.crash();
    try { navigator.vibrate && navigator.vibrate([60, 40, 120]); } catch { /* ignore */ }
    const trip = o && o.kind === 'barrier';
    const off = o ? player.x - o.x : 0;
    let dir = Math.abs(off) > 0.15 ? Math.sign(off) : (Math.random() < 0.5 ? -1 : 1);
    // the body ends up ~1.8 units to the side: fall toward whichever side has room
    if (Math.abs(player.x + dir * 1.8) > ROAD - 0.2) dir = -dir;
    if (o) o.hit = true; // fade the obstacle so the fall stays visible
    fall = {
      t: 0, grounded: false, dir,
      x: player.x, y: player.y, z: 0,
      vx: dir * (trip ? 1.2 : 2), vy: trip ? 3.5 : 3, vz: trip ? Math.min(4, speed * 0.15) : -2.2,
      roll: player.lean * 0.16, vroll: dir * (trip ? 5.5 : 4),
    };
    const p = project(player.x, player.y + 1.2, 0.4);
    for (let i = 0; i < 16; i++) {
      particles.push({ x: p.x, y: p.y, vx: rand(-220, 220), vy: rand(-300, 40), life: rand(0.3, 0.6), c: Math.random() < 0.5 ? '#ffffff' : C.yellow });
    }
  }

  function updateFall(dt) {
    if (!fall) return;
    const f = fall;
    f.t += dt;
    f.x += f.vx * dt;
    f.z += f.vz * dt;
    // stay in view: feet and head both on the road
    const lo = -ROAD + 0.3 + (f.dir < 0 ? 1.6 : 0), hi = ROAD - 0.3 - (f.dir > 0 ? 1.6 : 0);
    f.x = Math.max(lo, Math.min(hi, f.x));
    f.z = Math.max(-0.4, Math.min(2.5, f.z));
    camX += ((f.x + f.dir * 0.9) * 0.55 - camX) * Math.min(1, dt * 3); // ease the camera onto the body
    if (!f.grounded) {
      f.vy -= GRAVITY * dt;
      f.y += f.vy * dt;
      f.roll += f.vroll * dt;
      if (f.y <= 0 && f.vy < 0) {
        f.y = 0;
        f.grounded = true;
        f.vy = 0;
        shake = Math.max(shake, 0.25);
        sfx.thud();
        try { navigator.vibrate && navigator.vibrate(50); } catch { /* ignore */ }
        const p = project(f.x, 0, f.z);
        for (let i = 0; i < 12; i++) {
          particles.push({ x: p.x + rand(-20, 20), y: p.y, vx: rand(-120, 120), vy: rand(-120, -20), life: rand(0.3, 0.6), c: 'rgba(200,180,255,.6)' });
        }
      }
    } else {
      // small hop after the first impact, then friction until it stops
      const k = Math.pow(0.02, dt);
      f.vx *= k; f.vz *= k;
    }
    // settle lying on the side the runner is falling toward
    if (f.grounded || Math.abs(f.roll) > Math.PI / 2) {
      const target = f.dir * Math.PI / 2;
      f.roll += (target - f.roll) * Math.min(1, dt * 12);
      f.vroll = 0;
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
    store.set('neonDash.wallet', wallet); // coins were banked as they were picked up
    ui.earned.textContent = coinCount;
    ui.walletOver.textContent = wallet;
    ui.goal.innerHTML = goalText();
    show(ui.hud, false);
    show(ui.over, true);
  }

  const continueCost = () => CONTINUE_BASE * 2 ** continues;

  function offerContinue() {
    if (wallet < continueCost()) { gameOver(); return; }
    state = 'continue';
    contTimer = CONTINUE_TIME;
    ui.contCost.textContent = continueCost();
    ui.contWallet.textContent = wallet;
    show(ui.cont, true);
  }

  function continueRun() {
    if (state !== 'continue' || wallet < continueCost()) return;
    initAudio();
    wallet -= continueCost();
    continues++;
    store.set('neonDash.wallet', wallet);
    // clear the road ahead so the runner doesn't respawn into a wall
    objects = objects.filter((o) => o.kind === 'coin' || o.kind === 'power' || o.z > 30);
    invuln = 2.5;
    jumpBuffer = 0;
    fall = null;
    player.y = 0;
    player.vy = 0;
    particles = [];
    state = 'play';
    show(ui.cont, false);
    sfx.revive();
    last = performance.now();
  }

  function declineContinue() {
    if (state !== 'continue') return;
    show(ui.cont, false);
    gameOver();
  }

  // ---------- Neon City shop ----------
  const ICONS = { apartment: '🏢', house: '🏠', garage: '🚗', club: '🪩', tower: '🏙️', billboard: '📺' };
  const nextCost = (b) => b.costs[city[b.id] || 0]; // undefined when maxed

  // Everything still for sale, so the game-over screen can always dangle the next goal.
  function shopGoals() {
    const goals = [];
    for (const b of NeonCity.BUILDINGS) {
      const c = nextCost(b);
      if (c !== undefined) goals.push({ name: b.name, cost: c, verb: city[b.id] ? 'upgrade' : 'build' });
    }
    for (const o of NeonLooks.OUTFITS) if (!owned.outfits.includes(o.id)) goals.push({ name: `${o.name} outfit`, cost: o.cost, verb: 'buy' });
    for (const t of NeonLooks.TRAILS) if (!owned.trails.includes(t.id)) goals.push({ name: `${t.name} trail`, cost: t.cost, verb: 'buy' });
    for (const id in POWERS) if (boosts[id] < POWER_COSTS.length) goals.push({ name: POWERS[id].name, cost: POWER_COSTS[boosts[id]], verb: 'upgrade' });
    return goals;
  }

  function goalText() {
    const open = shopGoals();
    if (!open.length) return 'You own everything. Legend! 🏆';
    const affordable = open.filter((g) => g.cost <= wallet);
    if (affordable.length) {
      const g = affordable.reduce((a, c) => (c.cost > a.cost ? c : a));
      return `You can ${g.verb} <b>${g.name}</b> now! Visit the Shop 🛍️`;
    }
    const g = open.reduce((a, c) => (c.cost < a.cost ? c : a));
    return `Next: <b>${g.name}</b>, ${g.cost - wallet} more coins`;
  }

  let shopTab = 'city';
  const TAB_INFO = {
    city: ['NEON CITY', 'Your city glows on the horizon while you run.'],
    outfits: ['OUTFITS', 'Tap Equip to wear an outfit you own.'],
    trails: ['TRAILS', 'Your trail streams behind you while you run.'],
    boosts: ['POWER-UPS', 'Grab power-ups on the road. Upgrades make them last longer.'],
  };

  function renderShop() {
    ui.walletCity.textContent = wallet;
    ui.shop.innerHTML = '';
    $('cityTitle').textContent = TAB_INFO[shopTab][0];
    $('cityTip').textContent = TAB_INFO[shopTab][1];
    for (const tb of document.querySelectorAll('#tabs button')) tb.classList.toggle('active', tb.dataset.tab === shopTab);
    if (shopTab === 'city') renderCityCards();
    else if (shopTab === 'boosts') renderBoostCards();
    else renderLookCards(shopTab);
  }

  function makeOutfitIcon(o) {
    const c = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = 44 * dpr; c.height = 56 * dpr;
    c.style.width = '44px'; c.style.height = '56px';
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    NeonLooks.drawRunner(x, 22, 54, 26, { phase: 0.5 }, o, 0, look.skin);
    return c;
  }

  function renderSkinPicker() {
    const card = document.createElement('div');
    card.className = 'card skin-card';
    card.innerHTML = '<div class="info"><div class="name">Skin tone</div><div class="swatches"></div></div>';
    const row = card.querySelector('.swatches');
    NeonLooks.SKINS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (look.skin === i ? ' on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', `Skin tone ${i + 1}`);
      b.addEventListener('click', () => { look.skin = i; store.set('neonDash.look', look); renderShop(); });
      row.appendChild(b);
    });
    ui.shop.appendChild(card);
  }

  function renderLookCards(kind) {
    if (kind === 'outfits') renderSkinPicker();
    const list = kind === 'outfits' ? NeonLooks.OUTFITS : NeonLooks.TRAILS;
    const key = kind === 'outfits' ? 'outfit' : 'trail';
    for (const item of list) {
      const have = owned[kind].includes(item.id), equipped = look[key] === item.id;
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = item.id;
      card.innerHTML = `
        <div class="icon"></div>
        <div class="info">
          <div class="name">${item.name}${equipped ? '<span class="lvl">WEARING</span>' : ''}</div>
          <div class="desc">${item.desc}</div>
        </div>`;
      const icon = card.querySelector('.icon');
      if (kind === 'outfits') icon.appendChild(makeOutfitIcon(item)); else icon.textContent = item.icon;
      const btn = document.createElement('button');
      if (equipped) { btn.textContent = 'Equipped ✓'; btn.className = 'max'; btn.disabled = true; }
      else if (have) {
        btn.textContent = 'Equip';
        btn.className = 'equip';
        btn.addEventListener('click', () => { look[key] = item.id; store.set('neonDash.look', look); renderShop(); });
      } else {
        btn.textContent = `Buy 🪙${item.cost}`;
        btn.disabled = item.cost > wallet;
        btn.addEventListener('click', () => buyLook(kind, key, item));
      }
      card.appendChild(btn);
      ui.shop.appendChild(card);
    }
  }

  function buyLook(kind, key, item) {
    if (owned[kind].includes(item.id) || item.cost > wallet) return;
    initAudio();
    wallet -= item.cost;
    owned[kind].push(item.id);
    look[key] = item.id; // wear it straight away
    store.set('neonDash.wallet', wallet);
    store.set('neonDash.owned', owned);
    store.set('neonDash.look', look);
    sfx.build();
    try { navigator.vibrate && navigator.vibrate(40); } catch { /* ignore */ }
    renderShop();
    ui.shop.querySelector(`[data-id="${item.id}"]`).classList.add('bought');
  }

  function renderBoostCards() {
    for (const id in POWERS) {
      const P = POWERS[id], lv = boosts[id], max = POWER_COSTS.length, cost = POWER_COSTS[lv];
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = id;
      card.innerHTML = `
        <div class="icon power-icon" style="color:${P.color};border-color:${P.color}">${P.icon}</div>
        <div class="info">
          <div class="name">${P.name}<span class="lvl">LV ${lv}/${max}</span></div>
          <div class="desc">${P.desc}. Lasts ${powerTime(id)}s${cost === undefined ? '' : ` → ${powerTime(id) + P.per}s`}</div>
        </div>`;
      const btn = document.createElement('button');
      if (cost === undefined) { btn.textContent = 'MAX'; btn.className = 'max'; btn.disabled = true; }
      else {
        btn.textContent = `Upgrade 🪙${cost}`;
        btn.disabled = cost > wallet;
        btn.addEventListener('click', () => {
          if (boosts[id] >= max || cost > wallet) return;
          initAudio();
          wallet -= cost;
          boosts[id]++;
          store.set('neonDash.wallet', wallet);
          store.set('neonDash.boosts', boosts);
          sfx.build();
          renderShop();
          ui.shop.querySelector(`[data-id="${id}"]`).classList.add('bought');
        });
      }
      card.appendChild(btn);
      ui.shop.appendChild(card);
    }
  }

  function renderCityCards() {
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

  function renderShopPreview(dt) {
    if (shopTab === 'city') renderCityPreview(); else renderRunnerPreview(dt);
  }

  // A little runner jogging on its own road, wearing the current outfit and trail.
  const pv = { x: 0, y: 0, vy: 0, lean: 0, phase: 0, d: 0, jumpIn: 1.2, trail: NeonLooks.createTrail() };
  function renderRunnerPreview(dt) {
    const sp = 15;
    pv.d += sp * dt;
    pv.phase += dt * cadence(sp);
    const target = Math.sin(time * 1.1) * 1.4;
    const px = pv.x;
    pv.x += (target - pv.x) * Math.min(1, dt * 6);
    pv.lean += (Math.max(-1, Math.min(1, (pv.x - px) / Math.max(dt, 1e-4) / 12)) - pv.lean) * Math.min(1, dt * 10);
    pv.jumpIn -= dt;
    if (pv.jumpIn <= 0 && pv.y === 0) { pv.vy = JUMP_V; pv.jumpIn = 2.2; }
    if (pv.y > 0 || pv.vy > 0) { pv.vy -= GRAVITY * dt; pv.y = Math.max(0, pv.y + pv.vy * dt); if (pv.y === 0) pv.vy = 0; }
    NeonLooks.updateTrail(pv.trail, look.trail, pv, pv.d, sp, dt, TRAIL_Z);

    const hz = CH * 0.22, feet = CH * 0.8;
    const sc = Math.min(CH * 0.2, (CW * 0.42) / ROAD), ch = (feet - hz) / sc, cx = pv.x * 0.5;
    const proj = (x, y, z) => {
      const s = (sc * CAM_D) / Math.max(z + CAM_D, 0.05);
      return { x: CW / 2 + (x - cx) * s, y: hz + (ch - y) * s, s };
    };
    const g = cctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, C.skyTop); g.addColorStop(1, C.skyLow);
    cctx.fillStyle = g; cctx.fillRect(0, 0, CW, hz);
    cctx.fillStyle = '#1a0533'; cctx.fillRect(0, hz, CW, CH - hz);
    const zN = -CAM_D + 0.3, zF = 150;
    const quad = (z0, z1, color) => {
      const a = proj(-ROAD, 0, z0), b = proj(ROAD, 0, z0), c = proj(ROAD, 0, z1), d = proj(-ROAD, 0, z1);
      cctx.beginPath(); cctx.moveTo(a.x, a.y); cctx.lineTo(b.x, b.y); cctx.lineTo(c.x, c.y); cctx.lineTo(d.x, d.y);
      cctx.fillStyle = color; cctx.fill();
    };
    quad(zN, zF, C.road);
    const so = pv.d % 8;
    for (let z = -so; z < zF; z += 8) if (z + 4 > zN) quad(Math.max(z, zN), z + 4, C.roadStripe);
    for (const ex of [-ROAD, ROAD]) {
      const a = proj(ex, 0, zN), b = proj(ex, 0, zF);
      cctx.beginPath(); cctx.moveTo(a.x, a.y); cctx.lineTo(b.x, b.y);
      cctx.strokeStyle = C.cyan; cctx.lineWidth = 3; cctx.stroke();
    }
    cctx.fillStyle = C.pink; cctx.fillRect(0, hz - 1, CW, 2);

    const base = proj(pv.x, 0, 0), p = proj(pv.x, pv.y, 0);
    const sh = Math.max(0.3, 1 - pv.y * 0.25);
    cctx.fillStyle = 'rgba(0,0,0,.5)';
    cctx.beginPath(); cctx.ellipse(base.x, base.y, 0.42 * p.s * sh, 0.12 * p.s * sh, 0, 0, Math.PI * 2); cctx.fill();
    NeonLooks.drawTrail(cctx, proj, pv.trail, look.trail, pv.d, time, TRAIL_Z);
    NeonLooks.drawRunner(cctx, p.x, p.y, p.s, { lean: pv.lean, phase: pv.phase, air: pv.y > 0.01 },
      NeonLooks.byId(NeonLooks.OUTFITS, look.outfit), time, look.skin);
  }

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
  $('contBtn').addEventListener('click', continueRun);
  $('contSkip').addEventListener('click', declineContinue);
  for (const tb of document.querySelectorAll('#tabs button')) {
    tb.addEventListener('click', () => { shopTab = tb.dataset.tab; renderShop(); ui.shop.scrollTop = 0; });
  }

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

    if (state === 'dying' || state === 'continue' || state === 'over') updateFall(dt);
    if (state === 'dying') {
      deathTimer -= dt;
      if (deathTimer <= 0) offerContinue();
    }
    if (state === 'continue') {
      contTimer -= dt;
      ui.contTime.textContent = Math.max(0, Math.ceil(contTimer));
      ui.contRing.style.setProperty('--p', Math.max(0, contTimer / CONTINUE_TIME));
      if (contTimer <= 0) declineContinue();
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
    player.phase += dt * cadence(speed);

    // power-up timers
    for (const id in power) if (power[id] > 0) power[id] = Math.max(0, power[id] - dt);
    if (invuln > 0) invuln = Math.max(0, invuln - dt);
    if (power.magnet > 0) {
      const k = Math.min(1, dt * 9);
      for (const o of objects) {
        if (o.kind !== 'coin' || o.taken || o.z > 18 || o.z < -0.5) continue;
        o.x += (player.x - o.x) * k;
        o.y += (player.y + 0.9 - o.y) * k;
      }
    }

    // spawning
    untilNext -= speed * dt;
    if (untilNext <= 0) {
      const used = spawnPattern();
      const diff = Math.min(1, distance / 3000);
      const gap = rand(16, 26) - diff * 6;
      untilNext = used + gap;
      if (Math.random() < POWER_CHANCE) {
        const ids = Object.keys(POWERS);
        objects.push({ kind: 'power', ptype: ids[(Math.random() * ids.length) | 0],
          x: rand(-ROAD + 0.8, ROAD - 0.8), y: 1, z: SPAWN_Z + used + gap / 2, hw: 0.45, hd: 0.45, h: 0 });
      }
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
        if (o.kind === 'coin' || o.kind === 'power') {
          if (!o.taken && Math.abs(o.x - player.x) < 0.75 && Math.abs(o.y - (player.y + 0.9)) < 1.1) {
            o.taken = true;
            if (o.kind === 'coin') {
              const n = power.double > 0 ? 2 : 1;
              coinCount += n;
              wallet += n;
              sfx.coin();
            } else {
              power[o.ptype] = powerMax[o.ptype] = powerTime(o.ptype);
              sfx.power();
            }
          }
        } else if (!o.dead && Math.abs(o.x - player.x) < o.hw + PLAYER_HW && player.y < o.h) {
          if (invuln > 0) continue;
          if (power.shield > 0) {
            // the shield takes the hit: smash the obstacle and keep running
            power.shield = 0;
            invuln = 0.8;
            o.dead = true;
            shake = 0.2;
            sfx.shieldBreak();
            try { navigator.vibrate && navigator.vibrate(30); } catch { /* ignore */ }
            const p = project(player.x, 1, 0.5);
            for (let i = 0; i < 30; i++) {
              particles.push({ x: p.x, y: p.y, vx: rand(-300, 300), vy: rand(-350, 50), life: rand(0.4, 0.8), c: Math.random() < 0.5 ? C.cyan : '#ffffff' });
            }
            continue;
          }
          crash(o);
          break;
        }
      }
    }
    objects = objects.filter((o) => o.z > -CAM_D + 0.6 && !o.taken && !o.dead);
    NeonLooks.updateTrail(trail, look.trail, player, distance, speed, dt, TRAIL_Z);

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
    const fade = Math.min(1, Math.max(0, (SPAWN_Z + 10 - o.z) / 25)) * (o.hit ? 0.35 : 1); // fade in at distance
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

  function drawPower(o) {
    if (o.z < -CAM_D + 0.5) return;
    const P = POWERS[o.ptype];
    const p = project(o.x, o.y + Math.sin(time * 3 + o.z) * 0.12, o.z);
    const r = 0.45 * p.s;
    if (r < 1) return;
    ctx.globalAlpha = Math.min(1, Math.max(0, (SPAWN_Z + 30 - o.z) / 25));
    const pulse = 1 + Math.sin(time * 6) * 0.08;
    ctx.fillStyle = P.color + '33';
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.5 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0221';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = P.color; ctx.lineWidth = Math.max(1.5, r * 0.15); ctx.stroke();
    ctx.fillStyle = P.color;
    ctx.font = `900 ${r * 1.05}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(P.icon, p.x, p.y + r * 0.05);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  // Active power-ups: icon + shrinking bar under the score.
  function drawPowerHud() {
    let y = 92;
    for (const id in power) {
      if (power[id] <= 0) continue;
      const P = POWERS[id], k = power[id] / powerMax[id];
      if (power[id] < 2 && Math.sin(time * 20) < 0) { y += 30; continue; } // blink when ending
      ctx.fillStyle = 'rgba(11,2,33,.6)';
      ctx.fillRect(14, y - 12, 118, 24);
      ctx.fillStyle = P.color;
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(P.icon, 20, y + 1);
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.fillRect(46, y - 4, 78, 8);
      ctx.fillStyle = P.color;
      ctx.fillRect(46, y - 4, 78 * k, 8);
      ctx.textBaseline = 'alphabetic';
      y += 30;
    }
  }

  function drawFallen() {
    const f = fall;
    const base = project(f.x, 0, f.z), p = project(f.x, f.y, f.z), s = p.s;
    const flat = Math.abs(Math.sin(f.roll));
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath();
    ctx.ellipse(base.x + Math.sin(f.roll) * 0.8 * s * flat, base.y, (0.42 + flat * 0.6) * s, 0.14 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    NeonLooks.drawRunner(ctx, p.x, p.y, s, { fall: f, roll: f.roll },
      NeonLooks.byId(NeonLooks.OUTFITS, look.outfit), time, look.skin);
  }

  function drawPlayer() {
    if (fall) { drawFallen(); return; }
    const base = project(player.x, 0, 0);
    const p = project(player.x, player.y, 0);
    const s = p.s;
    // shadow
    const sh = Math.max(0.3, 1 - player.y * 0.25);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.ellipse(base.x, base.y, 0.42 * s * sh, 0.12 * s * sh, 0, 0, Math.PI * 2); ctx.fill();


    NeonLooks.drawTrail(ctx, project, trail, look.trail, distance, time, TRAIL_Z);
    if (invuln > 0 && Math.sin(time * 30) < 0) return; // blink while invulnerable
    NeonLooks.drawRunner(ctx, p.x, p.y, s, { lean: player.lean, phase: player.phase, air: player.y > 0.01 },
      NeonLooks.byId(NeonLooks.OUTFITS, look.outfit), time, look.skin);
    if (power.shield > 0 && !(power.shield < 2 && Math.sin(time * 20) < 0)) {
      ctx.globalAlpha = 0.5 + Math.sin(time * 5) * 0.15;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(2, s * 0.05);
      ctx.fillStyle = 'rgba(5,217,232,.12)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 0.9 * s, 0.7 * s, 1.15 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 22, rand(-1, 1) * shake * 22);
    drawSky();
    drawGround();

    // far to near; the player sits at z = 0
    const sorted = objects.slice().sort((a, b) => b.z - a.z);
    let playerDrawn = false;
    const playerZ = fall ? fall.z : 0;
    for (const o of sorted) {
      if (!playerDrawn && o.z < playerZ) { drawPlayer(); playerDrawn = true; }
      if (o.kind === 'coin') drawCoin(o); else if (o.kind === 'power') drawPower(o); else drawBox(o);
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
      ctx.fillStyle = `rgba(255,42,109,${Math.max(0, deathTimer - 1.4) * 1.2})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state === 'play' || state === 'paused') drawPowerHud();
  }

  // Test hook for automated checks (only when the URL ends in #test).
  if (location.hash === '#test') {
    window.neonTest = {
      put: (o) => objects.push(Object.assign({ x: 0, y: 1, hw: 0.45, hd: 0.45, h: 0 }, o)),
      wall: (z, x = 0) => objects.push({ kind: 'wall', x, hw: 1, z, hd: 0.6, h: 2.4 }),
      barrier: (z) => objects.push({ kind: 'barrier', x: 0, hw: ROAD, z, hd: 0.3, h: 0.9 }),
      peek: () => ({ state, power: { ...power }, invuln, coinCount, wallet, x: player.x }),
    };
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
    if (!ui.city.classList.contains('hidden')) renderShopPreview(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
