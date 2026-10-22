'use strict';

// Hands-on shop day, seen from behind the counter. Shoppers come in off the street, walk the
// aisles, take goods off the shelves into a basket, queue and pay at your till. A delivery van
// drops boxes on the stock pile and a stock clerk carries them to the shelves.
//
// Every unit of the stall's stock is always in exactly one place:
//   b.stock = on shelves + stock pile + on the van + in the clerk's box + in shoppers' baskets
window.NeonShop = (() => {
  const T = window.NeonTycoon;
  const DAY_SECONDS = 75;          // 9:00 to 21:00
  const OPEN_H = 9, CLOSE_H = 21;
  const STAFF = [0, 1, 3];         // helpers at the till, by stall tier
  const STAFF_SERVE = 4;           // seconds a helper takes per shopper
  const CUSTOMERS = [26, 40, 55];  // shoppers who walk in on a normal day, by tier

  // layout, as fractions of the canvas
  const L = { sign: 0.045, street: 0.16, wall: 0.17, door: 0.27, enter: 0.31, counter: 0.79 };
  const ROWS = 3;
  // two shelf walls either side of the door, and two shelf islands in the middle of the floor
  const UNITS = [
    { x0: 0.02, x1: 0.39, top: L.wall + 0.006, base: L.door, cols: 5, wall: true },
    { x0: 0.61, x1: 0.79, top: L.wall + 0.006, base: L.door, cols: 3, wall: true },
    { x0: 0.05, x1: 0.37, top: 0.42, base: 0.53, cols: 4 },
    { x0: 0.63, x1: 0.95, top: 0.42, base: 0.53, cols: 4 },
  ];
  const PILE = { x: 0.13, y: 0.735 };     // where deliveries are stacked
  const CLERK_HOME = { x: 0.25, y: 0.7 };
  const VAN_X = 0.76;
  const FRIDGE = { x0: 0.805, x1: 0.985, top: 0.075, base: 0.27 };   // a drinks fridge against the front wall
  // props on the shop floor: [kind, x, y]
  const PROPS = [['plant', 0.365, 0.315], ['baskets', 0.64, 0.325], ['wet', 0.9, 0.69], ['bin', 0.255, 0.785], ['candy', 0.355, 0.78]];
  const TALKS = [['NEW', '#05d9e8'], ['★ BEST SELLER', '#ffd23f'], ['LOCAL FAV', '#4ade80'], ['HOT', '#ff7a00']];
  const LAMPS = [[0.22, 0.335, 0.64], [0.5, 0.37, 0.48], [0.78, 0.335, 0.64]];   // [x, lamp y, floor y below it]
  const PACK_W = { drinks: 0.52, noodles: 0.64, coffee: 0.56, vinyl: 0.86, holo: 0.64, sneakers: 0.96, chips: 0.56, signs: 0.9 };

  let run = null;

  // ---------- sound ----------
  let actx = null;
  const muted = () => { try { return JSON.parse(localStorage.getItem('neonDash.muted') || 'false'); } catch { return false; } };
  function tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
    if (muted()) return;
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  }
  const sfx = {
    ching: () => { tone(1568, 0.08, 'square', 0.05); tone(2093, 0.18, 'square', 0.045, 0, 0.07); },
    bell: () => { tone(1320, 0.25, 'triangle', 0.04); tone(990, 0.3, 'triangle', 0.03, 0, 0.12); },
    huff: () => tone(220, 0.25, 'sawtooth', 0.04, 110),
    thud: () => tone(110, 0.14, 'sine', 0.09, 45),
    horn: () => { tone(415, 0.1, 'square', 0.03); tone(415, 0.14, 'square', 0.03, 0, 0.16); },
    pop: () => tone(880, 0.05, 'triangle', 0.02, 1200),
    beep: () => tone(2600, 0.045, 'square', 0.022),
    whoosh: () => noiseBurst(0.45, 0.05, 600, 2400),
  };
  function noiseBuffer(sec) {
    const b = actx.createBuffer(1, Math.ceil(actx.sampleRate * sec), actx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // a short filtered hiss: the sliding doors
  function noiseBurst(dur, vol, f0, f1) {
    if (muted() || !actx) return;
    const t = actx.currentTime, src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = noiseBuffer(dur); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(actx.destination); src.start(t); src.stop(t + dur);
  }
  // background: soft shop music, and street noise that gets louder when the doors open
  const CHORDS = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 392]];
  const ambience = {
    street: null,
    start() {
      if (muted()) return;
      try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      try {
        const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
        src.buffer = noiseBuffer(2); src.loop = true; f.type = 'lowpass'; f.frequency.value = 450; g.gain.value = 0.004;
        src.connect(f).connect(g).connect(actx.destination); src.start();
        this.street = { src, g };
      } catch { this.street = null; }
    },
    // called every frame: the next note of the music, and the street volume
    tick(r, dt) {
      if (this.street) this.street.g.gain.setTargetAtTime(0.004 + r.doorOpen * 0.03, actx.currentTime, 0.1);
      r.beat -= dt;
      if (r.beat > 0 || r.closed) return;
      r.beat = 0.42;
      const chord = CHORDS[Math.floor(r.note / 8) % CHORDS.length], i = r.note % 8;
      tone(chord[[0, 1, 2, 3, 2, 1, 2, 3][i]] * 2, 0.35, 'triangle', 0.010);
      if (i === 0) tone(chord[0] / 2, 1.6, 'sine', 0.018);
      r.note++;
    },
    stop() { if (this.street) { try { this.street.src.stop(); } catch { /* ignore */ } this.street = null; } },
  };

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randomLook = () => {
    const N = window.NeonLooks;
    const pick = (a) => a[(Math.random() * a.length) | 0];
    return { outfit: pick(N.OUTFITS).id, skin: (Math.random() * 5) | 0, hair: pick(N.HAIRS).id, hairColor: (Math.random() * 6) | 0 };
  };
  const depthK = (y) => clamp((y - L.street) / (L.counter - L.street), 0, 1);
  const scaleAt = (y, H) => H * (0.035 + 0.075 * depthK(y));

  // shelf geometry
  const kick = (u) => (u.base - u.top) * 0.12;
  const rowH = (u) => (u.base - u.top - kick(u)) / ROWS;
  const shelfY = (u, row) => u.base - kick(u) - row * rowH(u);   // where row `row` (0 = bottom) sits
  const unitSpot = (u) => ({ x: rand(u.x0 + 0.05, u.x1 - 0.05), y: u.wall ? L.enter : u.base + 0.065 });

  function makeSlots() {
    const slots = [];
    UNITS.forEach((u, ui) => {
      for (let row = 0; row < ROWS; row++) {
        for (let c = 0; c < u.cols; c++) {
          slots.push({ u: ui, row, x: u.x0 + (c + 0.5) * (u.x1 - u.x0) / u.cols, y: shelfY(u, row), n: 0, pop: 0, v: (Math.random() * 6) | 0 });
        }
      }
    });
    return slots;
  }
  const shelfTotal = () => run.slots.reduce((a, sl) => a + sl.n, 0);
  const unitItems = (ui) => run.slots.reduce((a, sl) => a + (sl.u === ui ? sl.n : 0), 0);
  const unitRoom = (ui) => run.slots.reduce((a, sl) => a + (sl.u === ui ? run.cap - sl.n : 0), 0);
  const backTotal = () => run.pile + run.incoming + run.clerk.carry;

  // ---------- open / close ----------
  // ui: { canvas, onTick(run), onEnd(summary) }
  function open(s, bizId, ui) {
    const res = T.startShopDay(s, bizId);
    if (!res.ok) return res;
    const b = res.b, tier = b.tier;
    const units = T.unitsPerDay(T.STALLS[tier].cap, b.good);
    const crowd = T.effectMod(s, b.district, b.good); // festivals, heatwaves...
    // a present owner draws a bigger crowd than the automatic day (35% more shoppers)
    const entrants = Math.max(3, Math.round(Math.min(CUSTOMERS[tier], units * 1.35) * crowd));
    const qtyMean = Math.max(1, (units * 1.35 * crowd) / entrants);
    const slots = makeSlots();
    // how many units one shelf spot holds: enough that a full shop's worth fits on the shelves
    const cap = Math.max(1, Math.ceil(Math.max(units * 3, b.stock) / slots.length));
    run = {
      s, b, ui, t: 0, entrants, qtyMean, spawned: 0, nextSpawn: 0.5, cap, slots,
      pile: 0, incoming: 0, deliveries: [], van: null,
      people: [], effects: [], boxes: [], dust: [],
      staffTimers: STAFF[tier] ? Array(STAFF[tier]).fill(0).map((_, i) => i * 1.3) : [],
      served: 0, sold: 0, revenue: 0, lostPrice: 0, lostWait: 0, lostStock: 0, closed: false, last: performance.now(), raf: 0,
      sellerLook: (() => { try { return Object.assign({ outfit: 'classic', skin: 2, hair: 'short', hairColor: 0 }, JSON.parse(localStorage.getItem('neonDash.look') || '{}')); } catch { return {}; } })(),
      staffLooks: Array.from({ length: STAFF[tier] }, randomLook),
      clerk: { kind: 'clerk', look: { outfit: 'dj', skin: (Math.random() * 5) | 0, hair: 'short', hairColor: 2 }, x: CLERK_HOME.x, y: CLERK_HOME.y, state: 'idle', carry: 0, phase: 0, facing: 'front' },
      speckles: Array.from({ length: 70 }, () => ({ u: Math.random(), v: Math.random(), dark: Math.random() < 0.5 })),
      belt: 0, drawer: 0, doorOpen: 0, cars: [], dpr: 1, beat: 0, note: 0,
      // shelf signs: one per shelving unit, hanging under a random spot
      talkers: UNITS.map((u, i) => ({ slot: slots.findIndex((sl) => sl.u === i && sl.row === 0) + (Math.random() < 0.5 ? 0 : u.cols - 1), talk: TALKS[(Math.random() * TALKS.length) | 0] })),
      // what's in the drinks fridge: four shelves of cans and bottles
      fridge: Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => ({ kind: Math.random() < 0.5 ? 'bottle' : 'drinks', v: (Math.random() * 6) | 0 }))),
      skyline: Array.from({ length: 9 }, (_, i) => ({ x: i / 9 + rand(-0.02, 0.02), w: rand(0.08, 0.14), h: rand(0.025, 0.055), lit: Math.random() })),
    };
    // stock the shelves for opening: bottom rows first, spread across all the shelving
    const order = slots.slice().sort((a, c) => a.row - c.row || a.u - c.u || a.x - c.x);
    let left = b.stock;
    for (let pass = 0; left > 0 && pass < cap; pass++) {
      for (const sl of order) { if (left <= 0) break; sl.n++; left--; }
    }
    run.pile = left;
    // passers-by who just walk past, so the street feels alive
    for (let i = 0; i < 4; i++) addPasser(Math.random());
    ambience.start();
    const loop = (now) => {
      if (!run) return;
      const dt = Math.min(0.05, (now - run.last) / 1000);
      run.last = now;
      step(dt);
      draw();
      ui.onTick(run);
      if (run && run.done) { ambience.stop(); const sum = summary(); const cb = ui.onEnd; run = null; cb(sum); return; }
      run.raf = requestAnimationFrame(loop);
    };
    run.raf = requestAnimationFrame(loop);
    sfx.bell();
    return { ok: true };
  }

  function summary() {
    return { served: run.served, sold: run.sold, revenue: Math.round(run.revenue), lostPrice: run.lostPrice, lostWait: run.lostWait, lostStock: run.lostStock, entrants: run.spawned };
  }

  // ---------- people ----------
  function addPasser(startFrac = 0) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    run.people.push({ kind: 'passer', look: randomLook(), x: dir > 0 ? -0.1 + startFrac * 1.2 : 1.1 - startFrac * 1.2, y: L.street, dir, speed: 0.08 + Math.random() * 0.05, phase: Math.random() * 6 });
  }

  function addShopper() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    run.spawned++;
    run.people.push({
      kind: 'shopper', state: 'street', look: randomLook(), x: dir > 0 ? -0.08 : 1.08, y: L.street, dir, speed: 0.11 + Math.random() * 0.04,
      phase: Math.random() * 6, limit: T.shopperLimit(), qty: Math.max(1, Math.round(run.qtyMean * (0.6 + Math.random() * 0.8))),
      patience: 10 + Math.random() * 8, wait: 0, bubble: null, timer: 0, mood: undefined, bag: false, basket: 0, facing: 'back',
    });
    // some come as a couple, or a parent with a child, who tag along without buying
    const lead = run.people[run.people.length - 1], roll = Math.random();
    if (roll < 0.3) {
      const child = roll < 0.1;
      run.people.push({ kind: 'companion', leader: lead, child, look: randomLook(), x: lead.x - dir * 0.05, y: lead.y, side: Math.random() < 0.5 ? -1 : 1, phase: Math.random() * 6, facing: 'back' });
    }
  }

  const queue = () => run.people.filter((p) => p.state === 'queue' || p.state === 'serving').sort((a, b) => a.qAt - b.qAt);
  const queueSpot = (i) => ({ x: 0.5 + (i % 2 ? 0.05 : -0.05) * Math.min(1, i), y: L.counter - 0.035 - i * 0.05 });
  const atTill = (x) => x.state === 'queue' && x.y > L.counter - 0.13;

  function moveToward(p, tx, ty, dt, speed) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d < 0.004) { p.x = tx; p.y = ty; return true; }
    const m = Math.min(d, speed * dt);
    p.x += (dx / d) * m; p.y += (dy / d) * m;
    p.phase += dt * 9; p.moving = true;
    if (Math.abs(dy) > 0.002) p.facing = dy > 0 ? 'front' : 'back';
    return false;
  }
  // follow p.path (a list of [x, y] points); true once at the end
  function walk(p, dt, speed) {
    if (!p.path || !p.path.length) return true;
    if (moveToward(p, p.path[0][0], p.path[0][1], dt, speed)) p.path.shift();
    return !p.path.length;
  }
  // routes through the shop: the centre aisle (x = 0.5) joins everything
  function routeTo(from, to) {
    const pts = [];
    if (Math.abs(from.x - 0.5) > 0.01) pts.push([0.5, from.y]);
    if (Math.abs(to.y - from.y) > 0.005) pts.push([0.5, to.y]);
    pts.push([to.x, to.y]);
    return pts;
  }

  const say = (p, text, sec = 2.2) => { p.bubble = text; p.bubbleT = sec; };
  const pick = (a) => a[(Math.random() * a.length) | 0];
  function leaveShop(p, mood, bubble) {
    if (p.basket) { run.pile += p.basket; p.basket = 0; } // a dropped basket goes back to the stock pile
    p.state = 'leaving'; p.mood = mood; p.hold = false; say(p, bubble);
    p.exitDir = Math.random() < 0.5 ? -1 : 1;
    p.path = routeTo(p, { x: 0.5, y: L.enter }).concat([[0.5, L.street]]);
  }

  // pick a shelf to visit, favouring well-stocked ones
  function pickUnit() {
    const w = UNITS.map((_, i) => unitItems(i) + 0.5);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return 0;
  }

  // take goods off the shelves into the basket; the nearest shelf spots go first
  function takeGoods(p) {
    let need = Math.min(p.qty, shelfTotal()), flies = 0;
    while (need > 0) {
      const mine = run.slots.filter((sl) => sl.n > 0 && sl.u === p.unit);
      const pool = mine.length ? mine : run.slots.filter((sl) => sl.n > 0);
      pool.sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x) || c.row - a.row);
      const sl = pool[0], t = Math.min(need, sl.n);
      sl.n -= t; need -= t; p.basket += t;
      if (flies < 4) run.effects.push({ kind: 'fly', x: sl.x, y: sl.y, to: p, t: -flies * 0.12, dur: 0.38 });
      flies++;
    }
    p.state = 'pick'; p.timer = 0.45 + Math.min(4, flies) * 0.12; p.facing = 'back';
    sfx.pop();
  }

  // ---------- simulation ----------
  function step(dt) {
    const r = run;
    r.t += dt;
    const open = r.t < DAY_SECONDS;
    // shoppers arrive spread over the day
    if (open && r.spawned < r.entrants && r.t >= r.nextSpawn) {
      addShopper();
      const gap = (DAY_SECONDS * 0.9) / r.entrants;
      r.nextSpawn = r.t + gap * (0.5 + Math.random());
    }
    if (open && Math.random() < dt * 0.6) addPasser();

    const mult = r.b.mult || T.RETAIL;
    for (const p of r.people) {
      p.moving = false;
      if (p.bubbleT !== undefined) p.bubbleT -= dt;
      if (p.kind === 'passer') { p.x += p.dir * p.speed * dt; p.phase += dt * 8; p.moving = true; continue; }
      switch (p.state) {
        case 'street': // walk along the pavement, turn in at the door
          p.x += p.dir * p.speed * dt; p.phase += dt * 8; p.moving = true;
          if (!open) { p.kind = 'passer'; break; }
          if (Math.abs(p.x - 0.5) < 0.02) {
            p.x = 0.5; p.state = 'enter'; p.unit = pickUnit();
            const spot = unitSpot(UNITS[p.unit]);
            p.path = [[0.5, L.enter]].concat(routeTo({ x: 0.5, y: L.enter }, spot));
          }
          break;
        case 'enter':
          if (walk(p, dt, 0.2)) { p.state = 'look'; p.timer = rand(0.7, 1.4); p.facing = 'back'; }
          break;
        case 'look': // read the price tag
          p.timer -= dt;
          if (p.timer > 0) break;
          // some browse a second shelf before making up their mind
          if (!p.wandered && Math.random() < 0.3) {
            p.wandered = true;
            p.unit = (p.unit + 1 + ((Math.random() * (UNITS.length - 1)) | 0)) % UNITS.length;
            p.path = routeTo(p, unitSpot(UNITS[p.unit])); p.state = 'enter';
            break;
          }
          // some pick a pack up to look at it first, then buy it or put it back
          if (shelfTotal() > 0 && !p.considered && Math.random() < (mult > p.limit ? 0.6 : 0.3)) {
            p.considered = true; p.state = 'consider'; p.timer = rand(0.9, 1.5); p.hold = true;
            break;
          }
          if (mult > p.limit) { r.lostPrice++; leaveShop(p, 'angry', pick(['😒 Too pricey!', '😒 How much?!', '💸 Nope.'])); break; }
          if (shelfTotal() > 0) takeGoods(p);
          else if (backTotal() > 0) { p.state = 'wait'; p.wait = 0; p.mood = 'meh'; say(p, '⏳ Restock, please?', 99); }
          else { r.lostStock++; leaveShop(p, 'sad', '📦 Out of stock?!'); }
          break;
        case 'consider': // holding a pack, reading the label
          p.timer -= dt;
          if (p.timer > 0) break;
          p.hold = false;
          if (mult > p.limit) { // puts it back
            const sl = run.slots.filter((x) => x.u === p.unit && x.n > 0).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
            if (sl) sl.pop = 0.2;
            r.lostPrice++; leaveShop(p, 'angry', pick(['😒 Too pricey!', '🤔 Not at that price.']));
          } else p.state = 'look', p.timer = 0;
          break;
        case 'wait': // shelves are empty but there is stock out back
          p.wait += dt;
          if (shelfTotal() > 0) { p.bubbleT = 0; takeGoods(p); }
          else if (p.wait > p.patience || backTotal() === 0) { r.lostStock++; leaveShop(p, 'sad', '📦 Out of stock?!'); }
          break;
        case 'pick':
          p.timer -= dt;
          if (p.timer <= 0) {
            p.state = 'toQueue'; p.path = [[0.5, p.y]];
            say(p, mult < p.limit * 0.8 ? pick(['😍 Bargain!', '😍 So cheap!']) : pick(['🙂 Nice.', '🙂 Just what I need.']), 1.4); p.mood = 'happy';
          }
          break;
        case 'toQueue':
          if (walk(p, dt, 0.22)) { p.state = 'queue'; p.qAt = r.t; p.wait = 0; }
          break;
        case 'queue': {
          const q = queue(), spot = queueSpot(q.indexOf(p));
          moveToward(p, spot.x, spot.y, dt, 0.25);
          p.facing = 'front';
          p.wait += dt;
          if (p.wait > p.patience * 0.6) p.mood = 'meh';
          if (p.wait > p.patience) { r.lostWait++; leaveShop(p, 'angry', pick(['😠 Too slow!', '😠 Forget it!'])); sfx.huff(); }
          break;
        }
        case 'serving': {
          p.timer -= dt;
          // the scanner beeps for each item
          const scanned = Math.ceil(clamp(1 - p.timer / p.serveDur, 0, 1) * p.basket);
          if (scanned > (p.scanned || 0)) { p.scanned = scanned; sfx.beep(); }
          if (p.timer <= 0) finishSale(p);
          break;
        }
        case 'leaving':
          if (walk(p, dt, 0.24)) { p.x += p.exitDir * 0.14 * dt; p.phase += dt * 8; p.moving = true; }
          break;
      }
    }
    for (const c of r.people) {
      if (c.kind !== 'companion') continue;
      const l = c.leader;
      if (!r.people.includes(l)) { c.x = 9; continue; } // their leader has gone
      c.moving = false;
      const atShelf = ['look', 'consider', 'pick', 'wait'].includes(l.state);
      moveToward(c, l.x + c.side * (atShelf ? 0.06 : 0.045), l.y + (l.y < L.wall ? 0 : 0.012), dt, 0.32);
      if (!c.moving) c.facing = l.facing;
      c.mood = l.mood;
    }
    // people step around each other (a small sideways nudge, drawn only)
    const crowd = r.people.filter((p) => p.y > L.wall && p.kind !== 'passer' && p.state !== 'queue' && p.state !== 'serving');
    for (const p of crowd) {
      let push = 0;
      for (const q of crowd) {
        if (q === p) continue;
        const dx = p.x - q.x, dy = Math.abs(p.y - q.y);
        if (dy < 0.03 && Math.abs(dx) < 0.05) push += (dx >= 0 ? 1 : -1) * (0.05 - Math.abs(dx)) * 0.6;
      }
      p.ox = (p.ox || 0) + (clamp(push, -0.04, 0.04) - (p.ox || 0)) * Math.min(1, dt * 5);
    }
    stepClerk(dt);
    stepVan(dt);
    ambience.tick(r, dt);
    // traffic on the road
    if (Math.random() < dt * 0.3) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      r.cars.push({ x: dir > 0 ? -0.15 : 1.15, dir, lane: dir > 0 ? 0.142 : 0.131, speed: rand(0.3, 0.55), color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0] });
    }
    for (const c of r.cars) c.x += c.dir * c.speed * dt;
    r.cars = r.cars.filter((c) => c.x > -0.3 && c.x < 1.3);
    // the doors open for anyone walking in or out
    const nearDoor = (p) => p && Math.abs(p.x - 0.5) < 0.1 && p.y > L.street - 0.01 && p.y < L.enter + 0.06;
    const wantOpen = r.people.some((p) => ((p.kind === 'shopper' && (p.state === 'enter' || p.state === 'leaving')) || (p.kind === 'companion' && p.y > L.street + 0.005)) && nearDoor(p)) || nearDoor(r.van && r.van.courier);
    if (wantOpen && r.doorOpen === 0) sfx.whoosh();
    r.doorOpen = clamp(r.doorOpen + (wantOpen ? 4 : -2.5) * dt, 0, 1);
    // helpers at the till serve the front of the queue on their own
    r.staffTimers = r.staffTimers.map((tm, i) => {
      tm -= dt;
      if (tm <= 0) {
        const p = queue().find(atTill);
        if (p) { startServe(p, 0.8, i); return STAFF_SERVE * (0.8 + Math.random() * 0.4); }
        return 0.3;
      }
      return tm;
    });
    if (r.people.some((p) => p.state === 'serving')) r.belt += dt;
    if (r.drawer > 0) r.drawer -= dt;
    for (const sl of r.slots) if (sl.pop > 0) sl.pop = Math.max(0, sl.pop - dt);
    for (const fx of r.effects) { fx.t += dt; if (fx.kind === 'text') fx.y -= dt * 0.08; }
    r.effects = r.effects.filter((fx) => (fx.kind === 'text' ? fx.t < 1.1 : fx.t < fx.dur));
    stepBoxes(dt);
    r.people = r.people.filter((p) => p.x > -0.2 && p.x < 1.2);
    // the day ends at closing time once the shop is empty (or 10 s after closing)
    if (!open && !r.closed) { r.closed = true; for (const p of r.people) if (p.state === 'street') p.kind = 'passer'; }
    const inside = r.people.some((p) => p.kind === 'shopper' && p.state !== 'leaving');
    if (r.closed && (!inside || r.t > DAY_SECONDS + 10)) {
      for (const p of r.people) {
        if (p.kind !== 'shopper' || p.state === 'leaving') continue;
        r.lostWait++;
        r.pile += p.basket; p.basket = 0;
      }
      r.done = true;
    }
  }

  // the stock clerk carries boxes from the pile to the emptiest shelves
  function stepClerk(dt) {
    const r = run, c = r.clerk;
    c.moving = false;
    switch (c.state) {
      case 'idle': {
        if (!r.pile) {
          if (Math.random() < dt * 0.12) { // nothing to stock: go and tidy a shelf
            c.unit = (Math.random() * UNITS.length) | 0;
            c.path = routeTo(c, unitSpot(UNITS[c.unit])); c.state = 'toShelf'; c.tidy = true;
            break;
          }
          moveToward(c, CLERK_HOME.x, CLERK_HOME.y, dt, 0.2); if (!c.moving) c.facing = 'front'; break;
        }
        c.tidy = false;
        let best = -1, score = 0;
        UNITS.forEach((_, i) => {
          if (unitRoom(i) <= 0) return;
          const sc = unitRoom(i) - unitItems(i) * 0.2;
          if (best < 0 || sc > score) { best = i; score = sc; }
        });
        if (best < 0) break;
        // pick up a box from the pile
        c.unit = best;
        c.carry = Math.min(r.pile, unitRoom(best), r.cap * UNITS[best].cols * 2);
        r.pile -= c.carry;
        const from = { x: PILE.x + 0.08, y: PILE.y - 0.03 };
        c.path = [[from.x, from.y]].concat(routeTo(from, unitSpot(UNITS[best])));
        c.state = 'toShelf';
        break;
      }
      case 'toShelf':
        if (walk(c, dt, 0.28)) { c.state = 'stock'; c.timer = 0.1; c.facing = 'back'; }
        break;
      case 'stock': { // put goods on the shelf, one spot at a time
        c.timer -= dt;
        if (c.timer > 0) break;
        if (c.tidy) { // straighten a few packs, then head back
          const mine = r.slots.filter((x) => x.u === c.unit && x.n > 0);
          if (mine.length && (c.tidied = (c.tidied || 0) + 1) < 8) { pick(mine).pop = 0.15; c.timer = 0.3; break; }
          c.tidy = false; c.tidied = 0; c.state = 'back'; c.path = routeTo(c, { x: PILE.x + 0.08, y: PILE.y - 0.03 });
          break;
        }
        c.timer = 0.12;
        const sl = r.slots.filter((x) => x.u === c.unit && x.n < r.cap)
          .sort((a, b) => a.n - b.n || a.row - b.row || Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
        if (sl && c.carry > 0) {
          const add = Math.min(c.carry, Math.max(1, Math.ceil(r.cap / 3)), r.cap - sl.n);
          sl.n += add; c.carry -= add; sl.pop = 0.25;
        } else {
          c.state = 'back';
          c.path = routeTo(c, { x: PILE.x + 0.08, y: PILE.y - 0.03 });
        }
        break;
      }
      case 'back':
        if (walk(c, dt, 0.28)) { r.pile += c.carry; c.carry = 0; c.state = 'idle'; }
        break;
    }
  }

  // the delivery van: drives up, the courier carries the boxes in and drops them on the pile
  function stepVan(dt) {
    const r = run;
    if (!r.van && r.deliveries.length) r.van = { x: 1.45, state: 'in', trips: r.deliveries.splice(0), courier: null, wait: 0 };
    const v = r.van;
    if (!v) return;
    if (v.state === 'in') {
      v.x -= Math.max(0.08, (v.x - VAN_X) * 2.6) * dt;
      if (v.x <= VAN_X) { v.x = VAN_X; v.state = 'parked'; sfx.horn(); }
    } else if (v.state === 'parked') {
      if (r.deliveries.length) v.trips.push(...r.deliveries.splice(0));
      const c = v.courier;
      if (!c) {
        if (v.trips.length) {
          v.wait = 0;
          v.courier = {
            kind: 'courier', look: { outfit: 'sunset', skin: (Math.random() * 5) | 0, hair: 'buzz', hairColor: 1 },
            x: v.x - 0.16, y: L.street, phase: 0, facing: 'front', box: v.trips.shift(), state: 'carry',
            path: [[0.5, L.street + 0.004], [0.5, L.enter], [0.5, PILE.y - 0.06], [PILE.x + 0.12, PILE.y]],
          };
        } else if ((v.wait += dt) > 0.6) v.state = 'out';
      } else {
        c.moving = false;
        if (c.state === 'carry' && walk(c, dt, 0.34)) {
          // drop the box onto the pile
          r.boxes.push({ x: PILE.x + rand(-0.03, 0.03), y: c.y - 0.06, vy: -0.15, ty: PILE.y, units: c.box, bounced: false });
          c.box = 0; c.state = 'return';
          c.path = [[0.5, PILE.y - 0.06], [0.5, L.enter], [0.5, L.street + 0.004], [v.x - 0.16, L.street]];
        } else if (c.state === 'return' && walk(c, dt, 0.34)) {
          v.courier = null;
        }
      }
    } else if (v.state === 'out') {
      v.x -= 0.5 * dt;
      if (v.x < -0.6) r.van = null;
    }
  }

  function stepBoxes(dt) {
    const r = run;
    for (const bx of r.boxes) {
      bx.vy += 3.2 * dt; bx.y += bx.vy * dt;
      if (bx.y >= bx.ty) {
        bx.y = bx.ty;
        if (!bx.bounced) { bx.bounced = true; bx.vy = -0.35; sfx.thud(); puff(bx.x, bx.ty); }
        else { bx.done = true; r.incoming -= bx.units; r.pile += bx.units; }
      }
    }
    r.boxes = r.boxes.filter((bx) => !bx.done);
    for (const d of r.dust) { d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; }
    r.dust = r.dust.filter((d) => d.t < 0.6);
  }
  function puff(x, y) {
    for (let i = 0; i < 8; i++) run.dust.push({ x, y, vx: rand(-0.12, 0.12), vy: rand(-0.06, 0), t: 0 });
  }

  // who: -1 for you, or the helper's index
  function startServe(p, time, who = -1) {
    p.state = 'serving'; p.timer = time; p.serveDur = time; p.servedBy = who; p.scanned = 0;
  }

  function finishSale(p) {
    const r = run;
    const res = T.shopSale(r.s, r.b.id, p.basket);
    if (!res.ok) { r.lostStock++; leaveShop(p, 'sad', '📦 Out of stock?!'); return; }
    p.basket = 0;
    r.served++; r.sold += res.qty; r.revenue += res.revenue;
    p.bag = true;
    leaveShop(p, 'happy', pick(['😊 Thanks!', '💜 Love this place!', '👋 See you!', '😊 Have a good one!']));
    r.effects.push({ kind: 'receipt', to: p, t: 0, dur: 0.5 });
    r.effects.push({ kind: 'text', text: `+$${Math.round(res.revenue).toLocaleString()}`, x: p.x, y: L.counter - 0.1, t: 0 });
    sfx.ching();
    // how they paid: card, or cash rounded up to a note, with change
    const card = Math.random() < 0.6, total = res.revenue;
    const note = total < 20 ? 5 : total < 50 ? 10 : 20;
    r.lastSale = { qty: res.qty, price: total / res.qty, total, method: card ? 'card' : 'cash', card: 1000 + ((Math.random() * 9000) | 0), tendered: card ? total : Math.ceil((total + 0.01) / note) * note, t: r.t };
    if (!card) r.drawer = 0.8;
    try { navigator.vibrate && navigator.vibrate(12); } catch { /* ignore */ }
  }

  // tap: serve whoever is at the front of the queue (you are quick: about half a second)
  function serve() {
    if (!run) return false;
    const p = queue().find(atTill);
    if (!p) return false;
    startServe(p, 0.55);
    return true;
  }
  function closeEarly() { if (run) run.t = Math.max(run.t, DAY_SECONDS); }
  // order more stock: it arrives by van
  function refill() {
    if (!run) return { ok: false };
    const res = T.refillShelves(run.s, run.b.id);
    if (!res.ok) return res;
    run.incoming += res.moved;
    const trips = clamp(Math.ceil(res.moved / (run.cap * 8)), 1, 4);
    for (let i = 0; i < trips; i++) {
      const share = Math.floor(res.moved / trips) + (i < res.moved % trips ? 1 : 0);
      if (share) run.deliveries.push(share);
    }
    return res;
  }
  function setPrice(mult) { if (!run) return; T.setShelfPrice(run.s, run.b.id, mult); }
  const frontWaiting = () => !!(run && queue().some(atTill));

  // ---------- drawing ----------
  function draw() {
    const r = run, cv = r.ui.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const G = T.G[r.b.good], art = window.NeonShopArt;
    r.dpr = dpr;

    ctx.fillStyle = '#0d0420'; ctx.fillRect(0, 0, W, H);
    drawStreet(ctx, W, H);
    // people outside, seen through the windows
    const outside = (p) => p.y < L.wall - 0.001;
    const courier = r.van && r.van.courier;
    for (const p of r.people.filter(outside)) drawPerson(ctx, p, W, H, G);
    if (courier && outside(courier)) drawPerson(ctx, courier, W, H, G);
    drawStorefront(ctx, W, H, G);
    drawFloor(ctx, W, H);
    UNITS.forEach((u, i) => { if (u.wall) drawUnit(ctx, u, i, W, H, G); });
    drawFridge(ctx, W, H);
    drawDoor(ctx, W, H);
    drawLamps(ctx, W, H);

    // inside: shelf islands, the stock pile and people, far to near
    const items = [];
    UNITS.forEach((u, i) => { if (!u.wall) items.push({ y: u.base, draw: () => drawUnit(ctx, u, i, W, H, G) }); });
    items.push({ y: PILE.y, draw: () => drawPile(ctx, W, H, G) });
    for (const [kind, x, y] of PROPS) items.push({ y, draw: () => drawProp(ctx, kind, x, y, W, H) });
    for (const p of r.people) if (!outside(p)) items.push({ y: p.y, draw: () => drawPerson(ctx, p, W, H, G) });
    items.push({ y: r.clerk.y, draw: () => drawPerson(ctx, r.clerk, W, H, G) });
    if (courier && !outside(courier)) items.push({ y: courier.y, draw: () => drawPerson(ctx, courier, W, H, G) });
    items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());

    // boxes being dropped, and their dust
    for (const bx of r.boxes) drawBox(ctx, bx.x * W, bx.y * H, scaleAt(PILE.y, H) * 0.42, G);
    for (const d of r.dust) {
      ctx.fillStyle = `rgba(220,200,170,${0.5 * (1 - d.t / 0.6)})`;
      ctx.beginPath(); ctx.arc(d.x * W, d.y * H, 2 + d.t * 10, 0, Math.PI * 2); ctx.fill();
    }
    // goods flying from the shelf into a basket
    for (const fx of r.effects) {
      if (fx.kind !== 'fly' || fx.t < 0) continue;
      const k = fx.t / fx.dur, p = fx.to, s = scaleAt(p.y, H);
      const x1 = p.x * W - s * 0.34, y1 = p.y * H - s * 0.62;
      art.pack(ctx, r.b.good, fx.x * W + (x1 - fx.x * W) * k, fx.y * H + (y1 - fx.y * H) * k - Math.sin(k * Math.PI) * 18, H * 0.024, 0, dpr);
    }
    // the front of the queue glows: tap to serve
    const front = queue().find(atTill);
    if (front) {
      const s = scaleAt(front.y, H);
      ctx.strokeStyle = `rgba(255,210,63,${0.5 + 0.4 * Math.sin(r.t * 8)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(front.x * W, front.y * H, s * 0.5, s * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawCounter(ctx, W, H, G);
    // the receipt, torn off and handed over
    for (const fx of r.effects) {
      if (fx.kind !== 'receipt' || !r.printerXY) continue;
      const k = fx.t / fx.dur, p = fx.to, s = scaleAt(p.y, H);
      const x = r.printerXY[0] + ((p.x * W + s * 0.3) - r.printerXY[0]) * k, y = r.printerXY[1] + ((p.y * H - s * 0.8) - r.printerXY[1]) * k - Math.sin(k * Math.PI) * 20;
      ctx.save(); ctx.translate(x, y); ctx.rotate(k * 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(-4, -6, 8, 12); ctx.fillStyle = '#bbb'; ctx.fillRect(-3, -3, 6, 1); ctx.fillRect(-3, 0, 6, 1);
      ctx.restore();
    }
    // floating takings
    ctx.font = `900 ${Math.round(H * 0.03)}px system-ui, sans-serif`; ctx.fillStyle = '#ffd23f';
    for (const fx of r.effects) {
      if (fx.kind !== 'text') continue;
      ctx.globalAlpha = Math.max(0, 1 - fx.t);
      ctx.fillText(fx.text, fx.x * W, fx.y * H);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  // the shop front: brick piers, two display windows and a pair of sliding glass doors
  const FRONT = {
    glass: 0.05, transom: 0.072, road0: 0.118, road1: 0.146, sill: 0.17,
    windows: [[0.02, 0.39], [0.61, 0.98]], door: [0.42, 0.58],
    piers: [[0, 0.02], [0.39, 0.42], [0.58, 0.61], [0.98, 1]],
  };
  const CAR_COLORS = ['#ff2a6d', '#05d9e8', '#ffd23f', '#9b5de5', '#f2f2f2', '#22c55e'];

  // ---------- time of day: the sky goes from morning to night over the shift ----------
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, k) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; };
  const SKY = [[0, '#6fb7e8', '#cde8f7'], [0.45, '#3f95d6', '#a9d8f2'], [0.68, '#f08a5d', '#ffd29a'], [0.8, '#4b2a7a', '#e0679a'], [0.92, '#12052e', '#3a0d55'], [1, '#12052e', '#3a0d55']];
  function skyAt(k) {
    let i = 0;
    while (i < SKY.length - 2 && k > SKY[i + 1][0]) i++;
    const [k0, t0, b0] = SKY[i], [k1, t1, b1] = SKY[i + 1], f = clamp((k - k0) / (k1 - k0), 0, 1);
    return [mix(t0, t1, f), mix(b0, b1, f)];
  }
  const dayK = () => Math.min(run.t, DAY_SECONDS) / DAY_SECONDS;
  const nightAt = (k) => clamp((k - 0.62) / 0.26, 0, 1);

  function drawStreet(ctx, W, H) {
    const r = run, F = FRONT, k = dayK(), night = nightAt(k);
    // sky and the buildings across the road
    const [top, bot] = skyAt(k);
    let g = ctx.createLinearGradient(0, F.glass * H, 0, F.road0 * H);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, F.glass * H, W, (F.road0 - F.glass) * H + 1);
    for (const b of r.skyline) {
      const x = b.x * W, w = b.w * W, bt = (F.road0 - b.h) * H, bb = F.road0 * H;
      ctx.fillStyle = mix('#5d6f8f', '#1c0a3a', night); ctx.fillRect(x, bt, w, bb - bt);
      ctx.fillStyle = night > 0.3 ? (b.lit > 0.5 ? `rgba(255,210,63,${0.6 * night})` : `rgba(5,217,232,${0.5 * night})`) : `rgba(200,230,255,${0.35 * (1 - night)})`;
      for (let wy = bt + 4; wy < bb - 4; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 6) if (((wx * 7 + wy * 3) | 0) % 5 < 2) ctx.fillRect(wx, wy, 2, 3);
    }
    // road with lane markings and passing cars
    ctx.fillStyle = mix('#4a4a55', '#1a1424', night); ctx.fillRect(0, F.road0 * H, W, (F.road1 - F.road0) * H);
    ctx.fillStyle = 'rgba(255,210,63,.55)';
    const lane = (F.road0 + F.road1) / 2 * H;
    for (let x = ((-r.t * 30) % 40) - 40; x < W; x += 40) ctx.fillRect(x, lane, 18, 1.5);
    for (const c of r.cars) drawCar(ctx, c, W, H, night);
    if (r.van) drawVan(ctx, r.van, W, H);
    // curb and pavement, with street lamps that come on at dusk
    ctx.fillStyle = mix('#a49cb4', '#5a4a6e', night); ctx.fillRect(0, F.road1 * H, W, 2);
    g = ctx.createLinearGradient(0, F.road1 * H, 0, L.door * H);
    g.addColorStop(0, mix('#8a8496', '#3a2a52', night)); g.addColorStop(1, mix('#9a94a6', '#4d3a66', night));
    ctx.fillStyle = g; ctx.fillRect(0, F.road1 * H + 2, W, (L.door - F.road1) * H);
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 22) { ctx.beginPath(); ctx.moveTo(x, F.road1 * H + 2); ctx.lineTo(x - 3, L.wall * H); ctx.stroke(); }
    for (const lx of [0.2, 0.8]) {
      const x = lx * W, y0 = (F.road1 + 0.004) * H, y1 = (F.glass + 0.03) * H;
      ctx.fillStyle = '#2a2a35'; ctx.fillRect(x - 1.5, y1, 3, y0 - y1);
      ctx.fillRect(x - 1.5, y1, 10, 2.5);
      if (night > 0.05) {
        const lg = ctx.createRadialGradient(x + 9, y1 + 3, 0, x + 9, y1 + 3, H * 0.05);
        lg.addColorStop(0, `rgba(255,230,150,${0.55 * night})`); lg.addColorStop(1, 'rgba(255,230,150,0)');
        ctx.fillStyle = lg; ctx.fillRect(x + 9 - H * 0.05, y1 + 3 - H * 0.05, H * 0.1, H * 0.1);
      }
      ctx.fillStyle = night > 0.05 ? '#fff2c4' : '#8a8a96'; ctx.fillRect(x + 6, y1 + 2, 6, 2);
    }
  }

  function drawCar(ctx, c, W, H, night) {
    const w = W * 0.13, h = H * 0.026, x = c.x * W, base = c.lane * H;
    ctx.fillStyle = c.color; roundRect(ctx, x - w / 2, base - h * 0.62, w, h * 0.5, 3); ctx.fill();
    roundRect(ctx, x - w * 0.27 - c.dir * w * 0.04, base - h, w * 0.5, h * 0.45, 4); ctx.fill();
    ctx.fillStyle = 'rgba(10,20,40,.8)'; roundRect(ctx, x - w * 0.23 - c.dir * w * 0.04, base - h * 0.93, w * 0.42, h * 0.32, 3); ctx.fill();
    ctx.fillStyle = '#111';
    for (const k of [-0.3, 0.3]) { ctx.beginPath(); ctx.arc(x + k * w, base - h * 0.12, h * 0.17, 0, Math.PI * 2); ctx.fill(); }
    const fx = x + c.dir * w / 2, bx = x - c.dir * w / 2;
    if (night > 0.2) {
      const lg = ctx.createRadialGradient(fx, base - h * 0.4, 0, fx, base - h * 0.4, w * 0.35);
      lg.addColorStop(0, `rgba(255,240,180,${0.55 * night})`); lg.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = lg; ctx.fillRect(fx - w * 0.35, base - h * 0.4 - w * 0.35, w * 0.7, w * 0.7);
    }
    ctx.fillStyle = '#ff3b3b'; ctx.fillRect(bx - c.dir * 1, base - h * 0.5, 2.5, 2.5);
  }

  function drawVan(ctx, v, W, H) {
    const x = v.x * W, base = (FRONT.road1 + 0.003) * H, h = H * 0.065, w = W * 0.32;
    const left = x - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(left + 4, base - 3, w - 8, 5);
    // cargo box and cab
    ctx.fillStyle = '#e8e8f2'; roundRect(ctx, left, base - h, w * 0.72, h * 0.86, 4); ctx.fill();
    ctx.fillStyle = '#05d9e8'; roundRect(ctx, left + w * 0.7, base - h * 0.7, w * 0.3, h * 0.56, 5); ctx.fill();
    ctx.fillStyle = '#0b0221'; roundRect(ctx, left + w * 0.76, base - h * 0.64, w * 0.18, h * 0.22, 3); ctx.fill();
    ctx.fillStyle = '#ff2a6d'; ctx.fillRect(left, base - h * 0.45, w * 0.72, h * 0.08);
    ctx.fillStyle = '#3a0d55'; ctx.font = `900 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
    ctx.fillText('NEON FREIGHT', left + w * 0.36, base - h * 0.55);
    for (const wx of [left + w * 0.18, left + w * 0.82]) {
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(wx, base - h * 0.12, h * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(wx, base - h * 0.12, h * 0.06, 0, Math.PI * 2); ctx.fill();
    }
    if (v.state === 'parked' && Math.sin(run.t * 6) > 0) { ctx.fillStyle = '#ffb000'; ctx.fillRect(left + w - 3, base - h * 0.5, 3, 3); } // hazard lights
  }

  // textures (bricks, pegboard) are drawn once into a small tile and repeated
  const patterns = {};
  function pattern(ctx, name, w, h, paint) {
    const dpr = run.dpr, key = name + dpr;
    if (!patterns[key]) {
      const c = document.createElement('canvas');
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext('2d'); g.scale(dpr, dpr); paint(g);
      const pt = ctx.createPattern(c, 'repeat');
      if (pt.setTransform && window.DOMMatrix) pt.setTransform(new DOMMatrix().scale(1 / dpr));
      patterns[key] = pt;
    }
    return patterns[key];
  }
  // a brick wall section
  function bricks(ctx, x0, y0, x1, y1) {
    ctx.fillStyle = pattern(ctx, 'bricks', 52, 20, (g) => {
      const shades = ['#5a1f45', '#4e1a3d', '#63244c', '#541c41'];
      g.fillStyle = '#26102a'; g.fillRect(0, 0, 52, 20);
      for (let row = 0; row < 4; row++) {
        for (let col = -1; col < 5; col++) {
          g.fillStyle = shades[(row * 7 + col * 3 + 8) % 4];
          g.fillRect(col * 13 + (row % 2 ? 6.5 : 0) + 0.5, row * 5 + 0.5, 12, 4);
        }
      }
    });
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  const onSale = () => (run.b.mult || T.RETAIL) < T.RETAIL - 0.001;
  function drawStorefront(ctx, W, H, G) {
    const r = run, F = FRONT, night = nightAt(dayK()), art = window.NeonShopArt;
    const gy0 = F.glass * H, gy1 = F.sill * H;
    // the glass: a faint tint and reflections
    for (const [a, b] of F.windows) {
      const x0 = a * W, x1 = b * W;
      ctx.fillStyle = 'rgba(140,210,255,.06)'; ctx.fillRect(x0, gy0, x1 - x0, gy1 - gy0);
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      const k = x1 - x0;
      poly(ctx, [[x0 + k * 0.1, gy0], [x0 + k * 0.22, gy0], [x0 + k * 0.08, gy1], [x0 - k * 0.04, gy1]]); ctx.fill();
      poly(ctx, [[x0 + k * 0.27, gy0], [x0 + k * 0.31, gy0], [x0 + k * 0.17, gy1], [x0 + k * 0.13, gy1]]); ctx.fill();
    }
    // window stickers: OPEN sign hanging in the left window, a poster in the right one
    {
      const cx = W * 0.115, cy = (F.transom + 0.026) * H, sw = W * 0.15, sh = H * 0.026;
      ctx.strokeStyle = 'rgba(200,200,220,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - sw * 0.3, F.transom * H); ctx.lineTo(cx - sw * 0.3, cy - sh / 2); ctx.moveTo(cx + sw * 0.3, F.transom * H); ctx.lineTo(cx + sw * 0.3, cy - sh / 2); ctx.stroke();
      ctx.fillStyle = 'rgba(10,2,25,.85)'; roundRect(ctx, cx - sw / 2, cy - sh / 2, sw, sh, sh / 2); ctx.fill();
      const on = !r.closed;
      ctx.strokeStyle = on ? '#ff2a6d' : '#5a2a3a'; ctx.lineWidth = 2; ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = on ? 3 + 10 * night : 0; ctx.stroke();
      ctx.font = `900 ${Math.round(sh * 0.7)}px system-ui, sans-serif`; ctx.fillStyle = on ? '#ff5c8a' : '#7a4a5a';
      ctx.fillText(on ? 'OPEN' : 'CLOSED', cx, cy + sh * 0.26);
      ctx.shadowBlur = 0;
      // a poster: FRESH! normally, a red SALE poster when you've cut your price
      const px = W * 0.3, py = (F.transom + 0.008) * H, pw = W * 0.12, ph = H * 0.06, sale = onSale();
      g0(ctx, px - pw / 2, py, pw, ph, sale);
      art.pack(ctx, r.b.good, px, py + ph * 0.66, ph * 0.46, 0, r.dpr);
      ctx.font = `900 ${Math.round(ph * 0.2)}px system-ui, sans-serif`; ctx.fillStyle = sale ? '#fff' : '#0b0221';
      ctx.fillText(sale ? 'SALE!' : 'FRESH!', px, py + ph * 0.9);
    }
    // bulkhead over the windows with the shop's name
    let g = ctx.createLinearGradient(0, 0, 0, gy0);
    g.addColorStop(0, '#140628'); g.addColorStop(1, '#22093f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, gy0);
    ctx.font = `900 ${Math.round(Math.min(H * 0.026, W * 0.045))}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ff7a00'; ctx.shadowBlur = 4 + 8 * night;
    ctx.fillText(`${G.icon} ${G.name.toUpperCase()} · ${T.STALLS[r.b.tier].name.toUpperCase()}`, W / 2, L.sign * H * 0.68);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff2a6d'; ctx.fillRect(0, gy0 - 3, W, 2);
    // a wall clock showing the time, and a security camera in the corner
    art.clock(ctx, W * 0.94, gy0 * 0.5, gy0 * 0.36, OPEN_H + dayK() * (CLOSE_H - OPEN_H));
    // brick piers, and the wall under the windows
    for (const [a, b] of F.piers) bricks(ctx, a * W, gy0 - 1, b * W, L.door * H);
    for (const [a, b] of F.windows) bricks(ctx, a * W, gy1, b * W, L.door * H);
    // window frames: outer frame, a transom bar near the top, a mullion, and a sill
    for (const [a, b] of F.windows) {
      const x0 = a * W, x1 = b * W, mid = (x0 + x1) / 2;
      ctx.fillStyle = '#1b1b26';
      ctx.fillRect(x0, gy0, x1 - x0, 4); ctx.fillRect(x0, gy0, 4, gy1 - gy0); ctx.fillRect(x1 - 4, gy0, 4, gy1 - gy0);
      ctx.fillRect(x0, F.transom * H - 2, x1 - x0, 4); ctx.fillRect(mid - 2, F.transom * H, 4, gy1 - F.transom * H);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(x0 + 4, gy0 + 4, x1 - x0 - 8, 1); ctx.fillRect(x0 + 4, F.transom * H + 2, x1 - x0 - 8, 1);
      ctx.fillStyle = '#cfc8e6'; ctx.fillRect(x0 - 2, gy1 - 2, x1 - x0 + 4, 4);
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x0 - 2, gy1 + 2, x1 - x0 + 4, 2);
    }
    art.camera(ctx, W * 0.045, gy0 - 2, H * 0.03, r.t);
  }
  // a small poster with a gradient
  function g0(ctx, x, y, w, h, red) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, red ? '#ff3b3b' : '#ffd23f'); g.addColorStop(1, red ? '#b80f2e' : '#ff7a00');
    ctx.fillStyle = g; roundRect(ctx, x, y, w, h, 3); ctx.fill();
  }

  // automatic sliding glass doors: they open when someone walks up
  function drawDoor(ctx, W, H) {
    const r = run, F = FRONT;
    const x0 = F.door[0] * W, x1 = F.door[1] * W, y0 = F.glass * H, y1 = L.door * H, half = (x1 - x0) / 2;
    const slide = r.doorOpen * half * 0.92;
    // frame header with the motion sensor and an ENTRANCE sign
    ctx.fillStyle = '#1b1b26'; ctx.fillRect(x0 - 3, y0, x1 - x0 + 6, H * 0.016);
    ctx.fillStyle = '#0b0b10'; ctx.fillRect((x0 + x1) / 2 - 7, y0 + H * 0.016, 14, 4);
    ctx.fillStyle = r.doorOpen > 0.05 ? '#4ade80' : '#ff3b3b'; ctx.fillRect((x0 + x1) / 2 - 1.5, y0 + H * 0.016 + 1, 3, 2);
    ctx.font = `800 ${Math.round(H * 0.011)}px system-ui, sans-serif`; ctx.fillStyle = '#4ade80';
    ctx.fillText('ENTRANCE', (x0 + x1) / 2, y0 + H * 0.012);
    // the two panels slide behind the piers
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0 + H * 0.016, x1 - x0, y1 - y0 - H * 0.016); ctx.clip();
    for (const side of [-1, 1]) {
      const px0 = side < 0 ? x0 - slide : x0 + half + slide, py0 = y0 + H * 0.016;
      ctx.fillStyle = 'rgba(150,220,255,.12)'; ctx.fillRect(px0, py0, half, y1 - py0);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      poly(ctx, [[px0 + half * 0.2, py0], [px0 + half * 0.45, py0], [px0 + half * 0.1, y1], [px0 - half * 0.15, y1]]); ctx.fill();
      ctx.strokeStyle = '#a7adbf'; ctx.lineWidth = 3; ctx.strokeRect(px0 + 1.5, py0 + 1.5, half - 3, y1 - py0 - 3);
      ctx.fillStyle = '#a7adbf'; ctx.fillRect(px0, y1 - H * 0.012, half, H * 0.012); // kick rail
      // handle bar on the inner edge
      const hx = side < 0 ? px0 + half - 7 : px0 + 5;
      ctx.fillStyle = '#d7dbe8'; ctx.fillRect(hx, py0 + (y1 - py0) * 0.42, 2.5, (y1 - py0) * 0.2);
    }
    // opening hours on the glass
    const hx = x0 + half + slide + half / 2, hy = y0 + (y1 - y0) * 0.3;
    ctx.font = `800 ${Math.round(Math.min(H * 0.011, half * 0.22))}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.fillText('OPEN', hx, hy); ctx.fillText('9–21', hx, hy + H * 0.013);
    ctx.restore();
    ctx.fillStyle = '#7a7f92'; ctx.fillRect(x0, y1 - 2, x1 - x0, 3); // threshold strip
  }

  function drawFloor(ctx, W, H) {
    let y = L.door, row = 0;
    while (y < L.counter) {
      const y2 = Math.min(L.counter, y + 0.014 + 0.05 * depthK(y));
      const w1 = scaleAt(y, H) * 0.9, w2 = scaleAt(y2, H) * 0.9;
      const n = Math.ceil(W / 2 / w1) + 2;
      for (let j = -n; j < n; j++) {
        ctx.fillStyle = (j + row) % 2 ? '#1b0d38' : '#22113f';
        ctx.beginPath();
        ctx.moveTo(W / 2 + j * w1, y * H); ctx.lineTo(W / 2 + (j + 1) * w1, y * H);
        ctx.lineTo(W / 2 + (j + 1) * w2, y2 * H); ctx.lineTo(W / 2 + j * w2, y2 * H);
        ctx.closePath(); ctx.fill();
      }
      y = y2; row++;
    }
    // sunlight through the windows by day (golden near sunset), and pools of light under the lamps
    const k = dayK(), night = nightAt(k), sun = (1 - night) * 0.11;
    if (sun > 0.005) {
      ctx.fillStyle = k > 0.6 ? `rgba(255,190,120,${sun})` : `rgba(255,245,215,${sun})`;
      for (const [a, b] of FRONT.windows) {
        poly(ctx, [[a * W, L.door * H], [b * W, L.door * H], [(b + 0.1) * W, (L.door + 0.16) * H], [(a + 0.1) * W, (L.door + 0.16) * H]]); ctx.fill();
      }
    }
    for (const [lx, , ly] of LAMPS) {
      const g = ctx.createRadialGradient(lx * W, ly * H, 0, lx * W, ly * H, W * 0.22);
      g.addColorStop(0, `rgba(255,225,160,${0.08 + 0.08 * night})`); g.addColorStop(1, 'rgba(255,225,160,0)');
      ctx.fillStyle = g; ctx.fillRect(lx * W - W * 0.22, ly * H - W * 0.22, W * 0.44, W * 0.44);
      ctx.fillStyle = `rgba(255,240,200,${0.05 + 0.06 * night})`; // the lamp's reflection in the polished floor
      ctx.beginPath(); ctx.ellipse(lx * W, ly * H, W * 0.035, H * 0.006, 0, 0, Math.PI * 2); ctx.fill();
    }
    // skirting along the front wall, and a welcome mat inside the door
    ctx.fillStyle = '#12052a'; ctx.fillRect(0, L.door * H, W, 3);
    const my0 = L.door * H + 3, my1 = (L.door + 0.035) * H;
    const w0 = (FRONT.door[1] - FRONT.door[0]) * W * 0.95, w1 = w0 * scaleAt(L.door + 0.035, H) / scaleAt(L.door, H);
    ctx.fillStyle = '#26262e'; poly(ctx, [[W / 2 - w0 / 2, my0], [W / 2 + w0 / 2, my0], [W / 2 + w1 / 2, my1], [W / 2 - w1 / 2, my1]]); ctx.fill();
    ctx.strokeStyle = '#3d3d4a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = `800 ${Math.round((my1 - my0) * 0.45)}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.fillText('WELCOME', W / 2, my0 + (my1 - my0) * 0.68);
  }

  // perspective: everything recedes toward the point where the floor tiles meet
  const VP_Y = -0.134;
  const toVP = (x, y, f, W, H) => [x + (W / 2 - x) * f, y + (VP_Y * H - y) * f];
  function poly(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  // hanging lamps, each casting a soft cone of light down to the floor
  function drawLamps(ctx, W, H) {
    const night = nightAt(dayK()), s = W * 0.075;
    for (const [lx, ly, fy] of LAMPS) {
      const x = lx * W, y = ly * H;
      const g = ctx.createLinearGradient(0, y, 0, fy * H);
      g.addColorStop(0, `rgba(255,230,170,${0.1 + 0.08 * night})`); g.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = g; poly(ctx, [[x - s * 0.4, y], [x + s * 0.4, y], [x + W * 0.13, fy * H], [x - W * 0.13, fy * H]]); ctx.fill();
      window.NeonShopArt.lamp(ctx, x, y, s, '#fff2c4', FRONT.glass * H);
    }
  }

  // a drinks fridge with glass doors, lit inside
  function drawFridge(ctx, W, H) {
    const r = run, art = window.NeonShopArt;
    const x0 = FRIDGE.x0 * W, x1 = FRIDGE.x1 * W, top = FRIDGE.top * H, base = FRIDGE.base * H, D = 0.03;
    const P = (x, y) => toVP(x, y, D, W, H);
    ctx.fillStyle = '#20202b'; poly(ctx, [[x0, top], P(x0, top), P(x0, base), [x0, base]]); ctx.fill();
    ctx.fillStyle = '#34343f'; poly(ctx, [[x0, top], [x1, top], P(x1, top), P(x0, top)]); ctx.fill();
    ctx.fillStyle = '#1b1b26'; ctx.fillRect(x0, top, x1 - x0, base - top);
    // lit header
    const hh = H * 0.02;
    ctx.fillStyle = '#0b0221'; ctx.fillRect(x0 + 3, top + 3, x1 - x0 - 6, hh);
    ctx.font = `800 ${Math.round(hh * 0.62)}px system-ui, sans-serif`; ctx.fillStyle = '#7fe9ff';
    ctx.shadowColor = '#05d9e8'; ctx.shadowBlur = 6; ctx.fillText('❄ COLD DRINKS', (x0 + x1) / 2, top + 3 + hh * 0.72); ctx.shadowBlur = 0;
    // inside: bright shelves of cans and bottles
    const ix0 = x0 + 4, ix1 = x1 - 4, iy0 = top + hh + 6, iy1 = base - H * 0.016;
    const g = ctx.createLinearGradient(0, iy0, 0, iy1);
    g.addColorStop(0, '#effcff'); g.addColorStop(1, '#9fd3ea');
    ctx.fillStyle = g; ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    const rows = r.fridge.length, rh = (iy1 - iy0) / rows, cw = (ix1 - ix0) / r.fridge[0].length;
    for (let row = 0; row < rows; row++) {
      const y = iy0 + (row + 1) * rh - 2;
      r.fridge[row].forEach((it, c) => art.pack(ctx, it.kind, ix0 + (c + 0.5) * cw, y, Math.min(rh * 0.82, cw * 1.6), it.v, r.dpr));
      ctx.fillStyle = '#c9d6e0'; ctx.fillRect(ix0, y, ix1 - ix0, 2);
    }
    // two glass doors with handles and reflections, a little frost at the bottom
    const mid = (x0 + x1) / 2;
    ctx.strokeStyle = '#3a3a48'; ctx.lineWidth = 3;
    ctx.strokeRect(ix0, iy0, mid - ix0, iy1 - iy0); ctx.strokeRect(mid, iy0, ix1 - mid, iy1 - iy0);
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    for (const dx of [ix0, mid]) { const w = mid - ix0; poly(ctx, [[dx + w * 0.15, iy0], [dx + w * 0.4, iy0], [dx + w * 0.1, iy1], [dx - w * 0.15 + 3, iy1]]); ctx.fill(); }
    ctx.fillStyle = '#d7dbe8'; ctx.fillRect(mid - 6, iy0 + (iy1 - iy0) * 0.35, 2, (iy1 - iy0) * 0.25); ctx.fillRect(mid + 4, iy0 + (iy1 - iy0) * 0.35, 2, (iy1 - iy0) * 0.25);
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(ix0, iy1 - 5, ix1 - ix0, 5);
    ctx.fillStyle = '#111'; ctx.fillRect(x0, iy1, x1 - x0, base - iy1);
    ctx.fillStyle = '#2a2a35'; for (let x = x0 + 4; x < x1 - 4; x += 5) ctx.fillRect(x, iy1 + 2, 2, base - iy1 - 4);
  }

  // floor props: a plant, baskets, a wet-floor sign, a bin and a sweets rack by the till
  function drawProp(ctx, kind, x, y, W, H) {
    const art = window.NeonShopArt, s = scaleAt(y, H), px = x * W, py = y * H;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px, py, s * 0.28, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    if (kind === 'plant') art.plant(ctx, px, py, s * 0.9);
    else if (kind === 'baskets') art.basketStack(ctx, px, py, s);
    else if (kind === 'wet') art.wetFloor(ctx, px, py, s);
    else if (kind === 'bin') art.bin(ctx, px, py, s);
    else if (kind === 'candy') { // a two-shelf rack of sweets and gum
      const w = s * 0.7, h = s * 0.9;
      ctx.fillStyle = '#2a2a35'; ctx.fillRect(px - w / 2, py - h, 2, h); ctx.fillRect(px + w / 2 - 2, py - h, 2, h);
      for (let row = 0; row < 3; row++) {
        const sy = py - row * h * 0.33 - 2;
        ctx.fillStyle = '#9aa0b5'; ctx.fillRect(px - w / 2, sy, w, 2);
        for (let i = 0; i < 4; i++) art.pack(ctx, 'candy', px - w / 2 + (i + 0.5) * (w / 4), sy, s * 0.24, i + row, run.dpr);
      }
      ctx.fillStyle = '#ff2a6d'; ctx.fillRect(px - w / 2, py - h - s * 0.12, w, s * 0.12);
      ctx.font = `800 ${Math.max(6, Math.round(s * 0.09))}px system-ui, sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText('SWEETS', px, py - h - s * 0.03);
    }
  }

  // a speech bubble over someone's head
  function drawBubble(ctx, text, x, y, s, W, alpha) {
    const fs = Math.max(10, Math.round(s * 0.2));
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + fs, h = fs * 1.6, bx = clamp(x - w / 2, 2, W - w - 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; roundRect(ctx, bx, y - h, w, h, h / 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(clamp(x, bx + 8, bx + w - 8) - 4, y - 1); ctx.lineTo(clamp(x, bx + 8, bx + w - 8) + 4, y - 1); ctx.lineTo(x, y + 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b0221'; ctx.fillText(text, bx + w / 2, y - h * 0.3);
    ctx.globalAlpha = 1;
  }

  function drawUnit(ctx, u, ui, W, H, G) {
    const r = run;
    const x0 = u.x0 * W, x1 = u.x1 * W, top = u.top * H, base = u.base * H, rh = rowH(u) * H, kk = kick(u) * H;
    const D = u.wall ? 0.03 : 0.045;   // how deep the unit looks
    const P = (x, y, f = D) => toVP(x, y, f, W, H);
    if (!u.wall) {
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse((x0 + x1) / 2, base + 2, (x1 - x0) * 0.56, 7, 0, 0, Math.PI * 2); ctx.fill();
    }
    // end panel on the side that faces the middle of the shop
    const cx = (x0 + x1) / 2, ex = cx < W / 2 ? x1 : x0;
    let g = ctx.createLinearGradient(0, top, 0, base);
    g.addColorStop(0, '#2b0d5e'); g.addColorStop(1, '#170636');
    ctx.fillStyle = g; poly(ctx, [[ex, top], P(ex, top), P(ex, base), [ex, base]]); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.stroke();
    // top cap
    ctx.fillStyle = '#5b2bb5'; poly(ctx, [[x0, top], [x1, top], P(x1, top), P(x0, top)]); ctx.fill();
    // back panel with pegboard holes
    g = ctx.createLinearGradient(0, top, 0, base);
    g.addColorStop(0, '#24094f'); g.addColorStop(1, '#3a1774');
    ctx.fillStyle = g; ctx.fillRect(x0, top, x1 - x0, base - top - kk);
    ctx.fillStyle = pattern(ctx, 'pegboard', 7, 7, (g) => { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(3, 3, 1.5, 1.5); });
    ctx.fillRect(x0 + 4, top + 3, x1 - x0 - 8, base - top - kk - 6);
    // shelves: board surface, LED light, goods, then the front lip with its price strip
    const lip = Math.max(3, rh * 0.13), colW = (x1 - x0) / u.cols;
    for (let row = 0; row < ROWS; row++) {
      const y = shelfY(u, row) * H;
      ctx.fillStyle = '#4a2a8c'; poly(ctx, [[x0 + 3, y], [x1 - 3, y], P(x1 - 3, y, D * 0.6), P(x0 + 3, y, D * 0.6)]); ctx.fill();
      const ceil = row === ROWS - 1 ? top : shelfY(u, row + 1) * H + lip;
      g = ctx.createLinearGradient(0, ceil, 0, ceil + rh * 0.6);
      g.addColorStop(0, 'rgba(190,240,255,.22)'); g.addColorStop(1, 'rgba(190,240,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x0 + 3, ceil, x1 - x0 - 6, rh * 0.6);
    }
    // goods: two packs side by side per spot and up to three deep, filled from the front
    const FACINGS = 2, DEEP = 3, PER = FACINGS * DEEP;
    const art = window.NeonShopArt, wf = PACK_W[r.b.good] || 0.6;
    const fsz = Math.min(rh * 0.8, (colW * 0.47) / wf);
    for (const sl of r.slots) {
      if (sl.u !== ui || sl.n <= 0) continue;
      // packs are pulled to the front, so a part-stocked shelf still looks faced up
      const vis = clamp(Math.ceil(Math.sqrt(sl.n / r.cap) * PER), 1, PER);
      const y = sl.y * H - 1;
      for (let d = DEEP - 1; d >= 0; d--) {
        for (let f = 0; f < FACINGS; f++) {
          if (d * FACINGS + f >= vis) continue;
          const fx = sl.x * W + (f - 0.5) * colW * 0.47;
          const [px, py] = P(fx, y, D * 0.24 * d);
          const sc = (1 - d * 0.09) * (d === 0 && sl.pop > 0 ? 1 + sl.pop * 1.6 : 1);
          const s = fsz * sc;
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(0,0,0,${0.3 - d * 0.06})`;
          ctx.beginPath(); ctx.ellipse(px, py - 0.5, s * wf * 0.6, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1 - d * 0.22;
          art.pack(ctx, r.b.good, px, py, s, sl.v, r.dpr);
        }
      }
    }
    ctx.globalAlpha = 1;
    for (let row = 0; row < ROWS; row++) {
      const y = shelfY(u, row) * H;
      ctx.fillStyle = '#e4defa'; ctx.fillRect(x0 + 2, y, x1 - x0 - 4, lip);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x0 + 2, y + lip, x1 - x0 - 4, 1.5);
      ctx.fillStyle = '#ffd23f';
      for (let c = 0; c < u.cols; c++) ctx.fillRect(x0 + (c + 0.5) * colW - 4, y + lip * 0.2, 8, lip * 0.6);
    }
    // uprights and the kick plate
    ctx.fillStyle = '#7446d8'; ctx.fillRect(x0, top, 3, base - top); ctx.fillRect(x1 - 3, top, 3, base - top);
    ctx.fillStyle = '#12052a'; ctx.fillRect(x0, base - kk, x1 - x0, kk);
    ctx.fillStyle = 'rgba(5,217,232,.35)'; ctx.fillRect(x0, base - kk, x1 - x0, 1.5);
    // a shelf sign hanging under one spot
    const tk = r.talkers[ui], ts = tk && r.slots[tk.slot];
    if (ts && ts.u === ui) {
      ctx.font = `800 ${Math.max(6, Math.round(rh * 0.24))}px system-ui, sans-serif`;
      const w = ctx.measureText(tk.talk[0]).width + 6, ty = shelfY(u, ts.row) * H + lip;
      const tx = clamp(ts.x * W, x0 + w / 2 + 2, x1 - w / 2 - 2); // kept inside the unit
      ctx.fillStyle = tk.talk[1]; ctx.fillRect(tx - w / 2, ty, w, rh * 0.3);
      ctx.fillStyle = '#0b0221'; ctx.fillText(tk.talk[0], tx, ty + rh * 0.23);
    }
    // the price, on the middle shelf: red with a SALE flash when you've cut it
    const sale = onSale();
    const price = T.shelfPrice(r.s, r.b), label = `${sale ? 'SALE ' : ''}$${price < 100 ? price.toFixed(2) : Math.round(price).toLocaleString()}`;
    ctx.font = `900 ${Math.max(8, Math.round(rh * 0.36))}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 8, th = rh * 0.4, ty = shelfY(u, 1) * H - th * 0.3;
    ctx.fillStyle = sale ? '#ff3b3b' : '#ffd23f'; roundRect(ctx, cx - tw / 2, ty, tw, th, 3); ctx.fill();
    ctx.fillStyle = sale ? '#fff' : '#0b0221'; ctx.fillText(label, cx, ty + th * 0.78);
    if (sale) { // a wobbling SALE disc on the shelf edge
      const wx = x0 + colW * 0.5, wy = shelfY(u, 0) * H + lip + rh * 0.2, rr = Math.max(6, rh * 0.28);
      ctx.save(); ctx.translate(wx, wy); ctx.rotate(Math.sin(r.t * 3 + ui) * 0.25);
      ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(rr * 0.6)}px system-ui, sans-serif`; ctx.fillText('SALE', 0, rr * 0.22);
      ctx.restore();
    }
    // islands carry a light-box sign on top
    if (!u.wall) {
      const sw = (x1 - x0) * 0.62, sh = H * 0.026, sy = top - sh - H * 0.012;
      ctx.fillStyle = '#7446d8'; ctx.fillRect(cx - sw * 0.3, sy + sh, 2, top - sy - sh); ctx.fillRect(cx + sw * 0.3, sy + sh, 2, top - sy - sh);
      ctx.fillStyle = '#0b0221'; roundRect(ctx, cx - sw / 2, sy, sw, sh, 4); ctx.fill();
      ctx.strokeStyle = '#05d9e8'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = `800 ${Math.round(sh * 0.58)}px system-ui, sans-serif`; ctx.fillStyle = '#05d9e8';
      ctx.fillText(`${G.icon} AISLE ${ui - 1}`, cx, sy + sh * 0.72);
    }
  }

  function drawBox(ctx, x, y, size, G) {
    // a cardboard box resting with its bottom at y
    const w = size, h = size * 0.75;
    ctx.fillStyle = '#a8713a'; ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = '#c68d4f'; ctx.fillRect(x - w / 2, y - h, w, h * 0.22);
    ctx.fillStyle = '#e2c08a'; ctx.fillRect(x - w * 0.07, y - h, w * 0.14, h);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - h, w, h);
    if (size > 14) { ctx.font = `${Math.round(size * 0.32)}px system-ui, sans-serif`; ctx.fillText(G.icon, x - w * 0.27, y - h * 0.2); }
  }

  function drawPile(ctx, W, H, G) {
    const r = run;
    const s = scaleAt(PILE.y, H), size = s * 0.42, x = PILE.x * W, y = PILE.y * H;
    // pallet
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x - size * 1.7, y - 4, size * 3.4, 6);
    ctx.fillStyle = '#4a3020'; for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * size * 1.3 - 3, y + 2, 6, 3);
    const n = Math.min(9, Math.ceil(r.pile / Math.max(1, r.cap * 6)));
    for (let i = 0; i < n; i++) {
      const lvl = Math.floor(i / 3), col = i % 3;
      drawBox(ctx, x + (col - 1) * size * 1.05 + (lvl % 2 ? size * 0.2 : 0), y - 4 - lvl * size * 0.72, size, G);
    }
    if (r.pile > 0) {
      ctx.font = `800 ${Math.round(Math.max(10, s * 0.26))}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
      ctx.fillText(`${r.pile}`, x, y - 8 - Math.ceil(n / 3) * size * 0.72);
    }
  }

  function drawPerson(ctx, p, W, H, G) {
    const r = run, art = window.NeonShopArt;
    const px = (p.x + (p.ox || 0)) * W, py = p.y * H, s = scaleAt(p.y, H) * (p.child ? 0.66 : 1);
    // a soft shadow on the ground
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(px, py, s * 0.3, s * 0.075, 0, 0, Math.PI * 2); ctx.fill();
    const onStreet = p.kind === 'passer' || p.state === 'street' || (p.kind === 'companion' && p.leader.state === 'street');
    const front = !onStreet && p.facing === 'front';
    const stride = p.kind === 'passer' || p.moving || (p.kind === 'shopper' && p.state === 'street') ? 0.35 : 0;
    NeonLooks.drawRunner(ctx, px, py, s, { front, phase: p.phase, stride, mood: p.mood }, NeonLooks.byId(NeonLooks.OUTFITS, p.look.outfit), r.t, p.look);
    // the clerk wears a green staff apron
    if (p.kind === 'clerk') {
      ctx.fillStyle = '#22c55e'; roundRect(ctx, px - s * 0.18, py - s * 1.26, s * 0.36, s * 0.52, s * 0.06); ctx.fill();
      if (front) { ctx.fillStyle = '#0b0221'; ctx.font = `800 ${Math.round(Math.max(6, s * 0.09))}px system-ui, sans-serif`; ctx.fillText('STAFF', px, py - s * 1.08); }
    }
    // a box in their arms (clerk and courier)
    if ((p.kind === 'clerk' && p.carry > 0) || (p.kind === 'courier' && p.box > 0)) drawBox(ctx, px, py - s * 0.62, s * 0.55, G);
    // a pack held up to read the label
    if (p.hold) art.pack(ctx, r.b.good, px + s * 0.3, py - s * 1.15, s * 0.32, 0, r.dpr);
    // shopping basket, held at the side
    if (p.basket > 0) {
      const bx = px - s * 0.34, by = py - s * 0.62, bw = s * 0.44, bh = s * 0.22;
      for (let i = 0; i < Math.min(3, p.basket); i++) art.pack(ctx, r.b.good, bx + (i - 1) * bw * 0.28, by - bh * 0.1, s * 0.24, i, r.dpr);
      ctx.fillStyle = '#ff2a6d'; ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 1; k < 4; k++) ctx.fillRect(bx - bw / 2 + (k * bw) / 4, by - bh / 2 + 2, 1, bh - 4);
      ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx, by - bh / 2, bw * 0.36, Math.PI, 0); ctx.stroke();
    }
    if (p.bag) { ctx.font = `${Math.round(s * 0.45)}px system-ui, sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText('🛍️', px + s * 0.35, py - s * 0.75); }
    // what they're buying, and how patient they are
    if (p.state === 'queue' || p.state === 'serving') {
      const k = Math.max(0, 1 - p.wait / p.patience);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(px - s * 0.3, py - s * 2.15, s * 0.6, 5);
      ctx.fillStyle = k > 0.5 ? '#4ade80' : k > 0.25 ? '#ffd23f' : '#ff6b6b'; ctx.fillRect(px - s * 0.3, py - s * 2.15, s * 0.6 * k, 5);
      ctx.font = `800 ${Math.round(Math.max(11, s * 0.28))}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
      ctx.fillText(`${p.basket}× ${G.icon}`, px, py - s * 2.25);
    }
    if (p.bubble && p.bubbleT > 0) drawBubble(ctx, p.bubble, px, py - s * (p.state === 'queue' ? 2.45 : 2.05), s, W, Math.min(1, p.bubbleT / 0.3));
  }

  const money2 = (n) => `$${n.toFixed(2)}`;
  // shorten text to fit a width
  function fit(ctx, text, w) {
    if (ctx.measureText(text).width <= w) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > w) text = text.slice(0, -1);
    return text + '…';
  }

  function drawPOS(ctx, base, W, H, G, serving) {
    const r = run;
    const sw = Math.min(W * 0.32, 200), sh = H * 0.125, sx = clamp(base[0] - sw / 2, 4, W - sw - 4), sy = base[1] - H * 0.014 - sh;
    // stand
    ctx.fillStyle = '#2a2a35'; ctx.fillRect(base[0] - 3, sy + sh, 6, base[1] - sy - sh); ctx.fillRect(base[0] - 14, base[1] - 3, 28, 4);
    // bezel and screen
    ctx.fillStyle = '#0d0d14'; roundRect(ctx, sx, sy, sw, sh, 5); ctx.fill();
    const x0 = sx + 4, y0 = sy + 4, w = sw - 8, h = sh - 8, pad = w * 0.05;
    ctx.fillStyle = '#061820'; ctx.fillRect(x0, y0, w, h);
    const line = h * 0.15, fs = Math.max(7, Math.round(h * 0.105));
    // header bar
    ctx.fillStyle = '#05d9e8'; ctx.fillRect(x0, y0, w, line);
    ctx.fillStyle = '#062a33'; ctx.font = `800 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.fillText('NEON POS · TILL 1', x0 + pad, y0 + line * 0.75);
    ctx.textAlign = 'right'; ctx.fillText(clock(), x0 + w - pad, y0 + line * 0.75);
    const L1 = y0 + line * 2, L2 = L1 + line, L3 = L2 + line * 1.15;
    const price = T.shelfPrice(r.s, r.b);
    // a payment stays on screen for a moment, even if the next customer is already up
    const recent = r.lastSale && r.t - r.lastSale.t < (serving ? 0.9 : 1.6) ? r.lastSale : null;
    if (recent || (serving && serving.basket)) {
      if (recent) serving = null;
      const k = serving ? clamp(1 - serving.timer / (serving.serveDur || 0.5), 0, 1) : 1;
      const qty = serving ? Math.max(1, Math.ceil(k * serving.basket)) : recent.qty;
      const each = serving ? price : recent.price, total = qty * each;
      // item line: name and line total, then qty x price
      ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.fillStyle = '#e6fbff';
      ctx.textAlign = 'right'; ctx.fillText(money2(total), x0 + w - pad, L1);
      const right = ctx.measureText(money2(total)).width;
      ctx.textAlign = 'left'; ctx.fillText(fit(ctx, `${G.icon} ${G.name}`, w - pad * 3 - right), x0 + pad, L1);
      ctx.fillStyle = '#7fb3c2'; ctx.font = `600 ${Math.round(fs * 0.9)}px system-ui, sans-serif`;
      ctx.fillText(`   ${qty} × ${money2(each)}`, x0 + pad, L2);
      if (recent) {
        ctx.textAlign = 'right';
        ctx.fillText(recent.method === 'card' ? `CARD •••• ${recent.card}` : `CASH ${money2(recent.tendered)}`, x0 + w - pad, L2);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = 'rgba(127,179,194,.4)'; ctx.fillRect(x0 + pad, L2 + line * 0.35, w - pad * 2, 1);
      // total
      ctx.fillStyle = '#05d9e8'; ctx.font = `900 ${Math.round(fs * 1.25)}px system-ui, sans-serif`;
      ctx.textAlign = 'left'; ctx.fillText('TOTAL', x0 + pad, L3 + line * 0.15);
      ctx.textAlign = 'right'; ctx.fillText(money2(total), x0 + w - pad, L3 + line * 0.15);
      // footer: scanning, or paid
      const fy = y0 + h - line * 1.05;
      if (recent) {
        ctx.fillStyle = '#16a34a'; ctx.fillRect(x0, fy, w, line * 1.05);
        ctx.fillStyle = '#fff'; ctx.font = `900 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center';
        const msg = recent.method === 'card' ? '✓ PAID · APPROVED' : `✓ PAID · CHANGE ${money2(recent.tendered - recent.total)}`;
        ctx.fillText(fit(ctx, msg, w - pad), x0 + w / 2, fy + line * 0.78);
      } else if (Math.sin(r.t * 10) > -0.4) {
        ctx.fillStyle = '#ffd23f'; ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('● SCANNING…', x0 + w / 2, fy + line * 0.78);
      }
    } else {
      ctx.textAlign = 'center'; ctx.fillStyle = '#e6fbff'; ctx.font = `800 ${fs}px system-ui, sans-serif`;
      ctx.fillText('Next customer, please', x0 + w / 2, L1 + line * 0.4);
      ctx.fillStyle = '#7fb3c2'; ctx.font = `600 ${Math.round(fs * 0.9)}px system-ui, sans-serif`;
      ctx.fillText(`Today: ${r.served} sale${r.served === 1 ? '' : 's'} · ${r.sold} sold`, x0 + w / 2, L2 + line * 0.5);
      ctx.fillStyle = '#05d9e8'; ctx.font = `900 ${Math.round(fs * 1.35)}px system-ui, sans-serif`;
      ctx.fillText(`$${Math.round(r.revenue).toLocaleString()}`, x0 + w / 2, L3 + line * 0.6);
    }
    ctx.textAlign = 'center';
    // screen glare
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.35, y0); ctx.lineTo(x0, y0 + h * 0.6); ctx.closePath(); ctx.fill();
  }

  function drawCounter(ctx, W, H, G) {
    const r = run, far = L.counter * H, near = far + H * 0.075;
    const f = (near - far) / (near - VP_Y * H);
    // a point on the counter top: u across (0 left, 1 right), v from our edge (0) to the shoppers' edge (1)
    const P = (u, v) => toVP(-0.02 * W + u * 1.04 * W, near, f * v, W, H);
    // stone counter top with speckles
    let g = ctx.createLinearGradient(0, far, 0, near);
    g.addColorStop(0, '#8b82ad'); g.addColorStop(1, '#cec7e6');
    ctx.fillStyle = g; poly(ctx, [P(0, 1), P(1, 1), P(1, 0), P(0, 0)]); ctx.fill();
    for (const sp of r.speckles) { const p = P(sp.u, sp.v); ctx.fillStyle = sp.dark ? 'rgba(40,20,70,.35)' : 'rgba(255,255,255,.45)'; ctx.fillRect(p[0], p[1], 2, 1.5); }
    ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(...P(0, 1)); ctx.lineTo(...P(1, 1)); ctx.stroke();
    // cabinet on our side, with drawers
    g = ctx.createLinearGradient(0, near, 0, H);
    g.addColorStop(0, '#45275e'); g.addColorStop(1, '#1d0f2e');
    ctx.fillStyle = g; ctx.fillRect(0, near, W, H - near);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, near, W, 2);
    for (let i = 0; i < 4; i++) {
      const dx = W * (0.03 + i * 0.245), dw = W * 0.22, dy = near + H * 0.018, dh = H * 0.055;
      if (i === 2) continue; // the cash drawer goes here
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1.5; ctx.strokeRect(dx, dy, dw, dh);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(dx + dw / 2 - 10, dy + dh * 0.4, 20, 3);
    }
    // cash drawer: slides open when you take money
    {
      const out = r.drawer > 0 ? Math.min(1, r.drawer * 4) : 0;
      const dx = W * 0.52, dw = W * 0.22, dy = near + H * (0.018 + 0.03 * out), dh = H * 0.055;
      if (out) {
        ctx.fillStyle = '#120820'; ctx.fillRect(dx, dy - H * 0.03 * out, dw, H * 0.03 * out);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#4ade80' : '#22c55e'; ctx.fillRect(dx + 6 + i * (dw - 12) / 4, dy - H * 0.026 * out, (dw - 12) / 4 - 3, H * 0.022 * out); }
      }
      ctx.fillStyle = '#2b1640'; ctx.fillRect(dx, dy, dw, dh);
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1.5; ctx.strokeRect(dx, dy, dw, dh);
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(dx + dw / 2, dy + dh * 0.5, 3, 0, Math.PI * 2); ctx.fill();
    }
    // conveyor belt
    ctx.fillStyle = '#16121c'; poly(ctx, [P(0.05, 0.85), P(0.45, 0.85), P(0.45, 0.15), P(0.05, 0.15)]); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
    for (let k = 0; k < 20; k++) {
      const u = 0.05 + ((k * 0.02 + r.belt * 0.08) % 0.4);
      ctx.beginPath(); ctx.moveTo(...P(u, 0.85)); ctx.lineTo(...P(u, 0.15)); ctx.stroke();
    }
    ctx.fillStyle = '#9aa0b5';
    for (const u of [0.05, 0.45]) { poly(ctx, [P(u - 0.006, 0.88), P(u + 0.006, 0.88), P(u + 0.006, 0.12), P(u - 0.006, 0.12)]); ctx.fill(); }
    // scanner window, with a laser while scanning
    const serving = r.people.find((x) => x.state === 'serving');
    ctx.fillStyle = '#3a3f4f'; poly(ctx, [P(0.47, 0.8), P(0.57, 0.8), P(0.57, 0.2), P(0.47, 0.2)]); ctx.fill();
    ctx.fillStyle = 'rgba(5,217,232,.35)'; poly(ctx, [P(0.48, 0.72), P(0.56, 0.72), P(0.56, 0.28), P(0.48, 0.28)]); ctx.fill();
    if (serving && Math.sin(r.t * 40) > -0.3) {
      ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(...P(0.48, 0.5)); ctx.lineTo(...P(0.56, 0.5)); ctx.stroke(); ctx.shadowBlur = 0;
    }
    // goods riding the belt to the scanner
    if (serving && serving.basket) {
      const k = clamp(1 - serving.timer / (serving.serveDur || 0.4), 0, 1);
      for (let i = 0; i < Math.min(4, serving.basket); i++) {
        const p = P(0.1 + i * 0.07 + k * 0.3, 0.5);
        window.NeonShopArt.pack(ctx, r.b.good, p[0], p[1] + 3, H * 0.026, i, r.dpr);
      }
    }
    // receipt printer: the receipt rolls out while scanning
    const pr = P(0.4, 0.07);
    ctx.fillStyle = '#2a2a35'; roundRect(ctx, pr[0] - 12, pr[1] - 11, 24, 11, 2); ctx.fill();
    ctx.fillStyle = '#0b0b10'; ctx.fillRect(pr[0] - 8, pr[1] - 11, 16, 2);
    r.printerXY = [pr[0], pr[1] - 12];
    {
      const paid = r.lastSale && r.t - r.lastSale.t < 0.15;
      const k = serving ? clamp(1 - serving.timer / (serving.serveDur || 0.5), 0, 1) : paid ? 1 : 0;
      if (k > 0) {
        const len = k * H * 0.03;
        ctx.fillStyle = '#fafafa'; ctx.fillRect(pr[0] - 6, pr[1] - 11 - len, 12, len);
        ctx.fillStyle = '#c4c4c4'; for (let y = pr[1] - 14; y > pr[1] - 11 - len + 2; y -= 3) ctx.fillRect(pr[0] - 4, y, 8, 1);
      }
    }
    // card reader
    const cr = P(0.575, 0.8);
    ctx.fillStyle = '#1b1b24'; roundRect(ctx, cr[0] - 9, cr[1] - 16, 18, 20, 3); ctx.fill();
    ctx.fillStyle = r.lastSale && r.lastSale.method === 'card' && r.t - r.lastSale.t < 1.6 ? '#4ade80' : '#1e3a2a'; ctx.fillRect(cr[0] - 6, cr[1] - 13, 12, 6);
    // till screen on a stand, facing you: the sale being rung up, then PAID
    drawPOS(ctx, P(0.74, 0.45), W, H, G, serving);
    // bagging stand with paper bags
    const bs = P(0.955, 0.5), bw = W * 0.035;
    ctx.fillStyle = '#9aa0b5'; ctx.fillRect(bs[0] - bw, bs[1] - H * 0.045, 2, H * 0.045); ctx.fillRect(bs[0] + bw, bs[1] - H * 0.045, 2, H * 0.045);
    ctx.fillRect(bs[0] - bw, bs[1] - H * 0.045, bw * 2 + 2, 2);
    ctx.fillStyle = '#c99a5b'; ctx.fillRect(bs[0] - bw * 0.7, bs[1] - H * 0.04, bw * 1.4, H * 0.038);
    ctx.fillStyle = '#a87a40'; ctx.fillRect(bs[0] - bw * 0.7, bs[1] - H * 0.04, bw * 1.4, 3);
    // you and your helpers, behind the counter
    const sellerS = H * 0.13;
    const staffXs = [0.2, 0.8, 0.08, 0.92];
    // whoever is scanning moves their arms, item to item
    const busy = (who) => r.people.some((x) => x.state === 'serving' && x.servedBy === who);
    const pose = (who) => (busy(who) ? { phase: r.t * 14 + who, stride: 0.3 } : { phase: 0, stride: 0 });
    r.staffLooks.forEach((lk, i) => NeonLooks.drawRunner(ctx, W * staffXs[i], H + sellerS * 0.55, sellerS * 0.85, pose(i), NeonLooks.byId(NeonLooks.OUTFITS, lk.outfit), r.t, lk));
    NeonLooks.drawRunner(ctx, W * 0.5, H + sellerS * 0.5, sellerS, pose(-1), NeonLooks.byId(NeonLooks.OUTFITS, r.sellerLook.outfit), r.t, r.sellerLook);
  }

  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
  }

  // clock text for the HUD
  const clock = () => {
    if (!run) return '';
    const h = OPEN_H + (Math.min(run.t, DAY_SECONDS) / DAY_SECONDS) * (CLOSE_H - OPEN_H);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 15) * 15;
    return run.t >= DAY_SECONDS ? 'Closing…' : `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  // where the stock is right now
  const stockInfo = () => {
    if (!run) return null;
    const baskets = run.people.reduce((a, p) => a + (p.basket || 0), 0);
    return { shelves: shelfTotal(), pile: run.pile, incoming: run.incoming, clerk: run.clerk.carry, baskets, total: run.b.stock };
  };

  return { open, serve, refill, setPrice, closeEarly, clock, frontWaiting, stockInfo, active: () => !!run, current: () => run };
})();
