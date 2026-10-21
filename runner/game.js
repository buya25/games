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
  const FOOTFALL = 0.71;     // stride phase offset where a foot lands (matches the gait in looks.js)
  const RUNUP = 1.6;         // seconds to accelerate from standing to START_SPEED
  const LAND_TIME = 0.24;    // length of the landing squash
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
    reveal: { name: 'Map Reveal', icon: '👁', color: '#b26bff', base: 6, per: 2, maze: true,
      desc: 'Maze Run: shows the whole map and lights the way out' },
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
    finalScore: $('finalScore'),
    muteBtn: $('muteBtn'), installBtn: $('installBtn'), iosHint: $('iosHint'),
    scoreLabel: $('scoreLabel'), cleared: $('cleared'), clrLevel: $('clrLevel'), clrTime: $('clrTime'),
    clrCoins: $('clrCoins'), clrBonus: $('clrBonus'), clrWallet: $('clrWallet'), overTitle: $('overTitle'),
    finalLabel: $('finalLabel'), finalDetail: $('finalDetail'), contNote: $('contNote'), bestMazeMenu: $('bestMazeMenu'),
    raceResult: $('raceResult'), shareBtn: $('shareBtn'), againBtn: $('againBtn'), challenge: $('challenge'),
    chName: $('chName'), chDist: $('chDist'), chCanvas: $('chCanvas'), toast: $('toast'),
    lobby: $('lobby'), lobbyJoin: $('lobbyJoin'), lobbyRoom: $('lobbyRoom'), lbName: $('lbName'), lbFormats: $('lbFormats'),
    lbCreate: $('lbCreate'), lbCode: $('lbCode'), lbJoin: $('lbJoin'), lbError: $('lbError'), lbRoomCode: $('lbRoomCode'),
    lbFormatLabel: $('lbFormatLabel'), lbPlayers: $('lbPlayers'), lbStart: $('lbStart'), lbWaiting: $('lbWaiting'),
    results: $('results'), rsTitle: $('rsTitle'), rsList: $('rsList'), rsReward: $('rsReward'), rsRematch: $('rsRematch'),
    rsWaiting: $('rsWaiting'), reactions: $('reactions'),
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
  const look = Object.assign({ outfit: 'classic', trail: 'none', skin: 2, hair: 'short', hairColor: 0 }, store.get('neonDash.look', {}));
  const boosts = Object.assign({ magnet: 0, shield: 0, double: 0, reveal: 0 }, store.get('neonDash.boosts', {}));
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
  // Short filtered noise burst: a shoe hitting the road.
  let noiseBuf = null;
  function footstep(v) {
    if (!actx || muted) return;
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.1, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    const t = actx.currentTime;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = rand(0.85, 1.15);
    const f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = rand(450, 700) + v * 8;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(f).connect(g).connect(actx.destination);
    src.start(t);
    src.stop(t + 0.09);
  }

  const sfx = {
    step: footstep,
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
  let skyShift = 0; // horizontal sky offset in px; Maze Run turns the sky with the runner
  // wrap a screen x around the view so the skyline loops when the runner turns all the way round
  const wrapX = (x) => { const P = 1.2 * Math.PI * W; return ((((x - W / 2 + P / 2) % P) + P) % P) - P / 2 + W / 2; };
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
  let power, powerMax, invuln, continues, contTimer, fall, runup, land;
  let playSteps = 0;     // fixed steps of play this run (the clock ghosts are replayed against)
  let recorder = null;   // this run, for "challenge a friend"
  let ghost = null;      // { run, x, y, d, done, phase, beaten } when racing a friend's ghost
  let banner = null;     // { text, color, t } big message over the road

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
    power = { magnet: 0, shield: 0, double: 0, reveal: 0 };
    powerMax = { magnet: 1, shield: 1, double: 1, reveal: 1 };
    invuln = 0;
    continues = 0;
    contTimer = 0;
    fall = null;
    runup = 0;
    land = 0;
    jumpBuffer = 0;
    time = 0;
  }
  reset();

  const score = () => Math.floor(distance) + coinCount * 10;
  // stride phase per second; slower steps when barely moving
  const cadence = (v) => Math.PI * 2 * (1.3 + v * 0.025) * Math.min(1, 0.35 + v / 8);
  const strideOf = (v) => Math.min(1, v / START_SPEED);

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
  // Track randomness is seeded per run, so a challenge replays the exact same track.
  let rng = Math.random;
  const grand = (a, b) => a + rng() * (b - a);

  function spawnPattern() {
    const z = SPAWN_Z;
    const diff = Math.min(1, distance / 3000); // 0 -> 1 over ~3 km
    const roll = rng();
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
        const w = grand(1.2, 2.2 + diff);
        const x = grand(-ROAD + w / 2, ROAD - w / 2);
        wall(x - w / 2, x + w / 2, z);
        const free = x > 0 ? (-ROAD + (x - w / 2)) / 2 : (ROAD + (x + w / 2)) / 2;
        if (rng() < 0.6) coinLine(free, z - 6, 4);
        return 6;
      }
      case 'gate': {
        const gap = grand(2.6, 3.2) - diff * 1.0;
        const gx = grand(-ROAD + gap / 2, ROAD - gap / 2);
        wall(-ROAD, gx - gap / 2, z);
        wall(gx + gap / 2, ROAD, z);
        coinLine(gx, z - 7.5, 4);
        return 6;
      }
      case 'jump': {
        barrier(-ROAD, ROAD, z);
        // arc of coins following the jump
        const cx = grand(-ROAD + 0.6, ROAD - 0.6);
        for (let i = -2; i <= 2; i++) coin(cx, z + i * 1.6, 0.9 + (1.4 - i * i * 0.25));
        return 8;
      }
      case 'half': {
        const left = rng() < 0.5;
        if (left) { barrier(-ROAD, 0, z); wall(0, ROAD, z); } else { wall(-ROAD, 0, z); barrier(0, ROAD, z); }
        coin(left ? -ROAD / 2 : ROAD / 2, z, 2.2);
        return 8;
      }
      case 'slalom': {
        const n = 3 + Math.floor(diff * 2);
        const spacing = Math.max(12, speed * 0.6);
        let side = rng() < 0.5 ? -1 : 1;
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
        const hw = grand(0.7, 1.0);
        objects.push({
          kind: 'wall', moving: true, x: 0, hw, z, hd: 0.6, h: 2.4,
          amp: ROAD - hw, freq: grand(1.2, 1.8 + diff), phase: grand(0, Math.PI * 2),
        });
        return 10;
      }
      case 'double': {
        // jump barrier then quickly a gate
        barrier(-ROAD, ROAD, z);
        const gap = 2.4 - diff * 0.6;
        const gx = grand(-ROAD + gap / 2, ROAD - gap / 2);
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
    const up = drag.sy - e.clientY;
    if (mode === 'maze') {
      const sx = e.clientX - drag.sx;
      if (!drag.turned && !drag.jumped) {
        if (Math.abs(sx) > 35 && Math.abs(sx) > Math.abs(up) * 1.2) { mazeSteer(Math.sign(sx)); drag.turned = true; }
        else if (-up > 40 && -up > Math.abs(sx)) { mazeSteer('back'); drag.turned = true; }
      }
    } else {
      targetX = clampX(targetX + (dx / s0) * DRAG_SENS, PLAYER_HW);
    }
    if (!drag.jumped && up > 40 && up > Math.abs(e.clientX - drag.sx)) { requestJump(); drag.jumped = true; }
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const quick = performance.now() - drag.t < 280;
    if (!drag.jumped && !drag.turned && quick && drag.moved < 14 && Math.abs(drag.sy - e.clientY) < 14) requestJump();
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (e) => { if (drag && drag.id === e.pointerId) drag = null; });

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (e.target instanceof HTMLInputElement || !ui.city.classList.contains('hidden') || !ui.challenge.classList.contains('hidden')) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 's'].includes(k)) e.preventDefault();
    if (k === ' ' || k === 'ArrowUp' || k === 'w') {
      if (state === 'play') requestJump();
      else if (state === 'menu') start();
      else if (state === 'over') playAgain();
      else if (state === 'cleared') startMaze(mz.level + 1);
      else if (state === 'paused') resume();
    }
    if (mode === 'maze' && state === 'play' && !e.repeat) {
      if (k === 'ArrowLeft' || k === 'a') mazeSteer(-1);
      if (k === 'ArrowRight' || k === 'd') mazeSteer(1);
      if (k === 'ArrowDown' || k === 's') mazeSteer('back');
    }
    if (k === 'p' || k === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));

  // ---------- Flow ----------
  function show(el, on) { el.classList.toggle('hidden', !on); }
  const lookIds = () => ({
    outfits: NeonLooks.OUTFITS.map((o) => o.id), trails: NeonLooks.TRAILS.map((t) => t.id), hairs: NeonLooks.HAIRS.map((h) => h.id),
  });

  // challengeRun: a friend's decoded run to race (same seed = same track), or null
  // raceSeed: the shared track seed of a live race
  function start(challengeRun = null, raceSeed = null) {
    initAudio();
    reset();
    const seed = raceSeed !== null ? raceSeed : challengeRun ? challengeRun.seed : NeonGhost.newSeed();
    rng = NeonGhost.seeded(seed);
    playSteps = 0;
    recorder = NeonGhost.createRecorder(seed, look, playerName || 'Runner');
    ghost = challengeRun ? { run: challengeRun, x: 0, y: 0, d: 0, done: false, phase: 1.5, beaten: false } : null;
    banner = challengeRun ? { text: `RACE ${challengeRun.name.toUpperCase()}!`, color: '#b26bff', t: 0 } : null;
    mode = 'endless';
    mz = null;
    skyShift = 0;
    ui.scoreLabel.textContent = 'SCORE';
    ui.score.parentElement.classList.remove('warn');
    speed = 0;
    runup = RUNUP;
    state = 'play';
    show(ui.menu, false); show(ui.over, false); show(ui.paused, false); show(ui.hud, true);
    last = performance.now();
  }
  function pause() {
    if (state !== 'play' || race) return; // a live race can't be paused
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
    ghost = null;
    banner = null;
    mode = 'endless';
    mz = null;
    skyShift = 0;
    state = 'menu';
    ui.bestMenu.textContent = best;
    ui.bestMazeMenu.textContent = bestMaze;
    ui.walletMenu.textContent = wallet;
    show(ui.paused, false); show(ui.over, false); show(ui.cleared, false); show(ui.hud, false); show(ui.menu, true);
  }
  const playAgain = () => (mode === 'maze' ? startMaze(1) : start(ghost ? ghost.run : null));
  function landed() {
    land = LAND_TIME;
    tone(150, 0.08, 'triangle', 0.08, 70); // soft footfall
    const p = project(player.x, 0, 0);
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1;
      particles.push({ x: p.x + side * rand(4, 18), y: p.y - 2, vx: side * rand(60, 160), vy: rand(-140, -40), life: rand(0.25, 0.45), c: 'rgba(210,190,255,.55)' });
    }
  }

  // Stumble and fall: walls knock the runner back, barriers trip them forward.
  // Either way they topple sideways (away from the obstacle) and slide to a stop.
  function crash(o) {
    state = 'dying';
    store.set('neonDash.wallet', wallet);
    deathTimer = 1.7;
    startFall(o);
  }

  // Knock the runner over: walls knock them back, barriers trip them forward.
  function startFall(o) {
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
  let shareCode = null;
  function gameOver() {
    state = 'over';
    let record;
    const racing = mode === 'endless' && ghost;
    ui.raceResult.textContent = '';
    if (racing) {
      const diff = Math.round(distance - NeonGhost.finalDistance(ghost.run));
      ui.raceResult.textContent = diff >= 0 ? `🏆 You beat ${ghost.run.name} by ${diff} m!` : `👻 ${ghost.run.name} wins by ${-diff} m`;
    }
    ui.againBtn.textContent = racing ? 'RACE AGAIN' : 'PLAY AGAIN';
    ui.shareBtn.textContent = racing ? '👻 CHALLENGE BACK' : '👻 CHALLENGE A FRIEND';
    show(ui.shareBtn, mode === 'endless' && recorder && recorder.samples.length > 0);
    shareCode = null;
    if (mode === 'endless' && recorder) {
      recorder.crashed = true;
      recorder.name = playerName || 'Runner';
      NeonGhost.encode(recorder, lookIds()).then((c) => { shareCode = c; }).catch(() => {});
    }
    if (mode === 'maze') {
      const cleared = mz.level - 1;
      record = false; // best maze is saved when a maze is cleared
      ui.overTitle.textContent = "TIME'S UP!";
      ui.finalLabel.textContent = 'Mazes cleared';
      ui.finalScore.textContent = cleared;
      ui.finalDetail.textContent = `Lost in maze ${mz.level} · ${coinCount} coins`;
      ui.bestOver.textContent = bestMaze;
    } else {
      const s = score();
      record = s > best;
      if (record) { best = s; store.set('neonDash.best', best); }
      ui.overTitle.textContent = 'CRASHED!';
      ui.finalLabel.textContent = 'Score';
      ui.finalScore.textContent = s;
      ui.finalDetail.textContent = `${Math.floor(distance)} m · ${coinCount} coins`;
      ui.bestOver.textContent = best;
    }
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
    ui.contNote.textContent = mode === 'maze' ? `Adds ${MAZE_TIME_BONUS} seconds` : '';
    ui.contWallet.textContent = wallet;
    show(ui.cont, true);
  }

  function continueRun() {
    if (state !== 'continue' || wallet < continueCost()) return;
    initAudio();
    wallet -= continueCost();
    continues++;
    store.set('neonDash.wallet', wallet);
    if (mode === 'maze') {
      mz.timeLeft += MAZE_TIME_BONUS;
      mazePopup(`+${MAZE_TIME_BONUS}s`, C.cyan);
      runup = RUNUP * 0.5;
    } else {
      // clear the road ahead so the runner doesn't respawn into a wall
      objects = objects.filter((o) => o.kind === 'coin' || o.kind === 'power' || o.z > 30);
    }
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

  function toast(msg) {
    ui.toast.textContent = msg;
    show(ui.toast, true);
    clearTimeout(toast.t);
    toast.t = setTimeout(() => show(ui.toast, false), 2600);
  }

  async function shareRun() {
    if (!recorder || !recorder.samples.length) return;
    if (!playerName) {
      const n = (window.prompt('Your name for the challenge?', '') || '').trim().slice(0, 12);
      if (n) { playerName = n; store.set('neonDash.name', n); }
    }
    if (!shareCode || recorder.name !== (playerName || 'Runner')) {
      recorder.name = playerName || 'Runner';
      shareCode = await NeonGhost.encode(recorder, lookIds());
    }
    const url = `${location.origin}${location.pathname}?c=${shareCode}`;
    const text = `👻 I ran ${Math.floor(NeonGhost.finalDistance(recorder))} m in Neon Dash. Can you beat my ghost?`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Neon Dash challenge', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Challenge link copied! Send it to a friend.'); }
    catch { window.prompt('Copy this challenge link:', url); }
  }

  // Opening a challenge link (?c=...) shows who challenged you and lets you race their ghost.
  let pendingChallenge = null;
  async function readChallengeLink() {
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      history.replaceState(null, '', location.pathname + location.hash);
      openLobby(room.toUpperCase().slice(0, 4));
      return;
    }
    const code = new URLSearchParams(location.search).get('c');
    if (!code) return;
    history.replaceState(null, '', location.pathname + location.hash);
    try {
      const run = await NeonGhost.decode(code, lookIds());
      pendingChallenge = run;
      ui.chName.textContent = run.name;
      ui.chDist.textContent = Math.floor(NeonGhost.finalDistance(run));
      const c2 = ui.chCanvas.getContext('2d');
      c2.clearRect(0, 0, 240, 300);
      NeonLooks.drawRunner(c2, 120, 285, 130, { phase: 0.6, stride: 1 }, NeonLooks.byId(NeonLooks.OUTFITS, run.look.outfit), 0, run.look);
      show(ui.menu, false);
      show(ui.challenge, true);
    } catch {
      toast('That challenge link looks broken.');
    }
  }
  $('shareBtn').addEventListener('click', () => { shareRun(); });
  $('chAccept').addEventListener('click', () => { show(ui.challenge, false); start(pendingChallenge); });
  $('chSkip').addEventListener('click', () => { show(ui.challenge, false); show(ui.menu, true); });

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
    NeonLooks.drawRunner(x, 22, 54, 26, { phase: 0.5 }, o, 0, look);
    return c;
  }

  // Free customisation: skin tone, hair style and hair colour.
  function renderSkinPicker() {
    const card = document.createElement('div');
    card.className = 'card skin-card';
    card.innerHTML = `<div class="info">
      <div class="name">Skin tone</div><div class="swatches" data-row="skin"></div>
      <div class="name sub">Hair</div><div class="chips" data-row="hair"></div>
      <div class="swatches" data-row="hairColor"></div></div>`;
    const pick = (key, val) => { look[key] = val; store.set('neonDash.look', look); renderShop(); };
    NeonLooks.SKINS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (look.skin === i ? ' on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', `Skin tone ${i + 1}`);
      b.addEventListener('click', () => pick('skin', i));
      card.querySelector('[data-row="skin"]').appendChild(b);
    });
    for (const h of NeonLooks.HAIRS) {
      const b = document.createElement('button');
      b.className = 'chip' + (look.hair === h.id ? ' on' : '');
      b.textContent = h.name;
      b.addEventListener('click', () => pick('hair', h.id));
      card.querySelector('[data-row="hair"]').appendChild(b);
    }
    NeonLooks.HAIR_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch small' + (look.hairColor === i ? ' on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', `Hair colour ${i + 1}`);
      b.addEventListener('click', () => pick('hairColor', i));
      card.querySelector('[data-row="hairColor"]').appendChild(b);
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
    show(ui.menu, false); show(ui.over, false); show(ui.cleared, false); show(ui.city, true);
    sizeCityCanvas();
  }
  function closeCity() {
    show(ui.city, false);
    if (cityFrom === 'over') { ui.walletOver.textContent = wallet; ui.goal.innerHTML = goalText(); show(ui.over, true); }
    else if (cityFrom === 'cleared') { ui.clrWallet.textContent = wallet; show(ui.cleared, true); }
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
      NeonLooks.byId(NeonLooks.OUTFITS, look.outfit), time, look);
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

  $('playBtn').addEventListener('click', () => start());
  $('againBtn').addEventListener('click', () => playAgain());
  $('mazeBtn').addEventListener('click', () => startMaze(1));
  $('nextBtn').addEventListener('click', () => startMaze(mz.level + 1));
  $('clrMenu').addEventListener('click', toMenu);
  $('clrShop').addEventListener('click', () => openCity('cleared'));
  $('menuBtn').addEventListener('click', toMenu);
  $('quitBtn').addEventListener('click', toMenu);
  $('pauseBtn').addEventListener('click', pause);
  $('resumeBtn').addEventListener('click', resume);
  ui.muteBtn.addEventListener('click', () => { muted = !muted; store.set('neonDash.muted', muted); updateMuteBtn(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  ui.bestMenu.textContent = best;
  ui.walletMenu.textContent = wallet;
  ui.bestMazeMenu.textContent = store.get('neonDash.bestMaze', 0);

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
    if (race) smoothRivals(dt);

    if (state === 'dying' || state === 'continue' || state === 'over') updateFall(dt);
    if (state === 'dying') {
      deathTimer -= dt;
      if (deathTimer <= 0) { if (race) raceAfterCrash(); else offerContinue(); }
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
    if (race) { raceTick(); if (state !== 'play') return; }
    if (mode === 'maze') { updateMaze(dt); return; }

    if (runup > 0) {
      // run-up: ease from standing to START_SPEED
      runup = Math.max(0, runup - dt);
      const k = 1 - runup / RUNUP;
      speed = START_SPEED * k * (2 - k);
    } else {
      speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    }

    // steering
    if (keys.has('ArrowLeft') || keys.has('a')) targetX -= KEY_STEER * dt;
    if (keys.has('ArrowRight') || keys.has('d')) targetX += KEY_STEER * dt;
    targetX = clampX(targetX, PLAYER_HW);
    const prevX = player.x;
    player.x += (targetX - player.x) * Math.min(1, dt * 14);
    const vx = (player.x - prevX) / Math.max(dt, 1e-4);
    player.lean += (Math.max(-1, Math.min(1, vx / 12)) - player.lean) * Math.min(1, dt * 10);
    camX = player.x * 0.55;

    runnerBody(dt, speed);

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
      const gap = grand(16, 26) - diff * 6;
      untilNext = used + gap;
      if (rng() < POWER_CHANCE) {
        const ids = Object.keys(POWERS).filter((id) => !POWERS[id].maze);
        objects.push({ kind: 'power', ptype: ids[(rng() * ids.length) | 0],
          x: grand(-ROAD + 0.8, ROAD - 0.8), y: 1, z: SPAWN_Z + used + gap / 2, hw: 0.45, hd: 0.45, h: 0 });
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

    playSteps++;
    if (recorder && playSteps % NeonGhost.SAMPLE_STEPS === 0) NeonGhost.record(recorder, distance, player.x, player.y);
    if (ghost) {
      const g = NeonGhost.sampleAt(ghost.run, playSteps);
      const v = Math.max(0, (g.d - ghost.d) / dt);
      if (!g.done) ghost.phase += dt * cadence(v);
      Object.assign(ghost, { x: g.x, y: g.y, d: g.d, done: g.done });
      if (!ghost.beaten && g.done && distance > g.d) {
        ghost.beaten = true;
        banner = { text: `YOU BEAT ${ghost.run.name.toUpperCase()}! 🏆`, color: C.gold, t: 0 };
        sfx.build();
      }
    }
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }

    ui.score.textContent = score();
    ui.coins.textContent = coinCount;
  }

  // Jumping, landing and the running stride (shared by both modes).
  // gaitV = the speed the legs move at (can differ from ground speed, e.g. jogging in place).
  function runnerBody(dt, gaitV) {
    // jumping
    if (jumpBuffer > 0) {
      jumpBuffer -= dt;
      if (player.y <= 0) { player.vy = JUMP_V; jumpBuffer = 0; sfx.jump(); }
    }
    if (player.y > 0 || player.vy > 0) {
      player.vy -= GRAVITY * dt;
      player.y = Math.max(0, player.y + player.vy * dt);
      if (player.y === 0) { player.vy = 0; landed(); }
    }
    if (land > 0) land = Math.max(0, land - dt);
    const step0 = Math.floor((player.phase + FOOTFALL) / Math.PI);
    player.phase += dt * cadence(gaitV);
    if (player.y === 0 && gaitV > 1 && Math.floor((player.phase + FOOTFALL) / Math.PI) !== step0) sfx.step(gaitV);
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
    const sx = wrapX(W / 2 - camX * 6 + skyShift), r = Math.min(W, H) * 0.22, sy = horizon - r * 0.15;
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
    const off = -camX * 14 + skyShift;
    for (const b of skyline) {
      const x = wrapX(W / 2 + (b.x - 0.5) * W + off), w = b.w * W, h = b.h * H * 0.6;
      if (x + w < 0 || x > W) continue;
      ctx.fillStyle = '#16052e';
      ctx.fillRect(x, base - h, w, h);
      if (b.lit) { ctx.fillStyle = 'rgba(5,217,232,.2)'; ctx.fillRect(x + w * 0.3, base - h + 3, w * 0.12, h - 6); }
    }

    // the player's own Neon City, a little closer (more parallax)
    const u = Math.min(W, H * 0.6) / 110;
    NeonCity.drawCity(ctx, city, wrapX(W / 2 - camX * 22 + skyShift), base, u, time, { name: playerName });
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
      NeonLooks.byId(NeonLooks.OUTFITS, look.outfit), time, look);
  }

  // A friend's ghost: see-through runner in their look, name tag above.
  // A see-through runner in someone else's look, with a name tag (challenge ghosts and live rivals).
  function drawGhostFigure(g, x, y, z) {
    if (z < -CAM_D + 0.8 || z > SPAWN_Z) return;
    const lk = g.look || {};
    const p = project(x, y, z), s = p.s;
    ctx.save();
    ctx.globalAlpha = 0.5;
    const pose = g.lying ? { fall: { grounded: true, t: 1 }, roll: Math.PI / 2 }
      : { phase: g.phase, air: y > 0.01, stride: g.still ? 0 : 1 };
    NeonLooks.drawRunner(ctx, p.x, p.y, s, pose, NeonLooks.byId(NeonLooks.OUTFITS, lk.outfit), time, lk);
    ctx.restore();
    const tag = project(x, g.lying ? 0.6 : y + 2.15, z);
    const label = `${g.icon} ${g.name}${g.lying ? ' 💥' : ''}`;
    ctx.font = `800 ${Math.max(10, Math.min(16, tag.s * 0.28))}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(11,2,33,.7)';
    ctx.fillRect(tag.x - tw / 2 - 6, tag.y - 13, tw + 12, 18);
    ctx.fillStyle = '#e2c7ff';
    ctx.textAlign = 'center';
    ctx.fillText(label, tag.x, tag.y);
    ctx.textAlign = 'start';
    if (g.emoji) drawEmoji(g.emoji, project(x, y + 2.9, z));
  }

  function drawGhost(z) {
    const run = ghost.run;
    drawGhostFigure({ name: run.name, look: run.look, phase: ghost.phase, lying: ghost.done && run.crashed, icon: '👻' }, ghost.x, ghost.y, z);
  }

  const rivalFigure = (rv) => ({
    name: rv.name, look: rv.look, phase: rv.phase, icon: '🏃', emoji: rivalEmoji(rv),
    lying: !!(rv.tgt && rv.tgt.a === false), still: !!(rv.tgt && rv.tgt.f),
  });

  // Gap to the ghost, top centre.
  function drawGhostHud() {
    const gap = Math.round(ghost.d - distance);
    const ahead = gap < 0;
    const text = ghost.beaten ? `🏆 Beat ${ghost.run.name}` : gap === 0 ? `Neck and neck with ${ghost.run.name}`
      : ahead ? `You +${-gap} m` : `👻 ${ghost.run.name} +${gap} m`;
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(11,2,33,.7)';
    ctx.fillRect(W / 2 - tw / 2 - 10, 62, tw + 20, 26);
    ctx.fillStyle = ghost.beaten || ahead ? C.gold : '#e2c7ff';
    ctx.fillText(text, W / 2, 80);
    ctx.textAlign = 'start';
  }

  function drawBanner() {
    ctx.globalAlpha = Math.max(0, Math.min(1, (2.2 - banner.t) * 2));
    ctx.font = `900 italic ${Math.min(W, H) * 0.075}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6; ctx.strokeStyle = '#0b0221';
    ctx.strokeText(banner.text, W / 2, H * 0.3);
    ctx.fillStyle = banner.color;
    ctx.fillText(banner.text, W / 2, H * 0.3);
    ctx.textAlign = 'start';
    ctx.globalAlpha = 1;
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
    NeonLooks.drawRunner(ctx, p.x, p.y, s, { lean: player.lean, phase: player.phase, air: player.y > 0.01,
        stride: state === 'menu' ? 0 : strideOf(gaitSpeed()), squash: land > 0 ? Math.sin(Math.PI * (1 - land / LAND_TIME)) : 0 },
      NeonLooks.byId(NeonLooks.OUTFITS, look.outfit), time, look);
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
    const items = objects.slice();
    if (ghost && state !== 'menu') items.push({ kind: 'ghost', z: ghost.d - distance });
    if (race) for (const rv of Object.values(race.rivals)) if (rv.tgt) items.push({ kind: 'rival', z: rv.d - distance, rv });
    const sorted = items.sort((a, b) => b.z - a.z);
    let playerDrawn = false;
    const playerZ = fall ? fall.z : 0;
    for (const o of sorted) {
      if (!playerDrawn && o.z < playerZ) { drawPlayer(); playerDrawn = true; }
      if (o.kind === 'ghost') drawGhost(o.z);
      else if (o.kind === 'rival') drawGhostFigure(rivalFigure(o.rv), o.rv.x, o.rv.y, o.z);
      else if (o.kind === 'coin') drawCoin(o); else if (o.kind === 'power') drawPower(o); else drawBox(o);
    }
    if (!playerDrawn) drawPlayer();
    if (myEmoji()) drawEmoji(myEmoji(), project(player.x, player.y + 2.9, 0));

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
    if (ghost && (state === 'play' || state === 'paused')) drawGhostHud();
    if (banner) drawBanner();
    drawRaceHud();
    if (state === 'play' && runup > RUNUP - 1 && !race) {
      const k = (RUNUP - runup); // 0 -> 1 over the first second
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.fillStyle = C.yellow;
      ctx.font = `900 italic ${Math.min(W, H) * (0.18 + k * 0.08)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.min(W, H) * 0.025;
      ctx.strokeStyle = C.pink;
      ctx.strokeText('GO!', W / 2, H * 0.3);
      ctx.lineWidth = Math.min(W, H) * 0.012;
      ctx.strokeStyle = '#0b0221';
      ctx.strokeText('GO!', W / 2, H * 0.3);
      ctx.fillText('GO!', W / 2, H * 0.3);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Maze Run ----------
  // The runner jogs along corridors of a grid maze. Swipe left/right before a
  // junction to turn there; corners with only one way turn by themselves; dead
  // ends turn you round. Find the exit (the light beam) before time runs out.
  const CELL = 7;           // cell size in world units (corridor width)
  const WALL_H = 3.3;
  const MAZE_VIEW = 7;      // cells drawn around the runner
  const TURN_TIME = 0.22;   // seconds for the camera to swing through a 90° turn
  const MAZE_TIME_BONUS = 20; // seconds a continue adds
  const DIRS = NeonMaze.DIRS;
  let mode = 'endless';
  let mz = null;
  let bestMaze = store.get('neonDash.bestMaze', 0);
  const mazeSpeed = (level) => Math.min(15, 10.5 + level * 0.5);
  // legs keep jogging on the spot while waiting at a junction
  const gaitSpeed = () => (mode === 'maze' && mz && mz.waiting && !fall ? 7 : speed);

  function startMaze(level, seed = null) {
    initAudio();
    const keepCoins = state === 'cleared' ? coinCount : 0;
    reset();
    ghost = null;
    banner = null;
    recorder = null;
    mode = 'maze';
    coinCount = keepCoins;
    const n = Math.min(13, 4 + level);
    const mrng = seed !== null ? NeonGhost.seeded(seed) : Math.random; // a race seed gives everyone the same maze
    const maze = NeonMaze.generate(n, n, 0.08, mrng);
    mz = {
      maze, level, rng: mrng, segs: NeonMaze.wallSegments(maze),
      pos: { x: 0, y: 0 }, heading: [0, 1, 2, 3].find((d) => NeonMaze.isOpen(maze, 0, 0, d)), yaw: 0,
      want: null, waiting: false, trip: 0, visited: new Set(['0,0']), items: [], popups: [],
    };
    // generous: players explore wrong turns, the shortest path is only a floor
    mz.timeMax = mz.timeLeft = Math.round((maze.pathLength * CELL) / mazeSpeed(level) * 2.3 + 15);
    if (race) mz.timeMax = mz.timeLeft = 1e9; // races have no clock, just first out
    mz.toExit = NeonMaze.distances(maze, maze.exit.x, maze.exit.y);
    placeMazeItems();
    speed = 0;
    runup = RUNUP;
    state = 'play';
    ui.scoreLabel.textContent = 'TIME';
    for (const el of [ui.menu, ui.over, ui.paused, ui.cleared]) show(el, false);
    show(ui.hud, true);
    mazePopup(`MAZE ${level}`, C.cyan);
    last = performance.now();
  }

  function placeMazeItems() {
    const m = mz.maze;
    // Map Reveal orbs: 1 per maze, +1 every third maze, at least 2 cells from the start
    const fromStart = NeonMaze.distances(m, 0, 0);
    const spots = [];
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (fromStart[y][x] >= 2 && !(x === m.exit.x && y === m.exit.y)) spots.push(`${x},${y}`);
    const reveal = new Set();
    for (let i = 0; i < 1 + Math.floor(mz.level / 3) && spots.length; i++) reveal.add(spots.splice((mz.rng() * spots.length) | 0, 1)[0]);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if ((x === 0 && y === 0) || (x === m.exit.x && y === m.exit.y)) continue;
        if (reveal.has(`${x},${y}`)) {
          mz.items.push({ kind: 'power', ptype: 'reveal', wx: x * CELL, wy: y * CELL, y: 1 });
          continue;
        }
        const open = [0, 1, 2, 3].filter((d) => NeonMaze.isOpen(m, x, y, d));
        const straight = open.length === 2 && (open[0] + 2) % 4 === open[1];
        if (mz.level >= 2 && straight && mz.rng() < Math.min(0.35, 0.1 * mz.level)) {
          // a barrier across a straight corridor (never at a junction)
          mz.items.push({ kind: 'barrier', wx: x * CELL, wy: y * CELL, axis: open[0] % 2, h: 0.9 });
        } else if (mz.rng() < 0.45) {
          const d = open[(mz.rng() * open.length) | 0];
          for (let i = 0; i < 3; i++) mz.items.push({ kind: 'coin', wx: x * CELL + DIRS[d][0] * 1.6 * i, wy: y * CELL + DIRS[d][1] * 1.6 * i, y: 0.9 });
        }
      }
    }
  }

  function mazePopup(text, color = '#ffffff') { mz.popups.push({ text, color, t: 0 }); }

  // World -> runner-local coordinates (x right, z forward); yaw adds the turn swing.
  function toLocal(wx, wy, withYaw = true) {
    const [fx, fy] = DIRS[mz.heading];
    const dx = wx - mz.pos.x, dy = wy - mz.pos.y;
    let x = dx * fy - dy * fx, z = dx * fx + dy * fy;
    if (withYaw && mz.yaw) {
      const c = Math.cos(mz.yaw), sn = Math.sin(mz.yaw);
      [x, z] = [x * c - z * sn, x * sn + z * c];
    }
    return { x, z };
  }

  const cellAt = () => ({ x: Math.round(mz.pos.x / CELL), y: Math.round(mz.pos.y / CELL) });

  function turnTo(d) {
    const diff = (d - mz.heading + 4) % 4;
    if (diff === 0) return;
    // the view starts where it was and swings round to the new heading
    mz.yaw += diff === 1 ? -Math.PI / 2 : diff === 3 ? Math.PI / 2 : Math.PI;
    mz.heading = d;
    player.lean = diff === 1 ? 1 : diff === 3 ? -1 : 0;
    tone(260, 0.16, 'sine', 0.05, 520);
  }

  // Player input: dir = -1 (left), 1 (right) or 'back'.
  function mazeSteer(dir) {
    if (state !== 'play' || mode !== 'maze' || fall) return;
    if (dir === 'back' && !mz.waiting) { turnTo((mz.heading + 2) % 4); return; }
    mz.want = { dir, t: time };
    if (mz.waiting) {
      const c = cellAt();
      const d = dir === 'back' ? (mz.heading + 2) % 4 : (mz.heading + (dir < 0 ? 3 : 1)) % 4;
      if (NeonMaze.isOpen(mz.maze, c.x, c.y, d)) {
        mz.waiting = false;
        mz.want = null;
        turnTo(d);
        runup = RUNUP * 0.5;
      } else {
        shake = 0.12; // that way is a wall
        mz.want = null;
      }
    }
  }

  // Called when the runner reaches the centre of a cell.
  function atJunction() {
    const c = cellAt(), m = mz.maze;
    mz.visited.add(`${c.x},${c.y}`);
    if (c.x === m.exit.x && c.y === m.exit.y) { mazeCleared(); return; }
    const h = mz.heading, open = (d) => NeonMaze.isOpen(m, c.x, c.y, d);
    const L = (h + 3) % 4, R = (h + 1) % 4, B = (h + 2) % 4;
    if (mz.want) {
      const d = mz.want.dir === 'back' ? B : mz.want.dir < 0 ? L : R;
      if (open(d)) { mz.want = null; turnTo(d); return; }
    }
    if (open(h)) return; // straight on
    const sides = [L, R].filter(open);
    if (sides.length === 1) { turnTo(sides[0]); return; } // a corner: follow it
    if (!sides.length) { mazePopup('Dead end!', C.pink); turnTo(B); return; }
    mz.waiting = true; // T-junction: the player picks
  }

  function moveMaze(move) {
    const [fx, fy] = DIRS[mz.heading];
    const along = mz.pos.x * fx + mz.pos.y * fy;
    const next = (Math.floor(along / CELL + 1e-6) + 1) * CELL;
    if (along + move >= next) {
      mz.pos.x = Math.round((mz.pos.x + fx * (next - along)) / CELL) * CELL;
      mz.pos.y = Math.round((mz.pos.y + fy * (next - along)) / CELL) * CELL;
      distance += next - along;
      atJunction();
    } else {
      mz.pos.x += fx * move;
      mz.pos.y += fy * move;
      distance += move;
    }
  }

  function mazeTrip(it) {
    it.hit = true;
    mz.trip = 1.5;
    mz.timeLeft -= 3;
    mazePopup('-3s', C.pink);
    startFall({ kind: 'barrier', x: 0 });
  }

  function updateMaze(dt) {
    mz.timeLeft -= dt;
    for (const p of mz.popups) p.t += dt;
    mz.popups = mz.popups.filter((p) => p.t < 1.4);
    if (mz.timeLeft <= 0) { mazeTimeUp(); return; }
    if (mz.yaw) {
      const step = (dt * Math.PI) / 2 / TURN_TIME;
      mz.yaw = Math.abs(mz.yaw) <= step ? 0 : mz.yaw - Math.sign(mz.yaw) * step;
    }
    if (mz.want && time - mz.want.t > 1.4) mz.want = null; // stale swipe
    if (invuln > 0) invuln = Math.max(0, invuln - dt);
    if (power.reveal > 0) power.reveal = Math.max(0, power.reveal - dt);

    const top = mazeSpeed(mz.level);
    if (mz.trip > 0) {
      speed = 0;
      updateFall(dt);
      mz.trip -= dt;
      if (mz.trip <= 0) {
        fall = null;
        camX = 0;
        for (const it of mz.items) if (it.hit) it.dead = true;
        invuln = 0.6;
        runup = RUNUP * 0.6;
      }
    } else if (mz.waiting) {
      speed = 0;
    } else if (runup > 0) {
      runup = Math.max(0, runup - dt);
      const k = 1 - runup / RUNUP;
      speed = top * k * (2 - k);
    } else {
      speed = top;
    }
    player.lean += (0 - player.lean) * Math.min(1, dt * 5);
    if (!fall) camX = 0;
    runnerBody(dt, gaitSpeed());
    if (!fall && !mz.waiting) moveMaze(speed * dt);
    if (state !== 'play') return; // reached the exit

    // coins and barriers near the runner
    for (const it of mz.items) {
      if (it.taken || it.dead || it.hit) continue;
      const l = toLocal(it.wx, it.wy, false);
      if (Math.abs(l.z) > CELL / 2 || Math.abs(l.x) > CELL / 2) continue;
      if (it.kind === 'coin' || it.kind === 'power') {
        if (Math.abs(l.x) < 0.8 && Math.abs(l.z) < 0.6 && Math.abs(it.y - (player.y + 0.9)) < 1.1) {
          it.taken = true;
          if (it.kind === 'coin') {
            coinCount++;
            wallet++;
            sfx.coin();
          } else {
            power[it.ptype] = powerMax[it.ptype] = powerTime(it.ptype);
            sfx.power();
            mazePopup('MAP REVEALED', POWERS[it.ptype].color);
          }
        }
      } else if (it.axis === mz.heading % 2 && Math.abs(l.z) < 0.3 + PLAYER_HD && player.y < it.h && invuln <= 0 && !fall) {
        mazeTrip(it);
      }
    }
    mz.items = mz.items.filter((it) => !it.taken && !it.dead);
    NeonLooks.updateTrail(trail, look.trail, player, distance, speed, dt, TRAIL_Z);

    ui.score.textContent = race ? Math.floor(race.steps / 60) : Math.max(0, Math.ceil(mz.timeLeft));
    ui.score.parentElement.classList.toggle('warn', mz.timeLeft < 10);
    ui.coins.textContent = coinCount;
  }

  function mazeTimeUp() {
    state = 'dying';
    deathTimer = 1.0;
    speed = 0;
    mz.waiting = false;
    mz.timeLeft = 0;
    store.set('neonDash.wallet', wallet);
    mazePopup("TIME'S UP", C.pink);
    [440, 330, 220].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'square', 0.06), i * 160));
    try { navigator.vibrate && navigator.vibrate([80, 60, 80]); } catch { /* ignore */ }
  }

  function mazeCleared() {
    if (race) { raceFinished(); return; }
    state = 'cleared';
    speed = 0;
    const bonus = 10 * mz.level + Math.ceil(mz.timeLeft);
    wallet += bonus;
    store.set('neonDash.wallet', wallet);
    if (mz.level > bestMaze) { bestMaze = mz.level; store.set('neonDash.bestMaze', bestMaze); }
    [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.06), i * 90));
    try { navigator.vibrate && navigator.vibrate([40, 40, 40, 40, 120]); } catch { /* ignore */ }
    ui.clrLevel.textContent = mz.level;
    ui.clrTime.textContent = Math.ceil(mz.timeLeft);
    ui.clrCoins.textContent = coinCount;
    ui.clrBonus.textContent = bonus;
    ui.clrWallet.textContent = wallet;
    show(ui.hud, false);
    show(ui.cleared, true);
  }

  // ----- Maze rendering -----
  function renderMaze() {
    skyShift = (mz.heading * Math.PI / 2 - mz.yaw) * W * 0.6;
    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 22, rand(-1, 1) * shake * 22);
    drawSky();
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, '#2a0845'); g.addColorStop(1, '#0b0221');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.fillStyle = C.pink;
    ctx.fillRect(0, horizon - 1, W, 2);

    const zNear = -CAM_D + 0.35, far = MAZE_VIEW * CELL * 1.3;
    const c = cellAt(), m = mz.maze;
    const proj = (pts) => pts.map((p) => project(p.x, p.y || 0, p.z));
    const fillPoly = (pts, fill, stroke, lw) => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    };

    // floors (flat, so no sorting needed)
    for (let y = c.y - MAZE_VIEW; y <= c.y + MAZE_VIEW; y++) {
      for (let x = c.x - MAZE_VIEW; x <= c.x + MAZE_VIEW; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([ox, oy]) => toLocal((x + ox) * CELL, (y + oy) * CELL));
        const pts = NeonMaze.clipNear(corners, zNear);
        if (pts.length < 3 || pts.every((p) => p.z > far)) continue;
        const exit = x === m.exit.x && y === m.exit.y;
        fillPoly(proj(pts), exit ? '#3a1050' : (x + y) % 2 ? '#150727' : '#120622', 'rgba(5,217,232,.10)', 1);
      }
    }

    if (power.reveal > 0) drawRouteArrows(zNear, far, fillPoly);

    // walls, items, exit beam and runner, painted far to near
    const list = [];
    for (const sg of mz.segs) {
      if (Math.abs(sg.cx - c.x) > MAZE_VIEW || Math.abs(sg.cy - c.y) > MAZE_VIEW) continue;
      const a = toLocal(sg.x0 * CELL, sg.y0 * CELL), b = toLocal(sg.x1 * CELL, sg.y1 * CELL);
      if (a.z < zNear && b.z < zNear) continue;
      const facing = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      list.push({ depth: (a.z + b.z) / 2, draw: () => drawMazeWall(a, b, facing, zNear, fillPoly) });
    }
    for (const it of mz.items) {
      const l = toLocal(it.wx, it.wy);
      if (l.z < zNear + 0.3 || l.z > far) continue;
      if (it.kind === 'coin') list.push({ depth: l.z, draw: () => drawCoin({ x: l.x, y: it.y, z: l.z }) });
      else if (it.kind === 'power') list.push({ depth: l.z, draw: () => drawPower({ ptype: it.ptype, x: l.x, y: it.y, z: l.z }) });
      else {
        const across = it.axis === mz.heading % 2;
        list.push({ depth: l.z, draw: () => drawBox({ kind: 'barrier', x: l.x, z: l.z, hit: it.hit, h: it.h,
          hw: across ? CELL / 2 : 0.3, hd: across ? 0.3 : CELL / 2 }) });
      }
    }
    const ex = toLocal(m.exit.x * CELL, m.exit.y * CELL);
    if (ex.z > zNear + 0.5) list.push({ depth: ex.z, draw: () => drawExitBeam(ex) });
    if (race) {
      for (const rv of Object.values(race.rivals)) {
        if (!rv.tgt || rv.tgt.mx === undefined) continue;
        const l = toLocal(rv.mx, rv.my);
        if (l.z < zNear + 0.3 || l.z > far) continue;
        list.push({ depth: l.z, draw: () => drawGhostFigure(rivalFigure(rv), l.x, rv.y, l.z) });
      }
    }
    list.push({ depth: -1, draw: () => { drawPlayer(); if (myEmoji()) drawEmoji(myEmoji(), project(0, player.y + 2.9, 0)); } });
    list.sort((p, q) => q.depth - p.depth).forEach((it) => it.draw());

    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 1.5));
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawMinimap();
    drawMazeHints();
    if (state === 'play' || state === 'paused') drawPowerHud();
    drawRaceHud();
  }

  function drawMazeWall(a, b, facing, zNear, fillPoly) {
    const quad = NeonMaze.clipNear([
      { x: a.x, z: a.z, y: 0 }, { x: b.x, z: b.z, y: 0 }, { x: b.x, z: b.z, y: WALL_H }, { x: a.x, z: a.z, y: WALL_H },
    ], zNear);
    if (quad.length < 3) return;
    const pts = quad.map((p) => project(p.x, p.y, p.z));
    fillPoly(pts, facing ? '#2b0f55' : '#1b0838');
    // neon edges: pink along the top, cyan along the floor
    for (const [yy, color, w] of [[WALL_H, C.pink, 3], [0, 'rgba(5,217,232,.55)', 2]]) {
      const edge = quad.map((p, i) => ({ p, s: pts[i] })).filter((q) => Math.abs(q.p.y - yy) < 1e-6);
      if (edge.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(edge[0].s.x, edge[0].s.y);
      for (let i = 1; i < edge.length; i++) ctx.lineTo(edge[i].s.x, edge[i].s.y);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
    }
  }

  // A beam of light over the exit, visible above the walls from anywhere nearby.
  function drawExitBeam(l) {
    const b = project(l.x, 0, l.z), t = project(l.x, 40, l.z);
    const w = Math.max(4, 1.6 * b.s);
    const g = ctx.createLinearGradient(0, b.y, 0, t.y);
    g.addColorStop(0, 'rgba(255,210,63,.85)'); g.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x - w / 2, t.y, w, b.y - t.y);
    ctx.strokeStyle = C.gold; ctx.lineWidth = Math.max(2, b.s * 0.08);
    const pulse = 1 + Math.sin(time * 5) * 0.1;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, 1.8 * b.s * pulse, 0.45 * b.s * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    const lab = project(l.x, 3.2, l.z);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.max(10, lab.s * 0.9)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', lab.x, lab.y);
    ctx.textAlign = 'start';
  }

  // Shortest way from the runner's cell to the exit, as a list of cells.
  function mazeRoute() {
    const m = mz.maze, d = mz.toExit;
    let c = cellAt();
    const route = [c];
    while (d[c.y][c.x] > 0 && route.length < 400) {
      let next = null;
      for (let k = 0; k < 4; k++) {
        if (!NeonMaze.isOpen(m, c.x, c.y, k)) continue;
        const nx = c.x + DIRS[k][0], ny = c.y + DIRS[k][1];
        if (d[ny][nx] === d[c.y][c.x] - 1) { next = { x: nx, y: ny, dir: k }; break; }
      }
      if (!next) break;
      c.dir = next.dir;
      route.push(next);
      c = next;
    }
    return route;
  }

  // Glowing chevrons on the floor along the route (while Map Reveal is active).
  function drawRouteArrows(zNear, far, fillPoly) {
    const blink = power.reveal < 2 && Math.sin(time * 20) < 0;
    if (blink) return;
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(time * 6);
    for (const c of mazeRoute()) {
      if (c.dir === undefined) continue;
      const [dx, dy] = DIRS[c.dir], px = -dy, py = dx; // forward and sideways in world space
      for (const off of [0, CELL / 2]) {
        const cx = c.x * CELL + dx * off, cy = c.y * CELL + dy * off;
        const pt = (f, sd) => toLocal(cx + dx * f + px * sd, cy + dy * f + py * sd);
        const shape = [pt(1.1, 0), pt(-0.2, 1.1), pt(0.2, 0), pt(-0.2, -1.1)];
        if (shape.some((p) => p.z < zNear + 0.2 || p.z > far)) continue;
        fillPoly(shape.map((p) => project(p.x, 0.02, p.z)), C.gold);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawMinimap() {
    const m = mz.maze;
    const size = Math.min(120, W * 0.3), cs = size / Math.max(m.w, m.h);
    const x0 = W - size - 14, y0 = 66;
    ctx.fillStyle = 'rgba(11,2,33,.75)';
    ctx.fillRect(x0 - 4, y0 - 4, size + 8, size + 8);
    const sx = (x) => x0 + x * cs, sy = (y) => y0 + (m.h - 1 - y) * cs;
    const revealed = power.reveal > 0;
    const cells = revealed ? m.cells.flatMap((row, y) => row.map((_, x) => `${x},${y}`)) : mz.visited;
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      const seen = mz.visited.has(key);
      ctx.fillStyle = seen ? 'rgba(5,217,232,.25)' : 'rgba(178,107,255,.12)';
      ctx.fillRect(sx(x), sy(y), cs, cs);
      ctx.strokeStyle = seen ? C.pink : 'rgba(178,107,255,.8)'; ctx.lineWidth = 1.2;
      const wl = m.cells[y][x].walls;
      ctx.beginPath();
      if (wl[0]) { ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(x + 1), sy(y)); }
      if (wl[1]) { ctx.moveTo(sx(x + 1), sy(y)); ctx.lineTo(sx(x + 1), sy(y) + cs); }
      if (wl[2]) { ctx.moveTo(sx(x), sy(y) + cs); ctx.lineTo(sx(x + 1), sy(y) + cs); }
      if (wl[3]) { ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(x), sy(y) + cs); }
      ctx.stroke();
    }
    if (revealed) {
      // the way out, in gold
      ctx.strokeStyle = C.gold; ctx.lineWidth = Math.max(2, cs * 0.25); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      mazeRoute().forEach((c, i) => {
        const X = sx(c.x) + cs / 2, Y = sy(c.y) + cs / 2;
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      });
      ctx.stroke();
    }
    ctx.fillStyle = Math.sin(time * 6) > 0 ? C.gold : '#fff5c2';
    ctx.fillRect(sx(m.exit.x) + cs * 0.2, sy(m.exit.y) + cs * 0.2, cs * 0.6, cs * 0.6);
    // rivals in a live maze race
    if (race) {
      for (const rv of Object.values(race.rivals)) {
        if (!rv.tgt || rv.tgt.mx === undefined) continue;
        ctx.fillStyle = C.pink;
        ctx.beginPath(); ctx.arc(x0 + (rv.mx / CELL + 0.5) * cs, y0 + (m.h - 0.5 - rv.my / CELL) * cs, Math.max(2.5, cs * 0.3), 0, Math.PI * 2); ctx.fill();
      }
    }
    // the runner as an arrow
    const px = x0 + (mz.pos.x / CELL + 0.5) * cs, py = y0 + (m.h - 0.5 - mz.pos.y / CELL) * cs;
    const ang = (mz.heading * Math.PI) / 2;
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -cs * 0.45); ctx.lineTo(cs * 0.32, cs * 0.3); ctx.lineTo(-cs * 0.32, cs * 0.3); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.cyan;
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`MAZE ${mz.level}`, x0 + size, y0 + size + 18);
    ctx.textAlign = 'start';
  }

  function drawMazeHints() {
    for (const p of mz.popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.4);
      ctx.fillStyle = p.color;
      ctx.font = `900 italic ${Math.min(W, H) * 0.09}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, W / 2, H * 0.3 - p.t * 40);
    }
    ctx.globalAlpha = 1;
    if (mz.waiting && state === 'play') {
      const c = cellAt(), h = mz.heading, open = (d) => NeonMaze.isOpen(mz.maze, c.x, c.y, d);
      const pulse = 0.6 + 0.4 * Math.sin(time * 8);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = C.cyan;
      ctx.font = `900 ${Math.min(W, H) * 0.14}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      if (open((h + 3) % 4)) ctx.fillText('◀', W * 0.15, H * 0.62);
      if (open((h + 1) % 4)) ctx.fillText('▶', W * 0.85, H * 0.62);
      ctx.globalAlpha = 1;
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Swipe to pick a way', W / 2, H * 0.94);
    }
    ctx.textAlign = 'start';
  }

  // ---------- Race Friends (live, 2-4 players) ----------
  // Everyone runs the same seeded track (or maze) on their own phone and sends their
  // position ~8 times a second; rivals are drawn as see-through runners.
  const SPRINT_D = 1000;          // Sprint finish line, metres
  const RACE_PUBLISH_STEPS = 8;   // send our position every 8 fixed steps
  const RACE_GRACE_MS = 45000;    // after the first finisher, the race ends this long later
  const FORMATS = {
    sprint: { name: 'Sprint', desc: 'First to 1,000 m' },
    survival: { name: 'Survival', desc: 'Last runner standing' },
    maze: { name: 'Maze race', desc: 'First out of the same maze' },
  };
  let net = null;
  let race = null;
  let lobbyFormat = 'sprint';
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const myLook = () => ({ outfit: look.outfit, trail: look.trail, skin: look.skin, hair: look.hair, hairColor: look.hairColor });
  const fmtTime = (steps) => { const s = steps / 60; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n] || 'th');

  function lobbyMsg(msg, isError = true) {
    ui.lbError.textContent = msg || '';
    ui.lbError.classList.toggle('ok', !isError);
  }
  function lobbyBusy(on) { for (const b of [ui.lbCreate, ui.lbJoin]) b.disabled = on; if (on) lobbyMsg('Connecting…', false); }

  function openLobby(code = '') {
    show(ui.menu, false);
    show(ui.lobby, true); show(ui.lobbyJoin, true); show(ui.lobbyRoom, false);
    ui.lbName.value = playerName;
    ui.lbCode.value = code;
    lobbyMsg('');
    renderFormatChips();
    if (!NeonNet.available()) { lobbyMsg('Online races are not set up yet (the Firebase config is missing).'); return; }
    if (code && playerName) joinRace(code);
  }

  function renderFormatChips() {
    ui.lbFormats.innerHTML = '';
    for (const [id, f] of Object.entries(FORMATS)) {
      const b = document.createElement('button');
      b.className = 'fmt' + (lobbyFormat === id ? ' on' : '');
      b.innerHTML = `<b>${f.name}</b><small>${f.desc}</small>`;
      b.addEventListener('click', () => { lobbyFormat = id; renderFormatChips(); });
      ui.lbFormats.appendChild(b);
    }
  }

  function lobbyName() {
    const n = ui.lbName.value.trim().slice(0, 12);
    if (!n) { lobbyMsg('Enter your name first.'); ui.lbName.focus(); return null; }
    playerName = n;
    store.set('neonDash.name', n);
    return n;
  }

  async function createRace() {
    if (!lobbyName()) return;
    lobbyBusy(true);
    try {
      net = net || await NeonNet.connect();
      const code = await net.createRoom(lobbyFormat, { name: playerName, look: myLook() });
      enterRoom(code);
      lobbyMsg('');
    } catch (e) { lobbyMsg((e && e.message) || 'Could not connect.'); }
    lobbyBusy(false);
  }

  async function joinRace(codeIn) {
    if (!lobbyName()) return;
    const code = String(codeIn || ui.lbCode.value).trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { lobbyMsg('Room codes are 4 letters or numbers.'); return; }
    lobbyBusy(true);
    try {
      net = net || await NeonNet.connect();
      const res = await net.joinRoom(code, { name: playerName, look: myLook() });
      if (res.ok) { enterRoom(code); lobbyMsg(''); } else lobbyMsg(res.reason);
    } catch (e) { lobbyMsg((e && e.message) || 'Could not connect.'); }
    lobbyBusy(false);
  }

  function enterRoom(code) {
    race = { code, host: false, format: 'sprint', round: 0, phase: 'lobby', room: null, rivals: {} };
    race.unsub = net.watchRoom(code, onRoom);
    ui.lbRoomCode.textContent = code;
    show(ui.lobbyJoin, false);
    show(ui.lobbyRoom, true);
  }

  async function leaveRace() {
    if (!race) return;
    const r = race;
    race = null;
    if (r.unsub) r.unsub();
    show(ui.lobby, false); show(ui.results, false); show(ui.reactions, false);
    show($('pauseBtn'), true);
    toMenu();
    try { await net.leaveRoom(r.code, r.host); } catch { /* ignore */ }
  }

  function onRoom(room) {
    if (!race) return;
    race.room = room;
    const m = room.meta;
    if (!m) { toast('The host closed the room.'); leaveRace(); return; }
    race.format = m.format;
    race.host = m.host === net.uid;
    for (const [uid, p] of Object.entries(room.players)) {
      if (uid === net.uid) continue;
      const rv = race.rivals[uid] || (race.rivals[uid] = { uid, d: 0, x: 0, y: 0, mx: 0, my: 0, phase: Math.random() * 6 });
      rv.name = p.name; rv.look = p.look || {};
      const st = room.state[uid];
      rv.tgt = st && st.r === race.round ? st : null;
    }
    for (const uid of Object.keys(race.rivals)) if (!room.players[uid]) delete race.rivals[uid];
    if (m.status === 'countdown' && m.round !== race.round) { race.round = m.round; beginRace(m); return; }
    if (race.phase === 'lobby') renderLobbyRoom();
    if (race.phase === 'racing' || race.phase === 'done') checkRaceOver();
  }

  function runnerIcon(lk) {
    const c = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = 40 * dpr; c.height = 52 * dpr;
    c.style.width = '40px'; c.style.height = '52px';
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    NeonLooks.drawRunner(x, 20, 50, 24, { phase: 0.5 }, NeonLooks.byId(NeonLooks.OUTFITS, lk.outfit), 0, lk);
    return c;
  }

  function renderLobbyRoom() {
    const room = race.room;
    const f = FORMATS[race.format] || FORMATS.sprint;
    ui.lbFormatLabel.textContent = `${f.name}: ${f.desc}`;
    ui.lbPlayers.innerHTML = '';
    const entries = Object.entries(room.players).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    for (const [uid, p] of entries) {
      const row = document.createElement('div');
      row.className = 'player';
      row.appendChild(runnerIcon(p.look || {}));
      const nm = document.createElement('span');
      nm.textContent = p.name + (uid === net.uid ? ' (you)' : '');
      row.appendChild(nm);
      if (uid === room.meta.host) { const h = document.createElement('small'); h.textContent = 'HOST'; row.appendChild(h); }
      ui.lbPlayers.appendChild(row);
    }
    for (let i = entries.length; i < NeonNet.MAX_PLAYERS; i++) {
      const row = document.createElement('div');
      row.className = 'player empty';
      row.textContent = 'Waiting for a friend…';
      ui.lbPlayers.appendChild(row);
    }
    const enough = entries.length >= 2;
    show(ui.lbStart, race.host);
    ui.lbStart.disabled = !enough;
    ui.lbStart.textContent = enough ? 'START RACE' : 'NEED 2+ RUNNERS';
    show(ui.lbWaiting, !race.host);
  }

  function hostStart() {
    if (!race || !race.host) return;
    net.setMeta(race.code, { status: 'countdown', seed: NeonGhost.newSeed(), startAt: net.serverNow() + 4000, round: race.round + 1 })
      .catch(() => toast('Could not start, please try again.'));
  }

  async function inviteFriends() {
    if (!race) return;
    const url = `${location.origin}${location.pathname}?room=${race.code}`;
    const text = `🏁 Race me in Neon Dash! Room ${race.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Neon Dash race', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Invite link copied!'); } catch { window.prompt('Send this link to your friends:', url); }
  }

  function beginRace(m) {
    for (const el of [ui.lobby, ui.results, ui.over, ui.cleared, ui.cont, ui.paused, ui.city]) show(el, false);
    Object.assign(race, {
      phase: 'countdown', seed: m.seed, startAt: m.startAt, steps: 0, finished: 0, dead: false, deadAt: 0,
      over: false, rewarded: false, firstFinishAt: 0, emoji: '', emojiAt: 0,
    });
    for (const rv of Object.values(race.rivals)) Object.assign(rv, { d: 0, x: 0, y: 0, mx: 0, my: 0, tgt: null });
    if (m.format === 'maze') startMaze(2, m.seed); else start(null, m.seed);
    state = 'countdown';
    show(ui.reactions, true);
    show($('pauseBtn'), false); // a live race can't be paused
    publishRace();
  }

  // Ease each rival toward its latest reported position (runs every step while racing or waiting).
  function smoothRivals(dt) {
    const k = Math.min(1, dt * 10);
    for (const rv of Object.values(race.rivals)) {
      const t = rv.tgt;
      if (!t) continue;
      const prev = rv.d;
      // a report is ~0.1-0.3 s old when it arrives: move the rival on by how far they ran since
      // (everyone's speed follows the same race clock, so ours is a good estimate of theirs)
      const lag = t.t ? Math.min(0.6, Math.max(0, (net.serverNow() - t.t) / 1000)) : 0;
      const running = t.a !== false && !t.f && mode !== 'maze' && state === 'play';
      // dead reckoning: keep them moving at race speed, and use each report to correct the error
      if (running) rv.d += speed * dt;
      rv.d += ((t.d || 0) + (running ? speed * lag : 0) - rv.d) * k;
      rv.x += ((t.x || 0) - rv.x) * k;
      rv.y += ((t.y || 0) - rv.y) * k;
      if (t.mx !== undefined) { rv.mx += (t.mx - rv.mx) * k; rv.my += (t.my - rv.my) * k; }
      const v = Math.max(0, (rv.d - prev) / dt);
      if (v > 0.5) rv.phase += dt * cadence(v);
    }
  }

  function raceTick() {
    race.steps++;
    if (race.format === 'sprint' && !race.finished && distance >= SPRINT_D) { raceFinished(); return; }
    if (race.steps % RACE_PUBLISH_STEPS === 0) publishRace();
  }

  function publishRace() {
    if (!race || !net) return;
    const st = { r: race.round, t: Math.round(net.serverNow()), d: +distance.toFixed(1), x: +player.x.toFixed(2), y: +player.y.toFixed(2), a: !race.dead, f: race.finished, k: race.deadAt };
    if (mode === 'maze' && mz) { st.mx = +mz.pos.x.toFixed(2); st.my = +mz.pos.y.toFixed(2); }
    if (race.emoji && net.serverNow() - race.emojiAt < 2000) { st.e = race.emoji; st.et = race.emojiAt; }
    net.setState(race.code, st).catch(() => {});
  }

  function raceFinished() {
    race.finished = race.steps;
    race.phase = 'done';
    state = 'raceDone';
    speed = 0;
    banner = { text: 'FINISHED!', color: C.gold, t: 0 };
    sfx.build();
    publishRace();
    checkRaceOver();
  }

  // After a fall in a race: Survival knocks you out; Sprint gets you back up.
  function raceAfterCrash() {
    if (race.format === 'survival') {
      race.dead = true;
      race.deadAt = race.steps;
      race.phase = 'done';
      state = 'raceDone';
      banner = { text: "YOU'RE OUT!", color: C.pink, t: 0 };
      publishRace();
      checkRaceOver();
      return;
    }
    fall = null;
    objects = objects.filter((o) => o.kind === 'coin' || o.kind === 'power' || o.z > 25);
    invuln = 1.5;
    runup = RUNUP * 0.4;
    player.y = 0;
    player.vy = 0;
    state = 'play';
  }

  // Cells from a world position to the exit (maze races).
  const mazeLeft = (wx, wy) => {
    if (!mz) return 0;
    const x = Math.max(0, Math.min(mz.maze.w - 1, Math.round(wx / CELL))), y = Math.max(0, Math.min(mz.maze.h - 1, Math.round(wy / CELL)));
    return mz.toExit[y][x];
  };

  function raceStandings() {
    const rows = [{ me: true, uid: net.uid, name: playerName || 'You', d: distance, f: race.finished, a: !race.dead, k: race.deadAt,
      left: mode === 'maze' && mz ? mazeLeft(mz.pos.x, mz.pos.y) : 0 }];
    for (const rv of Object.values(race.rivals)) {
      const t = rv.tgt || {};
      rows.push({ me: false, uid: rv.uid, name: rv.name, d: t.d || 0, f: t.f || 0, a: t.a !== false, k: t.k || 0, left: t.mx !== undefined ? mazeLeft(t.mx, t.my) : 99 });
    }
    const fmt = race.format;
    const order = (p, q) => {
      if (fmt === 'survival') return (q.a - p.a) || (p.a ? q.d - p.d : q.k - p.k);
      if (!!q.f !== !!p.f) return q.f ? 1 : -1;
      if (p.f) return p.f - q.f;
      return fmt === 'maze' ? p.left - q.left : q.d - p.d;
    };
    // exact ties are broken by player id, so every phone shows the same order
    rows.sort((p, q) => order(p, q) || (p.uid < q.uid ? -1 : 1));
    return rows;
  }

  function checkRaceOver() {
    if (!race || race.over || !(race.phase === 'racing' || race.phase === 'done')) return;
    const rows = raceStandings();
    let over;
    if (race.format === 'survival') {
      const alive = rows.filter((r) => r.a).length;
      over = rows.length < 2 ? !rows[0].a : alive <= 1;
    } else {
      if (!race.firstFinishAt && rows.some((r) => r.f)) race.firstFinishAt = Date.now();
      over = rows.every((r) => r.f) || (race.firstFinishAt && Date.now() - race.firstFinishAt > RACE_GRACE_MS);
    }
    if (over) showResults(rows);
  }

  function showResults(rows) {
    race.over = true;
    race.phase = 'results';
    if (state === 'play' || state === 'dying' || state === 'countdown') state = 'raceDone';
    speed = 0;
    const place = rows.findIndex((r) => r.me) + 1;
    const reward = [50, 25, 10, 10][place - 1] || 10;
    if (!race.rewarded) { race.rewarded = true; wallet += reward; store.set('neonDash.wallet', wallet); }
    const metric = (r) => {
      if (race.format === 'survival') return `${Math.floor(r.d)} m${r.a ? ' · still running' : ''}`;
      if (r.f) return fmtTime(r.f);
      return race.format === 'maze' ? `${r.left} cells from exit` : `${Math.floor(r.d)} m`;
    };
    ui.rsTitle.textContent = place === 1 ? 'YOU WIN! 🏆' : `YOU CAME ${ordinal(place).toUpperCase()}`;
    ui.rsList.innerHTML = rows.map((r, i) => `<li class="${r.me ? 'me' : ''}"><span class="medal">${['🥇', '🥈', '🥉', '4️⃣'][i] || ''}</span>`
      + `<span class="nm">${esc(r.name)}${r.me ? ' (you)' : ''}</span><span class="st">${metric(r)}</span></li>`).join('');
    ui.rsReward.textContent = `+${reward} 🪙 → wallet: ${wallet}`;
    show(ui.rsRematch, race.host);
    show(ui.rsWaiting, !race.host);
    show(ui.hud, false);
    show(ui.reactions, false);
    show(ui.results, true);
    if (place === 1) sfx.build();
  }

  function sendReaction(e) {
    if (!race || !net) return;
    race.emoji = e;
    race.emojiAt = net.serverNow();
    publishRace();
  }

  // Countdown, standings and status text over the road.
  function drawRaceHud() {
    if (!race) return;
    ctx.textAlign = 'center';
    if (state === 'countdown') {
      const left = Math.min(3, Math.ceil((race.startAt - net.serverNow()) / 1000));
      ctx.font = `900 italic ${Math.min(W, H) * 0.3}px system-ui, sans-serif`;
      ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = '#0b0221';
      const txt = left > 0 ? String(left) : 'GO!';
      ctx.strokeText(txt, W / 2, H * 0.36); ctx.fillStyle = C.yellow; ctx.fillText(txt, W / 2, H * 0.36);
      ctx.font = '800 18px system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(FORMATS[race.format].name + ': ' + FORMATS[race.format].desc, W / 2, H * 0.36 + 40);
    } else if (race.phase === 'racing' || race.phase === 'done') {
      const rows = raceStandings();
      const top = mode === 'maze' ? 200 : 62;
      ctx.font = '800 13px system-ui, sans-serif';
      rows.forEach((r, i) => {
        const val = race.format === 'sprint' ? (r.f ? '🏁' : `${Math.floor(r.d)}/${SPRINT_D} m`)
          : race.format === 'survival' ? (r.a ? `${Math.floor(r.d)} m` : '💥 out')
          : (r.f ? '🏁' : `${r.left} to exit`);
        const line = `${i + 1}. ${r.name}  ${val}`;
        const tw = ctx.measureText(line).width;
        const x = mode === 'maze' ? W - 14 - tw / 2 - 8 : W / 2;
        ctx.fillStyle = 'rgba(11,2,33,.7)';
        ctx.fillRect(x - tw / 2 - 8, top + i * 22, tw + 16, 20);
        ctx.fillStyle = r.me ? C.gold : '#e2c7ff';
        ctx.fillText(line, x, top + i * 22 + 15);
      });
      if (race.phase === 'done') {
        ctx.font = '800 16px system-ui, sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText(race.dead ? "You're out. Waiting for the others…" : 'Finished! Waiting for the others…', W / 2, H * 0.9);
      }
    }
    ctx.textAlign = 'start';
  }

  // Emoji bubble above a runner (screen point at head height).
  function drawEmoji(e, p) {
    ctx.font = `${Math.max(18, Math.min(40, p.s * 0.6))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(e, p.x, p.y);
    ctx.textAlign = 'start';
  }
  const rivalEmoji = (rv) => (rv.tgt && rv.tgt.e && net.serverNow() - rv.tgt.et < 2000 ? rv.tgt.e : '');
  const myEmoji = () => (race && race.emoji && net.serverNow() - race.emojiAt < 2000 ? race.emoji : '');

  $('raceBtn').addEventListener('click', () => openLobby());
  $('lbCreate').addEventListener('click', () => createRace());
  $('lbJoin').addEventListener('click', () => joinRace());
  $('lbBack').addEventListener('click', () => { show(ui.lobby, false); show(ui.menu, true); });
  $('lbStart').addEventListener('click', hostStart);
  $('lbInvite').addEventListener('click', inviteFriends);
  $('lbLeave').addEventListener('click', () => leaveRace());
  $('rsRematch').addEventListener('click', hostStart);
  $('rsLeave').addEventListener('click', () => leaveRace());
  for (const b of ui.reactions.querySelectorAll('button')) b.addEventListener('click', () => sendReaction(b.textContent));

  readChallengeLink();

  // Test hook for automated checks (only when the URL ends in #test).
  if (location.hash === '#test') {
    window.neonTest = {
      put: (o) => objects.push(Object.assign({ x: 0, y: 1, hw: 0.45, hd: 0.45, h: 0 }, o)),
      wall: (z, x = 0) => objects.push({ kind: 'wall', x, hw: 1, z, hd: 0.6, h: 2.4 }),
      barrier: (z) => objects.push({ kind: 'barrier', x: 0, hw: ROAD, z, hd: 0.3, h: 0.9 }),
      peek: () => ({ state, power: { ...power }, invuln, coinCount, wallet, x: player.x }),
      god: (on) => { invuln = on ? 1e9 : 0; },
      race: () => race && { phase: race.phase, code: race.code, host: race.host, format: race.format, round: race.round,
        rivals: Object.values(race.rivals).map((r) => ({ name: r.name, d: r.d, tgt: r.tgt })), state, distance, finished: race.finished, dead: race.dead },
      sprintTo: (d) => { distance = d; },
      run: () => ({ distance, playSteps, recorder, ghost, shareCode, objects: objects.map((o) => ({ kind: o.kind, x: +o.x.toFixed(3), z: +(o.z + distance).toFixed(2) })) }),
      maze: () => mz,
      steer: (d) => mazeSteer(d),
      jump: () => requestJump(),
    };
  }

  // ---------- Loop ----------
  let last = performance.now();
  const STEP = 1 / 60;
  let stepAcc = 0;
  let lastRaceCheck = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'menu') {
      // the runner waits at the start line; the camera sways gently
      time += dt;
      camX = Math.sin(time * 0.5) * 0.6;
    } else if (state !== 'paused') {
      if (race && state === 'countdown' && net.serverNow() >= race.startAt) { state = 'play'; race.phase = 'racing'; stepAcc = 0; }
      if (race && now - lastRaceCheck > 500) { lastRaceCheck = now; checkRaceOver(); }
      // fixed 1/60 s steps: the same seed and the same moves give the same run on every phone
      stepAcc += dt;
      let n = 0;
      while (stepAcc >= STEP && n < 6) { update(STEP); stepAcc -= STEP; n++; }
      if (n === 6) stepAcc = 0;
    }
    if (mode === 'maze' && mz) renderMaze(); else render();
    if (!ui.city.classList.contains('hidden')) renderShopPreview(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
