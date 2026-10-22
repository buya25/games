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
    { x0: 0.61, x1: 0.98, top: L.wall + 0.006, base: L.door, cols: 5, wall: true },
    { x0: 0.05, x1: 0.37, top: 0.42, base: 0.53, cols: 4 },
    { x0: 0.63, x1: 0.95, top: 0.42, base: 0.53, cols: 4 },
  ];
  const PILE = { x: 0.13, y: 0.735 };     // where deliveries are stacked
  const CLERK_HOME = { x: 0.25, y: 0.7 };
  const VAN_X = 0.76;

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
          slots.push({ u: ui, row, x: u.x0 + (c + 0.5) * (u.x1 - u.x0) / u.cols, y: shelfY(u, row), n: 0, pop: 0 });
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
      belt: 0, drawer: 0, doorOpen: 0, cars: [],
      skyline: Array.from({ length: 9 }, (_, i) => ({ x: i / 9 + rand(-0.02, 0.02), w: rand(0.08, 0.14), h: rand(0.04, 0.09), lit: Math.random() })),
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
    const loop = (now) => {
      if (!run) return;
      const dt = Math.min(0.05, (now - run.last) / 1000);
      run.last = now;
      step(dt);
      draw();
      ui.onTick(run);
      if (run && run.done) { const sum = summary(); const cb = ui.onEnd; run = null; cb(sum); return; }
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

  function leaveShop(p, mood, bubble) {
    if (p.basket) { run.pile += p.basket; p.basket = 0; } // a dropped basket goes back to the stock pile
    p.state = 'leaving'; p.mood = mood; p.bubble = bubble; p.bubbleT = 99;
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
          if (mult > p.limit) { r.lostPrice++; leaveShop(p, 'angry', '😒'); break; }
          if (shelfTotal() > 0) takeGoods(p);
          else if (backTotal() > 0) { p.state = 'wait'; p.wait = 0; p.mood = 'meh'; p.bubble = '⏳'; p.bubbleT = 99; }
          else { r.lostStock++; leaveShop(p, 'sad', '📦❌'); }
          break;
        case 'wait': // shelves are empty but there is stock out back
          p.wait += dt;
          if (shelfTotal() > 0) { p.bubbleT = 0; takeGoods(p); }
          else if (p.wait > p.patience || backTotal() === 0) { r.lostStock++; leaveShop(p, 'sad', '📦❌'); }
          break;
        case 'pick':
          p.timer -= dt;
          if (p.timer <= 0) {
            p.state = 'toQueue'; p.path = [[0.5, p.y]];
            p.bubble = mult < p.limit * 0.8 ? '😍' : '🙂'; p.bubbleT = 1.2; p.mood = 'happy';
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
          if (p.wait > p.patience) { r.lostWait++; leaveShop(p, 'angry', '😠'); sfx.huff(); }
          break;
        }
        case 'serving':
          p.timer -= dt;
          if (p.timer <= 0) finishSale(p);
          break;
        case 'leaving':
          if (walk(p, dt, 0.24)) { p.x += p.exitDir * 0.14 * dt; p.phase += dt * 8; p.moving = true; }
          break;
      }
    }
    stepClerk(dt);
    stepVan(dt);
    // traffic on the road
    if (Math.random() < dt * 0.3) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      r.cars.push({ x: dir > 0 ? -0.15 : 1.15, dir, lane: dir > 0 ? 0.142 : 0.131, speed: rand(0.3, 0.55), color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0] });
    }
    for (const c of r.cars) c.x += c.dir * c.speed * dt;
    r.cars = r.cars.filter((c) => c.x > -0.3 && c.x < 1.3);
    // the doors open for anyone walking in or out
    const nearDoor = (p) => p && Math.abs(p.x - 0.5) < 0.1 && p.y > L.street - 0.01 && p.y < L.enter + 0.06;
    const wantOpen = r.people.some((p) => p.kind === 'shopper' && (p.state === 'enter' || p.state === 'leaving') && nearDoor(p)) || nearDoor(r.van && r.van.courier);
    r.doorOpen = clamp(r.doorOpen + (wantOpen ? 4 : -2.5) * dt, 0, 1);
    // helpers at the till serve the front of the queue on their own
    r.staffTimers = r.staffTimers.map((tm) => {
      tm -= dt;
      if (tm <= 0) {
        const p = queue().find(atTill);
        if (p) { startServe(p, 0.8); return STAFF_SERVE * (0.8 + Math.random() * 0.4); }
        return 0.3;
      }
      return tm;
    });
    if (r.people.some((p) => p.state === 'serving')) r.belt += dt;
    if (r.drawer > 0) r.drawer -= dt;
    for (const sl of r.slots) if (sl.pop > 0) sl.pop = Math.max(0, sl.pop - dt);
    for (const fx of r.effects) { fx.t += dt; if (fx.kind === 'text') fx.y -= dt * 0.08; }
    r.effects = r.effects.filter((fx) => (fx.kind === 'fly' ? fx.t < fx.dur : fx.t < 1.1));
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
        if (!r.pile) { moveToward(c, CLERK_HOME.x, CLERK_HOME.y, dt, 0.2); if (!c.moving) c.facing = 'front'; break; }
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

  function startServe(p, time) {
    p.state = 'serving'; p.timer = time; p.serveDur = time;
  }

  function finishSale(p) {
    const r = run;
    const res = T.shopSale(r.s, r.b.id, p.basket);
    if (!res.ok) { r.lostStock++; leaveShop(p, 'sad', '📦❌'); return; }
    p.basket = 0;
    r.served++; r.sold += res.qty; r.revenue += res.revenue;
    p.bag = true;
    leaveShop(p, 'happy', '😊');
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
    const G = T.G[r.b.good];

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
    drawDoor(ctx, W, H);

    // inside: shelf islands, the stock pile and people, far to near
    const items = [];
    UNITS.forEach((u, i) => { if (!u.wall) items.push({ y: u.base, draw: () => drawUnit(ctx, u, i, W, H, G) }); });
    items.push({ y: PILE.y, draw: () => drawPile(ctx, W, H, G) });
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
    ctx.font = `${Math.round(H * 0.026)}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
    for (const fx of r.effects) {
      if (fx.kind !== 'fly' || fx.t < 0) continue;
      const k = fx.t / fx.dur, p = fx.to, s = scaleAt(p.y, H);
      const x1 = p.x * W - s * 0.34, y1 = p.y * H - s * 0.75;
      ctx.fillText(G.icon, fx.x * W + (x1 - fx.x * W) * k, fx.y * H + (y1 - fx.y * H) * k - Math.sin(k * Math.PI) * 18);
    }
    // the front of the queue glows: tap to serve
    const front = queue().find(atTill);
    if (front) {
      const s = scaleAt(front.y, H);
      ctx.strokeStyle = `rgba(255,210,63,${0.5 + 0.4 * Math.sin(r.t * 8)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(front.x * W, front.y * H, s * 0.5, s * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawCounter(ctx, W, H, G);
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

  function drawStreet(ctx, W, H) {
    const r = run, F = FRONT;
    // night sky and the buildings across the road
    let g = ctx.createLinearGradient(0, F.glass * H, 0, F.road0 * H);
    g.addColorStop(0, '#12052e'); g.addColorStop(1, '#3a0d55');
    ctx.fillStyle = g; ctx.fillRect(0, F.glass * H, W, (F.road0 - F.glass) * H + 1);
    for (const b of r.skyline) {
      const x = b.x * W, w = b.w * W, top = (F.road0 - b.h) * H, bot = F.road0 * H;
      ctx.fillStyle = '#1c0a3a'; ctx.fillRect(x, top, w, bot - top);
      ctx.fillStyle = b.lit > 0.5 ? 'rgba(255,210,63,.55)' : 'rgba(5,217,232,.45)';
      for (let wy = top + 4; wy < bot - 4; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 6) if (((wx * 7 + wy * 3) | 0) % 5 < 2) ctx.fillRect(wx, wy, 2, 3);
    }
    // road with lane markings and passing cars
    ctx.fillStyle = '#1a1424'; ctx.fillRect(0, F.road0 * H, W, (F.road1 - F.road0) * H);
    ctx.fillStyle = 'rgba(255,210,63,.5)';
    const lane = (F.road0 + F.road1) / 2 * H;
    for (let x = ((-r.t * 30) % 40) - 40; x < W; x += 40) ctx.fillRect(x, lane, 18, 1.5);
    for (const c of r.cars) drawCar(ctx, c, W, H);
    if (r.van) drawVan(ctx, r.van, W, H);
    // curb and pavement, with street lamps
    ctx.fillStyle = '#5a4a6e'; ctx.fillRect(0, F.road1 * H, W, 2);
    g = ctx.createLinearGradient(0, F.road1 * H, 0, L.door * H);
    g.addColorStop(0, '#3a2a52'); g.addColorStop(1, '#4d3a66');
    ctx.fillStyle = g; ctx.fillRect(0, F.road1 * H + 2, W, (L.door - F.road1) * H);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 22) { ctx.beginPath(); ctx.moveTo(x, F.road1 * H + 2); ctx.lineTo(x - 3, L.wall * H); ctx.stroke(); }
    for (const lx of [0.2, 0.8]) {
      const x = lx * W, y0 = (F.road1 + 0.004) * H, y1 = (F.glass + 0.03) * H;
      ctx.fillStyle = '#2a2a35'; ctx.fillRect(x - 1.5, y1, 3, y0 - y1);
      ctx.fillRect(x - 1.5, y1, 10, 2.5);
      const lg = ctx.createRadialGradient(x + 9, y1 + 3, 0, x + 9, y1 + 3, H * 0.05);
      lg.addColorStop(0, 'rgba(255,230,150,.5)'); lg.addColorStop(1, 'rgba(255,230,150,0)');
      ctx.fillStyle = lg; ctx.fillRect(x + 9 - H * 0.05, y1 + 3 - H * 0.05, H * 0.1, H * 0.1);
      ctx.fillStyle = '#fff2c4'; ctx.fillRect(x + 6, y1 + 2, 6, 2);
    }
  }

  function drawCar(ctx, c, W, H) {
    const w = W * 0.13, h = H * 0.026, x = c.x * W, base = c.lane * H;
    ctx.fillStyle = c.color; roundRect(ctx, x - w / 2, base - h * 0.62, w, h * 0.5, 3); ctx.fill();
    roundRect(ctx, x - w * 0.27 - c.dir * w * 0.04, base - h, w * 0.5, h * 0.45, 4); ctx.fill();
    ctx.fillStyle = 'rgba(10,20,40,.8)'; roundRect(ctx, x - w * 0.23 - c.dir * w * 0.04, base - h * 0.93, w * 0.42, h * 0.32, 3); ctx.fill();
    ctx.fillStyle = '#111';
    for (const k of [-0.3, 0.3]) { ctx.beginPath(); ctx.arc(x + k * w, base - h * 0.12, h * 0.17, 0, Math.PI * 2); ctx.fill(); }
    const fx = x + c.dir * w / 2, bx = x - c.dir * w / 2;
    const lg = ctx.createRadialGradient(fx, base - h * 0.4, 0, fx, base - h * 0.4, w * 0.35);
    lg.addColorStop(0, 'rgba(255,240,180,.55)'); lg.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = lg; ctx.fillRect(fx - w * 0.35, base - h * 0.4 - w * 0.35, w * 0.7, w * 0.7);
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

  // a brick wall section
  function bricks(ctx, x0, y0, x1, y1) {
    ctx.fillStyle = '#26102a'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const bh = 5, bw = 13, shades = ['#5a1f45', '#4e1a3d', '#63244c', '#541c41'];
    for (let row = 0, y = y0; y < y1; row++, y += bh) {
      for (let col = -1, x = x0 - (row % 2 ? bw / 2 : 0); x < x1; col++, x += bw) {
        ctx.fillStyle = shades[(row * 7 + col * 3 + 8) % 4];
        const bx = Math.max(x0, x + 0.5), ex = Math.min(x1, x + bw - 1);
        if (ex > bx) ctx.fillRect(bx, y + 0.5, ex - bx, Math.min(bh - 1, y1 - y - 0.5));
      }
    }
  }

  function drawStorefront(ctx, W, H, G) {
    const r = run, F = FRONT;
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
      ctx.strokeStyle = on ? '#ff2a6d' : '#5a2a3a'; ctx.lineWidth = 2; ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = on ? 10 : 0; ctx.stroke();
      ctx.font = `900 ${Math.round(sh * 0.7)}px system-ui, sans-serif`; ctx.fillStyle = on ? '#ff5c8a' : '#7a4a5a';
      ctx.fillText(on ? 'OPEN' : 'CLOSED', cx, cy + sh * 0.26);
      ctx.shadowBlur = 0;
      const px = W * 0.87, py = (F.transom + 0.008) * H, pw = W * 0.12, ph = H * 0.06;
      g0(ctx, px - pw / 2, py, pw, ph);
      ctx.font = `${Math.round(ph * 0.42)}px system-ui, sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText(G.icon, px, py + ph * 0.55);
      ctx.font = `900 ${Math.round(ph * 0.2)}px system-ui, sans-serif`; ctx.fillStyle = '#0b0221'; ctx.fillText('FRESH!', px, py + ph * 0.86);
    }
    // bulkhead over the windows with the shop's name
    let g = ctx.createLinearGradient(0, 0, 0, gy0);
    g.addColorStop(0, '#140628'); g.addColorStop(1, '#22093f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, gy0);
    ctx.font = `900 ${Math.round(Math.min(H * 0.026, W * 0.045))}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ff7a00'; ctx.shadowBlur = 8;
    ctx.fillText(`${G.icon} ${G.name.toUpperCase()} · ${T.STALLS[r.b.tier].name.toUpperCase()}`, W / 2, L.sign * H * 0.68);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff2a6d'; ctx.fillRect(0, gy0 - 3, W, 2);
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
  }
  // a small poster with a gradient
  function g0(ctx, x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#ffd23f'); g.addColorStop(1, '#ff7a00');
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
    // ceiling lights reflected on the floor
    for (const [lx, ly] of [[0.5, 0.42], [0.22, 0.64], [0.78, 0.64]]) {
      const g = ctx.createRadialGradient(lx * W, ly * H, 0, lx * W, ly * H, W * 0.25);
      g.addColorStop(0, 'rgba(5,217,232,.10)'); g.addColorStop(1, 'rgba(5,217,232,0)');
      ctx.fillStyle = g; ctx.fillRect(lx * W - W * 0.25, ly * H - W * 0.25, W * 0.5, W * 0.5);
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
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    for (let y = top + 5; y < base - kk - 3; y += 7) for (let x = x0 + 6; x < x1 - 5; x += 7) ctx.fillRect(x, y, 1.5, 1.5);
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
    const fsz = Math.min(rh * 0.6, colW * 0.44);
    ctx.fillStyle = '#fff'; // emoji pick up the fill alpha
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
          ctx.beginPath(); ctx.ellipse(px, py - 0.5, s * 0.36, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.globalAlpha = 1 - d * 0.24;
          ctx.font = `${Math.max(6, Math.round(s))}px system-ui, sans-serif`;
          ctx.fillText(G.icon, px, py);
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
    // the price, on the middle shelf
    const price = T.shelfPrice(r.s, r.b), label = `$${price < 100 ? price.toFixed(2) : Math.round(price).toLocaleString()}`;
    ctx.font = `900 ${Math.max(8, Math.round(rh * 0.36))}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 8, th = rh * 0.4, ty = shelfY(u, 1) * H - th * 0.3;
    ctx.fillStyle = '#ffd23f'; roundRect(ctx, cx - tw / 2, ty, tw, th, 3); ctx.fill();
    ctx.fillStyle = '#0b0221'; ctx.fillText(label, cx, ty + th * 0.78);
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
    const r = run;
    const px = p.x * W, py = p.y * H, s = scaleAt(p.y, H);
    const front = p.kind !== 'passer' && p.state !== 'street' && p.facing === 'front';
    const stride = p.kind === 'passer' || p.moving ? 0.35 : 0;
    NeonLooks.drawRunner(ctx, px, py, s, { front, phase: p.phase, stride, mood: p.mood }, NeonLooks.byId(NeonLooks.OUTFITS, p.look.outfit), r.t, p.look);
    // the clerk wears a green staff apron
    if (p.kind === 'clerk') {
      ctx.fillStyle = '#22c55e'; roundRect(ctx, px - s * 0.18, py - s * 1.26, s * 0.36, s * 0.52, s * 0.06); ctx.fill();
      if (front) { ctx.fillStyle = '#0b0221'; ctx.font = `800 ${Math.round(Math.max(6, s * 0.09))}px system-ui, sans-serif`; ctx.fillText('STAFF', px, py - s * 1.08); }
    }
    // a box in their arms (clerk and courier)
    if ((p.kind === 'clerk' && p.carry > 0) || (p.kind === 'courier' && p.box > 0)) drawBox(ctx, px, py - s * 0.62, s * 0.55, G);
    // shopping basket, held at the side
    if (p.basket > 0) {
      const bx = px - s * 0.34, by = py - s * 0.62, bw = s * 0.44, bh = s * 0.22;
      ctx.font = `${Math.round(Math.max(8, s * 0.24))}px system-ui, sans-serif`;
      for (let i = 0; i < Math.min(3, p.basket); i++) ctx.fillText(G.icon, bx + (i - 1) * bw * 0.28, by - bh * 0.35);
      ctx.fillStyle = '#ff2a6d'; ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
      ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx, by - bh / 2, bw * 0.36, Math.PI, 0); ctx.stroke();
    }
    if (p.bag) { ctx.font = `${Math.round(s * 0.45)}px system-ui, sans-serif`; ctx.fillText('🛍️', px + s * 0.35, py - s * 0.75); }
    // what they're buying, and how patient they are
    if (p.state === 'queue' || p.state === 'serving') {
      const k = Math.max(0, 1 - p.wait / p.patience);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(px - s * 0.3, py - s * 2.15, s * 0.6, 5);
      ctx.fillStyle = k > 0.5 ? '#4ade80' : k > 0.25 ? '#ffd23f' : '#ff6b6b'; ctx.fillRect(px - s * 0.3, py - s * 2.15, s * 0.6 * k, 5);
      ctx.font = `800 ${Math.round(Math.max(11, s * 0.28))}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
      ctx.fillText(`${p.basket}× ${G.icon}`, px, py - s * 2.25);
    }
    if (p.bubble && (p.state === 'leaving' || (p.bubbleT || 0) > 0)) {
      ctx.font = `${Math.round(Math.max(16, s * 0.5))}px system-ui, sans-serif`;
      ctx.fillText(p.bubble, px, py - s * 2.0);
    }
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
      ctx.font = `${Math.round(H * 0.026)}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
      for (let i = 0; i < Math.min(4, serving.basket); i++) {
        const p = P(0.1 + i * 0.07 + k * 0.3, 0.5);
        ctx.fillText(G.icon, p[0], p[1] + 2);
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
    r.staffLooks.forEach((lk, i) => NeonLooks.drawRunner(ctx, W * staffXs[i], H + sellerS * 0.55, sellerS * 0.85, { phase: 0, stride: 0 }, NeonLooks.byId(NeonLooks.OUTFITS, lk.outfit), r.t, lk));
    NeonLooks.drawRunner(ctx, W * 0.5, H + sellerS * 0.5, sellerS, { phase: 0, stride: 0 }, NeonLooks.byId(NeonLooks.OUTFITS, r.sellerLook.outfit), r.t, r.sellerLook);
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
