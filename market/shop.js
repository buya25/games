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
  // the front wall is a little narrower than the screen, so the side walls show
  const BX = (x) => 0.5 + (x - 0.5) * 0.86;
  // two shelf walls either side of the door, and two shelf islands in the middle of the floor
  const UNITS = [
    { x0: BX(0.02), x1: BX(0.39), top: L.wall + 0.006, base: L.door, cols: 5, wall: true },
    { x0: BX(0.61), x1: BX(0.79), top: L.wall + 0.006, base: L.door, cols: 3, wall: true },
    { x0: 0.05, x1: 0.37, top: 0.42, base: 0.53, cols: 4 },
    { x0: 0.63, x1: 0.95, top: 0.42, base: 0.53, cols: 4 },
  ];
  const PILE = { x: 0.12, y: 0.665 };     // where deliveries are stacked
  const CLERK_HOME = { x: 0.27, y: 0.68 };
  // shop upgrades on the floor
  const KIOSK = { x: 0.955, y: 0.77 }, KIOSK_SPOT = { x: 0.89, y: 0.75 };
  const COFFEE = { x: 0.075, y: 0.785 }, TABLE = { x: 0.19, y: 0.79 };
  const FRIDGE_SPOT = { x: 0.82, y: 0.31 };
  // kinds of shopper: [type, chance, badge]
  const TYPES = [['thief', 0.06, ''], ['regular', 0.14, '⭐'], ['rushed', 0.14, '⏱️'], ['bargain', 0.11, '🏷️'], ['tourist', 0.09, '📸']];
  const VAN_X = 0.76;
  const FRIDGE = { x0: BX(0.805), x1: BX(0.985), top: 0.075, base: 0.27 };   // a drinks fridge against the front wall
  // props on the shop floor: [kind, x, y]
  const PROPS = [['plant', BX(0.365), 0.315], ['baskets', BX(0.64), 0.325], ['wet', 0.6, 0.395], ['bin', 0.29, 0.795], ['candy', 0.36, 0.78]];
  const JUNGLE = [['plant', 0.075, 0.43], ['plant', 0.925, 0.43], ['plant', BX(0.03), 0.3]];
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
    approved: () => { tone(1320, 0.07, 'sine', 0.04); tone(1760, 0.12, 'sine', 0.04, 0, 0.08); },
    coins: () => { for (let i = 0; i < 4; i++) tone(2400 + Math.random() * 1600, 0.05, 'triangle', 0.025, 0, 0.05 + i * 0.06); },
    alarm: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 880 : 1175, 0.14, 'square', 0.035, 0, i * 0.15); },
    click: () => tone(1800, 0.03, 'square', 0.03),
    shutter: () => noiseBurst(1.1, 0.05, 300, 900),
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
  // the shop music: chord loops and a tempo for each style you can pick
  const MUSIC = {
    chill: { beat: 0.42, wave: 'triangle', vol: 0.010, arp: [0, 1, 2, 3, 2, 1, 2, 3], chords: [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 392]] },
    synth: { beat: 0.26, wave: 'square', vol: 0.005, bass: 'sawtooth', arp: [0, 2, 1, 3, 0, 2, 1, 3], chords: [[220, 261.6, 329.6, 440], [174.6, 220, 261.6, 349.2], [261.6, 329.6, 392, 523.3], [196, 246.9, 293.7, 392]] },
    jazz: { beat: 0.5, wave: 'triangle', vol: 0.011, swing: true, arp: [0, 2, 1, 3, 2, 0, 3, 1], chords: [[293.7, 349.2, 440, 523.3], [196, 246.9, 293.7, 349.2], [261.6, 329.6, 392, 493.9], [220, 277.2, 329.6, 392]] },
  };
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
        // the murmur of other shoppers, louder the busier it gets
        const cs = actx.createBufferSource(), cf = actx.createBiquadFilter(), cg = actx.createGain();
        cs.buffer = noiseBuffer(2); cs.loop = true; cf.type = 'bandpass'; cf.frequency.value = 380; cf.Q.value = 0.7; cg.gain.value = 0;
        cs.connect(cf).connect(cg).connect(actx.destination); cs.start();
        this.crowd = { src: cs, g: cg };
      } catch { this.street = null; }
    },
    // called every frame: the next note of the music, and the street volume
    tick(r, dt) {
      if (this.street) this.street.g.gain.setTargetAtTime(0.004 + r.doorOpen * 0.03, actx.currentTime, 0.1);
      if (this.crowd) {
        const inside = r.people.filter((p) => p.kind !== 'passer' && p.y > L.wall).length;
        this.crowd.g.gain.setTargetAtTime(Math.min(0.014, inside * 0.0012), actx.currentTime, 0.4);
      }
      const m = MUSIC[r.decor.music.id];
      r.beat -= dt;
      if (!m || r.beat > 0 || r.closed || r.intro > 0) return;
      const i = r.note % 8;
      r.beat = m.beat * (m.swing ? (i % 2 ? 0.67 : 1.33) : 1);
      const chord = m.chords[Math.floor(r.note / 8) % m.chords.length];
      tone(chord[m.arp[i]] * 2, m.beat * 0.85, m.wave, m.vol);
      if (i === 0) tone(chord[0] / 2, m.beat * 3.8, m.bass || 'sine', m.bass ? 0.008 : 0.018);
      r.note++;
    },
    stop() {
      for (const k of ['street', 'crowd']) if (this[k]) { try { this[k].src.stop(); } catch { /* ignore */ } this[k] = null; }
    },
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
    // festivals and heatwaves, the weather, your shop's rating, and a coffee corner all change the crowd
    const weather = T.weather(s), up = b.upgrades || {};
    const crowd = T.effectMod(s, b.district, b.good) * T.WEATHER[weather].crowd * T.ratingMod(b) * (up.coffee ? 1.12 : 1);
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
      belt: 0, drawer: 0, doorOpen: 0, cars: [], dpr: 1, beat: 0, note: 0, decor: window.NeonShopArt.decor(),
      // shelf signs: one per shelving unit, hanging under a random spot
      talkers: UNITS.map((u, i) => ({ slot: slots.findIndex((sl) => sl.u === i && sl.row === 0) + (Math.random() < 0.5 ? 0 : u.cols - 1), talk: TALKS[(Math.random() * TALKS.length) | 0] })),
      // what's in the drinks fridge: four shelves of cans and bottles
      fridge: Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => ({ kind: Math.random() < 0.5 ? 'bottle' : 'drinks', v: (Math.random() * 6) | 0 }))),
      skyline: Array.from({ length: 9 }, (_, i) => ({ x: i / 9 + rand(-0.02, 0.02), w: rand(0.08, 0.14), h: rand(0.025, 0.055), lit: Math.random() })),
      weather, up, rain: [], drops: Array.from({ length: 40 }, () => [Math.random(), Math.random(), rand(1, 2.5)]),
      clouds: Array.from({ length: weather === 'cloudy' || weather === 'rain' ? 6 : 3 }, () => ({ x: Math.random(), y: rand(0.055, 0.085), w: rand(0.12, 0.25) })),
      // opening up and closing down
      intro: 2.6, outro: 0, lights: 0, shutter: 1,
      floor: [], till2: false, till2Timer: 0, drag: null, away: 0, cam: null, view: null,
      stats: { waits: [], stolen: 0, caught: 0, helped: 0, extras: 0 },
    };
    // wear and tear builds up over the season: scuffs on the floor, smudges on the windows
    b.wear = b.wear || { scuffs: [], smudges: [] };
    for (let i = 0; i < 2 && b.wear.scuffs.length < 18; i++) b.wear.scuffs.push([rand(0.08, 0.92), rand(L.door + 0.04, L.counter - 0.04), rand(0.15, 0.4)]);
    for (let i = 0, n = 1 + (Math.random() < 0.5); i < n && b.wear.smudges.length < 10; i++) b.wear.smudges.push([Math.random() < 0.5 ? 0 : 1, Math.random(), rand(0.2, 0.9)]);
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
    const r = run, st = r.stats;
    return {
      served: r.served, sold: r.sold, revenue: Math.round(r.revenue), lostPrice: r.lostPrice, lostWait: r.lostWait, lostStock: r.lostStock, entrants: r.spawned,
      weather: r.weather, extras: Math.round(st.extras * 100) / 100, stolen: st.stolen, caught: st.caught, helped: st.helped,
      stars: r.stars, rating: r.b.rating, reviews: r.b.reviews || [],
    };
  }

  // closing time: what today's shoppers thought (sets the stall's star rating)
  function finishDay() {
    const r = run, b = r.b, st = r.stats, mult = b.mult || T.RETAIL;
    const lost = r.lostPrice + r.lostWait + r.lostStock, seen = Math.max(1, r.served + lost);
    const avgWait = st.waits.length ? st.waits.reduce((a, x) => a + x, 0) / st.waits.length : 0;
    let stars = 5 - (r.lostWait / seen) * 4 - (r.lostStock / seen) * 3 - Math.max(0, mult - 1.3) * 3 - (avgWait > 6 ? 0.5 : 0)
      + (st.helped ? 0.3 : 0) + (mult < T.RETAIL ? 0.3 : 0) - (st.stolen ? 0.3 : 0);
    if (!r.served) stars = Math.min(stars, 2.5);
    stars = clamp(Math.round(stars * 2) / 2, 1, 5);
    const good = ['Friendly and quick!', 'Great little shop.', 'Love the vibe in here.', 'Will be back!'];
    const notes = [];
    if (r.lostWait / seen > 0.15 || avgWait > 7) notes.push('The queue took forever.');
    if (r.lostStock) notes.push('The shelves were empty!');
    if (mult > 1.35) notes.push('A bit pricey.');
    if (mult < T.RETAIL) notes.push('Bargain prices!');
    if (st.helped) notes.push('Staff helped me find what I needed.');
    if (st.stolen) notes.push('Saw someone shoplifting…');
    if (r.decor.floor.cost || r.decor.plants.id === 'jungle' || r.decor.sign.cost) notes.push('Lovely decor!');
    if (r.up.coffee) notes.push('The coffee corner is great.');
    while (notes.length < 3) notes.push(pick(good));
    const reviews = notes.slice(0, 3).map((text) => ({ stars: clamp(Math.round((stars + rand(-0.6, 0.6)) * 2) / 2, 1, 5), text }));
    r.stars = stars;
    b.rating = b.rating ? Math.round((b.rating * 0.6 + stars * 0.4) * 10) / 10 : stars;
    b.reviews = reviews;
    b.usual = mult; // regulars expect this price next time
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
      patience: 10 + Math.random() * 8, wait: 0, bubble: null, timer: 0, mood: undefined, bag: false, basket: 0, facing: 'back', extra: 0, spd: 1,
    });
    const lead = run.people[run.people.length - 1];
    // what kind of shopper they are
    let roll = Math.random();
    for (const [type, chance, badge] of TYPES) { if (roll < chance) { lead.type = type; lead.badge = badge; break; } roll -= chance; }
    const usual = run.b.usual || T.RETAIL;
    if (lead.type === 'regular') lead.limit = Math.max(usual, T.RETAIL) * 1.06;            // wants the usual price
    if (lead.type === 'rushed') { lead.patience = rand(5, 8); lead.spd = 1.45; }
    if (lead.type === 'bargain') lead.limit = T.RETAIL * 0.99;                              // only buys on SALE
    if (lead.type === 'tourist') lead.qty = Math.ceil(lead.qty * 2.5);
    // some come as a couple, or a parent with a child, who tag along without buying
    roll = Math.random();
    if (roll < 0.3 && lead.type !== 'thief' && lead.type !== 'rushed') {
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
    const m = Math.min(d, speed * (p.spd || 1) * dt);
    p.x += (dx / d) * m; p.y += (dy / d) * m;
    p.phase += m * 50; p.moving = true; // steps match the distance walked
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
    // now and then a pack slips and lands on the floor, until the clerk picks it up
    if (p.basket > 1 && Math.random() < 0.06) {
      p.basket--;
      run.floor.push({ x: p.x + rand(-0.03, 0.03), y: p.y + 0.012, n: 1, rot: rand(-1.2, 1.2) });
      say(p, '😬 Oops!', 1.2);
    }
  }

  const HELP_Q = ['🙋 Any more in the back?', '🙋 Which one is best?', '🙋 Where are the big packs?', '🙋 Is this one new?'];
  const GREET = {
    regular: '👋 The usual, please!', rushed: '⏱️ In a hurry!', bargain: '🏷️ Any deals today?', tourist: '📸 Wow, Neon City!',
  };

  // ---------- simulation ----------
  function step(dt) {
    const r = run;
    // opening up: the shutters roll up and the lights come on before the first shopper
    const opening = r.intro > 0;
    if (opening) {
      const before = r.intro;
      r.intro -= dt;
      if (before > 2.3 && r.intro <= 2.3) sfx.shutter();
      if (before > 0.3 && r.intro <= 0.3) sfx.click();
    } else r.t += dt;
    r.shutter = opening ? clamp((r.intro - 0.9) / 1.4, 0, 1) : r.ending ? clamp((3.2 - r.outro - 0.8) / 1.2, 0, 1) : 0;
    r.lights = opening ? clamp((0.9 - r.intro) / 0.6, 0, 1) * (r.intro > 0.3 && Math.random() < 0.2 ? 0.4 : 1)
      : r.ending ? clamp(0.35 + ((r.outro - 2.4) / 0.8) * 0.65, 0.35, 1) : 1;
    if (r.ending) {
      const before = r.outro;
      r.outro -= dt;
      if (before > 2.4 && r.outro <= 2.4) sfx.shutter();
      if (r.outro <= 0) r.done = true;
    }
    if (r.cam && (r.cam.t += dt) > r.cam.dur) r.cam = null;
    if (r.alarm > 0) r.alarm -= dt;
    if (!r.drag && r.away > 0) r.away -= dt;
    // weather: rain falling outside, clouds drifting
    if (r.weather === 'rain') {
      for (let i = 0; i < dt * 140; i++) r.rain.push({ x: Math.random() * 1.1, y: FRONT.glass, v: rand(0.5, 0.75) });
      for (const d of r.rain) { d.y += d.v * dt; d.x -= d.v * dt * 0.15; }
      r.rain = r.rain.filter((d) => d.y < FRONT.road1 + 0.03);
    }
    for (const c of r.clouds) { c.x += dt * 0.006; if (c.x > 1.2) c.x = -0.3; }
    const open = !opening && r.t < DAY_SECONDS;
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
          if (walk(p, dt, 0.2)) {
            p.state = 'look'; p.timer = rand(0.7, 1.4); p.facing = 'back';
            if (!p.greeted) {
              p.greeted = true;
              if (GREET[p.type]) say(p, GREET[p.type], 1.6);
              else if (r.weather === 'rain' && Math.random() < 0.3) say(p, '☔ Wet out there!', 1.6);
              else if (r.weather === 'hot' && Math.random() < 0.3) say(p, '🥵 So hot today!', 1.6);
            }
          }
          break;
        case 'help': // hand up, waiting for you to tap them
          p.timer -= dt;
          if (p.timer <= 0) { p.hand = false; p.mood = 'meh'; say(p, '😕 Never mind…', 1.4); p.state = 'look'; p.timer = 0.2; }
          break;
        case 'fridge': // grabbing a cold drink on the way round
          if (walk(p, dt, 0.2)) {
            p.state = 'fridgeGrab'; p.timer = 0.8; p.facing = 'back'; p.extra += 2.5;
            r.effects.push({ kind: 'fly', item: 'bottle', x: (FRIDGE.x0 + FRIDGE.x1) / 2, y: 0.2, to: p, t: 0, dur: 0.4 });
          }
          break;
        case 'fridgeGrab':
          p.timer -= dt;
          if (p.timer <= 0) { p.state = 'enter'; p.path = routeTo(p, unitSpot(UNITS[p.unit])); }
          break;
        case 'look': // read the price tag
          p.timer -= dt;
          if (p.timer > 0) break;
          // some put a hand up to ask you something
          if (!p.asked && p.type !== 'thief' && Math.random() < 0.15) {
            p.asked = true; p.state = 'help'; p.timer = 8; p.hand = true;
            say(p, pick(HELP_Q), 99);
            break;
          }
          // with the fridge upgrade, some grab a cold drink (more on hot days)
          if (r.up.fridge && !p.fridged && Math.random() < (r.weather === 'hot' ? 0.45 : 0.18)) {
            p.fridged = true; p.state = 'fridge'; p.path = routeTo(p, FRIDGE_SPOT);
            break;
          }
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
          if (mult > p.limit) {
            r.lostPrice++;
            leaveShop(p, 'angry', p.type === 'regular' ? '😤 You raised prices!' : p.type === 'bargain' ? '🏷️ No deals today.' : pick(['😒 Too pricey!', '😒 How much?!', '💸 Nope.']));
            break;
          }
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
          if (p.timer <= 0 && p.type === 'thief') { // slips it under their coat and heads for the door
            p.state = 'sneak'; p.hidden = true; say(p, '👀', 1.2); p.exitDir = Math.random() < 0.5 ? -1 : 1;
            p.path = routeTo(p, { x: 0.5, y: L.enter }).concat([[0.5, L.street]]);
          } else if (p.timer <= 0) {
            p.state = 'toQueue'; p.path = [[0.5, p.y]];
            say(p, mult < p.limit * 0.8 ? pick(['😍 Bargain!', '😍 So cheap!']) : pick(['🙂 Nice.', '🙂 Just what I need.']), 1.4); p.mood = 'happy';
          }
          break;
        case 'sneak':
          if (r.up.gates && p.y < L.enter + 0.015) { catchThief(p, true); break; }
          if (walk(p, dt, 0.26)) { // got away with it
            const res = T.shopLoss(r.s, r.b.id, p.basket);
            r.stats.stolen += res.qty || 0; p.basket = 0; p.hidden = false; p.state = 'leaving'; p.path = [];
            say(p, '😈', 1.5);
            r.effects.push({ kind: 'text', text: `🚨 ${res.qty || 0} stolen!`, x: 0.5, y: L.enter + 0.04, t: 0, color: '#ff6b6b' });
          }
          break;
        case 'toQueue':
          if (walk(p, dt, 0.22)) {
            if (r.up.selfcheck && !r.kioskBusy && Math.random() < 0.35) { // uses the self-checkout instead
              r.kioskBusy = p; p.state = 'toKiosk'; p.path = [[KIOSK_SPOT.x, KIOSK_SPOT.y]];
            } else { p.state = 'queue'; p.qAt = r.t; p.wait = 0; }
          }
          break;
        case 'toKiosk':
          if (walk(p, dt, 0.22)) { p.state = 'kiosk'; p.timer = 3; p.serveDur = 3; p.scanned = 0; p.facing = 'back'; }
          break;
        case 'kiosk': {
          p.timer -= dt;
          const scanned = Math.ceil(clamp(1 - p.timer / p.serveDur, 0, 1) * p.basket);
          if (scanned > (p.scanned || 0)) { p.scanned = scanned; sfx.beep(); }
          if (p.timer <= 0) { r.kioskBusy = null; finishSale(p, 'kiosk'); }
          break;
        }
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
    const wantOpen = r.people.some((p) => ((p.kind === 'shopper' && (p.state === 'enter' || p.state === 'leaving' || p.state === 'sneak')) || (p.kind === 'companion' && p.y > L.street + 0.005)) && nearDoor(p)) || nearDoor(r.van && r.van.courier);
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
    // the clerk on the second till
    if (r.till2 && r.clerk.state === 'till' && (r.till2Timer -= dt) <= 0) {
      const p = queue().find(atTill);
      if (p) { startServe(p, 0.8, 'till2'); r.till2Timer = STAFF_SERVE * 1.1; } else r.till2Timer = 0.3;
    }
    if (r.people.some((p) => p.state === 'serving')) r.belt += dt;
    if (r.drawer > 0) r.drawer -= dt;
    for (const sl of r.slots) if (sl.pop > 0) sl.pop = Math.max(0, sl.pop - dt);
    for (const fx of r.effects) { fx.t += dt; if (fx.kind === 'text') fx.y -= dt * 0.08; }
    r.effects = r.effects.filter((fx) => (fx.kind === 'text' ? fx.t < 1.1 : fx.t < fx.dur));
    stepBoxes(dt);
    r.people = r.people.filter((p) => p.x > -0.2 && p.x < 1.2);
    // the day ends at closing time once the shop is empty (or 10 s after closing)
    if (r.t >= DAY_SECONDS && !r.closed) { r.closed = true; for (const p of r.people) if (p.state === 'street') p.kind = 'passer'; }
    const inside = r.people.some((p) => p.kind === 'shopper' && p.state !== 'leaving');
    if (r.closed && !r.ending && (!inside || r.t > DAY_SECONDS + 10)) {
      for (const p of r.people) {
        if (p.kind !== 'shopper' || p.state === 'leaving') continue;
        r.lostWait++;
        if (p.state === 'sneak') { p.hidden = false; p.type = 'caught'; }
        leaveShop(p, 'meh', '🚪 Closing already?'); // their basket goes back to the stock pile
      }
      if (r.kioskBusy) r.kioskBusy = null;
      // closing down: lights dim, shutters come down, the takings are counted
      r.ending = true; r.outro = 3.2;
      finishDay();
    }
  }

  // the stock clerk carries boxes from the pile to the emptiest shelves
  function stepClerk(dt) {
    const r = run, c = r.clerk;
    c.moving = false;
    switch (c.state) {
      case 'idle': {
        // a dropped pack on the floor comes first
        if (r.floor.length) {
          c.target = r.floor[0]; c.state = 'fetch'; c.path = routeTo(c, { x: c.target.x, y: c.target.y - 0.004 });
          break;
        }
        if (!r.pile) {
          // otherwise, wipe a smudged window or mop a scuff now and then
          const w = r.b.wear;
          if (w.smudges.length && Math.random() < dt * 0.08) {
            const sm = pick(w.smudges), [a, b] = FRONT.windows[sm[0]];
            c.target = sm; c.chore = 'wipe'; c.state = 'chore'; c.path = routeTo(c, { x: a + (b - a) * sm[1], y: L.enter });
            break;
          }
          if (w.scuffs.length && Math.random() < dt * 0.06) {
            const sc = pick(w.scuffs);
            c.target = sc; c.chore = 'mop'; c.state = 'chore'; c.path = routeTo(c, { x: sc[0], y: sc[1] });
            break;
          }
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
      case 'fetch':
        if (walk(c, dt, 0.3)) {
          const i = r.floor.indexOf(c.target);
          if (i >= 0) { c.carry += r.floor[i].n; r.floor.splice(i, 1); sfx.pop(); }
          c.state = 'back'; c.path = routeTo(c, { x: PILE.x + 0.08, y: PILE.y - 0.03 });
        }
        break;
      case 'chore':
        if (walk(c, dt, 0.28)) { c.state = 'choring'; c.timer = 1.6; c.facing = c.chore === 'wipe' ? 'back' : 'front'; }
        break;
      case 'choring': // wiping or mopping
        c.timer -= dt; c.phase += dt * 16;
        if (c.timer <= 0) {
          const list = c.chore === 'wipe' ? r.b.wear.smudges : r.b.wear.scuffs, i = list.indexOf(c.target);
          if (i >= 0) list.splice(i, 1);
          c.state = 'back'; c.path = routeTo(c, CLERK_HOME);
        }
        break;
      case 'toTill':
        if (walk(c, dt, 0.32)) c.state = 'till';
        break;
      case 'till':
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
      if (v.x <= VAN_X) { v.x = VAN_X; v.state = 'parked'; sfx.horn(); r.cam = { x: VAN_X - 0.05, y: 0.14, z: 1.1, t: 0, dur: 1.4 }; }
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

  function catchThief(p, byGates) {
    const r = run;
    r.stats.caught++; p.hidden = false; p.type = 'caught';
    leaveShop(p, 'sad', byGates ? '🚨 Beep beep beep!' : '😳 Sorry, sorry!'); // the goods go back to the stock pile
    r.effects.push({ kind: 'text', text: '🚨 Shoplifter caught!', x: clamp(p.x, 0.2, 0.8), y: p.y - 0.1, t: 0, color: '#4ade80' });
    r.alarm = 1.2; sfx.alarm();
  }
  function helpShopper(p) {
    const r = run, tip = Math.round((T.shelfPrice(r.s, r.b) * 0.1 + 1) * 100) / 100;
    p.hand = false; p.qty += 1; p.mood = 'happy'; p.state = 'look'; p.timer = 0.3;
    say(p, '🙏 Thanks for the help!', 1.6);
    T.shopExtra(r.s, r.b.id, tip); r.stats.extras += tip; r.stats.helped++;
    r.effects.push({ kind: 'text', text: `💁 +$${tip.toFixed(2)} tip`, x: p.x, y: p.y - 0.12, t: 0 });
    sfx.ching();
  }
  // send the clerk to open a second till, or back to stocking
  function toggleTill2() {
    const r = run;
    if (!r || r.intro > 0 || r.ending) return false;
    const c = r.clerk;
    if (!r.till2) {
      r.till2 = true; r.till2Timer = 1.2;
      r.pile += c.carry; c.carry = 0; c.tidy = false;
      c.state = 'toTill'; c.path = routeTo(c, { x: 0.72, y: L.counter - 0.02 });
    } else {
      r.till2 = false; c.state = 'idle'; c.x = 0.72; c.y = L.counter - 0.02;
    }
    return r.till2;
  }

  // who: -1 for you, or the helper's index
  function startServe(p, time, who = -1) {
    p.state = 'serving'; p.timer = time; p.serveDur = time; p.servedBy = who; p.scanned = 0;
  }

  function finishSale(p, via) {
    const r = run;
    const res = T.shopSale(r.s, r.b.id, p.basket);
    if (!res.ok) { r.lostStock++; leaveShop(p, 'sad', '📦 Out of stock?!'); return; }
    p.basket = 0;
    const avg = r.served ? r.revenue / r.served : 0;
    r.served++; r.sold += res.qty; r.revenue += res.revenue;
    r.stats.waits.push(p.wait || 0);
    p.bag = true;
    // extras: a cold drink from the fridge, and a coffee from the coffee corner
    if (r.up.coffee && Math.random() < 0.25) { p.extra += 3; r.effects.push({ kind: 'text', text: '☕ +$3', x: p.x + 0.08, y: L.counter - 0.16, t: 0 }); }
    if (p.extra > 0) { T.shopExtra(r.s, r.b.id, p.extra); r.stats.extras += p.extra; }
    // a big sale gets a little zoom on the counter
    if ((r.served > 3 && res.revenue > avg * 2.2) || p.type === 'tourist') r.cam = { x: 0.5, y: 0.8, z: 1.12, t: 0, dur: 1.1 };
    leaveShop(p, 'happy', pick(['😊 Thanks!', '💜 Love this place!', '👋 See you!', '😊 Have a good one!']));
    r.effects.push({ kind: 'receipt', to: p, t: 0, dur: 0.5 });
    r.effects.push({ kind: 'text', text: `+$${Math.round(res.revenue).toLocaleString()}`, x: p.x, y: L.counter - 0.1, t: 0 });
    // how they paid: card, or cash rounded up to a note, with change
    const card = via === 'kiosk' || Math.random() < 0.6, total = res.revenue;
    if (card) sfx.approved(); else { sfx.ching(); sfx.coins(); }
    const note = total < 20 ? 5 : total < 50 ? 10 : 20;
    r.lastSale = { qty: res.qty, price: total / res.qty, total, method: card ? 'card' : 'cash', card: 1000 + ((Math.random() * 9000) | 0), tendered: card ? total : Math.ceil((total + 0.01) / note) * note, t: r.t };
    if (!card && via !== 'kiosk') r.drawer = 0.8;
    try { navigator.vibrate && navigator.vibrate(card ? 12 : [10, 40, 10]); } catch { /* ignore */ }
  }

  // tap: serve whoever is at the front of the queue (you are quick: about half a second)
  function serve() {
    if (!run || run.away > 0 || run.intro > 0) return false;
    const p = queue().find(atTill);
    if (!p) return false;
    startServe(p, 0.55);
    return true;
  }
  function closeEarly() { if (run && run.intro <= 0) run.t = Math.max(run.t, DAY_SECONDS); }

  // ---------- touch: catch a shoplifter, help a shopper, drag a box, or serve ----------
  const toWorld = (x, y) => { const v = run.view; return v ? [(x - v.cx) / v.z + v.cx, (y - v.cy) / v.z + v.cy] : [x, y]; };
  function personAt(wx, wy, W, H, test) {
    const hits = run.people.filter((p) => test(p) && Math.abs(wx - (p.x + (p.ox || 0)) * W) < scaleAt(p.y, H) * 0.6 && wy < p.y * H + 6 && wy > p.y * H - scaleAt(p.y, H) * 2.1);
    return hits.sort((a, b) => b.y - a.y)[0];
  }
  function pointerDown(x, y) {
    const r = run;
    if (!r || r.intro > 0 || r.ending) return 'none';
    const W = r.ui.canvas.clientWidth, H = r.ui.canvas.clientHeight, [wx, wy] = toWorld(x, y);
    const thief = personAt(wx, wy, W, H, (p) => p.state === 'sneak');
    if (thief) { catchThief(thief, false); return 'caught'; }
    const asker = personAt(wx, wy, W, H, (p) => p.state === 'help');
    if (asker) { helpShopper(asker); return 'help'; }
    const s = scaleAt(PILE.y, H);
    if (r.pile > 0 && Math.abs(wx - PILE.x * W) < s * 0.9 && wy < PILE.y * H + 8 && wy > PILE.y * H - s * 1.1) {
      r.drag = { x: wx, y: wy }; r.away = 99; // you leave the till to carry it
      return 'drag';
    }
    return serve() ? 'serve' : 'none';
  }
  function pointerMove(x, y) { if (run && run.drag) { const [wx, wy] = toWorld(x, y); run.drag.x = wx; run.drag.y = wy; } }
  function pointerUp() {
    const r = run;
    if (!r || !r.drag) return 'none';
    const W = r.ui.canvas.clientWidth, H = r.ui.canvas.clientHeight, { x, y } = r.drag;
    r.drag = null; r.away = 0.8; // back to the till in a moment
    const ui = UNITS.findIndex((u) => x >= u.x0 * W && x <= u.x1 * W && y >= (u.top - 0.05) * H && y <= (u.base + 0.04) * H);
    if (ui < 0 || unitRoom(ui) <= 0) return 'none';
    let n = Math.min(r.pile, unitRoom(ui), r.cap * UNITS[ui].cols * 2);
    r.pile -= n;
    while (n > 0) {
      const sl = r.slots.filter((x) => x.u === ui && x.n < r.cap).sort((a, b) => a.n - b.n || a.row - b.row)[0];
      const add = Math.min(n, r.cap - sl.n, Math.max(1, Math.ceil(r.cap / 3)));
      sl.n += add; n -= add; sl.pop = 0.3;
    }
    sfx.pop();
    return 'stocked';
  }
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
    if (!W || !H) return; // not laid out yet
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const G = T.G[r.b.good], art = window.NeonShopArt;
    r.dpr = dpr;

    ctx.fillStyle = '#0d0420'; ctx.fillRect(0, 0, W, H);
    // a camera move: a short zoom on a big sale, or on the van arriving
    r.view = null;
    if (r.cam) {
      const z = 1 + (r.cam.z - 1) * Math.sin(Math.PI * clamp(r.cam.t / r.cam.dur, 0, 1));
      const cx = r.cam.x * W, cy = r.cam.y * H;
      ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-cx, -cy);
      r.view = { cx, cy, z };
    }
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
    drawShutters(ctx, W, H);
    drawSideWalls(ctx, W, H);
    drawLamps(ctx, W, H);

    // inside: shelf islands, the stock pile and people, far to near
    const items = [];
    UNITS.forEach((u, i) => { if (!u.wall) items.push({ y: u.base, draw: () => drawUnit(ctx, u, i, W, H, G) }); });
    items.push({ y: PILE.y, draw: () => drawPile(ctx, W, H, G) });
    const plants = r.decor.plants.id;
    for (const [kind, x, y] of PROPS.concat(plants === 'jungle' ? JUNGLE : [])) {
      if (kind === 'plant' && plants === 'none') continue;
      items.push({ y, draw: () => drawProp(ctx, kind, x, y, W, H) });
    }
    // shop upgrades you can see
    if (r.up.selfcheck) items.push({ y: KIOSK.y, draw: () => drawKiosk(ctx, W, H) });
    if (r.up.coffee) { items.push({ y: COFFEE.y, draw: () => drawCoffee(ctx, W, H) }); items.push({ y: TABLE.y, draw: () => drawTable(ctx, W, H) }); }
    if (r.up.gates) for (const gx of [FRONT.door[0] + 0.01, FRONT.door[1] - 0.01]) items.push({ y: L.door + 0.02, draw: () => drawGate(ctx, gx, W, H) });
    // packs dropped on the floor
    for (const f of r.floor) items.push({ y: f.y, draw: () => { ctx.save(); ctx.translate(f.x * W, f.y * H); ctx.rotate(f.rot); art.pack(ctx, r.b.good, 0, 2, scaleAt(f.y, H) * 0.3, 0, dpr); ctx.restore(); } });
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
      art.pack(ctx, fx.item || r.b.good, fx.x * W + (x1 - fx.x * W) * k, fx.y * H + (y1 - fx.y * H) * k - Math.sin(k * Math.PI) * 18, H * 0.024, 0, dpr);
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
    // the box you're carrying from the pile, and where it will go
    if (r.drag) {
      const ui = UNITS.findIndex((u) => r.drag.x >= u.x0 * W && r.drag.x <= u.x1 * W && r.drag.y >= (u.top - 0.05) * H && r.drag.y <= (u.base + 0.04) * H);
      if (ui >= 0) {
        const u = UNITS[ui];
        ctx.strokeStyle = unitRoom(ui) > 0 ? '#4ade80' : '#ff6b6b'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
        ctx.strokeRect(u.x0 * W - 3, u.top * H - 3, (u.x1 - u.x0) * W + 6, (u.base - u.top) * H + 6); ctx.setLineDash([]);
      }
      drawBox(ctx, r.drag.x, r.drag.y + 10, H * 0.05, G);
    }
    // floating messages: takings, tips, alarms
    ctx.font = `900 ${Math.round(H * 0.028)}px system-ui, sans-serif`;
    for (const fx of r.effects) {
      if (fx.kind !== 'text') continue;
      ctx.globalAlpha = Math.max(0, 1 - fx.t);
      ctx.fillStyle = fx.color || '#ffd23f';
      ctx.fillText(fx.text, fx.x * W, fx.y * H);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // lights off before opening and after closing
    if (r.lights < 1) { ctx.fillStyle = `rgba(5,2,15,${(1 - r.lights) * 0.6})`; ctx.fillRect(0, 0, W, H); }
    // counting the day's takings at closing
    if (r.ending && r.outro < 1.3) {
      const k = clamp(1 - (r.outro - 0.2) / 1.0, 0, 1), cy = H * 0.45;
      ctx.fillStyle = 'rgba(11,2,33,.88)'; roundRect(ctx, W * 0.15, cy - H * 0.08, W * 0.7, H * 0.16, 16); ctx.fill();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(H * 0.024)}px system-ui, sans-serif`;
      ctx.fillText('🌙 Counting the takings…', W / 2, cy - H * 0.025);
      ctx.fillStyle = '#ffd23f'; ctx.font = `900 ${Math.round(H * 0.045)}px system-ui, sans-serif`;
      ctx.fillText(`💰 $${Math.round(r.revenue * k + r.stats.extras * k).toLocaleString()}`, W / 2, cy + H * 0.045);
    } else if (r.intro > 0) {
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `800 ${Math.round(H * 0.024)}px system-ui, sans-serif`;
      ctx.fillText(r.intro > 0.9 ? '🔑 Opening up…' : '💡 Lights on!', W / 2, H * 0.45);
    }
    ctx.textAlign = 'start';
  }

  // the shop front: brick piers, two display windows and a pair of sliding glass doors
  const FRONT = {
    glass: 0.05, transom: 0.072, road0: 0.118, road1: 0.146, sill: 0.17,
    windows: [[BX(0.02), BX(0.39)], [BX(0.61), BX(0.98)]], door: [BX(0.42), BX(0.58)],
    piers: [[BX(0), BX(0.02)], [BX(0.39), BX(0.42)], [BX(0.58), BX(0.61)], [BX(0.98), BX(1)]],
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
  const rgbHex = (c) => (c[0] === '#' ? c : '#' + c.match(/\d+/g).map((v) => (+v).toString(16).padStart(2, '0')).join(''));
  const nightAt = (k) => clamp((k - 0.62) / 0.26, 0, 1);

  function drawStreet(ctx, W, H) {
    const r = run, F = FRONT, k = dayK(), night = nightAt(k);
    // sky and the buildings across the road
    let [top, bot] = skyAt(k);
    const grey = r.weather === 'rain' ? 0.55 : r.weather === 'cloudy' ? 0.3 : 0;
    if (grey) { top = mix(rgbHex(top), '#5b6070', grey); bot = mix(rgbHex(bot), '#7a7f8c', grey); }
    let g = ctx.createLinearGradient(0, F.glass * H, 0, F.road0 * H);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, F.glass * H, W, (F.road0 - F.glass) * H + 1);
    // clouds drifting by
    for (const c of r.clouds) {
      ctx.fillStyle = r.weather === 'rain' ? 'rgba(90,95,110,.7)' : `rgba(255,255,255,${0.5 - night * 0.35})`;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse((c.x + c.w * (i - 1) * 0.3) * W, c.y * H, c.w * W * 0.3, H * 0.012, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const b of r.skyline) {
      const x = b.x * W, w = b.w * W, bt = (F.road0 - b.h) * H, bb = F.road0 * H;
      ctx.fillStyle = mix('#5d6f8f', '#1c0a3a', night); ctx.fillRect(x, bt, w, bb - bt);
      ctx.fillStyle = night > 0.3 ? (b.lit > 0.5 ? `rgba(255,210,63,${0.6 * night})` : `rgba(5,217,232,${0.5 * night})`) : `rgba(200,230,255,${0.35 * (1 - night)})`;
      for (let wy = bt + 4; wy < bb - 4; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 6) if (((wx * 7 + wy * 3) | 0) % 5 < 2) ctx.fillRect(wx, wy, 2, 3);
    }
    // road with lane markings and passing cars
    ctx.fillStyle = mix('#4a4a55', '#1a1424', night); ctx.fillRect(0, F.road0 * H, W, (F.road1 - F.road0) * H);
    if (r.weather === 'rain') { // a wet road shines
      ctx.fillStyle = 'rgba(200,220,255,.12)';
      for (let i = 0; i < 6; i++) ctx.fillRect(((i * 0.19 + 0.05) % 1) * W, (F.road0 + 0.01 + (i % 3) * 0.007) * H, W * 0.08, 1.5);
    }
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
    if (r.weather === 'rain') {
      ctx.strokeStyle = 'rgba(200,220,255,.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); for (const d of r.rain) { ctx.moveTo(d.x * W, d.y * H); ctx.lineTo(d.x * W + 2, d.y * H - 7); } ctx.stroke();
    }
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
    // greasy smudges build up on the glass until the clerk wipes them
    for (const [wi, u, v] of r.b.wear.smudges) {
      const [a, b] = F.windows[wi], sx = (a + (b - a) * u) * W, sy = gy0 + (gy1 - gy0) * v;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.018);
      sg.addColorStop(0, 'rgba(230,230,240,.22)'); sg.addColorStop(1, 'rgba(230,230,240,0)');
      ctx.fillStyle = sg; ctx.fillRect(sx - H * 0.018, sy - H * 0.018, H * 0.036, H * 0.036);
    }
    if (r.weather === 'rain') { // drops running down the windows
      ctx.fillStyle = 'rgba(220,235,255,.5)';
      for (const [u, v, d] of r.drops) {
        const wi = u < 0.5 ? 0 : 1, [a, b] = F.windows[wi], sx = (a + (b - a) * ((u * 2) % 1)) * W, sy = gy0 + (gy1 - gy0) * ((v + r.t * 0.04 * d) % 1);
        ctx.fillRect(sx, sy, 1.2, d * 2.2);
      }
    }
    // window stickers: OPEN sign hanging in the left window, a poster in the right one
    {
      const cx = W * BX(0.115), cy = (F.transom + 0.026) * H, sw = W * 0.13, sh = H * 0.026;
      ctx.strokeStyle = 'rgba(200,200,220,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - sw * 0.3, F.transom * H); ctx.lineTo(cx - sw * 0.3, cy - sh / 2); ctx.moveTo(cx + sw * 0.3, F.transom * H); ctx.lineTo(cx + sw * 0.3, cy - sh / 2); ctx.stroke();
      ctx.fillStyle = 'rgba(10,2,25,.85)'; roundRect(ctx, cx - sw / 2, cy - sh / 2, sw, sh, sh / 2); ctx.fill();
      const on = !r.closed && r.intro <= 0.3;
      ctx.strokeStyle = on ? '#ff2a6d' : '#5a2a3a'; ctx.lineWidth = 2; ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = on ? 3 + 10 * night : 0; ctx.stroke();
      ctx.font = `900 ${Math.round(sh * 0.7)}px system-ui, sans-serif`; ctx.fillStyle = on ? '#ff5c8a' : '#7a4a5a';
      ctx.fillText(on ? 'OPEN' : 'CLOSED', cx, cy + sh * 0.26);
      ctx.shadowBlur = 0;
      // a poster: FRESH! normally, a red SALE poster when you've cut your price
      const px = W * BX(0.3), py = (F.transom + 0.008) * H, pw = W * 0.11, ph = H * 0.06, sale = onSale();
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
    { const want = W * 0.6, have = ctx.measureText(`${G.icon} ${G.name.toUpperCase()} · ${T.STALLS[r.b.tier].name.toUpperCase()}`).width; if (have > want) ctx.font = `900 ${Math.round(Math.min(H * 0.026, W * 0.045) * want / have)}px system-ui, sans-serif`; }
    const sg = r.decor.sign, label = `${G.icon} ${G.name.toUpperCase()} · ${T.STALLS[r.b.tier].name.toUpperCase()}`;
    if (sg.rainbow) {
      const tw = ctx.measureText(label).width, rg = ctx.createLinearGradient(W / 2 - tw / 2, 0, W / 2 + tw / 2, 0);
      ['#ff2a6d', '#ffd23f', '#4ade80', '#05d9e8', '#9b5de5'].forEach((c, i) => rg.addColorStop((i / 4 + r.t * 0.1) % 1, c));
      ctx.fillStyle = rg;
    } else ctx.fillStyle = sg.color;
    ctx.shadowColor = sg.glow; ctx.shadowBlur = (4 + 8 * night) * r.lights;
    ctx.fillText(label, W / 2, L.sign * H * 0.68);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff2a6d'; ctx.fillRect(0, gy0 - 3, W, 2);
    // a wall clock showing the time, and a security camera in the corner
    art.clock(ctx, W * BX(0.93), gy0 * 0.5, gy0 * 0.36, OPEN_H + dayK() * (CLOSE_H - OPEN_H));
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
    art.camera(ctx, W * BX(0.05), gy0 - 2, H * 0.03, r.t);
    ctx.font = `${Math.round(gy0 * 0.55)}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
    ctx.fillText(T.WEATHER[r.weather].icon, W * BX(0.07), gy0 * 0.72); // today's weather, at the far end of the sign board
  }
  // roller shutters: down before opening and after closing
  function drawShutters(ctx, W, H) {
    const r = run, F = FRONT;
    if (r.shutter <= 0) return;
    for (const [a, b, y1] of [[F.windows[0][0], F.windows[0][1], F.sill], [F.windows[1][0], F.windows[1][1], F.sill], [F.door[0], F.door[1], L.door]]) {
      const x0 = a * W, x1 = b * W, y0 = F.glass * H, h = (y1 * H - y0) * r.shutter;
      ctx.fillStyle = '#8a8fa0'; ctx.fillRect(x0, y0, x1 - x0, h);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let y = y0 + 3; y < y0 + h; y += 4) ctx.fillRect(x0, y, x1 - x0, 1);
      ctx.fillStyle = '#5a5f70'; ctx.fillRect(x0, y0 + h - 3, x1 - x0, 3);
    }
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
    const fl = run.decor.floor;
    let y = L.door, row = 0;
    while (y < L.counter) {
      const y2 = Math.min(L.counter, y + 0.014 + 0.05 * depthK(y));
      const w1 = scaleAt(y, H) * 0.9, w2 = scaleAt(y2, H) * 0.9;
      const n = Math.ceil(W / 2 / w1) + 2;
      for (let j = -n; j < n; j++) {
        ctx.fillStyle = (fl.planks ? row % 2 : (j + row) % 2) ? fl.a : fl.b;
        ctx.beginPath();
        ctx.moveTo(W / 2 + j * w1, y * H); ctx.lineTo(W / 2 + (j + 1) * w1, y * H);
        ctx.lineTo(W / 2 + (j + 1) * w2, y2 * H); ctx.lineTo(W / 2 + j * w2, y2 * H);
        ctx.closePath(); ctx.fill();
        if (fl.line || fl.planks) { ctx.strokeStyle = fl.line ? 'rgba(5,217,232,.35)' : 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; if (!fl.planks || (j + row) % 3 === 0) ctx.stroke(); }
        if (fl.vein && (j * 7 + row * 3) % 5 === 0) { ctx.strokeStyle = 'rgba(120,110,150,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2 + j * w1 + w1 * 0.2, y * H); ctx.lineTo(W / 2 + (j + 1) * w2 - w2 * 0.3, y2 * H); ctx.stroke(); }
      }
      y = y2; row++;
    }
    // a glossy sheen, and scuffs that build up over the season
    const sheen = ctx.createLinearGradient(0, L.door * H, 0, L.counter * H);
    sheen.addColorStop(0, 'rgba(255,255,255,.05)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(255,255,255,.04)');
    ctx.fillStyle = sheen; ctx.fillRect(0, L.door * H, W, (L.counter - L.door) * H);
    for (const [sx, sy, sr] of run.b.wear.scuffs) {
      ctx.fillStyle = fl.id === 'marble' ? 'rgba(60,50,70,.22)' : 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.ellipse(sx * W, sy * H, scaleAt(sy, H) * sr, scaleAt(sy, H) * sr * 0.3, 0.3, 0, Math.PI * 2); ctx.fill();
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

  // ---------- shop upgrades on the floor ----------
  function drawKiosk(ctx, W, H) {
    const r = run, x = KIOSK.x * W, y = KIOSK.y * H, s = scaleAt(KIOSK.y, H);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.3, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2a35'; ctx.fillRect(x - s * 0.06, y - s * 0.9, s * 0.12, s * 0.9);
    ctx.fillStyle = '#3a3a48'; roundRect(ctx, x - s * 0.28, y - s * 0.95, s * 0.56, s * 0.18, 4); ctx.fill();
    ctx.fillStyle = '#1b1b26'; roundRect(ctx, x - s * 0.24, y - s * 1.5, s * 0.48, s * 0.55, 5); ctx.fill();
    const busy = r.kioskBusy && r.kioskBusy.state === 'kiosk';
    ctx.fillStyle = busy ? '#05d9e8' : '#0f3a46'; ctx.fillRect(x - s * 0.2, y - s * 1.45, s * 0.4, s * 0.42);
    ctx.fillStyle = busy ? '#062a33' : '#7fe9ff'; ctx.font = `800 ${Math.max(6, Math.round(s * 0.09))}px system-ui, sans-serif`;
    ctx.fillText(busy ? 'SCANNING' : 'SELF', x, y - s * 1.27); if (!busy) ctx.fillText('CHECKOUT', x, y - s * 1.16);
    if (busy && Math.sin(r.t * 40) > 0) { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(x - s * 0.2, y - s * 0.88, s * 0.4, 2); }
  }
  function drawCoffee(ctx, W, H) {
    const r = run, x = COFFEE.x * W, y = COFFEE.y * H, s = scaleAt(COFFEE.y, H);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.45, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6b4423'; ctx.fillRect(x - s * 0.42, y - s * 0.62, s * 0.84, s * 0.62);
    ctx.fillStyle = '#8a5a30'; ctx.fillRect(x - s * 0.46, y - s * 0.66, s * 0.92, s * 0.06);
    // espresso machine with steam
    ctx.fillStyle = '#c9cdd8'; roundRect(ctx, x - s * 0.3, y - s * 1.05, s * 0.36, s * 0.4, 4); ctx.fill();
    ctx.fillStyle = '#2a2a35'; ctx.fillRect(x - s * 0.24, y - s * 0.8, s * 0.24, s * 0.06);
    for (let i = 0; i < 3; i++) {
      const k = (r.t * 0.6 + i / 3) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(x - s * 0.12 + Math.sin(k * 6 + i) * 3, y - s * 1.08 - k * s * 0.4, 2 + k * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fff'; for (let i = 0; i < 3; i++) ctx.fillRect(x + s * 0.12 + i * s * 0.09, y - s * 0.76, s * 0.06, s * 0.09);
    ctx.fillStyle = '#ffd23f'; ctx.font = `800 ${Math.max(6, Math.round(s * 0.11))}px system-ui, sans-serif`; ctx.fillText('☕ COFFEE', x, y - s * 0.3);
  }
  function drawTable(ctx, W, H) {
    const x = TABLE.x * W, y = TABLE.y * H, s = scaleAt(TABLE.y, H);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.3, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2a35'; ctx.fillRect(x - 1.5, y - s * 0.55, 3, s * 0.55); ctx.fillRect(x - s * 0.12, y - 2, s * 0.24, 2);
    ctx.fillStyle = '#e8e8f2'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.56, s * 0.24, s * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(x - s * 0.04, y - s * 0.66, s * 0.07, s * 0.08);
  }
  function drawGate(ctx, gx, W, H) {
    const r = run, x = gx * W, y = (L.door + 0.02) * H, s = scaleAt(L.door + 0.02, H);
    const on = r.alarm > 0 && Math.sin(r.t * 30) > 0;
    ctx.fillStyle = 'rgba(230,240,255,.35)'; roundRect(ctx, x - s * 0.08, y - s * 1.3, s * 0.16, s * 1.3, 4); ctx.fill();
    ctx.strokeStyle = on ? '#ff3b3b' : '#05d9e8'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = on ? '#ff3b3b' : '#05d9e8'; ctx.fillRect(x - s * 0.05, y - s * 1.25, s * 0.1, 3);
  }

  // the side walls, running from the front wall's corners toward us
  function drawSideWalls(ctx, W, H) {
    const r = run, dec = r.decor.walls, vy = VP_Y * H;
    for (const side of [-1, 1]) {
      const cx = BX(side < 0 ? 0 : 1) * W, xe = side < 0 ? 0 : W;
      const k = (xe - W / 2) / (cx - W / 2);               // how far past the corner the screen edge is
      const floorY = vy + (L.door * H - vy) * k;            // where the wall meets the floor at the edge
      const g = ctx.createLinearGradient(cx, 0, xe, 0);
      g.addColorStop(0, dec.wall); g.addColorStop(1, mix(dec.wall, '#000000', 0.35));
      ctx.fillStyle = g; poly(ctx, [[cx, 0], [cx, L.door * H], [xe, floorY], [xe, 0]]); ctx.fill();
      // skirting board along the floor
      ctx.strokeStyle = dec.trim; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, L.door * H); ctx.lineTo(xe, floorY); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, L.door * H); ctx.stroke();
      // a point on this wall: u from the corner (0) to the screen edge (1), h height above the floor (0..1 of the front wall)
      const P = (u, h) => { const kk = 1 + (k - 1) * u, x = W / 2 + (cx - W / 2) * kk, fy = vy + (L.door * H - vy) * kk, ty = vy + (0 - vy) * kk; return [x, fy + (ty - fy) * h]; };
      if (side < 0) {
        // a framed poster and a wall light
        ctx.fillStyle = '#0b0221'; poly(ctx, [P(0.25, 0.75), P(0.7, 0.75), P(0.7, 0.42), P(0.25, 0.42)]); ctx.fill();
        const pg = ctx.createLinearGradient(...P(0.3, 0.7), ...P(0.65, 0.47));
        pg.addColorStop(0, '#ff2a6d'); pg.addColorStop(1, '#05d9e8');
        ctx.fillStyle = pg; poly(ctx, [P(0.3, 0.7), P(0.65, 0.7), P(0.65, 0.47), P(0.3, 0.47)]); ctx.fill();
        const [lx, ly] = P(0.5, 0.88);
        const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.06);
        lg.addColorStop(0, 'rgba(255,230,170,.35)'); lg.addColorStop(1, 'rgba(255,230,170,0)');
        ctx.fillStyle = lg; ctx.fillRect(lx - W * 0.06, ly - W * 0.06, W * 0.12, W * 0.12);
        ctx.fillStyle = '#fff2c4'; ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2); ctx.fill();
      } else {
        // a fire extinguisher and an exit sign
        const [ex, ey] = P(0.45, 0.06), eh = H * 0.045;
        ctx.fillStyle = '#d61e1e'; roundRect(ctx, ex - 4, ey - eh, 8, eh, 3); ctx.fill();
        ctx.fillStyle = '#222'; ctx.fillRect(ex - 2, ey - eh - 4, 4, 4); ctx.fillRect(ex + 2, ey - eh - 3, 5, 2);
        ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(ex - 3, ey - eh + 3, 2, eh - 6);
        const [sx, sy] = P(0.35, 0.86);
        ctx.fillStyle = '#16a34a'; ctx.fillRect(sx - 12, sy - 6, 24, 10);
        ctx.fillStyle = '#fff'; ctx.font = '800 7px system-ui, sans-serif'; ctx.fillText('EXIT', sx, sy + 2);
      }
    }
  }

  // hanging lamps, each casting a soft cone of light down to the floor
  function drawLamps(ctx, W, H) {
    const night = nightAt(dayK()), s = W * 0.075;
    for (const [lx, ly, fy] of LAMPS) {
      const x = lx * W, y = ly * H;
      const g = ctx.createLinearGradient(0, y, 0, fy * H);
      g.addColorStop(0, `rgba(255,230,170,${(0.1 + 0.08 * night) * run.lights})`); g.addColorStop(1, 'rgba(255,230,170,0)');
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
    { // a faint reflection in the floor
      const rg = ctx.createLinearGradient(0, base, 0, base + H * 0.035);
      rg.addColorStop(0, 'rgba(120,70,220,.22)'); rg.addColorStop(1, 'rgba(120,70,220,0)');
      ctx.fillStyle = rg; ctx.fillRect(x0, base, x1 - x0, H * 0.035);
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

  const SKIN = (window.NeonLooks && NeonLooks.SKINS) || ['#f3cfb3', '#e0a986', '#c08058', '#8d5a3b', '#5a3825'];
  function drawPerson(ctx, p, W, H, G) {
    const r = run, art = window.NeonShopArt;
    const px = (p.x + (p.ox || 0)) * W, py = p.y * H, s = scaleAt(p.y, H) * (p.child ? 0.66 : 1);
    // a soft shadow on the ground
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(px, py, s * 0.3, s * 0.075, 0, 0, Math.PI * 2); ctx.fill();
    const onStreet = p.kind === 'passer' || p.state === 'street' || (p.kind === 'companion' && p.leader.state === 'street');
    const front = !onStreet && p.facing === 'front';
    if (p.kind === 'clerk' && (p.state === 'till' || p.state === 'toTill' && p.y > L.counter - 0.04)) return; // behind the counter now
    const stride = p.kind === 'passer' || p.moving || (p.kind === 'shopper' && p.state === 'street') ? 0.35 : 0;
    // a child holds their parent's hand
    if (p.child && p.leader && Math.abs(p.leader.y - p.y) < 0.03) {
      const l = p.leader, lx = (l.x + (l.ox || 0)) * W, ls = scaleAt(l.y, H);
      if (Math.abs(lx - px) < ls * 1.2) {
        ctx.strokeStyle = SKIN[p.look.skin] || '#c68642'; ctx.lineWidth = Math.max(2, s * 0.08);
        ctx.beginPath(); ctx.moveTo(px + Math.sign(lx - px) * s * 0.22, py - s * 0.95); ctx.lineTo(lx - Math.sign(lx - px) * ls * 0.26, l.y * H - ls * 0.82); ctx.stroke();
      }
    }
    NeonLooks.drawRunner(ctx, px, py, s, { front, phase: p.phase, stride, mood: p.mood }, NeonLooks.byId(NeonLooks.OUTFITS, p.look.outfit), r.t, p.look);
    // an umbrella when it's raining outside
    if (r.weather === 'rain' && p.y < L.wall + 0.005 && p.kind !== 'courier') {
      const ux = px + s * 0.1, uy = py - s * 2.05;
      ctx.strokeStyle = '#2a2a35'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(ux, uy + s * 0.9); ctx.stroke();
      ctx.fillStyle = CAR_COLORS[(p.look.skin + p.look.hairColor) % CAR_COLORS.length];
      ctx.beginPath(); ctx.moveTo(ux - s * 0.55, uy + s * 0.08); ctx.quadraticCurveTo(ux, uy - s * 0.5, ux + s * 0.55, uy + s * 0.08); ctx.closePath(); ctx.fill();
    }
    // a hand up to ask for help
    if (p.hand) {
      const hx = px + s * 0.28, hy = py - s * 1.95 + Math.sin(r.t * 8) * 2;
      ctx.strokeStyle = SKIN[p.look.skin] || '#c68642'; ctx.lineWidth = Math.max(2.5, s * 0.1);
      ctx.beginPath(); ctx.moveTo(px + s * 0.18, py - s * 1.35); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = SKIN[p.look.skin] || '#c68642'; ctx.beginPath(); ctx.arc(hx, hy, Math.max(2.5, s * 0.08), 0, Math.PI * 2); ctx.fill();
    }
    // what kind of shopper (a small badge) when they're inside
    if (p.badge && p.y > L.wall && p.state !== 'leaving' && !(p.bubble && p.bubbleT > 0)) {
      ctx.font = `${Math.round(Math.max(10, s * 0.24))}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
      ctx.fillText(p.badge, px + s * 0.3, py - s * 1.85);
    }
    // the clerk's cloth or mop while cleaning
    if (p.kind === 'clerk' && p.state === 'choring') {
      if (p.chore === 'wipe') {
        const wx = px + Math.sin(p.phase) * s * 0.25, wy = py - s * 1.6 + Math.cos(p.phase) * s * 0.1;
        ctx.fillStyle = '#05d9e8'; ctx.fillRect(wx - 3, wy - 3, 6, 6);
      } else {
        const mx = px + s * 0.25 + Math.sin(p.phase) * s * 0.2;
        ctx.strokeStyle = '#a87a40'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px + s * 0.2, py - s * 1.2); ctx.lineTo(mx, py - 2); ctx.stroke();
        ctx.fillStyle = '#e8e8f2'; ctx.fillRect(mx - s * 0.12, py - 4, s * 0.24, 4);
        ctx.fillStyle = 'rgba(150,200,255,.25)'; ctx.beginPath(); ctx.ellipse(px + s * 0.2, py, s * 0.4, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // the clerk wears the staff apron
    if (p.kind === 'clerk') {
      ctx.fillStyle = r.decor.uniform.color; roundRect(ctx, px - s * 0.18, py - s * 1.26, s * 0.36, s * 0.52, s * 0.06); ctx.fill();
      if (front) { ctx.fillStyle = '#0b0221'; ctx.font = `800 ${Math.round(Math.max(6, s * 0.09))}px system-ui, sans-serif`; ctx.fillText('STAFF', px, py - s * 1.08); }
    }
    // a box in their arms (clerk and courier)
    if ((p.kind === 'clerk' && p.carry > 0) || (p.kind === 'courier' && p.box > 0)) drawBox(ctx, px, py - s * 0.62, s * 0.55, G);
    // a pack held up to read the label
    if (p.hold) art.pack(ctx, r.b.good, px + s * 0.3, py - s * 1.15, s * 0.32, 0, r.dpr);
    // shopping basket, held at the side (a shoplifter has hidden theirs)
    if (p.basket > 0 && !p.hidden) {
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
    const pose = (who) => (busy(who) ? { phase: r.t * 14 + (typeof who === 'number' ? who : 3), stride: 0.3 } : { phase: 0, stride: 0 });
    r.staffLooks.forEach((lk, i) => NeonLooks.drawRunner(ctx, W * staffXs[i], H + sellerS * 0.55, sellerS * 0.85, pose(i), NeonLooks.byId(NeonLooks.OUTFITS, lk.outfit), r.t, lk));
    if (r.till2 && r.clerk.state === 'till') {
      const cx = W * 0.7, c = r.clerk;
      NeonLooks.drawRunner(ctx, cx, H + sellerS * 0.55, sellerS * 0.85, pose('till2'), NeonLooks.byId(NeonLooks.OUTFITS, c.look.outfit), r.t, c.look);
      ctx.fillStyle = '#16a34a'; roundRect(ctx, cx - 22, near - H * 0.03, 44, 13, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 9px system-ui, sans-serif'; ctx.fillText('TILL 2', cx, near - H * 0.03 + 10);
    }
    if (r.away > 0) { // you've stepped away from the till
      ctx.fillStyle = '#ffd23f'; roundRect(ctx, W * 0.5 - 34, near - H * 0.035, 68, 16, 4); ctx.fill();
      ctx.fillStyle = '#0b0221'; ctx.font = '800 10px system-ui, sans-serif'; ctx.fillText('BACK IN A SEC', W * 0.5, near - H * 0.035 + 12);
    } else NeonLooks.drawRunner(ctx, W * 0.5, H + sellerS * 0.5, sellerS, pose(-1), NeonLooks.byId(NeonLooks.OUTFITS, r.sellerLook.outfit), r.t, r.sellerLook);
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
    const floor = run.floor.reduce((a, f) => a + f.n, 0);
    return { shelves: shelfTotal(), pile: run.pile, incoming: run.incoming, clerk: run.clerk.carry, baskets: baskets + floor, total: run.b.stock };
  };

  return { open, serve, refill, setPrice, closeEarly, clock, frontWaiting, stockInfo, pointerDown, pointerMove, pointerUp, toggleTill2, active: () => !!run, current: () => run };
})();
