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
  const STAFF_SERVE = 4;           // seconds a helper takes per shopper (a fast cashier: 3)
  const CUSTOMERS = [26, 40, 55];  // shoppers who walk in on a normal day, by tier

  // layout, as fractions of the canvas
  const L = { sign: 0.045, street: 0.16, wall: 0.17, door: 0.27, enter: 0.31, counter: 0.79 };
  const ROWS = 3;
  // the front wall is a little narrower than the screen, so the side walls show
  const BX = (x) => 0.5 + (x - 0.5) * 0.86;
  // two shelf walls either side of the door, and two shelf islands in the middle of the floor
  const UNITS0 = [
    { x0: BX(0.02), x1: BX(0.39), top: L.wall + 0.006, base: L.door, cols: 5, wall: true },
    { x0: BX(0.61), x1: BX(0.79), top: L.wall + 0.006, base: L.door, cols: 3, wall: true },
    { x0: 0.05, x1: 0.37, top: 0.42, base: 0.53, cols: 4 },
    { x0: 0.63, x1: 0.95, top: 0.42, base: 0.53, cols: 4 },
  ];
  let UNITS = UNITS0; // the islands can be moved: see applyLayout
  // a megastore knocks through the right-hand wall into an annex, with stairs up to Level 2.
  // They're laid out in metres (X across, Z back from the front wall); Level 2 is kept 20 m off to the side
  // in the shop's own coordinates (LEVEL2_DX), and the 3D view lifts it up above the annex.
  const LEVEL2_DX = 20, LEVEL2_Y = 3.0;
  const ANNEX = { X0: 4.5, X1: 9, Z0: 1, Z1: 9.5, arch: [6.6, 8.4], l2: [1, 3.8], stair: { X: 8.6, Z0: 6.6, Z1: 3.8 } };
  const MUNITS = [
    { zone: 'annex', m: { X0: 5.2, X1: 8.0, Z: 5.6, wall: false }, cols: 4, tier: 2 },
    { zone: 'up', m: { X0: 5.0, X1: 8.0, Z: 1.5, wall: true, stand: 2.3 }, cols: 4, tier: 2 },
  ];
  const PILE = { x: 0.2069, y: 0.6405 };  // the stockroom bays: where you stand to grab a box (bays at X -2.25 to -0.95 m, Z 8.15 m)
  const CLERK_HOME = { x: 0.27, y: 0.68 };
  // shop upgrades on the floor
  const KIOSK = { x: 0.955, y: 0.77 }, KIOSK_SPOT = { x: 0.89, y: 0.75 };
  const COFFEE = { x: 0.075, y: 0.785 }, TABLE = { x: 0.19, y: 0.79 };
  const SIDE = { x: 0.64, y: 0.705 };   // the side counter by the till (a second product)
  const FRIDGE_SPOT = { x: 0.82, y: 0.31 };
  // kinds of shopper: [type, chance, badge]
  const TYPES = [['thief', 0.06, ''], ['returner', 0.04, '🔁'], ['influencer', 0.03, '📱'], ['regular', 0.0, '⭐'], ['rushed', 0.13, '⏱️'], ['bargain', 0.1, '🏷️'], ['tourist', 0.08, '📸']];
  // who shops here: each group has its own budget, patience and pace, and comes at its own time of day
  // (peak: [middle of their busy time, how wide], as a share of the day; more students and families at the weekend)
  const GROUPS = {
    worker: { icon: '💼', name: 'Office worker', limit: 1.06, patience: 0.72, spd: 1.15, qty: 1, peak: [0.12, 0.14], weekend: 0.35, wear: 'briefcase' },
    student: { icon: '🎒', name: 'Student', limit: 0.88, patience: 1.1, spd: 1.05, qty: 0.8, peak: [0.68, 0.12], weekend: 1.6, wear: 'backpack' },
    family: { icon: '👨‍👩‍👧', name: 'Family', limit: 1, patience: 0.9, spd: 0.9, qty: 1.7, peak: [0.5, 0.16], weekend: 2.2 },
    senior: { icon: '🧓', name: 'Senior', limit: 1.03, patience: 1.5, spd: 0.72, qty: 0.9, peak: [0.25, 0.18], weekend: 1, wear: 'cane' },
  };
  const weekend = (s) => s.day % 7 === 6 || s.day % 7 === 0;
  function pickGroup(k) {
    const w = Object.entries(GROUPS).map(([id, g]) => [id, (0.6 + 1.6 * bump(k, g.peak[0], g.peak[1])) * (weekend(run.s) ? g.weekend : 1)]);
    let x = Math.random() * w.reduce((a, [, v]) => a + v, 0);
    for (const [id, v] of w) { x -= v; if (x <= 0) return id; }
    return 'worker';
  }
  // what people wear for the weather and the season: scarves and hats in winter, sunglasses in summer
  function seasonWear(look) {
    const r = run, sea = r.season && r.season.id, wear = look.wear = (look.wear || []).filter((w) => !['scarf', 'beanie', 'shades'].includes(w));
    if (sea === 'winter' || r.weather === 'snow') { if (Math.random() < 0.7) wear.push('scarf'); if (Math.random() < 0.45) wear.push('beanie'); }
    else if (sea === 'autumn' && Math.random() < 0.35) wear.push('scarf');
    if ((sea === 'summer' && r.weather !== 'rain') || r.weather === 'hot') { if (Math.random() < (r.weather === 'hot' ? 0.6 : 0.4)) wear.push('shades'); }
    return look;
  }
  // holiday lights, by holiday
  const HOL_COLS = { xmas: ['#ff3b3b', '#4ade80', '#ffd23f', '#05d9e8'], halloween: ['#ff7a00', '#9b5de5'], valentine: ['#ff5c8a', '#ffffff'], summer: ['#ffd23f', '#05d9e8'],
    lunar: ['#ff3b3b', '#ffd23f'], neonfest: ['#ff2a6d', '#05d9e8', '#9b5de5', '#ffd23f'], school: ['#05d9e8', '#ffd23f', '#4ade80'] };
  // how busy the street is through the day: a morning rush, lunch, and the after-work rush
  const bump = (k, c, w) => Math.exp(-(((k - c) / w) ** 2));
  const rushRate = (k) => 1 + 0.9 * bump(k, 0.05, 0.06) + 0.8 * bump(k, 0.3, 0.06) + 1.0 * bump(k, 0.72, 0.08) - 0.35 * bump(k, 0.5, 0.1);
  const RUSH_AVG = Array.from({ length: 100 }, (_, i) => rushRate(i / 100)).reduce((a, x) => a + x, 0) / 100;
  // who's about: office workers in the morning, students in the afternoon
  const OUTFITS_BY_TIME = [[0.2, ['classic', 'ninja', 'classic']], [0.62, ['pink', 'sunset', 'dj']], [1, ['gold', 'holo', 'dj', 'classic']]];
  const VAN_X = 0.76;
  const FRIDGE = { x0: BX(0.805), x1: BX(0.985), top: 0.075, base: 0.27 };   // a drinks fridge against the front wall
  // props on the shop floor: [kind, x, y]
  const PROPS0 = [['plant', BX(0.365), 0.315], ['baskets', BX(0.64), 0.325], ['wet', 0.6, 0.395], ['bin', 0.29, 0.795], ['candy', 0.36, 0.78]];
  let PROPS = PROPS0;
  const JUNGLE = [['plant', 0.075, 0.43], ['plant', 0.925, 0.43], ['plant', BX(0.03), 0.3]];
  const TALKS = [['NEW', '#05d9e8'], ['★ BEST SELLER', '#ffd23f'], ['LOCAL FAV', '#4ade80'], ['HOT', '#ff7a00']];
  const LAMPS = [[0.22, 0.335, 0.64], [0.5, 0.37, 0.48], [0.78, 0.335, 0.64]];   // [x, lamp y, floor y below it]
  const PACK_W = { drinks: 0.52, noodles: 0.64, coffee: 0.56, vinyl: 0.86, holo: 0.64, sneakers: 0.96, chips: 0.56, signs: 0.9 };

  let run = null;

  // ---------- graphics quality ----------
  // 'auto' starts sharp and steps the resolution down if the phone can't keep up (and remembers it);
  // 'high' is always sharp, 'low' always smooth.
  const GFX_KEY = 'neonTycoon.gfx', GFX_AUTO_KEY = 'neonTycoon.gfxAuto';
  const getGfx = () => { try { return localStorage.getItem(GFX_KEY) || 'auto'; } catch { return 'auto'; } };
  function setGfx(mode) { try { localStorage.setItem(GFX_KEY, mode); localStorage.removeItem(GFX_AUTO_KEY); } catch { /* ignore */ } if (run) run.dprCap = startCap(); }
  // battery saver: 30 frames a second instead of 60 (on with ⚡ Smooth, when you turn it on, or when the battery is low)
  const SAVER_KEY = 'neonTycoon.saver';
  let battery = null;
  try { if (navigator.getBattery) navigator.getBattery().then((bt) => { battery = bt; }).catch(() => {}); } catch { /* ignore */ }
  const getSaver = () => { try { return localStorage.getItem(SAVER_KEY) === 'on'; } catch { return false; } };
  function setSaver(on) { try { localStorage.setItem(SAVER_KEY, on ? 'on' : 'off'); } catch { /* ignore */ } if (run) run.fpsCap = saverOn(); }
  const lowBattery = () => !!(battery && !battery.charging && battery.level < 0.2);
  const saverOn = () => getSaver() || getGfx() === 'low' || lowBattery();
  // the shop in 3D (WebGL), or the classic drawn view
  const VIEW_KEY = 'neonTycoon.view';
  const has3D = () => !!(window.NeonShop3D && window.NeonShop3D.supported());
  const getView = () => { let v = '3d'; try { v = localStorage.getItem(VIEW_KEY) || '3d'; } catch { /* ignore */ } return v === '3d' && !has3D() ? '2d' : v; };
  function setView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } }
  let r3dCache = null; // one WebGL renderer, reused day after day
  function startCap() {
    const mode = getGfx();
    if (mode === 'high') return 2;
    if (mode === 'low') return 1.25;
    try { return +localStorage.getItem(GFX_AUTO_KEY) || 2; } catch { return 2; }
  }
  // called each frame with the real time since the last one
  function adaptQuality(r, real) {
    if (getGfx() !== 'auto' || r.intro > 0 || r.ending || document.hidden || r.fpsCap) return;
    const q = r.q || (r.q = { t: 0, n: 0, sum: 0 });
    q.t += real; q.n++; q.sum += real;
    if (q.t < 2.5) return;
    const fps = q.n / q.sum;
    r.q = null;
    if (fps < 42 && r.dprCap > 1.25 && (window.devicePixelRatio || 1) > 1.25) {
      r.dprCap = r.dprCap > 1.6 ? 1.5 : 1.25;
      try { localStorage.setItem(GFX_AUTO_KEY, String(r.dprCap)); } catch { /* ignore */ }
      r.effects.push({ kind: 'text', text: '⚙️ Smoother graphics on', x: 0.5, y: 0.5, t: 0, color: '#7fe9ff' });
    }
  }

  // ---------- sound ----------
  let actx = null;
  const muted = () => { try { return JSON.parse(localStorage.getItem('neonDash.muted') || 'false'); } catch { return false; } };
  // pan: -1 (left) to 1 (right), so a sound comes from where it happens on screen
  function tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0, pan = 0) {
    if (muted()) return;
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = actx.destination;
    if (pan && actx.createStereoPanner) { const sp = actx.createStereoPanner(); sp.pan.value = clamp(pan, -1, 1); sp.connect(out); out = sp; }
    o.connect(g).connect(out); o.start(t); o.stop(t + dur);
  }
  // recorded sounds (CC0, Kenney; see assets/CREDITS.md), loaded once the audio starts; the synth stands in until then
  const SAMPLE_FILES = { step: 'walking', coin: 'coin', thud: 'race-impact', drop: 'city-placement-a', click: 'city-toggle', engine: 'race-engine', land: 'land', street: 'city-ambience' };
  const SAMPLES = {};
  let samplesLoading = false;
  function loadSamples() {
    if (samplesLoading || !actx) return;
    samplesLoading = true;
    for (const [k, f] of Object.entries(SAMPLE_FILES)) {
      fetch(`assets/sounds/${f}.ogg`).then((res) => res.arrayBuffer()).then((buf) => actx.decodeAudioData(buf)).then((b) => { SAMPLES[k] = b; if (k === 'street') ambience.useRecording(); }).catch(() => {});
    }
  }
  // play a recording (true if it could): vol, playback rate (pitch), and pan left/right
  function sample(k, vol = 0.5, rate = 1, pan = 0) {
    if (muted() || !actx || !SAMPLES[k]) return false;
    const src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = SAMPLES[k]; src.playbackRate.value = rate; g.gain.value = vol;
    let out = actx.destination;
    if (pan && actx.createStereoPanner) { const sp = actx.createStereoPanner(); sp.pan.value = clamp(pan, -1, 1); sp.connect(out); out = sp; }
    src.connect(g).connect(out); src.start();
    return true;
  }
  const sfx = {
    ching: () => { tone(1568, 0.08, 'square', 0.05); tone(2093, 0.18, 'square', 0.045, 0, 0.07); },
    bell: () => { tone(1320, 0.25, 'triangle', 0.04); tone(990, 0.3, 'triangle', 0.03, 0, 0.12); },
    huff: () => tone(220, 0.25, 'sawtooth', 0.04, 110),
    thud: () => sample('thud', 0.35, 0.9 + Math.random() * 0.2) || tone(110, 0.14, 'sine', 0.09, 45),
    horn: () => { sample('engine', 0.18, 0.8); tone(415, 0.1, 'square', 0.03); tone(415, 0.14, 'square', 0.03, 0, 0.16); },
    pop: () => sample('drop', 0.18, 1.1 + Math.random() * 0.2) || tone(880, 0.05, 'triangle', 0.02, 1200),
    beep: (pan = 0) => tone(2600, 0.045, 'square', 0.022, 0, 0, pan),
    chime: () => { tone(1568, 0.35, 'sine', 0.035); tone(1175, 0.5, 'sine', 0.03, 0, 0.18); },
    approved: () => { tone(1320, 0.07, 'sine', 0.04); tone(1760, 0.12, 'sine', 0.04, 0, 0.08); },
    coins: () => { if (!sample('coin', 0.3, 0.95 + Math.random() * 0.1)) for (let i = 0; i < 4; i++) tone(2400 + Math.random() * 1600, 0.05, 'triangle', 0.025, 0, 0.05 + i * 0.06); },
    alarm: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 880 : 1175, 0.14, 'square', 0.035, 0, i * 0.15); },
    click: () => sample('click', 0.4) || tone(1800, 0.03, 'square', 0.03),
    siren: () => { for (let i = 0; i < 6; i++) tone(i % 2 ? 660 : 880, 0.25, 'sawtooth', 0.02, 0, i * 0.25); },
    drum: () => tone(90, 0.12, 'sine', 0.06, 50),
    shutter: () => noiseBurst(1.1, 0.05, 300, 900),
    whoosh: () => noiseBurst(0.45, 0.05, 600, 2400),
    step: (vol = 0.03, pan = 0) => sample('land', vol * 6, 1.3 + Math.random() * 0.3, pan) || noiseBurst(0.07, vol, 260, 140, pan),
  };
  function noiseBuffer(sec) {
    const b = actx.createBuffer(1, Math.ceil(actx.sampleRate * sec), actx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // a short filtered hiss: the sliding doors
  function noiseBurst(dur, vol, f0, f1, pan = 0) {
    if (muted() || !actx) return;
    const t = actx.currentTime, src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = noiseBuffer(dur); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = actx.destination;
    if (pan && actx.createStereoPanner) { const sp = actx.createStereoPanner(); sp.pan.value = clamp(pan, -1, 1); sp.connect(out); out = sp; }
    src.connect(f).connect(g).connect(out); src.start(t); src.stop(t + dur);
  }
  // background: soft shop music, and street noise that gets louder when the doors open
  // the shop music: chord loops and a tempo for each style you can pick
  const MUSIC = {
    chill: { beat: 0.42, wave: 'triangle', vol: 0.010, arp: [0, 1, 2, 3, 2, 1, 2, 3], chords: [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 392]] },
    synth: { beat: 0.26, wave: 'square', vol: 0.005, bass: 'sawtooth', arp: [0, 2, 1, 3, 0, 2, 1, 3], chords: [[220, 261.6, 329.6, 440], [174.6, 220, 261.6, 349.2], [261.6, 329.6, 392, 523.3], [196, 246.9, 293.7, 392]] },
    jazz: { beat: 0.5, wave: 'triangle', vol: 0.011, swing: true, arp: [0, 2, 1, 3, 2, 0, 3, 1], chords: [[293.7, 349.2, 440, 523.3], [196, 246.9, 293.7, 349.2], [261.6, 329.6, 392, 493.9], [220, 277.2, 329.6, 392]] },
  };
  // how much you're looking out at the street (zoomed in near the windows): 0 to 1
  function streetK(r) {
    if (r.r3d) return r.r3d.streetness();
    const zm = r.zoom, cv = r.ui.canvas, H = cv.clientHeight || 1;
    if (zm.z < 1.05) return 0;
    return clamp((0.4 - (H / 2 - zm.ty) / zm.z / H) / 0.25, 0, 1);
  }
  const ambience = {
    street: null,
    // swap the noise for the street recording, looping, once it's loaded
    useRecording() {
      if (!this.street || this.street.rec || !SAMPLES.street) return;
      try {
        const src = actx.createBufferSource(); src.buffer = SAMPLES.street; src.loop = true;
        src.connect(this.street.g); src.start(); this.street.src.stop(); this.street.src = src; this.street.rec = true;
      } catch { /* keep the hiss */ }
    },
    start() {
      if (muted()) return;
      try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      loadSamples();
      try {
        const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
        src.buffer = noiseBuffer(2); src.loop = true; f.type = 'lowpass'; f.frequency.value = 450; g.gain.value = 0.004;
        src.connect(f).connect(g).connect(actx.destination); src.start();
        this.street = { src, g };
        this.useRecording(); // (already loaded on a later day)
        // the murmur of other shoppers, louder the busier it gets
        const cs = actx.createBufferSource(), cf = actx.createBiquadFilter(), cg = actx.createGain();
        cs.buffer = noiseBuffer(2); cs.loop = true; cf.type = 'bandpass'; cf.frequency.value = 380; cf.Q.value = 0.7; cg.gain.value = 0;
        cs.connect(cf).connect(cg).connect(actx.destination); cs.start();
        this.crowd = { src: cs, g: cg };
      } catch { this.street = null; }
    },
    // called every frame: the next note of the music, and the street volume
    tick(r, dt) {
      if (this.street) this.street.g.gain.setTargetAtTime((0.004 + r.doorOpen * 0.03 + streetK(r) * 0.022) * (this.street.rec ? 3 : 1), actx.currentTime, 0.15); // (the recording is quieter than the hiss)
      // shoppers' footsteps, from where they're walking
      const walkers = r.people.filter((p) => p.moving && p.kind !== 'passer' && p.y > L.wall);
      if (walkers.length && Math.random() < dt * Math.min(6, walkers.length * 1.2)) { const p = pick(walkers); sfx.step(0.012, panAt(p.x, p.y)); }
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
  // a look that's always the same for the same number (a member of staff, a regular)
  const lookFor = (n) => {
    const N = window.NeonLooks, h = (k) => Math.floor(Math.abs(Math.sin(n * 12.9898 + k * 78.233) * 43758.5453)) ;
    return { outfit: N.OUTFITS[h(1) % N.OUTFITS.length].id, skin: h(2) % 5, hair: N.HAIRS[h(3) % N.HAIRS.length].id, hairColor: h(4) % 6 };
  };
  const randomLook = () => {
    const N = window.NeonLooks;
    const pick = (a) => a[(Math.random() * a.length) | 0];
    return { outfit: pick(N.OUTFITS).id, skin: (Math.random() * 5) | 0, hair: pick(N.HAIRS).id, hairColor: (Math.random() * 6) | 0 };
  };
  const depthK = (y) => clamp((y - L.street) / (L.counter - L.street), 0, 1);
  const scaleAt = (y, H) => H * (0.035 + 0.075 * depthK(y));
  // the same shop in metres (seen from above): X across, Z from the front wall to the till (as the 3D view)
  const sAt = (y) => 0.035 + 0.075 * clamp((y - L.street) / (L.counter - L.street), 0, 1.7); // past the counter too (the back door)
  const SB = sAt(L.door), SC = sAt(L.counter), RW = 9, RD = 9;
  const zOf = (y) => (RD * (1 / SB - 1 / sAt(y))) / (1 / SB - 1 / SC);
  const xOf = (x, y) => (x - 0.5) * (RW / 0.86) * (SB / sAt(y));
  function toFlat(X, Z) {
    const k = 1 / (1 / SB - (Z * (1 / SB - 1 / SC)) / RD);
    return [0.5 + X / ((RW / 0.86) * (SB / k)), L.street + ((k - 0.035) / 0.075) * (L.counter - L.street)];
  }
  const metres = (a, b) => Math.hypot(xOf(a.x, a.y) - xOf(b.x, b.y), zOf(a.y) - zOf(b.y));
  // an island's footprint on the floor, in metres (0.85 m deep behind its front edge)
  const footprint = (u) => ({ X0: xOf(u.x0, u.base), X1: xOf(u.x1, u.base), Z1: zOf(u.base), Z0: zOf(u.base) - 0.85 });
  function blocked(x, y, pad = 0.25) {
    const X = xOf(x, y), Z = zOf(y);
    return UNITS.some((u) => { if (u.wall) return false; const f = footprint(u); return X > f.X0 - pad && X < f.X1 + pad && Z > f.Z0 - pad && Z < f.Z1 + pad; });
  }

  // ---------- your layout: where the islands and floor props stand, and which line goes on each unit ----------
  const ISLAND_H = 0.11, ISLAND_W = 0.32, ISLAND_BASE = 0.53;
  // an island placed with its centre at x and its front edge at base (it keeps its real size in metres)
  function island(u, cx, base) {
    const k = sAt(base) / sAt(ISLAND_BASE), w = ISLAND_W * k;
    return Object.assign({}, u, { x0: cx - w / 2, x1: cx + w / 2, base, top: base - ISLAND_H * k });
  }
  // keep an island off the centre aisle (everyone walks down x = 0.5) and inside the walls
  function clampIsland(i, cx, base) {
    base = clamp(base, 0.45, 0.62);
    const w = ISLAND_W * sAt(base) / sAt(ISLAND_BASE), wallX = toFlat(-RW / 2 + 0.25, zOf(base) - 0.85)[0];
    cx = i === 2 ? clamp(cx, Math.max(wallX, 0.03) + w / 2, 0.47 - w / 2) : clamp(cx, 0.53 + w / 2, Math.min(1 - wallX, 0.97) - w / 2);
    return [cx, base];
  }
  // promotions you buy once and place on the floor, each for one line
  const PROMOS = {
    poster: { name: '🖼️ Promo poster', cost: 400, desc: 'More shoppers come in for its line (more still near the door).', at: [0.32, 0.36] },
    bogo: { name: '🏷️ 2-for-1 sign', cost: 600, desc: 'Shoppers buying its line take more, and every second one is free. Clears a slow line.', at: [0.5, 0.47] },
    tasting: { name: '🍽️ Tasting stand', cost: 1500, desc: 'Shoppers walking past try a sample ($0.50) and may switch to its line.', at: [0.62, 0.62] },
  };
  // the promotions this shop owns, where they stand and which line they push
  function promosOf(b, lay = b.layout || {}) {
    return Object.keys(PROMOS).filter((id) => b.promos && b.promos[id]).map((id) => {
      const m = (lay.promos && lay.promos[id]) || {}, [x, y] = clampProp(m.x ?? PROMOS[id].at[0], m.y ?? PROMOS[id].at[1]);
      return { id, x, y, line: Number.isInteger(m.line) && m.line < lineCount(b.tier) ? m.line : 0 };
    });
  }
  // furniture you buy once and place (and turn) anywhere on the floor; each helps a little
  const FURNITURE = {
    bench: { name: '🪑 Bench', cost: 500, size: [1.4, 0.5], desc: 'Somewhere to sit: the queue is a little more patient.', at: [0.8, 0.7] },
    vending: { name: '🥫 Vending machine', cost: 1200, size: [0.9, 0.7], desc: 'Sells snacks all day: a few dollars more.', at: [0.94, 0.62] },
    arcade: { name: '🕹️ Arcade machine', cost: 2000, size: [0.8, 0.8], desc: 'Kids love it: families buy a bit more, and it takes coins.', at: [0.08, 0.62] },
    bigplant: { name: '🌳 Big plant', cost: 300, size: [0.7, 0.7], desc: 'A nicer place to shop: a little better word of mouth.', at: [0.06, 0.33] },
    display: { name: '💎 Trend display', cost: 1600, size: [1.0, 0.6], desc: 'Shows off today\'s trending line: more shoppers go for it.', at: [0.66, 0.6] },
  };
  function furnOf(b, lay = b.layout || {}) {
    return Object.keys(FURNITURE).filter((id) => b.furniture && b.furniture[id]).map((id) => {
      const m = (lay.furn && lay.furn[id]) || {}, [x, y] = clampProp(m.x ?? FURNITURE[id].at[0], m.y ?? FURNITURE[id].at[1]);
      return { id, x, y, rot: (m.rot || 0) % 4 };
    });
  }
  const PROP_KINDS = { plant: '🪴 Plant', baskets: '🧺 Baskets', wet: '⚠️ Wet-floor sign', bin: '🗑️ Bin', candy: '🍬 Sweets stand' };
  function clampProp(x, y) { return [clamp(x, 0.06, 0.94), clamp(y, L.enter + 0.01, L.counter - 0.015)]; }
  const layoutUnits = (lay) => UNITS0.map((u, i) => {
    const m = !u.wall && lay.units && lay.units[i];
    return m ? island(u, ...clampIsland(i, m.x, m.base)) : Object.assign({}, u);
  });
  // the annex and Level 2 units as flat shop coordinates (only in a megastore)
  // more floor space (🏗️ Grow): new islands in the front half of the shop, either side of the aisle
  const EXP_UNITS = [
    { zone: 'main', m: { X0: -3.7, X1: -1.5, Z: 3.5, wall: false }, cols: 3, exp: 1 },
    { zone: 'main', m: { X0: 1.5, X1: 3.7, Z: 3.5, wall: false }, cols: 3, exp: 2 },
  ];
  const UNIT_NAMES = ['Left wall shelves', 'Right wall shelves', 'Left island', 'Right island'];
  function bigUnits(b) {
    const floor = T.expOf(b).floor;
    return MUNITS.filter((u) => b.tier >= u.tier).concat(EXP_UNITS.filter((u) => floor >= u.exp)).map((u) => {
      const dx = u.zone === 'up' ? LEVEL2_DX : 0, [x0, base] = toFlat(u.m.X0 + dx, u.m.Z), [x1] = toFlat(u.m.X1 + dx, u.m.Z);
      const h = u.exp ? ISLAND_H * sAt(base) / sAt(ISLAND_BASE) : ISLAND_H; // a new island in the main room is drawn to scale
      return { x0, x1, base, top: base - h, cols: u.cols, wall: u.m.wall, zone: u.zone, m: u.m, dx, exp: u.exp,
        name: u.exp ? `New island ${u.exp}` : u.zone === 'annex' ? 'Annex island' : 'Level 2 shelves' };
    });
  }
  function applyLayout(b) {
    const lay = b.layout || {};
    UNITS = layoutUnits(lay).concat(bigUnits(b));
    PROPS = lay.props && lay.props.length === PROPS0.length ? lay.props.map(([k, x, y]) => [k, ...clampProp(x, y)]) : PROPS0;
    // a prop dragged onto an island goes back where it was
    PROPS = PROPS.map((pr, i) => (blocked(pr[1], pr[2], 0.05) ? PROPS0[i] : pr));
  }

  // ---------- the shop seen from above (the Arrange sheet and the closing heat map) ----------
  // shapes in metres for a layout
  function planShapes(b, lay = b.layout || {}) {
    const units = layoutUnits(lay), saved = UNITS;
    UNITS = units; // so blocked() checks this layout
    const lines = unitLines(Object.assign({}, b, { layout: lay }));
    const props = (lay.props && lay.props.length === PROPS0.length ? lay.props : PROPS0).map(([k, x, y], i) => {
      const [cx, cy] = clampProp(x, y), ok = !blocked(cx, cy, 0.05), [px, py] = ok ? [cx, cy] : [PROPS0[i][1], PROPS0[i][2]];
      return { kind: k, x: px, y: py, X: xOf(px, py), Z: zOf(py), i };
    });
    UNITS = saved;
    const big = bigUnits(b).map((u, k) => ({ i: UNITS0.length + k, wall: u.wall, X0: u.m.X0, X1: u.m.X1, Z0: u.m.Z - (u.wall ? 0.5 : 0.85), Z1: u.m.Z, line: lines[UNITS0.length + k], zone: u.zone, fixed: true, name: u.name }));
    return {
      annex: b.tier >= 2 ? ANNEX : null,
      units: big.concat(units.map((u, i) => (u.wall ? { i, wall: true, X0: xOf(u.x0, u.base), X1: xOf(u.x1, u.base), Z0: 0.07, Z1: 0.57, line: lines[i], name: UNIT_NAMES[i] } : Object.assign({ i, wall: false, line: lines[i], x: (u.x0 + u.x1) / 2, base: u.base, name: UNIT_NAMES[i] }, footprint(u))))),
      props, lines: lineNames(b), colors: LINE_COLORS,
      promos: promosOf(b, lay).map((pr) => Object.assign(pr, { X: xOf(pr.x, pr.y), Z: zOf(pr.y) })),
      furn: furnOf(b, lay).map((f) => Object.assign(f, { X: xOf(f.x, f.y), Z: zOf(f.y) })),
      counter: { X0: xOf(0, L.counter) - 0.2, X1: -xOf(0, L.counter) + 0.2, Z0: zOf(L.counter), Z1: zOf(L.counter) + 0.85 },
      pile: { X: xOf(PILE.x, PILE.y), Z: zOf(PILE.y) }, fridge: { X0: xOf(FRIDGE.x0, L.door), X1: xOf(FRIDGE.x1, L.door) },
      door: { X0: xOf(FRONT.door[0], L.door), X1: xOf(FRONT.door[1], L.door) }, windows: FRONT.windows.map(([a, c]) => [xOf(a, L.door), xOf(c, L.door)]),
    };
  }
  // fit the plan into a W×H canvas
  // (wider for a megastore, to show the annex)
  let planWide = false;
  const planView = (W, H) => { const w = planWide ? 14.4 : 9.8, k = Math.min(W / w, H / 10.9); return { k, ox: W / 2 - (planWide ? 2.3 * k : 0), oy: (H - 10.9 * k) / 2 + 0.55 * k }; };
  const planTo = (W, H, X, Z) => { const v = planView(W, H); return [v.ox + X * v.k, v.oy + Z * v.k]; };
  const planFrom = (W, H, x, y) => { const v = planView(W, H); return [(x - v.ox) / v.k, (y - v.oy) / v.k]; };
  // draw the plan: opts.heat paints where shoppers spent their time; opts.pick highlights one item
  function drawPlan(ctx, W, H, sh, opts = {}) {
    planWide = !!sh.annex;
    const P = (X, Z) => planTo(W, H, X, Z), k = planView(W, H).k, dec = window.NeonShopArt.decor();
    const rect = (X0, Z0, X1, Z1) => { const [a, b] = P(X0, Z0), [c, d] = P(X1, Z1); return [a, b, c - a, d - b]; };
    ctx.clearRect(0, 0, W, H);
    // floor, walls, the till
    ctx.fillStyle = dec.floor.a; ctx.fillRect(...rect(-RW / 2, 0, RW / 2, 10.3));
    ctx.fillStyle = 'rgba(0,0,0,.12)'; for (let z = 0; z < 10.3; z += 0.6) for (let x = -RW / 2 + ((z / 0.6) % 2) * 0.6; x < RW / 2; x += 1.2) ctx.fillRect(...rect(x, z, Math.min(x + 0.6, RW / 2), Math.min(z + 0.6, 10.3)));
    if (opts.heat) {
      const hm = opts.heat, max = Math.max(0.001, ...hm.data);
      for (let gy = 0; gy < hm.y; gy++) for (let gx = 0; gx < hm.x; gx++) {
        const v = hm.data[gy * hm.x + gx] / max; if (v < 0.04) continue;
        ctx.fillStyle = `hsla(${(1 - v) * 220}, 95%, 55%, ${0.25 + v * 0.5})`;
        ctx.fillRect(...rect(-RW / 2 + (gx * RW) / hm.x, (gy * 9.6) / hm.y, -RW / 2 + ((gx + 1) * RW) / hm.x, ((gy + 1) * 9.6) / hm.y));
      }
    }
    if (sh.annex) { // the annex through the arch, Level 2 dashed over its front, and the stairs
      const a = sh.annex;
      ctx.fillStyle = dec.floor.b; ctx.fillRect(...rect(a.X0, a.Z0, a.X1, a.Z1));
      ctx.fillStyle = dec.walls.wall; ctx.fillRect(...rect(a.X1, a.Z0 - 0.2, a.X1 + 0.2, a.Z1 + 0.2)); ctx.fillRect(...rect(a.X0, a.Z0 - 0.2, a.X1, a.Z0)); ctx.fillRect(...rect(a.X0, a.Z1, a.X1 + 0.2, a.Z1 + 0.2));
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeRect(...rect(a.X0 + 0.1, a.l2[0], a.X1 - 0.1, a.l2[1])); ctx.setLineDash([]);
      ctx.fillStyle = '#9aa0b5'; ctx.fillRect(...rect(a.stair.X - 0.35, a.stair.Z1, a.stair.X + 0.35, a.stair.Z0));
    }
    ctx.fillStyle = dec.walls.wall;
    ctx.fillRect(...rect(-RW / 2 - 0.2, -0.3, -RW / 2, 10.3));
    if (sh.annex) { ctx.fillRect(...rect(RW / 2, -0.3, RW / 2 + 0.2, sh.annex.arch[0])); ctx.fillRect(...rect(RW / 2, sh.annex.arch[1], RW / 2 + 0.2, 10.3)); } else ctx.fillRect(...rect(RW / 2, -0.3, RW / 2 + 0.2, 10.3));
    ctx.fillStyle = '#5a1f45'; ctx.fillRect(...rect(-RW / 2 - 0.2, -0.3, RW / 2 + 0.2, 0));
    ctx.fillStyle = '#8cd2ff'; for (const [a, c] of sh.windows) ctx.fillRect(...rect(a, -0.2, c, -0.1));
    ctx.fillStyle = dec.floor.a; ctx.fillRect(...rect(sh.door.X0, -0.3, sh.door.X1, 0));
    ctx.fillStyle = '#c4bddc'; ctx.fillRect(...rect(sh.counter.X0, sh.counter.Z0, sh.counter.X1, sh.counter.Z1));
    ctx.fillStyle = '#e8f6ff'; ctx.fillRect(...rect(sh.fridge.X0, 0.05, sh.fridge.X1, 0.75));
    ctx.fillStyle = '#a8713a'; ctx.fillRect(...rect(sh.pile.X - 0.6, sh.pile.Z - 0.45, sh.pile.X + 0.6, sh.pile.Z + 0.45));
    ctx.font = `800 ${Math.max(9, Math.round(k * 0.3))}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0b0221';
    ctx.fillText('TILL', ...P(0, (sh.counter.Z0 + sh.counter.Z1) / 2)); ctx.fillText('📦', ...P(sh.pile.X, sh.pile.Z));
    ctx.fillStyle = '#4ade80'; ctx.fillText('DOOR', ...P((sh.door.X0 + sh.door.X1) / 2, -0.55));
    // shelving, coloured by the line on it
    for (const u of sh.units) {
      const on = opts.pick && opts.pick.type === 'unit' && opts.pick.i === u.i, col = sh.colors[u.line];
      ctx.fillStyle = '#6a34c8'; ctx.fillRect(...rect(u.X0, u.Z0, u.X1, u.Z1)); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(...rect(u.X0, u.Z0, u.X1, u.Z1));
      ctx.fillStyle = col; ctx.fillRect(...rect(u.X0, u.Z1 - 0.12, u.X1, u.Z1));
      if (!u.wall) ctx.fillRect(...rect(u.X0, u.Z0, u.X1, u.Z0 + 0.12));
      if (on) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.setLineDash([5, 4]); ctx.strokeRect(...rect(u.X0 - 0.08, u.Z0 - 0.08, u.X1 + 0.08, u.Z1 + 0.08)); ctx.setLineDash([]); }
      ctx.fillStyle = '#fff'; ctx.fillText(`${u.zone === 'up' ? 'L2 · ' : ''}${sh.lines[u.line]}`, ...P((u.X0 + u.X1) / 2, (u.Z0 + u.Z1) / 2));
    }
    // promotions: a ring in their line's colour
    for (const pr of sh.promos || []) {
      const [x, y] = P(pr.X, pr.Z);
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(x, y, k * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = sh.colors[pr.line]; ctx.lineWidth = opts.pick && opts.pick.type === 'promo' && opts.pick.id === pr.id ? 4 : 2; ctx.stroke();
      ctx.font = `${Math.max(13, Math.round(k * 0.5))}px system-ui, sans-serif`; ctx.fillText(PROMOS[pr.id].name.split(' ')[0], x, y);
    }
    // furniture: its footprint, turned, with its icon
    for (const f of sh.furn || []) {
      const [w, d] = FURNITURE[f.id].size, [x, y] = P(f.X, f.Z), on = opts.pick && opts.pick.type === 'furn' && opts.pick.id === f.id;
      ctx.save(); ctx.translate(x, y); ctx.rotate((f.rot * Math.PI) / 2);
      ctx.fillStyle = '#3b2a5c'; ctx.fillRect(-w * k / 2, -d * k / 2, w * k, d * k);
      ctx.strokeStyle = on ? '#fff' : '#ffd23f'; ctx.lineWidth = on ? 3 : 1.5; ctx.strokeRect(-w * k / 2, -d * k / 2, w * k, d * k);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(-w * k / 2, d * k / 2 - 3, w * k, 3); // the front
      ctx.restore();
      ctx.font = `${Math.max(13, Math.round(k * 0.45))}px system-ui, sans-serif`; ctx.fillText(FURNITURE[f.id].name.split(' ')[0], x, y);
    }
    // floor props
    ctx.font = `${Math.max(14, Math.round(k * 0.6))}px system-ui, sans-serif`;
    for (const pr of sh.props) {
      const [x, y] = P(pr.X, pr.Z);
      if (opts.pick && opts.pick.type === 'prop' && opts.pick.i === pr.i) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, k * 0.45, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillText(PROP_KINDS[pr.kind].split(' ')[0], x, y);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  // what's under a point on the plan: { type: 'unit' | 'prop', i } or null
  function planHit(W, H, sh, x, y) {
    const [X, Z] = planFrom(W, H, x, y);
    const pm = (sh.promos || []).find((q) => Math.hypot(q.X - X, q.Z - Z) < 0.6);
    if (pm) return { type: 'promo', id: pm.id };
    const fu = (sh.furn || []).find((q) => Math.hypot(q.X - X, q.Z - Z) < 0.7);
    if (fu) return { type: 'furn', id: fu.id };
    const pr = sh.props.slice().sort((a, b) => Math.hypot(a.X - X, a.Z - Z) - Math.hypot(b.X - X, b.Z - Z))[0];
    if (pr && Math.hypot(pr.X - X, pr.Z - Z) < 0.6) return { type: 'prop', i: pr.i };
    const u = sh.units.find((v) => X > v.X0 - 0.2 && X < v.X1 + 0.2 && Z > v.Z0 - 0.2 && Z < v.Z1 + 0.2);
    return u ? { type: 'unit', i: u.i, wall: u.wall } : null;
  }
  // move an item on the plan to a point; returns the new layout
  function planMove(b, lay, pick, W, H, x, y) {
    const [X, Z] = planFrom(W, H, x, y);
    lay = JSON.parse(JSON.stringify(lay || {}));
    if (pick.type === 'unit') {
      if (!UNITS0[pick.i] || UNITS0[pick.i].wall) return lay; // wall shelves, the annex and Level 2 stay put
      const [cx, base] = toFlat(X, clamp(Z + 0.42, 1, 9));
      const [x2, b2] = clampIsland(pick.i, cx, base);
      // the two islands can't overlap
      const other = layoutUnits(lay)[pick.i === 2 ? 3 : 2], me = island(UNITS0[pick.i], x2, b2), f1 = footprint(me), f2 = footprint(other);
      if (f1.X1 > f2.X0 - 0.3 && f1.X0 < f2.X1 + 0.3 && f1.Z1 > f2.Z0 - 0.3 && f1.Z0 < f2.Z1 + 0.3) return lay;
      lay.units = lay.units || {}; lay.units[pick.i] = { x: x2, base: b2 };
    } else if (pick.type === 'promo') {
      const [px, py] = clampProp(...toFlat(X, Z)), saved = UNITS;
      UNITS = layoutUnits(lay); const bad = blocked(px, py, 0.05); UNITS = saved;
      if (bad) return lay;
      lay.promos = lay.promos || {}; lay.promos[pick.id] = Object.assign({}, lay.promos[pick.id], { x: px, y: py });
    } else if (pick.type === 'furn') {
      const [px, py] = clampProp(...toFlat(X, Z)), saved = UNITS;
      UNITS = layoutUnits(lay); const bad = blocked(px, py, 0.3); UNITS = saved;
      if (bad) return lay;
      lay.furn = lay.furn || {}; lay.furn[pick.id] = Object.assign({}, lay.furn[pick.id], { x: px, y: py });
    } else {
      const props = lay.props && lay.props.length === PROPS0.length ? lay.props : PROPS0.map((pr) => pr.slice());
      const [px, py] = clampProp(...toFlat(X, Z)), saved = UNITS;
      UNITS = layoutUnits(lay); const bad = blocked(px, py, 0.05); UNITS = saved;
      if (bad) return lay;
      props[pick.i] = [props[pick.i][0], px, py]; lay.props = props;
    }
    return lay;
  }

  // ---------- today's goal ----------
  const GOALS = [
    { id: 'serve', make: (r) => Math.max(6, Math.round(r.entrants * 0.55)), text: (n) => `Serve ${n} shoppers`, prog: (r) => r.served },
    { id: 'take', make: (r) => Math.max(20, Math.round((r.entrants * 0.45 * r.qtyMean * T.shelfPrice(r.s, r.b)) / 10) * 10), text: (n) => `Take $${n.toLocaleString()}`, prog: (r) => r.revenue },
    { id: 'help', make: () => 2, text: (n) => `Help ${n} shoppers who ask`, prog: (r) => r.stats.helped },
    { id: 'patient', make: () => 0, text: () => 'Nobody walks out of the queue', fail: (r) => r.lostWait > 0 },
    { id: 'thief', make: () => 0, text: () => 'No shoplifter gets away', fail: (r) => r.stats.stolen > 0 },
    { id: 'stars', make: () => 4, text: () => 'Earn a 4★ day', end: (r) => (r.stars || 0) >= 4 },
  ];
  const pickGoal = (s, b) => ({ id: GOALS[(s.day * 5 + b.id * 3 + (b.tier || 0)) % GOALS.length].id, n: 0 });
  const goalDef = (g) => GOALS.find((x) => x.id === g.id);
  // the goal's text and how it's going: { text, prog, done, failed }
  function goalInfo() {
    const r = run;
    if (!r) return null;
    if (r.night) { const left = nightLeft(); return { night: true, text: 'Night shift', prog: `${r.night.total - left}/${r.night.total} done · ${Math.ceil(r.night.t)}s`, done: left === 0, failed: false }; }
    const g = r.goal, d = goalDef(g);
    if (!g.n) g.n = d.make(r);
    const text = d.text(g.n);
    if (d.fail) { const failed = d.fail(r); return { text, prog: failed ? '✗' : r.closed ? '✓' : 'so far ✓', done: !failed && r.closed, failed }; }
    if (d.end) return { text, prog: 'at closing', done: false, failed: false };
    const v = d.prog(r);
    return { text, prog: d.id === 'take' ? `$${Math.round(v).toLocaleString()}/${g.n.toLocaleString()}` : `${Math.min(v, g.n)}/${g.n}`, done: v >= g.n, failed: false };
  }
  // judged at closing: met or not, the coins it pays, and the streak
  function judgeGoal() {
    const r = run, b = r.b, d = goalDef(r.goal);
    if (!r.goal.n) r.goal.n = d.make(r);
    const met = d.fail ? !d.fail(r) && r.served >= 3 : d.end ? d.end(r) : d.prog(r) >= r.goal.n;
    b.goalStreak = met ? (b.goalStreak || 0) + 1 : 0;
    return { text: d.text(r.goal.n), met, streak: b.goalStreak, reward: met ? 15 + 5 * Math.min(5, b.goalStreak) : 0 };
  }

  // ---------- the stockroom: a bay of boxes for each line, by the left island ----------
  const BAY_X = [-2.25, -1.6, -0.95], BAY_Z = 8.15;
  const bayAt = (line) => { const [x, y] = toFlat(BAY_X[line], BAY_Z); return { x, y }; };
  // deliveries come in at the back door, behind the counter
  const BACK_PATH = [[-4, 11], [-3.6, 10.1], [-3.3, 9.3]];
  // goods into the stockroom: into one line's bay, or (a delivery) sorted by how much shelf each line has
  function pileIn(n, line) {
    const r = run;
    if (!(n > 0)) return;
    r.pile += n;
    if (Number.isInteger(line) && line < r.bay.length) { r.bay[line] += n; return; }
    const room = r.bay.map((_, i) => r.slots.filter((sl) => sl.line === i).length), tot = room.reduce((a, x) => a + x, 0) || 1;
    let left = n;
    r.bay.forEach((_, i) => { const add = Math.floor((n * room[i]) / tot); r.bay[i] += add; left -= add; });
    r.bay[room.indexOf(Math.max(...room))] += left;
  }
  // take up to n out of a line's bay; returns how many
  function pileOut(n, line) {
    const r = run, t = Math.max(0, Math.min(n, r.bay[line] || 0));
    r.bay[line] -= t; r.pile -= t;
    return t;
  }
  const bayLow = (line) => run.bay[line] < run.cap * 3;

  // where shoppers spend their time, on a grid over the floor (shown on the closing report)
  const HEAT_X = 14, HEAT_Y = 12;

  // ---------- product lines: two or three kinds of each good, each on its own shelving ----------
  const LINES = {
    drinks: ['Original', 'Zero', 'Mega'], noodles: ['Chicken', 'Spicy', 'Veggie'], coffee: ['House', 'Dark roast', 'Decaf'], vinyl: ['Pop', 'Jazz', 'Rock'],
    holo: ['Robots', 'Pets', 'Dragons'], sneakers: ['Runners', 'High-tops', 'Slides'], chips: ['Basic', 'Pro', 'Ultra'], signs: ['Small', 'Arrow', 'Custom'],
  };
  const LINE_V = [0, 2, 4];            // the pack colourway for each line
  const LINE_COLORS = ['#05d9e8', '#ff2a6d', '#ffd23f'];
  const lineCount = (tier) => (tier === 0 ? 2 : 3);
  const lineNames = (b) => (LINES[b.good] || ['Classic', 'Special', 'Deluxe']).slice(0, lineCount(b.tier));
  // which line is on each shelving unit (your choice, or a mix by default)
  function unitLines(b) {
    const n = lineCount(b.tier), lay = b.layout || {};
    return UNITS0.concat(MUNITS, EXP_UNITS).map((_, i) => { const l = lay.lines && lay.lines[i]; return Number.isInteger(l) && l < n ? l : [0, 1, 2, 0, 1, 2, 0, 1][i] % n; });
  }
  // today's trending line (the same all day; changes from day to day)
  // a price for each line, as a share of the shop's shelf price (1 = the same; 0.8 = 20% off)
  const linePrice = (b, line) => (b.linePrice && b.linePrice[line] > 0 ? b.linePrice[line] : 1);
  function nudgeLine(line, d) {
    const r = run, b = r.b;
    b.linePrice = lineNames(b).map((_, i) => linePrice(b, i));
    b.linePrice[line] = clamp(Math.round((b.linePrice[line] + d) * 20) / 20, 0.6, 1.6);
    return b.linePrice[line];
  }
  const trending = (s, b) => (s.day * 7 + b.id * 3) % lineCount(b.tier);

  // shelf geometry
  const kick = (u) => (u.base - u.top) * 0.12;
  const rowH = (u) => (u.base - u.top - kick(u)) / ROWS;
  const shelfY = (u, row) => u.base - kick(u) - row * rowH(u);   // where row `row` (0 = bottom) sits
  const unitSpot = (u) => (u.m ? mSpot(u, rand(u.m.X0 + 0.4, u.m.X1 - 0.4)) : { x: rand(u.x0 + 0.05, u.x1 - 0.05), y: u.wall ? L.enter : u.base + 0.065 });
  // in front of an annex or Level 2 unit, at X metres across
  const mSpot = (u, X) => { const [x, y] = toFlat(X + u.dx, u.m.stand || u.m.Z + 0.75); return { x, y }; };

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
  const carried = () => run.clerk.carry + (run.me ? run.me.carry : 0) + run.staff.reduce((a, st) => a + (st.body ? st.body.carry : 0), 0);
  const backTotal = () => run.pile + run.incoming + carried();

  // ---------- open / close ----------
  // ui: { canvas, onTick(run), onEnd(summary) }
  function open(s, bizId, ui) {
    const res = T.startShopDay(s, bizId);
    if (!res.ok) return res;
    const b = res.b, tier = b.tier;
    const units = T.unitsPerDay(T.STALLS[tier].cap, b.good);
    // festivals and heatwaves, the weather, your shop's rating, and a coffee corner all change the crowd
    const weather = T.weather(s), up = b.upgrades || {};
    const events = [null, null, null, 'market', 'parade', 'power', 'inspector', 'celebrity', 'pipe', 'critic'], event = events[(Math.random() * events.length) | 0];
    const buzz = b.buzz && b.buzz.day === s.day ? b.buzz.mult : 1;
    const crowd = T.effectMod(s, b.district, b.good) * T.WEATHER[weather].crowd * T.weatherDemand(s, b.good) * (T.holiday(s.day) ? 1.06 : 1) * T.ratingMod(b) * T.repMod(b) * (up.coffee ? 1.12 : 1) * buzz * (event === 'market' ? 1.08 : 1);
    b.regulars = b.regulars || [];
    const staff = T.staffOf(b);
    // a present owner draws a bigger crowd than the automatic day (35% more shoppers)
    const ads = T.adMod(s, b), floorK = 1 + 0.12 * T.expOf(b).floor;
    const entrants = Math.max(3, Math.round(Math.min(CUSTOMERS[tier] * (1 + 0.15 * T.expOf(b).floor), units * 1.35 * floorK) * crowd * ads * T.followerMod(s)) + Math.floor(b.regulars.length / 2));
    for (const a of T.adsOf(s, b)) a.shop = (a.shop || 0) + Math.round(entrants * (1 - 1 / ads) * (T.CAMPAIGNS[a.id].boost / Math.max(0.01, ads - 1)));
    const qtyMean = Math.max(1, (units * 1.35 * floorK * crowd * ads * T.followerMod(s)) / entrants);
    applyLayout(b);
    const slots = makeSlots(), ul = unitLines(b);
    for (const sl of slots) { sl.line = ul[sl.u]; sl.v = LINE_V[sl.line]; }
    // how many units one shelf spot holds: enough that a full shop's worth fits on the shelves
    const cap = Math.max(1, Math.ceil(Math.max(units * 3, b.stock) / slots.length));
    run = {
      s, b, ui, t: 0, entrants, qtyMean, spawned: 0, nextSpawn: 0.5, cap, slots,
      pile: 0, incoming: 0, deliveries: [], van: null,
      people: [], effects: [], boxes: [], dust: [],
      // your staff at the tills: each has a skill, gets tired, and takes a break when worn out
      staff: staff.map((m, i) => ({ m, timer: 1 + i * 1.3, energy: 100, brk: 0, served: 0, look: lookFor(m.look || i * 7919 + b.id), job: 'till', body: null })),
      served: 0, sold: 0, revenue: 0, lostPrice: 0, lostWait: 0, lostStock: 0, closed: false, last: performance.now(), raf: 0,
      sellerLook: (() => { try { return Object.assign({ outfit: 'classic', skin: 2, hair: 'short', hairColor: 0 }, JSON.parse(localStorage.getItem('neonDash.look') || '{}')); } catch { return {}; } })(),
      rival: T.rival(s, b), holiday: T.holiday(s.day), season: T.season(s.day), event, eventAt: rand(18, 48), eventT: 0,
      reduced: (T.freshness(s, b) || { reduced: 0 }).reduced,
      patienceMul: staff.some((m) => m.skill === 'friendly') ? 1.25 : 1,
      clerkSpeed: Math.min(1.8, 1 + 0.4 * staff.filter((m) => m.skill === 'stocker').length),
      dogs: [], parade: [], police: null, pendingReturn: null, zoom: { z: 1, tx: 0, ty: 0 }, info: null, inv: null,
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
      dprCap: startCap(),
      // walking the floor yourself, today's goal, product lines, where shoppers spent their time
      me: null, greetT: 0, lines: lineNames(b), unitLine: ul, trend: trending(s, b), lineSold: lineNames(b).map(() => 0),
      heat: new Float32Array(HEAT_X * HEAT_Y), goal: pickGoal(s, b), hourSold: Array(12).fill(0),
      rep: T.repOf(b), repD: { price: 0, stock: 0, queue: 0, service: 0 }, // what people say about you, and today's experiences
      groups: {}, mud: 0, // who came today; muddy footprints by the door on a wet day
      online: [], nextOnline: rand(8, 14), // delivery orders on the tablet
      stats: { waits: [], stolen: 0, caught: 0, helped: 0, extras: 0, good: 0, bad: 0, returns: 0, newRegulars: 0, rewards: 0, reducedSold: 0, knocked: 0, haul: false },
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
    run.pile = 0; run.bay = run.lines.map(() => 0);
    pileIn(left);
    // orders regulars asked for: due ones come in to collect; missed ones cost you the regular
    b.requests = b.requests || [];
    run.ordersLost = [];
    for (const rq of b.requests.filter((x) => x.due < s.day)) loseOrder(rq);
    run.collect = b.requests.filter((x) => x.made < s.day).map((rq, i) => ({ rq, at: rand(6, 14) + i * 9 }));
    run.promos = promosOf(b);
    run.furn = furnOf(b);
    const has = (id) => run.furn.some((f) => f.id === id);
    if (has('bench')) run.patienceMul *= 1.1;
    // a basket stand near the door, and sweets by the till, sell a little more
    const propAt = (k) => PROPS.find((pr) => pr[0] === k);
    const bk = propAt('baskets'), cd = propAt('candy');
    run.basketsNear = !!bk && metres({ x: bk[1], y: bk[2] }, { x: 0.5, y: L.enter }) < 3;
    run.candyNear = !!cd && metres({ x: cd[1], y: cd[2] }, { x: 0.5, y: L.counter - 0.04 }) < 2.6;
    // passers-by who just walk past, so the street feels alive
    for (let i = 0; i < 4; i++) addPasser(Math.random());
    run.ads = T.adsOf(s, b).map((a) => a.id);
    if (run.ads.includes('flyers')) run.people.push({ kind: 'promoter', name: 'Flyers', look: Object.assign(randomLook(), { outfit: 'pink', wear: ['flyers'] }), x: 0.36, y: L.street + 0.002, phase: 0, facing: 'front', badge: '📄' });
    ambience.start();
    layers = {};
    if (ui.canvas3d && getView() === '3d') {
      try { r3dCache = r3dCache || window.NeonShop3D.create(ui.canvas3d); r3dCache.attach(run); run.r3d = r3dCache; }
      catch (e) { console.warn('3D shop unavailable', e); run.r3d = null; ui.canvas3d.style.display = 'none'; }
    } else if (ui.canvas3d) ui.canvas3d.style.display = 'none';
    run.fpsCap = saverOn();
    const loop = (now) => {
      if (!run) return;
      if (run.fpsCap && now - (run.lastFrame || 0) < 1000 / 32) { run.raf = requestAnimationFrame(loop); return; } // battery saver: every other frame
      run.lastFrame = now;
      if ((run.capCheck = (run.capCheck || 0) + 1) % 120 === 0) run.fpsCap = saverOn(); // the battery may have run low
      const real = (now - run.last) / 1000, dt = Math.min(0.05, real);
      run.last = now;
      if (real > 0 && real < 0.5) adaptQuality(run, real);
      step(dt);
      markStickers();
      if (run.r3d) { run.r3d.render(dt); drawOverlay3D(); } else draw();
      ui.onTick(run);
      if (run && run.done) { if (run.r3d) run.r3d.detach(); ambience.stop(); const sum = summary(); const cb = ui.onEnd; run = null; cb(sum); return; }
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
      returns: st.returns, good: st.good, bad: st.bad, newRegulars: st.newRegulars, regulars: r.b.regulars.length, rewards: st.rewards,
      reducedSold: st.reducedSold, knocked: st.knocked, haul: st.haul, event: r.event, holiday: r.holiday,
      staff: r.staff.map((x) => ({ name: x.m.name, served: x.served, morale: x.m.morale })),
      stars: r.stars, rating: r.b.rating, reviews: r.b.reviews || [],
      goal: r.goalResult || null, eventResult: r.eventResult || null, critic: r.critic || null, splashed: st.splashed || 0, rep: r.b.rep, repBefore: r.repBefore, tidy: r.stats.tidy, nightDone: r.stats.nightDone, nightTotal: r.stats.nightTotal, orders: r.stats.orders || 0, ordersLost: r.ordersLost, openOrders: (r.b.requests || []).map((x) => ({ ...x, lineName: r.lines[x.line] })), lines: r.lines, lineSold: r.lineSold, trend: r.trend,
      heat: { x: HEAT_X, y: HEAT_Y, data: Array.from(r.heat) }, plan: planShapes(r.b),
      online: st.online || 0, onlineLost: st.onlineLost || 0, side: st.side || 0, furnTake: st.furnTake || 0, matched: st.matched || 0, toRival: st.toRival || 0, rivalName: r.rival && r.rival.name,
      groups: r.groups, slips: st.slips || 0, mopped: st.mopped || 0, weekend: weekend(r.s),
    };
  }

  // closing time: what today's shoppers thought (sets the stall's star rating)
  function finishDay() {
    const r = run, b = r.b, st = r.stats, mult = b.mult || T.RETAIL;
    const lost = r.lostPrice + r.lostWait + r.lostStock, seen = Math.max(1, r.served + lost);
    const avgWait = st.waits.length ? st.waits.reduce((a, x) => a + x, 0) / st.waits.length : 0;
    let stars = 5 - (r.lostWait / seen) * 4 - (r.lostStock / seen) * 3 - Math.max(0, mult - 1.3) * 3 - (avgWait > 6 ? 0.5 : 0)
      + (st.helped ? 0.3 : 0) + (mult < T.RETAIL ? 0.3 : 0) - (st.stolen ? 0.3 : 0) + st.good * 0.2 - st.bad * 0.5;
    // staff get worn down by a busy day
    for (const s2 of r.staff) s2.m.morale = clamp(Math.round(s2.m.morale - s2.served * 1.2 + 6), 0, 100);
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
    if (st.bad) notes.push('They refused my return. Never again!');
    if (st.good && st.returns) notes.push('Sorted my return, no fuss.');
    if (st.rewards) notes.push('Love my stamp card!');
    if (r.decor.floor.cost || r.decor.plants.id === 'jungle' || r.decor.sign.cost || r.furn.length >= 2) notes.push('Lovely decor!');
    if (r.up.coffee) notes.push('The coffee corner is great.');
    if (st.tidy >= 0.8) notes.unshift('Spotless when I came in!');
    while (notes.length < 3) notes.push(pick(good));
    const reviews = notes.slice(0, 3).map((text) => ({ stars: clamp(Math.round((stars + rand(-0.6, 0.6)) * 2) / 2, 1, 5), text }));
    r.stars = stars = Math.min(5, stars + 0.4 * (st.tidy || 0)); // the night shift's tidy-up
    b.rating = b.rating ? Math.round((b.rating * 0.6 + stars * 0.4) * 10) / 10 : stars;
    b.reviews = reviews;
    b.usual = mult; // regulars expect this price next time
    r.goalResult = judgeGoal();
    r.repBefore = Object.assign({}, r.rep);
    b.rep = Object.fromEntries(T.REP_KEYS.map((k) => [k, Math.round(clamp(r.rep[k] + r.repD[k] * 0.35 - (r.rep[k] - 50) * 0.05, 0, 100))]));
    // the shop's diary: one line per day you ran it (the last 14), for the weekly report
    b.history = (b.history || []).concat([{
      day: r.s.day, sold: r.sold, revenue: Math.round(r.revenue + st.extras), lines: r.lines.slice(), lineSold: r.lineSold.slice(), hours: r.hourSold.slice(),
      stolen: st.stolen, caught: st.caught, goal: r.goalResult.met, streak: r.goalResult.streak, orders: st.orders || 0, stars: r.stars,
      layout: JSON.stringify([b.layout || {}, b.promos || {}, b.linePrice || []]),
    }]).slice(-14);
    for (const rq of (b.requests || []).filter((x) => x.due <= r.s.day && x.made < r.s.day)) loseOrder(rq);
  }

  // ---------- people ----------
  function addPasser(startFrac = 0) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    run.people.push({ kind: 'passer', look: seasonWear(randomLook()), x: dir > 0 ? -0.1 + startFrac * 1.2 : 1.1 - startFrac * 1.2, y: L.street, dir, speed: 0.08 + Math.random() * 0.05, phase: Math.random() * 6 });
  }

  function addShopper() {
    const r = run, dir = Math.random() < 0.5 ? 1 : -1;
    r.spawned++;
    const look = randomLook(), k = dayK(), group = pickGroup(k), G0 = GROUPS[group];
    look.outfit = group === 'worker' ? pick(['classic', 'ninja', 'classic', 'dj']) : pick(OUTFITS_BY_TIME.find(([until]) => k <= until)[1]); // suits for the office, the rest by time of day
    look.wear = G0.wear ? [G0.wear] : [];
    if (group === 'senior') look.grey = true;
    seasonWear(look);
    r.people.push({
      kind: 'shopper', state: 'street', look, name: pick(T.NAMES), x: dir > 0 ? -0.08 : 1.08, y: L.street, dir, speed: 0.11 + Math.random() * 0.04,
      phase: Math.random() * 6, limit: T.shopperLimit(), qty: Math.max(1, Math.round(r.qtyMean * (0.6 + Math.random() * 0.8))),
      patience: (10 + Math.random() * 8) * r.patienceMul, wait: 0, bubble: null, timer: 0, mood: undefined, bag: false, basket: 0, facing: 'back', extra: 0, spd: 1,
      compares: Math.random() < 0.6, // looks across the road at the rival's prices
      group,
    });
    const lead = r.people[r.people.length - 1];
    if (r.criticNext) { r.criticNext = false; lead.critic = true; }
    lead.limit *= G0.limit; lead.patience *= G0.patience; lead.spd = G0.spd; lead.qty = Math.max(1, Math.round(lead.qty * G0.qty));
    // a regular you've seen before (with a stamp card), or another kind of shopper
    const regs = r.b.regulars.filter((g) => !r.people.some((p) => p.reg === g));
    let roll = Math.random();
    if (regs.length && Math.random() < Math.min(0.25, 0.04 * r.b.regulars.length)) {
      const g = pick(regs);
      Object.assign(lead, { type: 'regular', badge: '⭐', reg: g, name: g.name, look: seasonWear(Object.assign({}, g.look)) });
    } else for (const [type, chance, badge] of TYPES) { const c = type === 'thief' ? chance * (1 + 0.5 * doorK()) * (guard() ? 0.6 : 1) : chance; if (roll < c) { lead.type = type; lead.badge = badge; break; } roll -= c; }
    if (lead.type === 'returner') lead.qty = 1;
    const rp = r.rep; // what they've heard
    lead.patience *= (0.8 + 0.4 * rp.queue / 100) * (0.9 + 0.2 * rp.service / 100);
    lead.limit *= 1 + ((rp.price - 50) / 50) * 0.04;
    if (rp.stock < 35 && lead.type !== 'regular' && Math.random() < (35 - rp.stock) / 100) lead.skip = true; // heard you're always out of stock
    // which line they're after: a regular always wants the same one; today's trend is more popular
    if (lead.reg && Number.isInteger(lead.reg.line) && lead.reg.line < r.lines.length) lead.line = lead.reg.line;
    else {
      const w = r.lines.map((_, i) => (i === r.trend ? (r.furn.some((f) => f.id === 'display') ? 2.5 : 1.8) : 1) * r.promos.reduce((a, pr) => a * (pr.id === 'poster' && pr.line === i ? (metres(pr, { x: 0.5, y: L.enter }) < 3 ? 1.7 : 1.35) : 1), 1)); let k = Math.random() * w.reduce((a, x) => a + x, 0);
      lead.line = 0; for (let i = 0; i < w.length; i++) { k -= w[i]; if (k <= 0) { lead.line = i; break; } }
      if (lead.reg) lead.reg.line = lead.line;
    }
    // some walk a dog, which waits outside
    if (lead.type !== 'thief' && Math.random() < 0.07) r.dogs.push({ owner: lead, x: lead.x - dir * 0.04, y: L.street + 0.003, phase: 0, look: (Math.random() * 3) | 0 });
    const usual = run.b.usual || T.RETAIL;
    if (lead.type === 'regular') lead.limit = Math.max(usual, T.RETAIL) * 1.06;            // wants the usual price
    if (lead.type === 'rushed') { lead.patience = rand(5, 8); lead.spd = 1.45; }
    if (lead.reg) { lead.group = lead.reg.group || (lead.reg.group = lead.group); }
    (r.groups[lead.group] = r.groups[lead.group] || { came: 0, served: 0, lost: 0 }).came++;
    if (lead.type === 'bargain') lead.limit = T.RETAIL * 0.99;                              // only buys on SALE
    if (lead.type === 'tourist') lead.qty = Math.ceil(lead.qty * 2.5);
    // some come as a couple, or a parent with a child, who tag along without buying
    roll = Math.random();
    if ((roll < 0.3 || lead.group === 'family') && lead.type !== 'thief' && lead.type !== 'rushed') {
      const child = roll < 0.1 || lead.group === 'family';
      run.people.push({ kind: 'companion', leader: lead, child, look: seasonWear(randomLook()), x: lead.x - dir * 0.05, y: lead.y, side: Math.random() < 0.5 ? -1 : 1, phase: Math.random() * 6, facing: 'back' });
    }
    return lead;
  }

  const queue = () => run.people.filter((p) => p.state === 'queue' || p.state === 'serving' || p.state === 'returning').sort((a, b) => a.qAt - b.qAt);
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
    if (p.climb) { // on the stairs
      p.climb.t += dt / 1.6; p.phase += dt * 9; p.moving = true;
      if (p.climb.t < 1) return false;
      p.climb = null;
    }
    if (!p.path || !p.path.length) return true;
    if (p.path[0][2] === 'climb') { // step onto the stairs: arrive at the other end after the climb
      const [x, y] = p.path.shift(); p.climb = { t: 0, from: [p.x, p.y], up: x > p.x };
      p.x = x; p.y = y; return false;
    }
    if (moveToward(p, p.path[0][0], p.path[0][1], dt, speed)) p.path.shift();
    return !p.path.length;
  }
  // routes through the shop: the centre aisle (x = 0.5) joins everything
  // which part of the shop a point is in: the main shop, the annex, or Level 2
  const zoneOf = (p) => { const X = xOf(p.x, p.y); return X > LEVEL2_DX / 2 ? 'up' : X > ANNEX.X0 - 0.05 ? 'annex' : 'main'; };
  const fl = (X, Z) => toFlat(X, Z);
  const ARCH_Z = (ANNEX.arch[0] + ANNEX.arch[1]) / 2;
  // the way between zones: [points...]; a point with 'climb' is the other end of the stairs
  function between(a, b) {
    const inside = fl(ANNEX.X0 - 0.7, ARCH_Z), outside = fl(ANNEX.X0 + 0.6, ARCH_Z);
    const bottom = fl(ANNEX.stair.X, ANNEX.stair.Z0 + 0.3), top = fl(ANNEX.stair.X + LEVEL2_DX, ANNEX.stair.Z1 - 0.3);
    if (a === 'main' && b === 'annex') return [inside, outside];
    if (a === 'annex' && b === 'main') return [outside, inside];
    if (a === 'annex' && b === 'up') return [bottom, [...top, 'climb']];
    if (a === 'up' && b === 'annex') return [top, [...bottom, 'climb']];
    if (a === 'main' && b === 'up') return between('main', 'annex').concat(between('annex', 'up'));
    if (a === 'up' && b === 'main') return between('up', 'annex').concat(between('annex', 'main'));
    return [];
  }
  function routeTo(from, to) {
    const za = zoneOf(from), zb = zoneOf(to);
    if (za !== 'main' || zb !== 'main') { // through the arch, and up or down the stairs
      if (za === zb) return [[to.x, to.y]];
      const via = between(za, zb), first = { x: via[0][0], y: via[0][1] };
      const start = za === 'main' ? routeTo0(from, first) : [[first.x, first.y]];
      return start.concat(via.slice(1)).concat([[to.x, to.y]]);
    }
    return routeTo0(from, to);
  }
  function routeTo0(from, to) {
    const pts = [];
    if (Math.abs(from.x - 0.5) > 0.01) pts.push([0.5, from.y]);
    if (Math.abs(to.y - from.y) > 0.005) pts.push([0.5, to.y]);
    pts.push([to.x, to.y]);
    return pts;
  }

  // back to the centre aisle (from wherever they are)
  const toAisle = (p) => (zoneOf(p) === 'main' ? [[0.5, p.y]] : routeTo(p, { x: 0.5, y: fl(ANNEX.X0 - 0.7, ARCH_Z)[1] }));
  const say = (p, text, sec = 2.2) => { p.bubble = text; p.bubbleT = sec; };
  // ---------- word of mouth: every shopper's day adds to what people say about the shop ----------
  const hear = (k, d) => { if (run && run.repD) run.repD[k] += d; };
  // a regular remembers their last visit: the price they paid, the wait, whether you'd run out
  const memo = (p, m) => { if (p.reg) p.reg.memo = Object.assign(p.reg.memo || {}, m); };
  // what they've heard, as they come in (only when it's strong one way or the other)
  function wordOfMouth(p) {
    const r = run, rp = r.rep, lines = [];
    if (rp.price > 70) lines.push('💬 My friend said it\'s cheap here!'); if (rp.price < 30) lines.push('💬 I heard it\'s pricey…');
    if (rp.queue > 70) lines.push('💬 They say you\'re quick!'); if (rp.queue < 30) lines.push('💬 Heard the queue is awful…');
    if (rp.stock < 35) lines.push('💬 Hope you\'ve got stock today…'); if (rp.service > 72) lines.push('💬 Everyone says the staff are lovely!');
    if (lines.length && Math.random() < 0.25) say(p, pick(lines), 2);
    // a regular remembers last time
    const m = p.reg && p.reg.memo, pm = (r.b.mult || T.RETAIL) * linePrice(r.b, p.line);
    if (m && m.mult && pm > m.mult * 1.1) { say(p, '🤨 Pricier than last time!', 2); p.limit *= 0.97; }
    else if (m && m.out) say(p, '🤞 Hope you\'ve got it this time!', 2);
    else if (m && m.slow) { say(p, '⏱️ Don\'t keep me waiting like last time!', 2); p.patience *= 0.85; }
  }
  // a small face over their head: 😍 a bargain, 💸 too dear, 🤔 thinking, 😤 waiting too long
  const react = (p, icon) => { p.react = { icon, t: 1.6 }; };
  const pick = (a) => a[(Math.random() * a.length) | 0];
  function leaveShop(p, mood, bubble) {
    if (p.critic && !p.reviewed) { p.reviewed = true; criticReview(p, mood === 'happy'); }
    if (p.kind === 'shopper' && p.group && run.groups[p.group] && mood !== 'happy' && !p.counted) { p.counted = true; run.groups[p.group].lost++; }
    if (p.basket) { pileIn(p.basket, Number.isInteger(p.got) ? p.got : p.line); p.basket = 0; } // a dropped basket goes back to the stockroom
    p.state = 'leaving'; p.mood = mood; p.hold = false; say(p, bubble);
    p.exitDir = Math.random() < 0.5 ? -1 : 1;
    p.path = routeTo(p, { x: 0.5, y: L.enter }).concat([[0.5, L.street]]);
  }

  const MUD_SPOT = { x: 0.5, y: 0.335 };
  const wetSignNear = () => { const w = PROPS.find((pr) => pr[0] === 'wet'); return !!w && metres({ x: w[1], y: w[2] }, MUD_SPOT) < 2.6; };
  const doorPull = (u) => (u.wall ? 0 : clamp((ISLAND_BASE - u.base) / 0.08, -1, 1)); // 0 where islands usually stand, 1 right by the door, -1 at the back
  const doorK = () => (doorPull(UNITS[2]) + doorPull(UNITS[3])) / 2;
  const lineItems = (line) => run.slots.reduce((a, sl) => a + (sl.line === line ? sl.n : 0), 0);
  // pick a shelf to visit: the shopper's line first, well-stocked ones, and islands near the door catch the eye
  function pickUnit(p) {
    const w = UNITS.map((u, i) => (unitItems(i) + 0.5) * (p && run.unitLine[i] !== p.line ? 0.25 : 1) * (1 + 0.4 * doorPull(u)));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return 0;
  }

  // take goods off the shelves into the basket; the nearest shelf spots go first
  function takeGoods(p) {
    const bogo = run.promos.find((pr) => pr.id === 'bogo' && pr.line === p.line);
    if (bogo && !p.bogo) { p.bogo = true; p.qty = Math.max(2, p.qty + Math.ceil(p.qty / 2)); react(p, '🏷️'); }
    let need = Math.min(p.qty, shelfTotal()), flies = 0;
    p.got = p.line;
    while (need > 0) {
      const mine = run.slots.filter((sl) => sl.n > 0 && sl.u === p.unit && sl.line === p.line);
      const theirs = run.slots.filter((sl) => sl.n > 0 && sl.line === p.line);
      const pool = mine.length ? mine : theirs.length ? theirs : run.slots.filter((sl) => sl.n > 0);
      pool.sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x) || c.row - a.row);
      const sl = pool[0], t = Math.min(need, sl.n);
      sl.n -= t; need -= t; p.basket += t;
      if (flies < 4) run.effects.push({ kind: 'fly', x: sl.x, y: sl.y, sl, to: p, t: -flies * 0.12, dur: 0.38 });
      flies++;
    }
    p.state = 'pick'; p.timer = 0.45 + Math.min(4, flies) * 0.12; p.facing = 'back';
    sfx.pop();
    // now and then a pack slips and lands on the floor, until the clerk picks it up
    if (p.basket > 1 && Math.random() < 0.06) {
      p.basket--;
      run.floor.push({ x: p.x + rand(-0.03, 0.03), y: p.y + 0.012, n: 1, rot: rand(-1.2, 1.2), line: p.got });
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
    r.shutter = opening ? clamp((r.intro - 0.9) / 1.4, 0, 1) : r.night || r.nightOffer ? Math.min(1, (r.shutter || 0) + dt) : r.ending ? clamp((3.2 - r.outro - 0.8) / 1.2, 0, 1) : 0;
    r.lights = r.night ? 0.8 : opening ? clamp((0.9 - r.intro) / 0.6, 0, 1) * (r.intro > 0.3 && Math.random() < 0.2 ? 0.4 : 1)
      : r.ending ? clamp(0.35 + ((r.outro - 2.4) / 0.8) * 0.65, 0.35, 1) : 1;
    if (r.ending) {
      const before = r.outro;
      r.outro -= dt;
      if (before > 2.4 && r.outro <= 2.4) sfx.shutter();
      if (r.outro <= 0) r.done = true;
    }
    if (r.cam && (r.cam.t += dt) > r.cam.dur) r.cam = null;
    if (r.alarm > 0) r.alarm -= dt;
    if (r.greetT > 0) r.greetT -= dt;
    if (r.pendingRequest && (r.pendingRequest.t -= dt) <= 0) answerRequest(false);
    if (r.info && (r.info.t -= dt) <= 0) r.info = null;
    if (!r.drag && r.away > 0) r.away -= dt;
    // weather: rain falling outside, clouds drifting
    if (r.weather === 'rain' || r.weather === 'snow') {
      const snow = r.weather === 'snow';
      for (let i = 0; i < dt * (snow ? 60 : 140); i++) r.rain.push({ x: Math.random() * 1.1, y: FRONT.glass, v: snow ? rand(0.03, 0.06) : rand(0.5, 0.75) });
      for (const d of r.rain) { d.y += d.v * dt; d.x -= d.v * dt * 0.15; }
      r.rain = r.rain.filter((d) => d.y < FRONT.road1 + 0.03);
    }
    for (const c of r.clouds) { c.x += dt * 0.006; if (c.x > 1.2) c.x = -0.3; }
    const open = !opening && r.t < DAY_SECONDS;
    // shoppers arrive spread over the day
    // a regular coming to collect their order
    if (open && r.collect.length && r.t >= r.collect[0].at) addCollector(r.collect.shift().rq);
    if (open && r.spawned < r.entrants && r.t >= r.nextSpawn) {
      addShopper();
      const gap = (DAY_SECONDS * 0.9) / r.entrants / (rushRate(dayK()) / RUSH_AVG); // busier at rush hour
      r.nextSpawn = r.t + (r.burst > 0 ? (r.burst--, 0.7) : gap * (0.5 + Math.random())); // fans arrive in a rush
    }
    if (open && Math.random() < dt * 0.6 * (r.event === 'market' ? 1.8 : 1) * (rushRate(dayK()) / RUSH_AVG)) addPasser();

    const mult = r.b.mult || T.RETAIL;
    for (const p of r.people) {
      p.moving = false;
      if (p.bubbleT !== undefined) p.bubbleT -= dt;
      if (p.react && (p.react.t -= dt) <= 0) p.react = null;
      if (p.kind === 'shopper' && !p.tasted && (p.state === 'enter' || p.state === 'look')) {
        const ts = r.promos.find((pr) => pr.id === 'tasting');
        if (ts && metres(p, ts) < 1.8) {
          p.tasted = true;
          if (Math.random() < 0.45) {
            T.shopExtra(r.s, r.b.id, -0.5); r.stats.extras -= 0.5; r.stats.samples = (r.stats.samples || 0) + 1;
            p.patience *= 1.15; react(p, '😋');
            if (p.line !== ts.line && !p.order && Math.random() < 0.6) { p.line = ts.line; say(p, `😋 Ooh, I'll get ${r.lines[ts.line]}!`, 1.6); }
          }
        }
      }
      if (p.kind !== 'passer' && p.y > L.enter - 0.01 && p.y < L.counter) { // the heat map
        const gx = clamp(Math.floor(((xOf(p.x, p.y) + RW / 2) / RW) * HEAT_X), 0, HEAT_X - 1), gy = clamp(Math.floor((zOf(p.y) / 9.6) * HEAT_Y), 0, HEAT_Y - 1);
        r.heat[gy * HEAT_X + gx] += dt;
      }
      if (p.kind === 'passer') { p.x += p.dir * p.speed * dt; p.phase += dt * 8; p.moving = true; continue; }
      if (p.kind === 'promoter') { if (Math.random() < dt * 0.12) say(p, pick(['📄 Deals inside!', '📄 Have a flyer!', '📄 New in store!']), 1.6); continue; }
      switch (p.state) {
        case 'street': // walk along the pavement, turn in at the door
          p.x += p.dir * p.speed * dt; p.phase += dt * 8; p.moving = true;
          if (!open) { p.kind = 'passer'; break; }
          if (Math.abs(p.x - 0.5) < 0.02 && p.skip) { p.skip = false; p.kind = 'passer'; say(p, '💬 They\'re always out of stock…', 1.6); break; }
          if (Math.abs(p.x - 0.5) < 0.02) {
            p.x = 0.5; p.state = 'enter'; p.unit = pickUnit(p);
            const spot = unitSpot(UNITS[p.unit]);
            p.path = [[0.5, L.enter]].concat(routeTo({ x: 0.5, y: L.enter }, spot));
          }
          break;
        case 'enter':
          if (walk(p, dt, 0.2)) {
            p.state = 'look'; p.timer = rand(0.7, 1.4); p.facing = 'back';
            if (p.type === 'returner' && !p.greeted) { // straight to the till with something to bring back
              p.greeted = true; p.hold = true; p.state = 'toQueue'; p.path = toAisle(p);
              say(p, pick(['🔁 It\'s broken!', '🔁 Wrong size!', '🔁 It doesn\'t work!']), 2);
              break;
            }
            if (!p.greeted && (r.weather === 'rain' || r.weather === 'snow')) { // wet shoes: mud on the floor by the door
              r.mud = Math.min(1, r.mud + 0.04);
              if (r.mud > 0.45 && Math.random() < 0.3) {
                if (wetSignNear()) say(p, '⚠️ Ooh, careful, it\'s wet!', 1.4);
                else { say(p, '😬 Whoa, slippery!', 1.6); hear('service', -0.8); r.stats.slips = (r.stats.slips || 0) + 1; }
              }
            }
            if (!p.greeted) {
              p.greeted = true; r.greetT = 1.2; // the staff wave hello
              if (p.kind === 'shopper') wordOfMouth(p);
              if (r.basketsNear && Math.random() < 0.25) p.qty++;              // grabbed a basket at the door: buys a bit more
              if (p.group === 'family' && r.furn.some((f) => f.id === 'arcade')) { p.qty++; const kid = r.people.find((c) => c.leader === p && c.child); if (kid) say(kid, '🕹️ Can I play?!', 1.6); }
              if (Math.random() < 0.2 * Math.max(0, doorPull(UNITS[p.unit]))) p.qty++;     // something by the door caught their eye
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
          if (!p.asked && p.type !== 'thief' && Math.random() < (p.group === 'senior' ? 0.3 : 0.15)) {
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
          let pm = mult * linePrice(r.b, p.line) * (p.matched || 1); // the price of the line they want
          // they can see the rival's prices across the road: you match it, or they go over there
          if (r.rival && p.compares && p.type !== 'regular' && pm > r.rival.mult * 1.05) {
            if (r.b.priceMatch) {
              p.matched = r.rival.mult / (mult * linePrice(r.b, p.line)); pm = r.rival.mult;
              say(p, `🤝 ${r.rival.name} is cheaper… you'll match it? Great!`, 1.8); r.stats.matched = (r.stats.matched || 0) + 1;
            } else {
              r.lostPrice++; r.stats.toRival = (r.stats.toRival || 0) + 1; hear('price', -2); leaveShop(p, 'angry', `😒 Cheaper at ${r.rival.name}!`); p.toRival = true;
              break;
            }
          }
          if (shelfTotal() > 0 && !p.considered && Math.random() < (pm > p.limit ? 0.6 : 0.3)) {
            p.considered = true; p.state = 'consider'; p.timer = rand(0.9, 1.5); p.hold = true; react(p, '🤔');
            break;
          }
          if (pm > p.limit) {
            r.lostPrice++; hear('price', -2); react(p, '💸'); memo(p, { dear: true });
            leaveShop(p, 'angry', p.type === 'regular' ? '😤 You raised prices!' : p.type === 'bargain' ? '🏷️ No deals today.' : pick(['😒 Too pricey!', '😒 How much?!', '💸 Nope.']));
            break;
          }
          if (pm < p.limit * 0.85) react(p, '😍');
          if (lineItems(p.line) > 0) {
            if (run.unitLine[p.unit] !== p.line && !p.moved) { // their line is on another shelf: walk over to it
              p.moved = true; p.unit = run.unitLine.findIndex((l, i) => l === p.line && unitItems(i) > 0);
              if (p.unit < 0) p.unit = run.unitLine.indexOf(p.line);
              p.path = routeTo(p, unitSpot(UNITS[p.unit])); p.state = 'enter';
            } else takeGoods(p);
          } else if (shelfTotal() > 0 && !p.subbed && Math.random() < 0.55) { // they'll try another line instead
            p.subbed = true; const was = r.lines[p.line]; hear('stock', -1);
            p.line = r.lines.map((_, i) => i).filter((i) => lineItems(i) > 0).sort((a, b) => lineItems(b) - lineItems(a))[0];
            say(p, `🤷 No ${was}… I'll try ${r.lines[p.line]}`, 1.8); react(p, '🤷');
            p.state = 'look'; p.timer = 0.2; p.moved = false;
          } else if (backTotal() > 0) { p.state = 'wait'; p.wait = 0; p.mood = 'meh'; say(p, `⏳ Any more ${r.lines[p.line]}?`, 99); }
          else { r.lostStock++; hear('stock', -3); memo(p, { out: true }); leaveShop(p, 'sad', `📦 No ${r.lines[p.line]} left?!`); }
          break;
        case 'consider': // holding a pack, reading the label
          p.timer -= dt;
          if (p.timer > 0) break;
          p.hold = false;
          if (mult * linePrice(r.b, p.line) * (p.matched || 1) > p.limit) { // puts it back
            const sl = run.slots.filter((x) => x.u === p.unit && x.n > 0).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
            if (sl) sl.pop = 0.2;
            r.lostPrice++; hear('price', -2); leaveShop(p, 'angry', pick(['😒 Too pricey!', '🤔 Not at that price.']));
          } else p.state = 'look', p.timer = 0;
          break;
        case 'wait': // shelves are empty but there is stock out back
          p.wait += dt;
          if (lineItems(p.line) > 0) { p.bubbleT = 0; takeGoods(p); }
          else if (p.wait > p.patience || backTotal() === 0) { r.lostStock++; hear('stock', -3); memo(p, { out: true }); leaveShop(p, 'sad', `📦 No ${r.lines[p.line]} left?!`); }
          break;
        case 'pick':
          p.timer -= dt;
          if (p.timer <= 0 && p.type === 'thief') { // slips it under their coat and heads for the door
            p.state = 'sneak'; p.hidden = true; say(p, '👀', 1.2); p.exitDir = Math.random() < 0.5 ? -1 : 1;
            p.path = routeTo(p, { x: 0.5, y: L.enter }).concat([[0.5, L.street]]);
          } else if (p.timer <= 0) {
            p.state = 'toQueue'; p.path = toAisle(p);
            say(p, mult * linePrice(r.b, p.line) < p.limit * 0.8 ? pick(['😍 Bargain!', '😍 So cheap!']) : pick(['🙂 Nice.', '🙂 Just what I need.']), 1.4); p.mood = 'happy';
          }
          break;
        case 'sneak':
          if (r.up.gates && p.y < L.enter + 0.015) { catchThief(p, true); break; }
          const gd = guard();
          if (gd && !p.guardTried && metres(p, gd.body) < 1.6) {
            p.guardTried = true;
            if (Math.random() < 0.75 * (gd.energy < 30 ? 0.6 : 1)) { catchThief(p, false); say(gd.body, '✋ Not so fast!', 1.6); break; }
          }
          if (walk(p, dt, 0.26)) { // got away with it
            const res = T.shopLoss(r.s, r.b.id, p.basket);
            r.stats.stolen += res.qty || 0; p.basket = 0; p.hidden = false; p.state = 'leaving'; p.path = [];
            say(p, '😈', 1.5);
            r.police = { x: -0.3 }; sfx.siren(); // the police give chase down the road
            r.effects.push({ kind: 'text', text: `🚨 ${res.qty || 0} stolen!`, x: 0.5, y: L.enter + 0.04, t: 0, color: '#ff6b6b' });
          }
          break;
        case 'toQueue':
          if (walk(p, dt, 0.22)) {
            if (r.up.selfcheck && !r.power && !r.kioskBusy && Math.random() < 0.35) { // uses the self-checkout instead
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
          if (scanned > (p.scanned || 0)) { p.scanned = scanned; sfx.beep(panAt(KIOSK.x, KIOSK.y)); }
          if (p.timer <= 0) { r.kioskBusy = null; finishSale(p, 'kiosk'); }
          break;
        }
        case 'queue': {
          const q = queue(), spot = queueSpot(q.indexOf(p));
          moveToward(p, spot.x, spot.y, dt, 0.25);
          p.facing = 'front';
          p.wait += dt;
          if (p.wait > p.patience * 0.6) { p.mood = 'meh'; if (!p.fumed) { p.fumed = true; react(p, '😤'); } }
          if (p.wait > p.patience) { r.lostWait++; hear('queue', -3); memo(p, { slow: true }); leaveShop(p, 'angry', pick(['😠 Too slow!', '😠 Forget it!'])); sfx.huff(); }
          break;
        }
        case 'returning': // waiting at the till while you decide: refund, swap or refuse
          p.facing = 'front';
          if ((p.timer -= dt) <= 0) resolveReturn('refuse');
          break;
        case 'serving': {
          p.timer -= dt;
          // the scanner beeps for each item
          const scanned = Math.ceil(clamp(1 - p.timer / p.serveDur, 0, 1) * p.basket);
          if (scanned > (p.scanned || 0)) { p.scanned = scanned; sfx.beep(panAt(0.45, L.counter)); }
          if (p.timer <= 0) finishSale(p);
          break;
        }
        case 'leaving':
          if (p.cross !== undefined) { // over the road to the rival's shop
            p.cross = Math.min(1, p.cross + dt / 3.4); p.phase += dt * 8; p.moving = true;
            p.x = p.cx0 + (0.68 - p.cx0) * p.cross; p.y = L.street - (L.street - FRONT.road0 + 0.006) * p.cross;
            if (p.cross >= 1) p.x = 9;
            break;
          }
          if (walk(p, dt, 0.24)) {
            if (p.toRival) { p.cross = 0; p.cx0 = p.x; break; }
            p.x += p.exitDir * 0.14 * dt; p.phase += dt * 8; p.moving = true;
          }
          break;
      }
    }
    for (const c of r.people) {
      if (c.kind !== 'companion') continue;
      const l = c.leader;
      if (!r.people.includes(l)) { c.x = 9; continue; } // their leader has gone
      c.moving = false;
      const atShelf = ['look', 'consider', 'pick', 'wait'].includes(l.state);
      if (zoneOf(c) !== zoneOf(l) || l.climb) { c.x = l.x; c.y = l.y + 0.004; c.climb = l.climb; continue; } // through the arch, up the stairs: right behind them
      c.climb = null;
      moveToward(c, l.x + c.side * (atShelf ? 0.06 : 0.045), l.y + (l.y < L.wall ? 0 : 0.012), dt, 0.32);
      if (!c.moving) c.facing = l.facing;
      c.mood = l.mood;
      if (c.child && atShelf && !c.knocked && Math.random() < dt * 0.05) { // crash! packs all over the floor
        c.knocked = true;
        const near = r.slots.filter((sl) => sl.u === l.unit && sl.n > 0).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x)).slice(0, 3);
        for (const sl of near) { sl.n--; r.floor.push({ x: sl.x + rand(-0.02, 0.02), y: UNITS[sl.u].wall ? L.enter + rand(0.01, 0.03) : UNITS[sl.u].base + rand(0.02, 0.05), n: 1, rot: rand(-1.4, 1.4), line: sl.line }); r.stats.knocked++; }
        if (near.length) { say(c, '💥 Oops!', 1.6); say(l, '😳 Sorry about that!', 1.6); sfx.thud(); }
      }
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
    // dogs wait outside by the door while their owner shops
    for (const d of r.dogs) {
      const o = d.owner, out = o.y < L.wall + 0.002 && r.people.includes(o);
      const tx = out ? o.x - 0.035 : BX(0.36), moving = Math.abs(tx - d.x) > 0.004;
      if (moving) d.x += Math.sign(tx - d.x) * Math.min(Math.abs(tx - d.x), 0.2 * dt);
      d.phase += dt * (moving ? 14 : 6); d.moving = moving;
    }
    r.dogs = r.dogs.filter((d) => r.people.includes(d.owner) || (d.x > -0.1 && d.x < 1.1 && (d.x += (d.x < 0.5 ? -1 : 1) * 0.2 * dt)));
    // something happening in the neighbourhood today
    if (r.event && !opening && r.t >= r.eventAt && r.eventT >= 0) {
      if (r.eventT === 0) startEvent();
      r.eventT += dt;
      if (r.event === 'parade') { for (const m of r.parade) { m.x += 0.13 * dt; m.phase += dt * 9; } if (Math.floor(r.eventT * 2.5) !== Math.floor((r.eventT - dt) * 2.5)) sfx.drum(); }
      const len = r.event === 'power' ? 9 : r.event === 'parade' ? 14 : 99;
      if (r.eventT > len) { r.eventT = -1; r.power = false; if (r.event === 'power') r.effects.push({ kind: 'text', text: '💡 Power back on', x: 0.5, y: 0.45, t: 0, color: '#4ade80' }); }
    }
    stepEvent(dt, opening);
    stepOnline(dt, open);
    if (open) for (const f of r.furn) { // the vending machine and the arcade machine earn a little
      if ((f.id === 'vending' && Math.random() < dt * 0.07) || (f.id === 'arcade' && r.people.some((p) => p.child && p.y > L.wall) && Math.random() < dt * 0.1)) {
        const amt = f.id === 'vending' ? 2 : 1;
        T.shopExtra(r.s, r.b.id, amt); r.stats.extras += amt; r.stats.furnTake = (r.stats.furnTake || 0) + amt;
        r.effects.push({ kind: 'text', text: `${f.id === 'vending' ? '🥫' : '🕹️'} +$${amt}`, x: f.x, y: f.y - 0.06, t: 0, color: '#7fe9ff' });
      }
    }
    if (r.power) r.doorOpen = 1; // the automatic doors stay open in a power cut
    if (r.police && (r.police.x += 0.55 * dt) > 1.4) r.police = null;
    stepClerk(dt);
    stepMe(dt);
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
    if (wantOpen && r.doorOpen === 0) {
      sfx.whoosh();
      if (r.people.some((p) => p.kind === 'shopper' && p.state === 'enter' && nearDoor(p))) sfx.chime(); // ding-dong: someone's come in
    }
    if (!r.power) r.doorOpen = clamp(r.doorOpen + (wantOpen ? 4 : -2.5) * dt, 0, 1);
    // helpers at the till serve the front of the queue on their own
    r.staff.forEach((st, i) => {
      if (st.job !== 'till') return stepStaffJob(st, i, dt);
      if (st.brk > 0) { if ((st.brk -= dt) <= 0) st.energy = 70; return; } // back from a break
      if ((st.timer -= dt) > 0) return;
      const p = queue().find(atTill);
      if (!p) { st.timer = 0.3; return; }
      startServe(p, 0.8, i);
      st.served++; st.energy -= 7;
      // worn out, they fumble: a pack slips off the counter
      if (st.energy < 35 && p.basket > 1 && Math.random() < 0.2) {
        p.basket--; r.floor.push({ x: 0.5 + rand(-0.08, 0.08), y: L.counter - 0.025, n: 1, rot: rand(-1.2, 1.2), line: p.got });
        say(p, `😬 ${st.m.name} dropped one!`, 1.4); r.stats.fumbles = (r.stats.fumbles || 0) + 1; hear('service', -1);
      }
      st.timer = (st.m.skill === 'cashier' ? 3 : STAFF_SERVE) * (st.energy < 40 ? 1.4 : 1) * (0.8 + Math.random() * 0.4);
      if (st.energy < 25) { // worn out: a short break
        st.brk = 8; st.timer = 8.5;
        r.effects.push({ kind: 'text', text: `☕ ${st.m.name} takes a break`, x: 0.25 + i * 0.15, y: L.counter - 0.05, t: 0, color: '#7fe9ff' });
      }
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
    r.people = r.people.filter((p) => (p.x > -0.2 && p.x < 1.2) || p.y > L.wall + 0.01); // off along the street (the annex is inside, off to the right)
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
      // before going home: the night shift, if you want it (the offer goes after a few seconds)
      if (!r.nightDone) {
        if (r.night) stepNight(dt);
        else if (!r.nightOffer) r.nightOffer = { t: 6 };
        else if ((r.nightOffer.t -= dt) <= 0) { r.nightOffer = null; r.nightDone = true; }
        return;
      }
      // closing down: lights dim, shutters come down, the takings are counted
      r.ending = true; r.outro = 3.2;
      finishDay();
    }
  }

  // ---------- the night shift: a quick tidy after closing, for a better rating tomorrow ----------
  const NIGHT_SECONDS = 30;
  function nightShift(yes) {
    const r = run;
    if (!r || !r.nightOffer) return false;
    r.nightOffer = null;
    if (!yes) { r.nightDone = true; return true; }
    r.night = { t: NIGHT_SECONDS, faced: new Set(), bin: false };
    if (!r.me) r.me = { kind: 'me', look: r.sellerLook, x: TILL_SPOT.x, y: TILL_SPOT.y, phase: 0, facing: 'back', carry: 0, state: 'walk', path: [], goal: null };
    r.night.total = nightLeft();
    sfx.pop();
    return true;
  }
  // jobs still to do: scuffs, smudges, dropped packs, shelves to face, the bin
  function nightLeft() {
    const r = run, w = r.b.wear;
    return w.scuffs.length + w.smudges.length + r.floor.length + UNITS.filter((u, i) => (!u.m || u.exp) && unitItems(i) > 0 && !r.night.faced.has(i)).length + (r.night.bin ? 0 : 1);
  }
  function stepNight(dt) {
    const r = run, n = r.night;
    if ((n.t -= dt) <= 0 || nightLeft() === 0) endNight();
  }
  function endNight() {
    const r = run, n = r.night;
    if (!n) return;
    n.tidy = n.total ? clamp(1 - nightLeft() / n.total, 0, 1) : 1;
    r.stats.tidy = n.tidy; r.stats.nightDone = n.total - nightLeft(); r.stats.nightTotal = n.total;
    if (r.me) { pileIn(r.me.carry, r.me.carryLine); r.me.carry = 0; r.me = null; }
    r.night = null; r.nightDone = true; r.away = 0;
    sfx.ching();
  }
  const nightInfo = () => { const r = run; if (!r) return null; if (r.nightOffer) return { offer: true }; if (r.night) return { active: true, left: nightLeft(), total: r.night.total, t: Math.ceil(r.night.t) }; return null; };

  // the stock clerk carries boxes from the pile to the emptiest shelves
  function stepClerk(dt, c = run.clerk) {
    const r = run;
    c.moving = false;
    switch (c.state) {
      case 'idle': {
        // a dropped pack on the floor comes first
        if (r.floor.length) {
          c.target = r.floor[0]; c.state = 'fetch'; c.path = routeTo(c, { x: c.target.x, y: c.target.y - 0.004 });
          break;
        }
        let best = -1, score = 0;
        UNITS.forEach((_, i) => {
          if (unitRoom(i) <= 0 || !(r.bay[r.unitLine[i]] > 0)) return;
          const waiting = r.people.some((p) => p.state === 'wait' && p.line === r.unitLine[i]);
          const sc = unitRoom(i) - unitItems(i) * 0.2 + (waiting ? 1000 : 0);
          if (best < 0 || sc > score) { best = i; score = sc; }
        });
        if (best < 0) {
          // otherwise, wipe a smudged window or mop a scuff now and then
          const w = r.b.wear;
          if (w.smudges.length && Math.random() < dt * 0.08) {
            const sm = pick(w.smudges), [a, b] = FRONT.windows[sm[0]];
            c.target = sm; c.chore = 'wipe'; c.state = 'chore'; c.path = routeTo(c, { x: a + (b - a) * sm[1], y: L.enter });
            break;
          }
          if (r.mud > 0.6 && !r.me && Math.random() < dt * 0.1) {
            c.target = 'mud'; c.chore = 'mop'; c.state = 'chore'; c.path = routeTo(c, MUD_SPOT);
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
        // pick up a box from that line's bay
        c.unit = best; c.carryLine = r.unitLine[best];
        c.carry = pileOut(Math.min(unitRoom(best), r.cap * UNITS[best].cols * 2), c.carryLine);
        const from = { x: PILE.x + 0.08, y: PILE.y - 0.03 };
        c.path = [[from.x, from.y]].concat(routeTo(from, unitSpot(UNITS[best])));
        c.state = 'toShelf';
        break;
      }
      case 'toShelf':
        if (walk(c, dt, 0.28 * r.clerkSpeed)) { c.state = 'stock'; c.timer = 0.1; c.facing = 'back'; }
        break;
      case 'fetch':
        if (walk(c, dt, 0.3)) {
          const i = r.floor.indexOf(c.target);
          if (i >= 0) { c.carry += r.floor[i].n; c.carryLine = r.floor[i].line; r.floor.splice(i, 1); sfx.pop(); }
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
          if (c.target === 'mud') { r.mud = 0; r.stats.mopped = (r.stats.mopped || 0) + 1; }
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
        c.timer = 0.12 / r.clerkSpeed;
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
        if (walk(c, dt, 0.28 * r.clerkSpeed)) { pileIn(c.carry, c.carryLine); c.carry = 0; c.state = 'idle'; }
        break;
    }
  }

  // the delivery van: drives up, the courier carries the boxes in and drops them on the pile
  function stepVan(dt) {
    const r = run;
    if (r.scheduled && r.scheduled.length) { // supplier orders that are due
      const due = r.scheduled.filter((x) => r.t >= x.at || r.ending);
      if (due.length) { r.scheduled = r.scheduled.filter((x) => !due.includes(x)); r.deliveries.push(...due.map((x) => x.units)); }
    }
    if (!r.van && r.deliveries.length) r.van = { x: 1.45, state: 'in', trips: r.deliveries.splice(0), courier: null, wait: 0 };
    const v = r.van;
    if (!v) return;
    if (v.state === 'in') {
      v.x -= Math.max(0.08, (v.x - VAN_X) * 2.6) * dt;
      if (v.x <= VAN_X) { v.x = VAN_X; v.state = 'parked'; sfx.horn(); r.effects.push({ kind: 'text', text: '🚚 Delivery at the back door', x: 0.5, y: 0.5, t: 0, color: '#7fe9ff' }); }
    } else if (v.state === 'parked') {
      if (r.deliveries.length) v.trips.push(...r.deliveries.splice(0));
      const c = v.courier;
      if (!c) {
        if (v.trips.length) {
          v.wait = 0;
          v.courier = {
            kind: 'courier', look: { outfit: 'sunset', skin: (Math.random() * 5) | 0, hair: 'buzz', hairColor: 1 },
            ...(() => { const [x, y] = toFlat(...BACK_PATH[0]); return { x, y }; })(), phase: 0, facing: 'back', box: v.trips.shift(), state: 'carry', trolley: true,
            // in at the back door, round the end of the counter, to the stockroom bays
            path: BACK_PATH.slice(1).map(([X, Z]) => toFlat(X, Z)).concat([[PILE.x, PILE.y + 0.035]]),
          };
        } else if ((v.wait += dt) > 0.6) v.state = 'out';
      } else {
        c.moving = false;
        if (c.state === 'carry' && walk(c, dt, 0.34)) {
          // drop the box onto the pile
          // unload the trolley onto the bays
          r.boxes.push({ x: bayAt((Math.random() * r.bay.length) | 0).x, y: c.y - 0.06, vy: -0.15, ty: bayAt(0).y, units: c.box, bounced: false });
          c.box = 0; c.state = 'return';
          c.path = BACK_PATH.slice().reverse().map(([X, Z]) => toFlat(X, Z));
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
        else { bx.done = true; r.incoming -= bx.units; pileIn(bx.units); } // sorted into the bays
      }
    }
    r.boxes = r.boxes.filter((bx) => !bx.done);
    for (const d of r.dust) { d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; }
    r.dust = r.dust.filter((d) => d.t < 0.6);
  }
  function puff(x, y) {
    for (let i = 0; i < 8; i++) run.dust.push({ x, y, vx: rand(-0.12, 0.12), vy: rand(-0.06, 0), t: 0 });
  }

  // ---------- online orders: they come in on the tablet; pack them and a rider takes them out ----------
  const ONLINE_DUE = 30;   // seconds before a delivery counts as late
  const onlineStock = (o) => run.bay[o.line] + lineItems(o.line) >= o.qty;
  function stepOnline(dt, open) {
    const r = run;
    if (!r.up.online || r.intro > 0) return;
    if (open && r.t >= r.nextOnline && r.online.filter((o) => o.state === 'new').length < 3) {
      r.nextOnline = r.t + rand(12, 22);
      const id = (r.onlineId = (r.onlineId || 0) + 1);
      r.online.push({ id, name: pick(T.NAMES), line: (Math.random() * r.lines.length) | 0, qty: 2 + ((Math.random() * 4) | 0), age: 0, state: 'new' });
      sfx.chime(); r.effects.push({ kind: 'text', text: '📱 New online order!', x: 0.62, y: L.counter - 0.12, t: 0, color: '#7fe9ff' });
    }
    for (const o of r.online) {
      o.age += dt;
      if (o.state === 'new' && o.age > ONLINE_DUE * 1.6) { o.state = 'cancelled'; hear('service', -2); r.stats.onlineLost = (r.stats.onlineLost || 0) + 1; r.effects.push({ kind: 'text', text: `📱 ${o.name} cancelled: too slow`, x: 0.62, y: L.counter - 0.12, t: 0, color: '#ff6b6b' }); }
    }
    r.online = r.online.filter((o) => o.state === 'new' || o.age < ONLINE_DUE * 3);
  }
  // take the goods from the stockroom (then the shelves), ring it up, and send a rider
  function packOrder(id, by) {
    const r = run, o = r && r.online.find((x) => x.id === id && x.state === 'new');
    if (!o) return { ok: false, msg: 'That order has gone.' };
    if (!onlineStock(o)) return { ok: false, msg: `Not enough ${r.lines[o.line]} in stock.` };
    let need = o.qty - pileOut(o.qty, o.line);
    while (need > 0) { const sl = r.slots.filter((x) => x.line === o.line && x.n > 0).sort((a, b) => b.n - a.n)[0]; if (!sl) break; const t = Math.min(need, sl.n); sl.n -= t; need -= t; }
    const res = T.shopSale(r.s, r.b.id, o.qty);
    if (!res.ok) return { ok: false, msg: 'Out of stock.' };
    const late = o.age > ONLINE_DUE, lm = linePrice(r.b, o.line);
    let extra = Math.round((res.revenue * (lm - 1) - res.revenue * lm * 0.15 + 3) * 100) / 100; // its line's price, the platform's 15% cut, a $3 delivery fee
    if (late) extra -= Math.round(res.revenue * lm * 0.3 * 100) / 100; // a late one: 30% back
    T.shopExtra(r.s, r.b.id, extra);
    r.revenue += res.revenue; r.sold += res.qty; r.stats.extras += extra;
    if (r.lineSold[o.line] !== undefined) r.lineSold[o.line] += res.qty;
    o.state = 'sent'; r.stats.online = (r.stats.online || 0) + 1;
    hear('service', late ? -1 : 1.2);
    r.cars.push({ x: 0.5, dir: Math.random() < 0.5 ? 1 : -1, lane: 0.152, speed: 0.4, color: '#ff2a6d', kind: 'scooter' });
    r.effects.push({ kind: 'text', text: `🛵 ${o.qty}× ${r.lines[o.line]} to ${o.name}${late ? ' (late: 30% back)' : ''}`, x: 0.5, y: L.counter - 0.12, t: 0, color: late ? '#ff9f6b' : '#4ade80' });
    sfx.approved();
    return { ok: true, late, by };
  }
  const onlineInfo = () => (run && run.up.online ? run.online.filter((o) => o.state === 'new').map((o) => ({ id: o.id, name: o.name, qty: o.qty, line: run.lines[o.line], left: Math.max(0, Math.ceil(ONLINE_DUE - o.age)), late: o.age > ONLINE_DUE, stock: onlineStock(o) })) : null);

  // ---------- today's challenge events: an inspector, a celebrity, a burst pipe, a food critic ----------
  const banner = (text, color = '#ffd23f') => run.effects.push({ kind: 'text', text, x: 0.5, y: 0.45, t: 0, color });
  const eventDone = (ok, text) => { const r = run; r.eventResult = { ok, text }; banner(text, ok ? '#4ade80' : '#ff6b6b'); if (ok) sfx.approved(); };
  // what the inspector writes down: packs on the floor, mud, scuffs, dirty windows, old stock on the shelves
  function inspectIssues() {
    const r = run, out = [];
    if (r.floor.length) out.push(`${r.floor.length} pack${r.floor.length > 1 ? 's' : ''} on the floor`);
    if (r.mud > 0.4) out.push('a muddy doorway');
    if (r.pipe && !r.pipe.fixed) out.push('a flood');
    if (r.b.wear.scuffs.length > 10) out.push('a scuffed floor');
    if (r.b.wear.smudges.length > 6) out.push('dirty windows');
    if ((T.freshness(r.s, r.b) || {}).expiring > 0) out.push('stock about to go off');
    return out;
  }
  function stepEvent(dt, opening) {
    const r = run, ev = r.event, open = !opening && r.t < DAY_SECONDS;
    if (!ev || opening) return;
    if (ev === 'critic' && !r.criticWarned) { r.criticWarned = true; banner('🕵️ A food critic is in town today…', '#ffd23f'); }
    if ((ev === 'inspector' || ev === 'celebrity') && !r.warned && r.t >= r.eventAt - 9 && r.eventT >= 0) {
      r.warned = true; sfx.click();
      banner(ev === 'inspector' ? '📋 Health inspector on the way!' : '⭐ A celebrity is coming!', '#ffd23f');
    }
    // the inspector walks round, stopping to make notes, then gives the verdict
    const ins = r.inspector;
    if (ins && r.people.includes(ins) && ins.state === 'inspect') {
      if (ins.timer > 0) { ins.timer -= dt; if (ins.timer <= 0) ins.path = ins.stops.length ? routeTo(ins, ins.stops.shift()) : null; }
      else if (walk(ins, dt, 0.17)) {
        if (ins.path === null) { // done: the verdict
          const issues = inspectIssues(), pass = !issues.length;
          if (pass) { hear('service', 6); r.stats.good++; eventDone(true, '✅ Inspection passed! ⭐ Top hygiene score'); say(ins, '📋 Very clean. Well done!', 2); }
          else { T.shopExtra(r.s, r.b.id, -120); r.stats.extras -= 120; hear('service', -4); eventDone(false, `❌ Inspection failed: fined $120 (${issues.slice(0, 2).join(', ')})`); say(ins, '📋 Not good enough…', 2); }
          ins.state = 'leaving'; ins.exitDir = 1; ins.path = routeTo(ins, { x: 0.5, y: L.enter }).concat([[0.5, L.street]]);
        } else { ins.timer = 2; ins.facing = 'back'; say(ins, pick(['📋 Hmm…', '📋 Let me see…', '🔦 Checking…']), 1.6); }
      }
    }
    // a burst pipe: the puddle spreads until someone fixes it, then it dries
    const pp = r.pipe;
    if (pp) {
      pp.t += dt;
      if (!pp.fixed) {
        pp.size = Math.min(1, pp.size + dt * 0.05);
        if (pp.plumber && (pp.plumber -= dt) <= 0) fixPipe('plumber');
      } else pp.size = Math.max(0, pp.size - dt * 0.12);
      for (const p of r.people) { // shoppers who walk through it
        if (p.kind !== 'shopper' || p.splashed || !(pp.size > 0.15) || metres(p, pp) > 0.4 + pp.size * 1.3) continue;
        p.splashed = true; hear('service', -0.6); r.stats.splashed = (r.stats.splashed || 0) + 1;
        say(p, pick(['💦 Ugh, wet socks!', '💦 It\'s flooding in here!', '💦 Eww!']), 1.6); react(p, '💦');
      }
      if (!pp.fixed && pp.t > 30) { pp.fixed = true; T.shopExtra(r.s, r.b.id, -150); r.stats.extras -= 150; hear('service', -3); eventDone(false, '💦 The landlord sent an emergency plumber: −$150'); }
    }
    // the celebrity's verdict comes when they leave
    const cel = r.celeb;
    if (cel && !r.eventResult && cel.state === 'leaving') {
      if (cel.bag) { r.b.buzz = { day: r.s.day + 1, mult: 1.3 }; hear('service', 4); eventDone(true, '📸 The celebrity loved it! Big crowds tomorrow'); }
      else { hear('service', -4); eventDone(false, '😒 The celebrity walked out… the photos are everywhere'); }
    }
    if (!open) return;
  }
  // fix the leak yourself (free) or call a plumber ($80, about 6 seconds)
  function fixPipe(how) {
    const r = run, pp = r && r.pipe;
    if (!pp || pp.fixed) return;
    pp.fixed = true; sfx.click();
    if (how === 'plumber') { T.shopExtra(r.s, r.b.id, -80); r.stats.extras -= 80; eventDone(true, '🔧 The plumber fixed the leak (−$80)'); }
    else { hear('service', 2); eventDone(true, `🔧 You fixed the leak${pp.t < 12 ? ' in no time' : ''}!`); }
  }
  function callPlumber() {
    const r = run, pp = r && r.pipe;
    if (!pp || pp.fixed || pp.plumber) return false;
    pp.plumber = 6; banner('📞 A plumber is on the way ($80)', '#7fe9ff');
    return true;
  }
  // the critic: a shopper like any other, who writes it all up when they leave
  function criticReview(p, bought) {
    const r = run;
    if (r.eventResult) return;
    const pm = (r.b.mult || T.RETAIL) * linePrice(r.b, p.line) * (p.matched || 1);
    let stars = bought ? 5 : 2;
    if (bought) { if ((p.wait || 0) > 4) stars--; if ((p.wait || 0) > 8) stars--; if (pm > p.limit * 0.95) stars--; }
    if (r.floor.length > 2 || r.mud > 0.5 || (r.pipe && !r.pipe.fixed)) stars -= 0.5;
    if (p.helped) stars += 0.5;
    stars = clamp(Math.round(stars * 2) / 2, 1, 5);
    const ok = stars >= 3.5, words = stars >= 4.5 ? '"Quick, friendly, fair prices. A gem."' : stars >= 3.5 ? '"A solid little shop."' : stars >= 2.5 ? '"Fine, but nothing special."' : '"Slow, dear, and I left empty-handed."';
    hear('service', (stars - 3) * 3); hear('price', (stars - 3) * 1.5);
    r.b.buzz = { day: r.s.day + 1, mult: ok ? 1.15 : 0.9 };
    r.critic = { stars, words };
    eventDone(ok, `📰 The critic gives you ${'★'.repeat(Math.round(stars))}${'☆'.repeat(5 - Math.round(stars))}`);
    say(p, '🕵️ (That was the food critic!)', 2.2);
  }
  const eventInfo = () => {
    const r = run;
    if (!r || !r.event) return null;
    if (r.eventResult) return { text: r.eventResult.text, ok: r.eventResult.ok, done: true };
    if (r.event === 'pipe' && r.pipe && !r.pipe.fixed) return { text: r.pipe.plumber ? '💦 Burst pipe: the plumber is coming…' : '💦 Burst pipe! Tap here for a plumber ($80), or 🚶 walk over and fix it', tap: !r.pipe.plumber };
    if (r.event === 'inspector' && (r.warned || r.inspector)) return { text: r.inspector ? '📋 The inspector is looking round…' : '📋 Inspector coming: pick up packs, mop up!' };
    if (r.event === 'celebrity' && (r.warned || r.celeb)) return { text: r.celeb ? '⭐ A celebrity is in! Serve them quickly' : '⭐ A celebrity is on the way…' };
    if (r.event === 'critic') return { text: '🕵️ A food critic is here somewhere: treat everyone well' };
    return null;
  };

  function startEvent() {
    const r = run;
    if (r.event === 'parade') {
      r.parade = Array.from({ length: 12 }, (_, i) => ({ x: -0.04 - i * 0.06, look: randomLook(), flag: CAR_COLORS[i % CAR_COLORS.length], phase: i }));
      r.entrants += 2;
      r.effects.push({ kind: 'text', text: '🎺 A parade is going by!', x: 0.5, y: 0.45, t: 0, color: '#ffd23f' });
    } else if (r.event === 'power') {
      r.power = true;
      r.effects.push({ kind: 'text', text: '⚡ Power cut! Cash only', x: 0.5, y: 0.45, t: 0, color: '#ff6b6b' });
      sfx.click();
    } else if (r.event === 'inspector') { // in a grey suit with a clipboard: two shelves and the stockroom, then the verdict
      const look = Object.assign(randomLook(), { outfit: 'classic', wear: ['clipboard'] });
      const stops = [unitSpot(UNITS[2]), unitSpot(UNITS[3]), { x: PILE.x + 0.1, y: PILE.y - 0.04 }];
      const p = { kind: 'inspector', name: 'Inspector', badge: '📋', state: 'inspect', look, x: 0.5, y: L.street, dir: 1, phase: 0, facing: 'back', stops, timer: 0, path: [[0.5, L.enter]].concat(routeTo({ x: 0.5, y: L.enter }, stops.shift())), mood: 'meh' };
      r.people.push(p); r.inspector = p;
    } else if (r.event === 'celebrity') { // a star in gold and sunglasses, with fans close behind
      const p = addShopper();
      Object.assign(p, { type: 'celeb', badge: '⭐', name: pick(['Nova Star', 'DJ Lumen', 'Kira Blaze', 'Rex Neon']), qty: 3, compares: false, skip: false, patience: 16 });
      p.limit = Math.max(p.limit, 1.9); p.look = Object.assign({}, p.look, { outfit: 'gold', wear: ['shades'] });
      say(p, '😎 Hi everyone!', 2);
      r.celeb = p; r.entrants += 6; r.burst = 6; r.nextSpawn = r.t + 1.2;
    } else if (r.event === 'pipe') { // somewhere on the floor, away from the shelves
      const spots = [[0.3, 0.6], [0.7, 0.6], [0.5, 0.46], [0.25, 0.4], [0.75, 0.4]].filter(([x, y]) => !blocked(x, y, 0.3));
      const [x, y] = pick(spots.length ? spots : [[0.5, 0.46]]);
      r.pipe = { x, y, t: 0, size: 0.05, fixed: false };
      sfx.thud(); banner('💦 A pipe has burst!', '#7fe9ff');
    } else if (r.event === 'critic') { // the next shopper is the critic (you don't know which)
      r.criticNext = true;
    }
  }
  // you decide what to do about a return: refund the money, swap it for a new one, or refuse
  function resolveReturn(choice) {
    const r = run, p = r && r.pendingReturn;
    if (!p) return false;
    r.pendingReturn = null; p.hold = false; r.stats.returns++;
    const price = T.shelfPrice(r.s, r.b);
    if (choice === 'swap' && shelfTotal() > 0) {
      const sl = r.slots.filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
      sl.n--; sl.pop = 0.2;
      T.shopLoss(r.s, r.b.id, 1); r.b.last.stolen--; // a new one goes out of the door
      r.stats.good++; leaveShop(p, 'happy', '😊 Cheers, that\'s great!');
    } else if (choice === 'refuse') {
      r.stats.bad++; hear('service', -3); leaveShop(p, 'angry', '😡 Terrible service!'); sfx.huff();
    } else { // a refund
      T.shopExtra(r.s, r.b.id, -price); r.stats.extras -= price;
      r.stats.good++; leaveShop(p, 'happy', '🙂 Thanks, that\'s fair.');
      r.effects.push({ kind: 'text', text: `🔁 −$${price.toFixed(2)} refund`, x: p.x, y: L.counter - 0.12, t: 0, color: '#ff9f6b' });
    }
    return true;
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
    p.hand = false; p.helped = true; p.qty += 1; p.mood = 'happy'; p.state = 'look'; p.timer = 0.3; hear('service', 2);
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
      pileIn(c.carry, c.carryLine); c.carry = 0; c.tidy = false;
      c.state = 'toTill'; c.path = routeTo(c, { x: 0.72, y: L.counter - 0.02 });
    } else {
      r.till2 = false; c.state = 'idle'; c.x = 0.72; c.y = L.counter - 0.02;
    }
    return r.till2;
  }

  // where a spot in the shop is on screen, left (-1) to right (1): sounds come from there
  function panAt(x, y) {
    const r = run, cv = r.ui.canvas, W = cv.clientWidth || 1;
    if (r.r3d) return clamp((r.r3d.project(x, y, 1)[0] / W) * 2 - 1, -1, 1) * 0.7;
    const zm = r.zoom; return clamp(((x * W * zm.z + zm.tx) / W) * 2 - 1, -1, 1) * 0.7;
  }

  // ---------- walking the floor yourself, while someone else looks after the till ----------
  const TILL_SPOT = { x: 0.6, y: L.counter - 0.02 };
  const covered = () => !!run && ((run.till2 && run.clerk.state === 'till') || run.staff.some((st) => st.job === 'till' && !(st.brk > 0)));
  const canWalk = () => !!run && run.intro <= 0 && !run.ending && (!!run.me || covered());
  // a path across the floor that goes around the islands (along the front of them, or the aisle by the wall shelves)
  function clearLine(a, b) {
    for (let i = 1; i <= 16; i++) { const k = i / 16; if (blocked(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 0.2)) return false; }
    return true;
  }
  function planPath(from, to) {
    if (zoneOf(from) !== 'main' || zoneOf(to) !== 'main') return routeTo(from, to);
    if (clearLine(from, to)) return [[to.x, to.y]];
    const front = Math.max(...UNITS.filter((u) => !u.wall).map((u) => u.base)) + 0.07, rows = [front, L.enter + 0.015];
    for (const y of rows) {
      const a = { x: from.x, y }, b = { x: to.x, y };
      if (clearLine(from, a) && clearLine(a, b) && clearLine(b, to)) return [[a.x, a.y], [b.x, b.y], [to.x, to.y]];
    }
    for (const y of rows) { // across to the centre aisle first
      const a = { x: 0.5, y: from.y }, b = { x: 0.5, y }, c = { x: to.x, y };
      if (clearLine(from, a) && clearLine(b, c) && clearLine(c, to)) return [[a.x, a.y], [b.x, b.y], [c.x, c.y], [to.x, to.y]];
    }
    return routeTo(from, to);
  }
  // a free spot on the floor near (x, y): off the islands, inside the walls, in front of the till
  function floorSpot(x, y) {
    if (zoneOf({ x, y }) !== 'main') { // in the annex or upstairs: keep inside its walls
      const up = zoneOf({ x, y }) === 'up', dx = up ? LEVEL2_DX : 0, X = clamp(xOf(x, y) - dx, ANNEX.X0 + 0.3, ANNEX.X1 - 0.3), Z = clamp(zOf(y), (up ? ANNEX.l2[0] : ANNEX.l2[1]) + 0.3, (up ? ANNEX.l2[1] : ANNEX.Z1) - 0.3);
      const [fx, fy] = fl(X + dx, Z); return { x: fx, y: fy };
    }
    [x, y] = clampProp(x, y);
    y = Math.min(y, L.counter - 0.03);
    if (!blocked(x, y, 0.2)) return { x, y };
    const u = UNITS.find((v) => !v.wall && blocked(x, y, 0.2) && x > v.x0 - 0.08 && x < v.x1 + 0.08) || UNITS[2];
    return { x: clamp(x, u.x0 + 0.02, u.x1 - 0.02), y: u.base + 0.065 };
  }
  // step out from behind the counter, or go back to it
  function toggleWalk() {
    const r = run;
    if (!r || r.intro > 0 || r.ending) return 'no';
    if (r.me) { goBack(); return 'back'; }
    if (!covered()) return 'nocover';
    r.me = { kind: 'me', look: r.sellerLook, x: TILL_SPOT.x, y: TILL_SPOT.y, phase: 0, facing: 'back', carry: 0, state: 'walk', path: [], goal: null };
    r.away = 1; sfx.pop();
    return 'walking';
  }
  function goBack() {
    const me = run.me;
    if (!me || me.state === 'return') return;
    me.goal = null; me.state = 'return'; me.path = planPath(me, TILL_SPOT);
  }
  // walk to a point on the floor, or to someone you tapped (you deal with them when you get there)
  function walkTo(x, y, goal) {
    const me = run.me;
    if (!me || me.state === 'return' || me.state === 'choring') return;
    const t = goal && goal.p ? floorSpot(goal.p.x, goal.p.y + 0.02) : floorSpot(x, y);
    me.goal = goal || null; me.path = planPath(me, t); me.state = 'walk';
  }
  // what you can do where you're standing
  function nearby() {
    const r = run, me = r && r.me;
    if (!me || me.state !== 'walk') return [];
    const acts = [], d = (o) => metres(me, o);
    const thief = r.people.find((p) => p.state === 'sneak' && d(p) < 1.8);
    if (thief) acts.push({ id: 'catch', label: '🚨 Stop thief!', p: thief });
    const hand = r.people.find((p) => p.state === 'help' && d(p) < 1.6);
    if (hand) acts.push({ id: 'help', label: '🙋 Help', p: hand });
    if (me.carry > 0) {
      const ui = UNITS.findIndex((u, i) => r.unitLine[i] === me.carryLine && unitRoom(i) > 0 && d(unitSpot0(u)) < 1.7);
      if (ui >= 0) acts.push({ id: 'stock', label: `🧺 Stock ${r.lines[r.unitLine[ui]]}`, ui });
      if (d({ x: PILE.x, y: PILE.y }) < 1.8) acts.push({ id: 'drop', label: '↩️ Put box back' });
    } else if (r.pile > 0 && d({ x: PILE.x, y: PILE.y }) < 1.8) {
      // the lines that need it most first
      const need = r.lines.map((_, i) => i).filter((i) => r.bay[i] > 0).sort((a, b) => lineItems(a) - lineItems(b));
      for (const l of need.slice(0, 2)) acts.push({ id: 'box' + l, label: `📦 Grab ${r.lines[l]}` });
    }
    const fl = r.floor.find((f) => d(f) < 1.4);
    if (fl) acts.push({ id: 'floor', label: '🫳 Pick up', f: fl });
    const sc = r.b.wear.scuffs.find((w) => d({ x: w[0], y: w[1] }) < 1.2);
    if (sc) acts.push({ id: 'mop', label: '🧽 Mop', w: sc });
    if (r.pipe && !r.pipe.fixed && d(r.pipe) < 1.9) acts.unshift({ id: 'fix', label: '🔧 Fix the leak' });
    if (r.mud > 0.15 && d(MUD_SPOT) < 1.8) acts.unshift({ id: 'mop', label: '🧽 Mop the muddy doorway', w: 'mud' });
    if (me.y < L.enter + 0.06) {
      const sm = r.b.wear.smudges.find((w) => { const [a, b] = FRONT.windows[w[0]]; return Math.abs(me.x - (a + (b - a) * w[1])) < 0.12; });
      if (sm) acts.push({ id: 'wipe', label: '🪟 Wipe window', w: sm });
    }
    if (r.night) { // the night shift: face the shelves, empty the bin
      const ui = UNITS.findIndex((u, i) => (!u.m || u.exp) && unitItems(i) > 0 && !r.night.faced.has(i) && d(unitSpot0(u)) < 1.7);
      if (ui >= 0) acts.unshift({ id: 'face', label: '✨ Face the shelf', ui });
      const bin = PROPS.find((pr) => pr[0] === 'bin');
      if (bin && !r.night.bin && d({ x: bin[1], y: bin[2] }) < 1.4) acts.unshift({ id: 'bin', label: '🗑️ Empty the bin' });
    }
    const reg = r.people.find((p) => p.reg && !p.chatted && p.y > L.wall && !['leaving', 'sneak'].includes(p.state) && d(p) < 1.6);
    if (reg) acts.push({ id: 'chat', label: `💬 Chat to ${reg.name}`, p: reg });
    return acts.slice(0, 3);
  }
  // where you stand to reach a unit (in front of an island, or the aisle by the wall shelves)
  const unitSpot0 = (u) => (u.m ? mSpot(u, (u.m.X0 + u.m.X1) / 2) : { x: (u.x0 + u.x1) / 2, y: u.wall ? L.enter : u.base + 0.065 });
  function doAction(id) {
    const r = run, me = r && r.me;
    if (!me || me.state !== 'walk') return false;
    if (id === 'box') id = nearby().map((x) => x.id).find((x) => x.startsWith('box')) || id; // any line
    const a = nearby().find((x) => x.id === id);
    if (!a) return false;
    if (id === 'catch') catchThief(a.p, false);
    else if (id === 'help') helpShopper(a.p);
    else if (id.startsWith('box')) { me.carryLine = +id.slice(3); me.carry = pileOut(r.cap * 8, me.carryLine); sfx.thud(); }
    else if (id === 'drop') { pileIn(me.carry, me.carryLine); me.carry = 0; sfx.thud(); }
    else if (id === 'stock') {
      let n = Math.min(me.carry, unitRoom(a.ui));
      me.carry -= n;
      while (n > 0) {
        const sl = r.slots.filter((x) => x.u === a.ui && x.n < r.cap).sort((p, q) => p.n - q.n || p.row - q.row)[0];
        const add = Math.min(n, r.cap - sl.n, Math.max(1, Math.ceil(r.cap / 3)));
        sl.n += add; n -= add; sl.pop = 0.3;
      }
      me.state = 'choring'; me.chore = 'stock'; me.timer = 0.6; me.facing = 'back'; sfx.pop();
    } else if (id === 'floor') { // into your box if it's the same line, otherwise tucked back into the stockroom
      r.floor.splice(r.floor.indexOf(a.f), 1);
      if (me.carry > 0 && me.carryLine !== a.f.line) pileIn(a.f.n, a.f.line); else { me.carry += a.f.n; me.carryLine = a.f.line; }
      sfx.pop();
    } else if (id === 'fix') { // turn the water off and patch the pipe
      me.state = 'choring'; me.chore = 'mop'; me.timer = 1.5; me.facing = 'front'; me.task = { id: 'fix' };
    } else if (id === 'face' || id === 'bin') { // tidy the packs to the front, or empty the bin
      me.state = 'choring'; me.chore = 'wipe'; me.timer = 0.9; me.facing = 'back'; me.task = { id, ui: a.ui };
      if (id === 'face') for (const sl of r.slots) if (sl.u === a.ui && sl.n > 0) sl.pop = 0.25;
    } else if (id === 'mop' || id === 'wipe') {
      me.state = 'choring'; me.chore = id; me.timer = 1.1; me.target = a.w; me.facing = id === 'wipe' ? 'back' : 'front';
    } else if (id === 'chat') { // a chat with a regular: happier, more patient, and they might buy one more
      const p = a.p; p.chatted = true; p.mood = 'happy'; p.patience *= 1.5;
      if (Math.random() < 0.5) p.qty++;
      say(p, pick(['😊 Always nice to see you!', '😄 How\'s business?', '💜 Best shop in town!']), 1.8); say(me, '👋 Hi ' + p.name + '!', 1.4);
      react(p, '💜'); r.stats.chats = (r.stats.chats || 0) + 1; hear('service', 1.5);
    }
    try { navigator.vibrate && navigator.vibrate(10); } catch { /* ignore */ }
    return true;
  }
  function stepMe(dt) {
    const r = run, me = r.me;
    if (!me) return;
    me.moving = false; r.away = 1;
    if (me.bubbleT !== undefined) me.bubbleT -= dt;
    if (r.ending && me.state !== 'return') goBack();
    if (r.night) r.away = 0;
    if (me.state === 'choring') {
      me.timer -= dt; me.phase += dt * 16;
      if (me.timer <= 0) {
        if (me.task && me.task.id === 'fix') { fixPipe('you'); me.task = null; }
        else if (me.task) { if (r.night) { if (me.task.id === 'face') r.night.faced.add(me.task.ui); else r.night.bin = true; } me.task = null; }
        else if (me.chore === 'mop' && me.target === 'mud') { r.mud = 0; r.stats.mopped = (r.stats.mopped || 0) + 1; hear('service', 1); }
        else if (me.chore === 'mop' || me.chore === 'wipe') { const list = me.chore === 'wipe' ? r.b.wear.smudges : r.b.wear.scuffs, i = list.indexOf(me.target); if (i >= 0) list.splice(i, 1); }
        me.state = 'walk';
      }
      return;
    }
    const step = Math.floor(me.phase / 3);
    const arrived = walk(me, dt, 0.3);
    if (Math.floor(me.phase / 3) !== step) sfx.step(0.03, panAt(me.x, me.y));
    if (me.state === 'return') { if (arrived) { pileIn(me.carry, me.carryLine); me.carry = 0; r.me = null; r.away = 0.3; } return; }
    // someone you tapped: keep after them (a shoplifter keeps moving), and deal with them when close
    const g = me.goal;
    if (g && g.p) {
      if (!r.people.includes(g.p) || !['sneak', 'help'].includes(g.p.state) && g.kind !== 'chat') { me.goal = null; return; }
      if (metres(me, g.p) < (g.kind === 'catch' ? 1.8 : 1.5)) { me.goal = null; doAction(g.kind); }
      else if ((g.re = (g.re || 0) - dt) <= 0) { g.re = 0.35; me.path = planPath(me, floorSpot(g.p.x, g.p.y + 0.02)); }
    }
  }

  // ---------- orders: a regular asks you to have some of a line ready by a day ----------
  function loseOrder(rq) {
    const r = run, b = r.b;
    b.requests = b.requests.filter((x) => x !== rq);
    b.regulars = b.regulars.filter((g) => g.name !== rq.name); // they won't be back
    r.ordersLost.push(rq.name);
  }
  // they come in, go to their line's shelf, and take the whole order to the till
  function addCollector(rq) {
    const r = run;
    addShopper();
    const p = r.people.filter((x) => x.kind === 'shopper').at(-1), g = r.b.regulars.find((x) => x.name === rq.name);
    Object.assign(p, { type: 'regular', badge: '📝', name: rq.name, reg: g || null, look: g ? g.look : p.look, line: rq.line, qty: rq.qty, limit: T.RETAIL * 9, order: rq, patience: p.patience * 1.6 });
  }
  // after a sale, a regular may ask for an order
  function maybeAsk(p) {
    const r = run, b = r.b;
    if (!p.reg || p.order || r.pendingRequest || b.requests.length >= 3 || b.requests.some((x) => x.name === p.name) || Math.random() > 0.3) return;
    const line = (Math.random() * r.lines.length) | 0, qty = Math.max(3, Math.round(r.qtyMean * rand(2.5, 4))), days = 2 + ((Math.random() * 3) | 0);
    r.pendingRequest = { p, line, qty, due: r.s.day + days, t: 10 };
    say(p, `📝 Could you get ${qty}× ${r.lines[line]} by day ${r.s.day + days}?`, 4);
  }
  function answerRequest(yes) {
    const r = run, q = r && r.pendingRequest;
    if (!q) return false;
    r.pendingRequest = null;
    if (yes) {
      r.b.requests.push({ name: q.p.name, line: q.line, qty: q.qty, due: q.due, made: r.s.day });
      say(q.p, '👍 Brilliant, see you then!', 1.8); sfx.ching();
    } else say(q.p, '😕 Oh well…', 1.4);
    return true;
  }
  const requestInfo = () => { const q = run && run.pendingRequest; return q ? { name: q.p.name, qty: q.qty, line: run.lines[q.line], due: q.due } : null; };

  // ---------- your team: each helper has a job you can change in the shop ----------
  const JOBS = { till: '🧾 Till', stock: '📦 Restock', door: '🚪 Door', online: '📱 Online orders', break: '☕ Break' };
  const DOOR_SPOT = { x: 0.57, y: L.enter + 0.03 };
  const guard = () => run.staff.find((st) => st.job === 'door' && st.body && st.body.state === 'guard');
  function setJob(i, job) {
    const r = run, st = r && r.staff[i];
    if (!st || !JOBS[job] || r.ending) return false;
    if (st.job === job) return true;
    st.job = job; st.brk = 0;
    if (job === 'online' && !r.up.online) { st.job = 'till'; return false; }
    if (job === 'till' || job === 'break' || job === 'online') { // back behind the counter
      if (st.body) { const b = st.body; pileIn(b.carry, b.carryLine); b.carry = 0; b.state = 'leave'; b.path = planPath(b, TILL_SPOT); }
    } else {
      const b = st.body || (st.body = { kind: 'staffer', look: st.look, x: TILL_SPOT.x, y: TILL_SPOT.y, phase: 0, facing: 'back', carry: 0, name: st.m.name, i });
      if (job === 'stock') { b.state = 'idle'; b.path = []; } else { b.state = 'toDoor'; b.path = planPath(b, DOOR_SPOT); }
    }
    sfx.pop();
    return true;
  }
  function stepStaffJob(st, i, dt) {
    const r = run, b = st.body;
    if (st.job === 'break') st.energy = Math.min(100, st.energy + dt * 9);
    else st.energy = Math.max(0, st.energy - dt * (st.job === 'stock' ? 0.7 : 0.35));
    if (st.job === 'online') { // packs online orders at the counter, one every few seconds
      st.energy = Math.max(0, st.energy - dt * 0.4);
      if ((st.timer -= dt) <= 0) { st.timer = 4.5 * (st.energy < 30 ? 1.4 : 1); const o = r.online.find((x) => x.state === 'new' && onlineStock(x)); if (o) packOrder(o.id, st.m.name); }
    }
    if (st.job === 'break' && st.energy >= 100) { setJob(i, 'till'); r.effects.push({ kind: 'text', text: `💪 ${st.m.name} is back on the till`, x: 0.5, y: L.counter - 0.1, t: 0, color: '#4ade80' }); }
    if (!b) return;
    b.moving = false;
    if (b.bubbleT !== undefined) b.bubbleT -= dt;
    if (b.state === 'leave') { if (walk(b, dt, 0.3)) st.body = null; return; }
    if (st.job === 'stock') {
      const sp = r.clerkSpeed; r.clerkSpeed = sp * (st.energy < 30 ? 0.7 : 1); // tired: slower
      stepClerk(dt, b); r.clerkSpeed = sp;
      // too tired, they fumble a pack while stocking
      if (b.state === 'stock' && st.energy < 20 && b.carry > 0 && Math.random() < dt * 0.4) {
        b.carry--; r.floor.push({ x: b.x + rand(-0.02, 0.02), y: b.y + 0.01, n: 1, rot: rand(-1.2, 1.2), line: b.carryLine }); say(b, '😵 Whoops…', 1.2);
      }
    } else if (st.job === 'door') {
      if (b.state === 'toDoor' && walk(b, dt, 0.3)) { b.state = 'guard'; b.facing = 'back'; }
      if (b.state === 'guard') b.facing = 'back';
    }
  }
  // the team, for the sheet: names, skills, energy, morale, job
  const team = () => (run ? run.staff.map((st, i) => ({ i, name: st.m.name, skill: st.m.skill, icon: T.SKILLS[st.m.skill].icon, energy: Math.round(st.energy), morale: Math.round(st.m.morale), job: st.job, brk: st.brk > 0, served: st.served })) : []);

  // who: -1 for you, or the helper's index
  function startServe(p, time, who = -1) {
    if (p.type === 'returner') { // a return, not a sale
      p.state = 'returning'; p.timer = 9;
      run.pendingReturn = p;
      if (who !== -1) resolveReturn('refund'); // your staff just refund it
      return;
    }
    p.state = 'serving'; p.timer = time; p.serveDur = time; p.servedBy = who; p.scanned = 0;
  }

  function finishSale(p, via) {
    const r = run;
    const res = T.shopSale(r.s, r.b.id, p.basket);
    if (!res.ok) { r.lostStock++; leaveShop(p, 'sad', '📦 Out of stock?!'); return; }
    p.basket = 0;
    const avg = r.served ? r.revenue / r.served : 0;
    r.served++; r.sold += res.qty; r.revenue += res.revenue;
    if (p.group && r.groups[p.group]) r.groups[p.group].served++;
    r.stats.waits.push(p.wait || 0);
    if (Number.isInteger(p.got) && r.lineSold[p.got] !== undefined) r.lineSold[p.got] += res.qty;
    r.hourSold[clamp(Math.floor(dayK() * 12), 0, 11)] += res.qty; // 9:00 to 21:00, by the hour
    if (p.bogo && p.got === p.line && res.qty > 1) { // the free ones
      const free = Math.floor(res.qty / 2), off = -Math.round((res.revenue / res.qty) * free * 100) / 100;
      T.shopExtra(r.s, r.b.id, off); r.revenue += off; res.revenue += off; r.stats.bogo = (r.stats.bogo || 0) + free;
    }
    const lm = (Number.isInteger(p.got) ? linePrice(r.b, p.got) : 1) * (p.matched && p.got === p.line ? p.matched : 1);
    if (Math.abs(lm - 1) > 0.001) { const diff = Math.round(res.revenue * (lm - 1) * 100) / 100; T.shopExtra(r.s, r.b.id, diff); r.revenue += diff; res.revenue += diff; }
    if ((p.wait || 0) < 2.5 && via !== 'kiosk') react(p, '⚡');
    { // what they'll tell their friends
      const pm = (r.b.mult || T.RETAIL) * (Number.isInteger(p.got) ? linePrice(r.b, p.got) : 1);
      hear('queue', (p.wait || 0) < 3 ? 1.5 : (p.wait || 0) > p.patience * 0.6 ? -1 : 0.3);
      hear('price', pm < p.limit * 0.85 ? 1.2 : pm > p.limit * 0.95 ? -0.5 : 0.3);
      hear('service', 0.8 + (r.furn.some((f) => f.id === 'bigplant') ? 0.3 : 0));
      memo(p, { mult: pm, wait: p.wait || 0, out: false, dear: false, slow: false });
    }
    if (r.b.side && r.b.side.stock > 0 && Math.random() < 0.3) { // one from the side counter, as they pay
      const sd = T.sideSale(r.s, r.b.id, Math.random() < 0.3 ? 2 : 1);
      if (sd.ok) { r.stats.extras += sd.rev; r.stats.side = (r.stats.side || 0) + sd.q; r.effects.push({ kind: 'text', text: `${T.G[r.b.side.good].icon} +$${sd.rev.toFixed(2)}`, x: SIDE.x, y: SIDE.y - 0.06, t: 0, color: '#ffd23f' }); }
    }
    if (r.candyNear && Math.random() < 0.15) { p.extra += 1.5; r.effects.push({ kind: 'text', text: '🍬 +$1.50', x: p.x - 0.08, y: L.counter - 0.16, t: 0, color: '#ff8fcf' }); }
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
    const card = !r.power && (via === 'kiosk' || Math.random() < 0.6), total = res.revenue;
    r.stats.reducedSold += res.reduced || 0; if (res.reduced) r.reduced = Math.max(0, r.reduced - res.reduced);
    const price = res.revenue / res.qty;
    if (p.reg) { // a regular's stamp card: every fifth visit, one is free
      p.reg.visits = (p.reg.visits || 0) + 1; p.reg.stamps = (p.reg.stamps || 0) + 1;
      if (p.reg.stamps >= 5) { p.reg.stamps = 0; T.shopExtra(r.s, r.b.id, -price); r.stats.extras -= price; r.stats.rewards++; say(p, '🎁 Free one on my stamp card!', 2); }
    } else if (!['thief', 'returner', 'caught'].includes(p.type) && r.b.regulars.length < (r.up.loyalty ? 14 : 10) && Math.random() < (r.up.loyalty ? 0.2 : 0.12)) {
      r.b.regulars.push({ name: p.name, look: p.look, group: p.group, stamps: 1, visits: 1 }); r.stats.newRegulars++;
      say(p, `💳 I'll be back! (${p.name})`, 2);
    }
    if (p.order) { // a collected order: they pay a third more for you getting it in
      const bonus = Math.round(res.revenue * 0.3 * 100) / 100;
      T.shopExtra(r.s, r.b.id, bonus); r.stats.extras += bonus; r.stats.orders = (r.stats.orders || 0) + 1;
      r.b.requests = r.b.requests.filter((x) => x !== p.order);
      say(p, '📝 My order! Thank you!', 2);
      r.effects.push({ kind: 'text', text: `📝 Order collected +$${bonus.toFixed(2)}`, x: p.x, y: L.counter - 0.18, t: 0, color: '#4ade80' });
    } else maybeAsk(p);
    if (p.type === 'influencer') { // a haul video brings more shoppers tomorrow
      r.b.buzz = { day: r.s.day + 1, mult: 1.12 }; r.stats.haul = true;
      say(p, '🎥 Haul video! Like and subscribe!', 2.2);
      r.effects.push({ kind: 'text', text: '📱 Going viral: more shoppers tomorrow!', x: 0.5, y: L.counter - 0.2, t: 0, color: '#9b5de5' });
    }
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
  // a point on screen to a point in the shop, undoing the zoom and camera
  const toWorld = (x, y) => {
    if (run.r3d || !run.inv || !window.DOMPoint) return [x, y];
    const q = run.inv.transformPoint(new DOMPoint(x * run.dpr, y * run.dpr));
    return [q.x, q.y];
  };
  const staffAt = (wx, wy, W, H) => { const saved = run.people; run.people = run.staff.filter((st) => st.body).map((st) => st.body); const hit = personAt(wx, wy, W, H, () => true); run.people = saved; return hit; };
  function personAt(wx, wy, W, H, test) {
    if (run.r3d) { // wx, wy are on the screen
      const hits3 = run.people.filter((p) => { if (!test(p)) return false; const [x, y, s] = onScreen(p); return Math.abs(wx - x) < s * 0.6 && wy < y + 6 && wy > y - s * 2.1; });
      return hits3.sort((a, b) => b.y - a.y)[0];
    }
    const hits = run.people.filter((p) => test(p) && Math.abs(wx - (p.x + (p.ox || 0)) * W) < scaleAt(p.y, H) * 0.6 && wy < p.y * H + 6 && wy > p.y * H - scaleAt(p.y, H) * 2.1);
    return hits.sort((a, b) => b.y - a.y)[0];
  }
  // a finger down on the stock pile picks up a box to carry
  function pointerDown(x, y) {
    const r = run;
    if (!r || r.intro > 0 || r.ending || r.me) return 'none';
    const W = r.ui.canvas.clientWidth, H = r.ui.canvas.clientHeight, [wx, wy] = toWorld(x, y);
    if (r.r3d) {
      const [px, py, ppm] = r.r3d.project(PILE.x, PILE.y, 0.4);
      if (r.pile > 0 && Math.abs(x - px) < ppm * 0.9 && Math.abs(y - py) < ppm * 0.7) { r.drag = { x, y }; r.away = 99; return 'drag'; }
      return 'none';
    }
    const s = scaleAt(PILE.y, H);
    if (r.pile > 0 && Math.abs(wx - PILE.x * W) < s * 0.9 && wy < PILE.y * H + 8 && wy > PILE.y * H - s * 1.1) {
      r.drag = { x: wx, y: wy }; r.away = 99; // you leave the till to carry it
      return 'drag';
    }
    return 'none';
  }
  // a tap: catch a shoplifter, help a raised hand, look at a shopper, or serve the queue
  function tap(x, y) {
    const r = run;
    if (!r || r.intro > 0 || r.ending) return 'none';
    const W = r.ui.canvas.clientWidth, H = r.ui.canvas.clientHeight, [wx, wy] = toWorld(x, y);
    if (r.me) { // out on the floor: tap someone to go to them, or anywhere to walk there
      const thief = personAt(wx, wy, W, H, (p) => p.state === 'sneak'), asker = personAt(wx, wy, W, H, (p) => p.state === 'help');
      const reg = personAt(wx, wy, W, H, (p) => p.reg && !p.chatted && p.y > L.wall);
      const who = thief || asker || reg;
      if (who) { walkTo(0, 0, { p: who, kind: thief ? 'catch' : asker ? 'help' : 'chat' }); return 'walk'; }
      const f = r.r3d ? r.r3d.toFlatAt(x, y) : [wx / W, wy / H];
      if (f && f[1] > L.wall) { walkTo(f[0], f[1]); return 'walk'; }
      return 'none';
    }
    const thief = personAt(wx, wy, W, H, (p) => p.state === 'sneak');
    if (thief) { catchThief(thief, false); return 'caught'; }
    if (staffAt(wx, wy, W, H)) return 'team';
    const asker = personAt(wx, wy, W, H, (p) => p.state === 'help');
    if (asker) { helpShopper(asker); return 'help'; }
    const who = personAt(wx, wy, W, H, (p) => (p.kind === 'shopper' || p.kind === 'companion') && p.y > L.wall && !atTill(p) && p.state !== 'returning');
    if (who) { r.info = { p: who.kind === 'companion' ? who.leader : who, t: 3 }; return 'info'; }
    return serve() ? 'serve' : 'none';
  }
  // pinch to zoom (1x to 2.4x) and drag to look around
  function zoomBy(f, sx, sy) {
    const r = run; if (!r) return;
    if (r.r3d) { r.r3d.zoom(f, sx, sy); viewMoved(); return; }
    const W = r.ui.canvas.clientWidth, H = r.ui.canvas.clientHeight, zm = r.zoom, z2 = clamp(zm.z * f, 1, 2.4);
    zm.tx = sx - ((sx - zm.tx) / zm.z) * z2; zm.ty = sy - ((sy - zm.ty) / zm.z) * z2; zm.z = z2;
    panBy(0, 0, W, H);
  }
  function panBy(dx, dy) {
    const r = run; if (!r) return;
    if (r.r3d) { r.r3d.pan(dx, dy); viewMoved(); return; }
    const W = r.ui.canvas.clientWidth, H = r.ui.canvas.clientHeight, zm = r.zoom;
    zm.tx = clamp(zm.tx + dx, W - W * zm.z, 0); zm.ty = clamp(zm.ty + dy, H - H * zm.z, 0);
  }
  // the 3D view turned or zoomed: the HUD shows a reset button
  const viewMoved = () => { const r3 = run.r3d; run.zoom.z = Math.max(r3.zoomLevel(), r3.rotated() ? 1.02 : 1); };
  // one finger turns the 3D shop round (all the way); in the drawn shop it slides the zoomed view
  function orbit(dx, dy) { const r = run; if (!r) return; if (r.r3d) { r.r3d.orbit(dx, dy); viewMoved(); } else panBy(dx, dy); }
  // photo mode: a picture of the shop as it is
  function snapshot() {
    const r = run; if (!r) return null;
    if (r.r3d) return r.r3d.snapshot();
    draw(); return r.ui.canvas.toDataURL('image/jpeg', 0.92);
  }
  function resetZoom() { if (run) { run.zoom = { z: 1, tx: 0, ty: 0 }; if (run.r3d) run.r3d.resetView(); } }
  function pointerMove(x, y) { if (run && run.drag) { const [wx, wy] = toWorld(x, y); run.drag.x = wx; run.drag.y = wy; } }
  function pointerUp() {
    const r = run;
    if (!r || !r.drag) return 'none';
    const W = r.ui.canvas.clientWidth, H = r.ui.canvas.clientHeight, { x, y } = r.drag;
    r.drag = null; r.away = 0.8; // back to the till in a moment
    const ui = r.r3d ? r.r3d.unitAt(x, y) : UNITS.findIndex((u) => x >= u.x0 * W && x <= u.x1 * W && y >= (u.top - 0.05) * H && y <= (u.base + 0.04) * H);
    if (ui < 0 || unitRoom(ui) <= 0) return 'none';
    let n = pileOut(Math.min(unitRoom(ui), r.cap * UNITS[ui].cols * 2), r.unitLine[ui]);
    if (n <= 0) { r.effects.push({ kind: 'text', text: `📦 No ${r.lines[r.unitLine[ui]]} in the stockroom`, x: 0.5, y: 0.5, t: 0, color: '#ff9f6b' }); return 'none'; }
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
  function order(key, qty) {
    const r = run;
    if (!r) return { ok: false };
    const res = T.orderStock(r.s, r.b.id, key, qty);
    if (!res.ok) return res;
    r.incoming += res.got; // in your stock from now, on the way by van
    const trips = clamp(Math.ceil(res.got / (r.cap * 8)), 1, 4), at = r.t + res.delay;
    for (let i = 0; i < trips; i++) {
      const share = Math.floor(res.got / trips) + (i < res.got % trips ? 1 : 0);
      if (share) (r.scheduled = r.scheduled || []).push({ at, units: share });
    }
    return res;
  }
  function setPrice(mult) { if (!run) return; T.setShelfPrice(run.s, run.b.id, mult); }
  const frontWaiting = () => !!(run && queue().some(atTill));

  // ---------- drawing ----------
  // packs near their sell-by date carry a half-price sticker (the oldest are put out front)
  function markStickers() {
    const r = run;
    r.stickers = new Set();
    if (r.reduced > 0) {
      let left = r.reduced;
      for (const sl of r.slots.slice().sort((a, c) => a.row - c.row || a.u - c.u || a.x - c.x)) { if (left <= 0) break; if (sl.n > 0) { r.stickers.add(sl); left -= sl.n; } }
    }
  }
  function draw() {
    const r = run, cv = r.ui.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, r.dprCap || 2), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return; // not laid out yet
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const G = T.G[r.b.good], art = window.NeonShopArt;
    r.dpr = dpr;

    ctx.fillStyle = '#0d0420'; ctx.fillRect(0, 0, W, H);
    // a camera move: a short zoom on a big sale, or on the van arriving
    // your own zoom and pan (pinch and drag), then any camera move on top
    ctx.translate(r.zoom.tx, r.zoom.ty); ctx.scale(r.zoom.z, r.zoom.z);
    if (r.cam) {
      const z = 1 + (r.cam.z - 1) * Math.sin(Math.PI * clamp(r.cam.t / r.cam.dur, 0, 1));
      const cx = r.cam.x * W, cy = r.cam.y * H;
      ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-cx, -cy);
    }
    try { r.inv = ctx.getTransform().inverse(); } catch { r.inv = null; }
    drawStreet(ctx, W, H);
    // people outside, seen through the windows
    const outside = (p) => p.y < L.wall - 0.001;
    const courier = r.van && r.van.courier;
    for (const p of r.people.filter(outside)) drawPerson(ctx, p, W, H, G);
    if (courier && outside(courier)) drawPerson(ctx, courier, W, H, G);
    for (const d of r.dogs) drawDog(ctx, d, W, H);
    // the still parts come from cached layers (not when zoomed in, so they stay sharp)
    const cache = r.zoom.z < 1.05, K = `${W}x${H}@${dpr}`, k = dayK(), night = nightAt(k);
    if (cache) {
      const open = !r.closed && r.intro <= 0.3;
      blit(ctx, layer('back', [K, r.b.wear.smudges.length, r.b.wear.scuffs.length, open, onSale(), Math.round(night * 10), k > 0.6, Math.round(r.lights * 5), r.power, r.decor.sign.id, r.decor.floor.id, r.weather].join('|'),
        (g) => { drawStorefront(g, W, H, G, 'static'); drawFloor(g, W, H); }, [0, 0, W, L.counter * H + 2]));
      drawStorefront(ctx, W, H, G, 'live');
    } else { drawStorefront(ctx, W, H, G); drawFloor(ctx, W, H); }
    UNITS.forEach((u, i) => { if (u.wall && !u.m) drawUnitCached(ctx, u, i, W, H, G, cache); });
    if (cache) blit(ctx, layer('fridge', K, (g) => drawFridge(g, W, H), [(FRIDGE.x0 - 0.06) * W, (FRIDGE.top - 0.02) * H, (FRIDGE.x1 - FRIDGE.x0 + 0.1) * W, (FRIDGE.base - FRIDGE.top + 0.04) * H]));
    else drawFridge(ctx, W, H);
    drawDoor(ctx, W, H);
    drawShutters(ctx, W, H);
    if (cache) {
      blit(ctx, layer('walls', [K, r.decor.walls.id, r.b.tier, Math.round(night * 10), Math.round(r.lights * 10)].join('|'), (g) => { drawSideWalls(g, W, H); drawLamps(g, W, H); }, [0, 0, W, 0.68 * H]));
    } else { drawSideWalls(ctx, W, H); drawLamps(ctx, W, H); }

    // inside: shelf islands, the stock pile and people, far to near
    const items = [];
    UNITS.forEach((u, i) => { if (!u.wall && (!u.m || u.exp)) items.push({ y: u.base, draw: () => drawUnitCached(ctx, u, i, W, H, G, cache) }); });
    items.push({ y: bayAt(0).y, draw: () => drawPile(ctx, W, H, G) });
    const plants = r.decor.plants.id;
    for (const [kind, x, y] of holidayProps()) items.push({ y, draw: () => drawHolidayProp(ctx, kind, x, y, W, H) });
    for (const f of r.furn) items.push({ y: f.y, draw: () => drawFurn(ctx, f, W, H) });
    for (const [kind, x, y] of PROPS.concat(plants === 'jungle' ? JUNGLE : [])) {
      if (kind === 'plant' && plants === 'none') continue;
      items.push({ y, draw: () => drawProp(ctx, kind, x, y, W, H) });
    }
    // shop upgrades you can see
    if (r.up.selfcheck) items.push({ y: KIOSK.y, draw: () => drawKiosk(ctx, W, H) });
    if (r.b.side) items.push({ y: SIDE.y, draw: () => drawSide(ctx, W, H) });
    if (r.up.coffee) { items.push({ y: COFFEE.y, draw: () => drawCoffee(ctx, W, H) }); items.push({ y: TABLE.y, draw: () => drawTable(ctx, W, H) }); }
    if (r.up.gates) for (const gx of [FRONT.door[0] + 0.01, FRONT.door[1] - 0.01]) items.push({ y: L.door + 0.02, draw: () => drawGate(ctx, gx, W, H) });
    // packs dropped on the floor
    if (r.pipe && r.pipe.size > 0.01) items.push({ y: r.pipe.y - 0.05, draw: () => drawPuddle(ctx, W, H) });
    for (const f of r.floor) items.push({ y: f.y, draw: () => { ctx.save(); ctx.translate(f.x * W, f.y * H); ctx.rotate(f.rot); art.pack(ctx, r.b.good, 0, 2, scaleAt(f.y, H) * 0.3, 0, dpr); ctx.restore(); } });
    for (const p of r.people) if (!outside(p)) items.push({ y: p.y, draw: () => drawPerson(ctx, p, W, H, G) });
    items.push({ y: r.clerk.y, draw: () => drawPerson(ctx, r.clerk, W, H, G) });
    if (r.me) items.push({ y: r.me.y, draw: () => drawPerson(ctx, r.me, W, H, G) });
    for (const st of r.staff) if (st.body) items.push({ y: st.body.y, draw: () => drawPerson(ctx, st.body, W, H, G) });
    for (const pr of r.promos) items.push({ y: pr.y, draw: () => drawPromo(ctx, pr, W, H) });
    if (courier && !outside(courier) && courier.y < L.counter - 0.01) items.push({ y: courier.y, draw: () => drawPerson(ctx, courier, W, H, G) });
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
    if (cache) {
      blit(ctx, layer('counter', K, (g) => drawCounter(g, W, H, G, 'static'), [0, (L.counter - 0.07) * H, W, (1 - L.counter + 0.07) * H]));
      drawCounter(ctx, W, H, G, 'live');
    } else drawCounter(ctx, W, H, G);
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
    drawInfo(ctx, W, H, G);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScreen(ctx, W, H);
    ctx.textAlign = 'start';
  }

  // over everything, in screen space: a power cut, the rush badge, lights off, opening and closing
  function drawScreen(ctx, W, H, lit) {
    const r = run;
    if (r.power && !lit) { ctx.fillStyle = 'rgba(5,2,15,.45)'; ctx.fillRect(0, 0, W, H); } // a power cut: just daylight from the windows
    if (!r.intro && !r.ending && !r.closed && rushRate(dayK()) / RUSH_AVG > 1.35) {
      ctx.fillStyle = 'rgba(255,90,40,.9)'; roundRect(ctx, 8, H * 0.29, 92, 18, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 11px system-ui, sans-serif'; ctx.fillText('🔥 Rush hour!', 54, H * 0.29 + 13);
    }
    // lights off before opening and after closing
    if (r.lights < 1 && !lit) { ctx.fillStyle = `rgba(5,2,15,${(1 - r.lights) * 0.6})`; ctx.fillRect(0, 0, W, H); }
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
  }

  // ---------- the 3D view: the shop itself is drawn by shop3d.js; this draws what goes over it ----------
  // where a person stands on screen, and how big they are (s: about half their height in pixels)
  function onScreen(p) {
    const [x, y, ppm, vis] = run.r3d.project(p.x + (p.ox || 0), p.y, 0);
    return [x, y, ppm * 0.9 * (p.child ? 0.66 : 1), vis];
  }
  function drawOverlay3D() {
    const r = run, cv = r.ui.canvas, r3d = r.r3d;
    const dpr = Math.min(window.devicePixelRatio || 1, r.dprCap || 2), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'), G = T.G[r.b.good], art = window.NeonShopArt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    r.dpr = dpr;
    // the front of the queue glows: tap to serve
    const front = queue().find(atTill);
    if (front) {
      const [x, y, s] = onScreen(front);
      ctx.strokeStyle = `rgba(255,210,63,${0.5 + 0.4 * Math.sin(r.t * 8)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, y, s * 0.5, s * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // badges, patience bars and speech bubbles; the clerk's STAFF tag
    const all = r.people.concat([r.clerk], r.me ? [r.me] : [], r.staff.filter((st) => st.body).map((st) => st.body));
    for (const p of all.sort((a, b) => a.y - b.y)) {
      const [x, y, s, vis] = onScreen(p);
      if (!vis || x < -40 || x > W + 40) continue;
      drawTags(ctx, p, x, y, s, W, G);
    }
    // dust from dropped boxes
    for (const d of r.dust) {
      const [x, y] = r3d.project(d.x, PILE.y, 0.15 + (PILE.y - d.y) * 6);
      ctx.fillStyle = `rgba(220,200,170,${0.5 * (1 - d.t / 0.6)})`;
      ctx.beginPath(); ctx.arc(x, y, 2 + d.t * 10, 0, Math.PI * 2); ctx.fill();
    }
    // goods flying from the shelf (or the fridge) into a basket
    for (const fx of r.effects) {
      if (fx.kind !== 'fly' || fx.t < 0) continue;
      const k = fx.t / fx.dur, [tx, ty, ts] = onScreen(fx.to);
      const [x0, y0] = fx.sl ? r3d.slotOnScreen(fx.sl) : r3d.project(fx.x, L.door, 1.2), x1 = tx - ts * 0.34, y1 = ty - ts * 0.8;
      art.pack(ctx, fx.item || r.b.good, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 18, H * 0.026, 0, dpr);
    }
    // the receipt, torn off and handed over
    for (const fx of r.effects) {
      if (fx.kind !== 'receipt') continue;
      const k = fx.t / fx.dur, [tx, ty, ts] = onScreen(fx.to), [px, py] = r3d.project(0.3, L.counter, 1.15);
      const x = px + (tx + ts * 0.3 - px) * k, y = py + (ty - ts * 1.6 - py) * k - Math.sin(k * Math.PI) * 20;
      ctx.save(); ctx.translate(x, y); ctx.rotate(k * 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(-4, -6, 8, 12); ctx.fillStyle = '#bbb'; ctx.fillRect(-3, -3, 6, 1); ctx.fillRect(-3, 0, 6, 1);
      ctx.restore();
    }
    // the box you're carrying, and the shelf it will go on
    if (r.drag) {
      const ui = r3d.unitAt(r.drag.x, r.drag.y);
      if (ui >= 0) {
        const rc = r3d.unitRect(ui);
        ctx.strokeStyle = unitRoom(ui) > 0 ? '#4ade80' : '#ff6b6b'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
        ctx.strokeRect(rc[0] - 3, rc[1] - 3, rc[2] - rc[0] + 6, rc[3] - rc[1] + 6); ctx.setLineDash([]);
      }
      drawBox(ctx, r.drag.x, r.drag.y + 10, H * 0.05, G);
    }
    // floating messages: over a person or the till, or across the middle of the screen
    ctx.font = `900 ${Math.round(H * 0.028)}px system-ui, sans-serif`;
    for (const fx of r.effects) {
      if (fx.kind !== 'text') continue;
      const [x, y] = fx.x === 0.5 ? [W / 2, fx.y * H] : r3d.project(fx.x, clamp(fx.y + 0.1, L.enter, L.counter), 2.1);
      ctx.globalAlpha = Math.max(0, 1 - fx.t);
      ctx.fillStyle = fx.color || '#ffd23f';
      ctx.fillText(fx.text, x, y - fx.t * 20);
    }
    ctx.globalAlpha = 1;
    drawInfo(ctx, W, H, G, (p) => { const [x, y, s] = onScreen(p); return [x, y - s * 2.3]; });
    drawScreen(ctx, W, H, true);
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
    const sky = (ctx) => {
      let [top, bot] = skyAt(k);
      const grey = r.weather === 'rain' || r.weather === 'snow' ? 0.55 : r.weather === 'cloudy' ? 0.3 : 0;
      if (grey) { top = mix(rgbHex(top), '#5b6070', grey); bot = mix(rgbHex(bot), '#7a7f8c', grey); }
      const g = ctx.createLinearGradient(0, F.glass * H, 0, F.road0 * H);
      g.addColorStop(0, top); g.addColorStop(1, bot);
      ctx.fillStyle = g; ctx.fillRect(0, F.glass * H, W, (F.road0 - F.glass) * H + 1);
      for (const b of r.skyline) {
        const x = b.x * W, w = b.w * W, bt = (F.road0 - b.h) * H, bb = F.road0 * H;
        ctx.fillStyle = mix('#5d6f8f', '#1c0a3a', night); ctx.fillRect(x, bt, w, bb - bt);
        ctx.fillStyle = night > 0.3 ? (b.lit > 0.5 ? `rgba(255,210,63,${0.6 * night})` : `rgba(5,217,232,${0.5 * night})`) : `rgba(200,230,255,${0.35 * (1 - night)})`;
        for (let wy = bt + 4; wy < bb - 4; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 6) if (((wx * 7 + wy * 3) | 0) % 5 < 2) ctx.fillRect(wx, wy, 2, 3);
      }
    };
    let g;
    if (r.zoom.z < 1.05) blit(ctx, layer('sky', [W, H, r.dpr, Math.round(k * 60), r.weather].join('|'), sky, [0, F.glass * H, W, (F.road0 - F.glass) * H + 1]));
    else sky(ctx);
    // clouds drifting by (in front of the buildings, as seen from inside)
    for (const c of r.clouds) {
      ctx.fillStyle = r.weather === 'rain' || r.weather === 'snow' ? 'rgba(90,95,110,.7)' : `rgba(255,255,255,${0.5 - night * 0.35})`;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse((c.x + c.w * (i - 1) * 0.3) * W, c.y * H, c.w * W * 0.3, H * 0.012, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    drawAcross(ctx, W, H, night);
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
    drawParadeAndPolice(ctx, W, H);
    // (the delivery van parks round the back now)
    // curb and pavement, with street lamps that come on at dusk
    ctx.fillStyle = mix('#a49cb4', '#5a4a6e', night); ctx.fillRect(0, F.road1 * H, W, 2);
    g = ctx.createLinearGradient(0, F.road1 * H, 0, L.door * H);
    g.addColorStop(0, mix('#8a8496', '#3a2a52', night)); g.addColorStop(1, mix('#9a94a6', '#4d3a66', night));
    ctx.fillStyle = g; ctx.fillRect(0, F.road1 * H + 2, W, (L.door - F.road1) * H);
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 22) { ctx.beginPath(); ctx.moveTo(x, F.road1 * H + 2); ctx.lineTo(x - 3, L.wall * H); ctx.stroke(); }
    drawPrecip(ctx, W, H);
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
    drawAwning(ctx, W, H);
  }

  function drawCar(ctx, c, W, H, night) {
    if (c.kind === 'scooter') { // a delivery rider
      const x = c.x * W, base = c.lane * H, s = H * 0.03;
      ctx.fillStyle = '#111'; for (const k of [-0.4, 0.4]) { ctx.beginPath(); ctx.arc(x + k * s, base - s * 0.15, s * 0.16, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = c.color; roundRect(ctx, x - s * 0.5, base - s * 0.45, s, s * 0.25, 3); ctx.fill();
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(x - c.dir * s * 0.55 - s * 0.18, base - s * 0.85, s * 0.36, s * 0.36); // the delivery box
      ctx.fillStyle = '#1b1035'; ctx.beginPath(); ctx.arc(x + c.dir * s * 0.1, base - s * 0.9, s * 0.16, 0, Math.PI * 2); ctx.fill();
      return;
    }
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

  // ---------- cached layers ----------
  // Parts of the picture that rarely change (the floor, walls, shelves, shop front, counter) are
  // painted once into an off-screen canvas and copied in each frame; each is repainted only when
  // its key (what it depends on) changes.
  let layers = {};
  function layer(name, key, paint, box) {
    const dpr = run.dpr, [bx, by, bw, bh] = box;
    let ly = layers[name];
    if (!ly || ly.key !== key) {
      const c = (ly && ly.c) || document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(bw * dpr)); c.height = Math.max(1, Math.ceil(bh * dpr));
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
      g.clearRect(bx, by, bw, bh);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      paint(g);
      ly = layers[name] = { c, key, box };
    }
    return ly;
  }
  const blit = (ctx, ly) => ctx.drawImage(ly.c, ly.box[0], ly.box[1], ly.box[2], ly.box[3]);
  // a shelving unit: cached until its packs, stickers or price change
  function drawUnitCached(ctx, u, ui, W, H, G, cache) {
    const r = run, mine = r.slots.filter((sl) => sl.u === ui);
    if (!cache || onSale() || linePrice(r.b, r.unitLine[ui]) < 0.999 || mine.some((sl) => sl.pop > 0)) { drawUnit(ctx, u, ui, W, H, G); return; }
    const key = [W, H, r.dpr, T.shelfPrice(r.s, r.b), linePrice(r.b, r.unitLine[ui]), mine.map((sl) => sl.n + (r.stickers.has(sl) ? 's' : '')).join(',')].join('|');
    blit(ctx, layer('unit' + ui, key, (g) => drawUnit(g, u, ui, W, H, G), [(u.x0 - 0.05) * W, (u.top - 0.07) * H, (u.x1 - u.x0 + 0.1) * W, (u.base - u.top + 0.13) * H]));
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
  // part: 'static' draws what rarely changes (cached), 'live' what moves; both when left out
  function drawStorefront(ctx, W, H, G, part) {
    const r = run, F = FRONT, night = nightAt(dayK()), art = window.NeonShopArt;
    const gy0 = F.glass * H, gy1 = F.sill * H, S = part !== 'live', LV = part !== 'static';
    // the glass: a faint tint and reflections
    if (S) for (const [a, b] of F.windows) {
      const x0 = a * W, x1 = b * W;
      ctx.fillStyle = 'rgba(140,210,255,.06)'; ctx.fillRect(x0, gy0, x1 - x0, gy1 - gy0);
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      const k = x1 - x0;
      poly(ctx, [[x0 + k * 0.1, gy0], [x0 + k * 0.22, gy0], [x0 + k * 0.08, gy1], [x0 - k * 0.04, gy1]]); ctx.fill();
      poly(ctx, [[x0 + k * 0.27, gy0], [x0 + k * 0.31, gy0], [x0 + k * 0.17, gy1], [x0 + k * 0.13, gy1]]); ctx.fill();
    }
    // greasy smudges build up on the glass until the clerk wipes them
    if (S) for (const [wi, u, v] of r.b.wear.smudges) {
      const [a, b] = F.windows[wi], sx = (a + (b - a) * u) * W, sy = gy0 + (gy1 - gy0) * v;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.018);
      sg.addColorStop(0, 'rgba(230,230,240,.22)'); sg.addColorStop(1, 'rgba(230,230,240,0)');
      ctx.fillStyle = sg; ctx.fillRect(sx - H * 0.018, sy - H * 0.018, H * 0.036, H * 0.036);
    }
    if (LV && r.weather === 'rain') { // drops running down the windows
      ctx.fillStyle = 'rgba(220,235,255,.5)';
      for (const [u, v, d] of r.drops) {
        const wi = u < 0.5 ? 0 : 1, [a, b] = F.windows[wi], sx = (a + (b - a) * ((u * 2) % 1)) * W, sy = gy0 + (gy1 - gy0) * ((v + r.t * 0.04 * d) % 1);
        ctx.fillRect(sx, sy, 1.2, d * 2.2);
      }
    }
    // window stickers: OPEN sign hanging in the left window, a poster in the right one
    if (S) {
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
    if (S) {
      const g = ctx.createLinearGradient(0, 0, 0, gy0);
      if (r.b.tier === 0) { g.addColorStop(0, '#5a3a22'); g.addColorStop(1, '#3d2716'); } // a painted wooden board for a little stall
      else { g.addColorStop(0, '#140628'); g.addColorStop(1, '#22093f'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, gy0);
      if (r.b.tier === 0) { ctx.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 6; y < gy0; y += 7) ctx.fillRect(0, y, W, 1); }
    }
    if (LV) drawMarquee(ctx, W, H, gy0);
    ctx.font = `900 ${Math.round(Math.min(H * 0.026, W * 0.045))}px system-ui, sans-serif`;
    { const want = W * 0.6, have = ctx.measureText(`${G.icon} ${G.name.toUpperCase()} · ${T.STALLS[r.b.tier].name.toUpperCase()}`).width; if (have > want) ctx.font = `900 ${Math.round(Math.min(H * 0.026, W * 0.045) * want / have)}px system-ui, sans-serif`; }
    const sg = r.decor.sign, label = `${G.icon} ${G.name.toUpperCase()} · ${T.STALLS[r.b.tier].name.toUpperCase()}`;
    if (sg.rainbow ? LV : S) { // the sign's lettering (a rainbow sign shimmers, so it's drawn live)
    if (sg.rainbow) {
      const tw = ctx.measureText(label).width, rg = ctx.createLinearGradient(W / 2 - tw / 2, 0, W / 2 + tw / 2, 0);
      ['#ff2a6d', '#ffd23f', '#4ade80', '#05d9e8', '#9b5de5'].forEach((c, i) => rg.addColorStop((i / 4 + r.t * 0.1) % 1, c));
      ctx.fillStyle = rg;
    } else ctx.fillStyle = sg.color;
    ctx.shadowColor = sg.glow; ctx.shadowBlur = r.b.tier === 0 ? 0 : (4 + 8 * night) * r.lights * (r.power ? 0 : 1);
    ctx.fillText(label, W / 2, L.sign * H * 0.68);
    ctx.shadowBlur = 0;
    }
    if (S) { ctx.fillStyle = '#ff2a6d'; ctx.fillRect(0, gy0 - 3, W, 2); }
    // a wall clock showing the time, and a security camera in the corner
    if (LV) art.clock(ctx, W * BX(0.93), gy0 * 0.5, gy0 * 0.36, OPEN_H + dayK() * (CLOSE_H - OPEN_H));
    if (!S) { art.camera(ctx, W * BX(0.05), gy0 - 2, H * 0.03, r.t); drawHoliday(ctx, W, H, gy0); return; }
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
    if (LV) { art.camera(ctx, W * BX(0.05), gy0 - 2, H * 0.03, r.t); drawHoliday(ctx, W, H, gy0); }
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

  // ---------- across the road: the rival shop, a street market, a parade, the police ----------
  function drawAcross(ctx, W, H, night) {
    const r = run, F = FRONT, base = F.road0 * H;
    if (r.rival) { // the rival's shop front, opposite
      const x0 = W * 0.6, x1 = W * 0.76, top = (F.road0 - 0.042) * H; // in view through the right-hand window
      ctx.fillStyle = mix('#c9c2d8', '#2b2440', night); ctx.fillRect(x0, top, x1 - x0, base - top);
      ctx.fillStyle = r.rival.sale ? '#ff3b3b' : '#3b82f6'; ctx.fillRect(x0, top, x1 - x0, H * 0.014);
      ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(H * 0.011)}px system-ui, sans-serif`;
      ctx.fillText(r.rival.name.toUpperCase(), (x0 + x1) / 2, top + H * 0.011);
      ctx.fillStyle = `rgba(255,240,200,${0.4 + 0.4 * night})`; ctx.fillRect(x0 + (x1 - x0) * 0.6, top + H * 0.02, (x1 - x0) * 0.36, base - top - H * 0.022);
      // their price board
      const price = T.price(r.s, r.b.district, r.b.good) * r.rival.mult;
      ctx.fillStyle = r.rival.sale ? '#ff3b3b' : '#ffd23f'; ctx.fillRect(x0 + (x1 - x0) * 0.04, top + H * 0.02, (x1 - x0) * 0.52, H * 0.022);
      ctx.fillStyle = r.rival.sale ? '#fff' : '#0b0221'; ctx.font = `800 ${Math.round(H * 0.01)}px system-ui, sans-serif`;
      ctx.fillText(`${r.rival.sale ? 'SALE ' : ''}${T.G[r.b.good].icon} $${price < 100 ? price.toFixed(2) : Math.round(price)}`, x0 + (x1 - x0) * 0.3, top + H * 0.035);
    }
    if (r.ads && r.ads.includes('billboard')) { // your billboard, over the road
      const x0 = W * 0.06, x1 = W * 0.36, top = (F.road0 - 0.052) * H, h = H * 0.03;
      ctx.fillStyle = '#2a2a35'; ctx.fillRect(x0 + (x1 - x0) * 0.3, top + h, 2, base - top - h); ctx.fillRect(x0 + (x1 - x0) * 0.7, top + h, 2, base - top - h);
      ctx.fillStyle = '#ff2a6d'; ctx.fillRect(x0, top, x1 - x0, h); ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(H * 0.011)}px system-ui, sans-serif`;
      ctx.fillText(`${T.G[r.b.good].icon} SHOP HERE! ${T.STALLS[r.b.tier].name.toUpperCase()} →`, (x0 + x1) / 2, top + h * 0.68);
    }
    if (r.event === 'market') { // a street market over the road, all day
      for (let i = 0; i < 3; i++) {
        const w = W * 0.11, x = W * [0.16, 0.5, 0.88][i] - w / 2, y = base; // either side, and through the door
        ctx.fillStyle = '#6b4423'; ctx.fillRect(x, y - H * 0.012, w, H * 0.012);
        for (let k = 0; k < 4; k++) { ctx.fillStyle = k % 2 ? '#fff' : CAR_COLORS[i]; ctx.fillRect(x + (k * w) / 4, y - H * 0.03, w / 4 + 0.5, H * 0.01); }
        ctx.fillStyle = '#2a2a35'; ctx.fillRect(x, y - H * 0.03, 1.5, H * 0.03); ctx.fillRect(x + w - 1.5, y - H * 0.03, 1.5, H * 0.03);
        for (let k = 0; k < 3; k++) { ctx.fillStyle = CAR_COLORS[(i + k + 2) % CAR_COLORS.length]; ctx.fillRect(x + 4 + k * (w - 8) / 3, y - H * 0.017, 5, 4); }
      }
    }
  }
  function drawParadeAndPolice(ctx, W, H) {
    const r = run;
    for (const m of r.parade) {
      if (m.x < -0.1 || m.x > 1.1) continue;
      const x = m.x * W, y = 0.141 * H, s = H * 0.03;
      NeonLooks.drawRunner(ctx, x, y, s, { front: false, phase: m.phase, stride: 0.3 }, NeonLooks.byId(NeonLooks.OUTFITS, m.look.outfit), r.t, m.look);
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + s * 0.3, y - s * 0.8); ctx.lineTo(x + s * 0.3, y - s * 2.4); ctx.stroke();
      ctx.fillStyle = m.flag; ctx.fillRect(x + s * 0.3, y - s * 2.4, s * 0.6 * (1 + Math.sin(m.phase) * 0.15), s * 0.4);
    }
    if (r.police) {
      const x = r.police.x * W, base = 0.142 * H, w = W * 0.14, h = H * 0.026;
      ctx.fillStyle = '#f2f2f2'; roundRect(ctx, x - w / 2, base - h * 0.62, w, h * 0.5, 3); ctx.fill();
      ctx.fillStyle = '#1d3557'; ctx.fillRect(x - w / 2, base - h * 0.42, w, h * 0.14);
      ctx.fillStyle = '#f2f2f2'; roundRect(ctx, x - w * 0.25, base - h, w * 0.48, h * 0.45, 4); ctx.fill();
      const on = Math.sin(r.t * 20) > 0;
      ctx.fillStyle = on ? '#ff3b3b' : '#3b82f6'; ctx.fillRect(x - w * 0.12, base - h * 1.12, w * 0.1, 3);
      ctx.fillStyle = on ? '#3b82f6' : '#ff3b3b'; ctx.fillRect(x + w * 0.02, base - h * 1.12, w * 0.1, 3);
      ctx.fillStyle = '#111'; for (const k of [-0.3, 0.3]) { ctx.beginPath(); ctx.arc(x + k * w, base - h * 0.12, h * 0.17, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  // a dog waiting outside for its owner
  function drawDog(ctx, d, W, H) {
    const x = d.x * W, y = d.y * H, s = H * 0.03, c = ['#b07a3e', '#3a2a1a', '#e8e0d0'][d.look];
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.5, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(x, y - s * 0.45, s * 0.42, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    const leg = d.moving ? Math.sin(d.phase) * s * 0.08 : 0;
    for (const [lx, ph] of [[-0.3, 1], [0.3, -1]]) ctx.fillRect(x + lx * s + leg * ph - 1, y - s * 0.35, 2.5, s * 0.35);
    ctx.beginPath(); ctx.arc(x + s * 0.4, y - s * 0.65, s * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x + s * 0.45, y - s * 0.62, s * 0.2, s * 0.1);
    ctx.save(); ctx.translate(x - s * 0.4, y - s * 0.5); ctx.rotate(-0.8 + Math.sin(d.phase * (d.moving ? 1 : 2.4)) * 0.5); ctx.fillRect(0, -1, s * 0.3, 2.5); ctx.restore();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x + s * 0.47, y - s * 0.7, 1, 0, Math.PI * 2); ctx.fill();
  }
  // snow and rain particles, and snow settling on the pavement
  function drawPrecip(ctx, W, H) {
    const r = run;
    if (r.weather === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (const d of r.rain) { ctx.beginPath(); ctx.arc(d.x * W + Math.sin(d.y * 60 + d.v * 9) * 3, d.y * H, 1.4, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(245,248,255,.55)'; ctx.fillRect(0, FRONT.road1 * H + 2, W, H * 0.006);
    } else if (r.weather === 'rain') {
      ctx.strokeStyle = 'rgba(200,220,255,.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); for (const d of r.rain) { ctx.moveTo(d.x * W, d.y * H); ctx.lineTo(d.x * W + 2, d.y * H - 7); } ctx.stroke();
    }
  }
  // the outside of the shop changes with its size: an awning for a shop, a marquee for a megastore
  function drawAwning(ctx, W, H) {
    const r = run, F = FRONT;
    if (r.b.tier < 1) return;
    for (const [a, b] of F.windows) {
      const x0 = a * W, x1 = b * W, y = F.glass * H, h = H * 0.014, n = Math.round((x1 - x0) / 14);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 ? '#f2f2f2' : r.decor.sign.glow;
        const sx = x0 + (i * (x1 - x0)) / n, sw = (x1 - x0) / n + 0.5;
        ctx.fillRect(sx, y, sw, h);
        ctx.beginPath(); ctx.arc(sx + sw / 2, y + h, sw / 2, 0, Math.PI); ctx.fill();
      }
    }
  }
  function drawMarquee(ctx, W, H, gy0) {
    const r = run;
    if (r.b.tier < 2) return;
    const n = 26;
    for (let i = 0; i < n; i++) { // chasing bulbs along the sign board
      const on = (i + Math.floor(r.t * 8)) % 3 === 0;
      ctx.fillStyle = on ? '#fff6c4' : '#7a6a30';
      ctx.beginPath(); ctx.arc(W * BX(0.03) + (i / (n - 1)) * W * (BX(0.97) - BX(0.03)), 3, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W * BX(0.03) + (i / (n - 1)) * W * (BX(0.97) - BX(0.03)), gy0 - 6, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  // holiday decorations
  function drawHoliday(ctx, W, H, gy0) {
    const r = run, h = r.holiday;
    if (!h) return;
    const cols = HOL_COLS[h.id] || HOL_COLS.summer;
    // a string of lights along the bottom of the sign board
    ctx.strokeStyle = '#1a1a22'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, gy0 + 4 + Math.sin(x / 18) * 3);
    ctx.stroke();
    for (let i = 0, x = 6; x < W; i++, x += 18) {
      const on = (i + Math.floor(r.t * 3)) % 4 !== 0;
      ctx.fillStyle = on ? cols[i % cols.length] : '#333';
      ctx.beginPath(); ctx.arc(x, gy0 + 6 + Math.sin(x / 18) * 3, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    if (h.id === 'summer') { // a banner over the aisle
      const y = H * 0.36;
      ctx.fillStyle = '#ffd23f'; roundRect(ctx, W * 0.36, y, W * 0.28, H * 0.026, 4); ctx.fill();
      ctx.fillStyle = '#0b0221'; ctx.font = `900 ${Math.round(H * 0.014)}px system-ui, sans-serif`; ctx.fillText('🏖️ SUMMER SALE', W / 2, y + H * 0.018);
    }
  }
  // seasonal props on the floor: a tree at Christmas, pumpkins at Halloween, a heart stand on Valentine's
  function holidayProps() {
    const h = run.holiday;
    if (!h) return [];
    if (h.id === 'xmas') return [['xmastree', BX(0.37), 0.33]];
    if (h.id === 'halloween') return [['pumpkin', BX(0.37), 0.32], ['pumpkin', BX(0.63), 0.32]];
    if (h.id === 'valentine') return [['hearts', BX(0.37), 0.32]];
    if (h.id === 'lunar') return [['lantern', BX(0.37), 0.32], ['lantern', BX(0.63), 0.32]];
    if (h.id === 'neonfest') return [['glowsticks', BX(0.37), 0.33]];
    if (h.id === 'school') return [['backpacks', BX(0.37), 0.33]];
    return [];
  }
  function drawHolidayProp(ctx, kind, x, y, W, H) {
    const px = x * W, py = y * H, s = scaleAt(y, H), r = run;
    if (kind === 'xmastree') {
      ctx.fillStyle = '#6b4423'; ctx.fillRect(px - 2, py - s * 0.25, 4, s * 0.25);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = '#1f9d55'; ctx.beginPath(); ctx.moveTo(px - s * (0.45 - i * 0.1), py - s * (0.25 + i * 0.35)); ctx.lineTo(px + s * (0.45 - i * 0.1), py - s * (0.25 + i * 0.35)); ctx.lineTo(px, py - s * (0.75 + i * 0.35)); ctx.closePath(); ctx.fill(); }
      for (let i = 0; i < 7; i++) { ctx.fillStyle = ['#ff3b3b', '#ffd23f', '#05d9e8'][(i + Math.floor(r.t * 3)) % 3]; ctx.beginPath(); ctx.arc(px + Math.sin(i * 2.4) * s * 0.25, py - s * (0.4 + i * 0.12), 1.8, 0, Math.PI * 2); ctx.fill(); }
      ctx.font = `${Math.round(s * 0.3)}px system-ui`; ctx.fillStyle = '#fff'; ctx.fillText('⭐', px, py - s * 1.42);
    } else if (kind === 'pumpkin') {
      ctx.fillStyle = '#ff7a00'; ctx.beginPath(); ctx.ellipse(px, py - s * 0.2, s * 0.28, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f6f2f'; ctx.fillRect(px - 1.5, py - s * 0.46, 3, s * 0.08);
      ctx.fillStyle = Math.sin(r.t * 6) > -0.5 ? '#ffe066' : '#c99a00';
      ctx.beginPath(); ctx.moveTo(px - s * 0.12, py - s * 0.26); ctx.lineTo(px - s * 0.05, py - s * 0.26); ctx.lineTo(px - s * 0.085, py - s * 0.32); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px + s * 0.05, py - s * 0.26); ctx.lineTo(px + s * 0.12, py - s * 0.26); ctx.lineTo(px + s * 0.085, py - s * 0.32); ctx.fill();
      ctx.fillRect(px - s * 0.1, py - s * 0.15, s * 0.2, s * 0.04);
    } else if (kind === 'lantern') {
      ctx.strokeStyle = '#2a2a35'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - s * 0.9); ctx.stroke();
      ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.ellipse(px, py - s * 1.05, s * 0.2, s * 0.17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(px - s * 0.1, py - s * 1.23, s * 0.2, s * 0.04); ctx.fillRect(px - s * 0.1, py - s * 0.9, s * 0.2, s * 0.04);
    } else if (kind === 'glowsticks') {
      for (let i = 0; i < 5; i++) { ctx.strokeStyle = HOL_COLS.neonfest[i % 4]; ctx.lineWidth = Math.max(2, s * 0.06); ctx.beginPath(); ctx.moveTo(px + (i - 2) * s * 0.1, py - s * 0.2); ctx.lineTo(px + (i - 2) * s * 0.14, py - s * (0.75 + 0.1 * Math.sin(r.t * 4 + i))); ctx.stroke(); }
      ctx.fillStyle = '#2a2a35'; ctx.fillRect(px - s * 0.3, py - s * 0.25, s * 0.6, s * 0.25);
    } else if (kind === 'backpacks') {
      for (let i = 0; i < 3; i++) { ctx.fillStyle = HOL_COLS.school[i]; roundRect(ctx, px + (i - 1.5) * s * 0.3, py - s * (0.45 + (i % 2) * 0.1), s * 0.26, s * 0.38, s * 0.06); ctx.fill(); }
    } else if (kind === 'hearts') {
      ctx.font = `${Math.round(s * 0.35)}px system-ui`; ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) ctx.fillText('💖', px + (i - 1) * s * 0.3, py - s * (0.3 + (i % 2) * 0.25) + Math.sin(r.t * 3 + i) * 2);
    }
  }
  // an info card when you tap a shopper
  function drawInfo(ctx, W, H, G, head) {
    const r = run, p = r.info && r.info.p;
    if (!p || !r.people.includes(p)) return;
    const kinds = { regular: `⭐ Regular · ${p.reg ? p.reg.stamps || 0 : 0}/5 stamps`, rushed: '⏱️ In a hurry', bargain: '🏷️ Bargain hunter', tourist: '📸 Tourist', influencer: '📱 Influencer', returner: '🔁 Bringing something back' };
    const doing = { look: 'Browsing', consider: 'Reading the label', pick: 'Picking up', queue: 'In the queue', toQueue: 'Heading to the till', wait: 'Waiting for stock', help: 'Wants help', fridge: 'Getting a drink', enter: 'Walking round', leaving: 'Leaving', sneak: 'Heading for the door' }[p.state] || 'Shopping';
    const moodTxt = { happy: '😊 Happy', meh: '😐 So-so', angry: '😠 Annoyed', sad: '😢 Unhappy' }[p.mood] || '🙂 Fine';
    const grp = GROUPS[p.group];
    const lines = [`${p.name || 'Shopper'}`, [grp ? `${grp.icon} ${grp.name}` : '', kinds[p.type] || (grp ? '' : '🛍️ Shopper')].filter(Boolean).join(' · '), `${doing} · ${moodTxt}`, `Wants ${p.qty}× ${G.icon} ${r.lines[p.line] || ''}${p.basket ? ` · has ${p.basket}` : ''}`];
    const s = scaleAt(p.y, H), hd = head ? head(p) : [(p.x + (p.ox || 0)) * W, p.y * H - s * 2.3], x = clamp(hd[0], W * 0.22, W * 0.78), y = hd[1];
    ctx.font = '700 11px system-ui, sans-serif';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, hh = lines.length * 14 + 10;
    ctx.globalAlpha = Math.min(1, r.info.t / 0.3);
    ctx.fillStyle = 'rgba(11,2,33,.92)'; roundRect(ctx, x - w / 2, y - hh, w, hh, 8); ctx.fill();
    ctx.strokeStyle = '#05d9e8'; ctx.lineWidth = 1.5; ctx.stroke();
    lines.forEach((l, i) => { ctx.fillStyle = i ? '#cfe' : '#ffd23f'; ctx.font = `${i ? 600 : 800} 11px system-ui, sans-serif`; ctx.fillText(l, x, y - hh + 17 + i * 14); });
    ctx.globalAlpha = 1;
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
  // the side counter: a small stand of the second product, by the till
  function drawSide(ctx, W, H) {
    const r = run, x = SIDE.x * W, y = SIDE.y * H, s = scaleAt(SIDE.y, H), g = r.b.side.good;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.4, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b2a5c'; ctx.fillRect(x - s * 0.36, y - s * 0.55, s * 0.72, s * 0.55);
    const n = Math.min(4, Math.ceil(r.b.side.stock / 6));
    for (let i = 0; i < n; i++) window.NeonShopArt.pack(ctx, g, x + (i - (n - 1) / 2) * s * 0.17, y - s * 0.57, s * 0.24, i, r.dpr);
    ctx.fillStyle = '#ffd23f'; ctx.font = `800 ${Math.max(6, Math.round(s * 0.1))}px system-ui, sans-serif`; ctx.fillText(`${T.G[g].icon} ${T.G[g].name.toUpperCase()}`, x, y - s * 0.22);
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
        if (r.b.tier >= 2) { // a megastore has an escalator up to its second floor
          ctx.strokeStyle = '#c9cdd8'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(...P(0.1, 0.05)); ctx.lineTo(...P(0.75, 0.75)); ctx.stroke();
          ctx.strokeStyle = '#2a2a35'; ctx.lineWidth = 1.5;
          for (let i = 1; i < 8; i++) { const a = P(0.1 + i * 0.08, 0.05 + i * 0.087), b = P(0.1 + i * 0.08, 0.0 + i * 0.087); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
          const [lx, ly] = P(0.3, 0.62);
          ctx.fillStyle = '#05d9e8'; roundRect(ctx, lx - 22, ly - 8, 44, 13, 3); ctx.fill();
          ctx.fillStyle = '#0b0221'; ctx.font = '800 8px system-ui, sans-serif'; ctx.fillText('⬆ LEVEL 2', lx, ly + 2);
        }
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
  // furniture in the drawn shop (seen from the till end)
  function drawFurn(ctx, f, W, H) {
    const px = f.x * W, py = f.y * H, s = scaleAt(f.y, H), r = run, side = f.rot % 2 === 1, w = s * (side ? 0.6 : 1) * FURNITURE[f.id].size[0];
    if (f.id === 'bench') {
      ctx.fillStyle = '#6b4423'; ctx.fillRect(px - w / 2, py - s * 0.42, w, s * 0.1); ctx.fillRect(px - w / 2, py - s * 0.75, w, s * 0.08);
      ctx.fillStyle = '#2a2a35'; ctx.fillRect(px - w / 2 + 2, py - s * 0.35, 3, s * 0.35); ctx.fillRect(px + w / 2 - 5, py - s * 0.35, 3, s * 0.35);
    } else if (f.id === 'vending' || f.id === 'arcade') {
      const h = s * (f.id === 'vending' ? 1.75 : 1.55), ww = s * 0.8;
      ctx.fillStyle = f.id === 'vending' ? '#c81e55' : '#2a1a4a'; roundRect(ctx, px - ww / 2, py - h, ww, h, 4); ctx.fill();
      ctx.fillStyle = f.id === 'vending' ? '#e8f6ff' : `hsl(${(r.t * 80) % 360},90%,60%)`; ctx.fillRect(px - ww * 0.36, py - h * 0.88, ww * 0.72, h * (f.id === 'vending' ? 0.5 : 0.32));
      if (f.id === 'vending') for (let i = 0; i < 9; i++) { ctx.fillStyle = CAR_COLORS[i % CAR_COLORS.length]; ctx.fillRect(px - ww * 0.3 + (i % 3) * ww * 0.22, py - h * 0.84 + Math.floor(i / 3) * h * 0.15, ww * 0.14, h * 0.08); }
      else { ctx.fillStyle = '#ff2a6d'; ctx.beginPath(); ctx.arc(px - ww * 0.15, py - h * 0.42, s * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#05d9e8'; ctx.fillRect(px + ww * 0.05, py - h * 0.45, s * 0.14, s * 0.06); }
    } else if (f.id === 'bigplant') {
      ctx.fillStyle = '#b5651d'; ctx.fillRect(px - s * 0.2, py - s * 0.4, s * 0.4, s * 0.4);
      ctx.fillStyle = '#2f9e44'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(px + (i - 2) * s * 0.12, py - s * (0.8 + (i % 2) * 0.35), s * 0.18, s * 0.42, (i - 2) * 0.3, 0, Math.PI * 2); ctx.fill(); }
    } else if (f.id === 'display') {
      ctx.fillStyle = '#e8e8f2'; ctx.fillRect(px - w / 2, py - s * 0.55, w, s * 0.55);
      ctx.fillStyle = 'rgba(160,220,255,.45)'; ctx.fillRect(px - w / 2, py - s * 1.05, w, s * 0.5);
      for (let i = 0; i < 3; i++) window.NeonShopArt.pack(ctx, r.b.good, px + (i - 1) * w * 0.28, py - s * 0.58, s * 0.3, LINE_V[r.trend] || 0, r.dpr);
      ctx.fillStyle = '#ffd23f'; ctx.font = `900 ${Math.max(7, Math.round(s * 0.14))}px system-ui`; ctx.fillText('🔥 TRENDING', px, py - s * 1.12);
    }
  }
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
    // which line this unit carries, in the line's colour
    if (u.wall && r.lines && r.lines.length > 1) { // on the plinth of a wall unit (islands get a sign on top)
      const ln = r.unitLine[ui], fs = Math.max(7, Math.round(kk * 0.75)), txt = `${r.lines[ln]}`.toUpperCase();
      ctx.font = `900 ${fs}px system-ui, sans-serif`;
      const tw = ctx.measureText(txt).width + fs, ty = base - kk / 2 - fs * 0.62;
      ctx.fillStyle = '#0b0221'; roundRect(ctx, cx - tw / 2, ty, tw, fs * 1.25, 3); ctx.fill();
      ctx.strokeStyle = LINE_COLORS[ln]; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = LINE_COLORS[ln]; ctx.textAlign = 'center'; ctx.fillText(txt, cx, ty + fs * 0.98);
    }
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
          if (d === 0 && f === 0 && r.stickers.has(sl)) {
            ctx.globalAlpha = 1; ctx.fillStyle = '#ffd23f';
            ctx.beginPath(); ctx.arc(px + s * 0.18, py - s * 0.55, Math.max(4, s * 0.2), 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#b91c1c'; ctx.font = `900 ${Math.max(6, Math.round(s * 0.22))}px system-ui, sans-serif`; ctx.fillText('½', px + s * 0.18, py - s * 0.48);
          }
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
    const lm = linePrice(r.b, r.unitLine[ui]), sale = onSale() || lm < 0.999;
    const price = T.shelfPrice(r.s, r.b) * lm, label = `${sale ? 'SALE ' : ''}$${price < 100 ? price.toFixed(2) : Math.round(price).toLocaleString()}`;
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
      const lc = r.lines && r.lines.length > 1 ? LINE_COLORS[r.unitLine[ui]] : '#05d9e8';
      ctx.strokeStyle = lc; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = `800 ${Math.round(sh * 0.58)}px system-ui, sans-serif`; ctx.fillStyle = lc;
      ctx.fillText(fit(ctx, `${G.icon} ${r.lines && r.lines.length > 1 ? r.lines[r.unitLine[ui]].toUpperCase() : `AISLE ${ui - 1}`}`, sw - 6), cx, sy + sh * 0.72);
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

  // a promotion on the floor, in its line's colour
  function drawPromo(ctx, pr, W, H) {
    const r = run, s = scaleAt(pr.y, H), x = pr.x * W, y = pr.y * H, col = LINE_COLORS[pr.line], name = r.lines[pr.line].toUpperCase();
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y, s * 0.3, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center';
    if (pr.id === 'poster') { // an A-board
      ctx.fillStyle = '#2a2a35'; ctx.beginPath(); ctx.moveTo(x - s * 0.24, y); ctx.lineTo(x - s * 0.18, y - s * 0.75); ctx.lineTo(x + s * 0.18, y - s * 0.75); ctx.lineTo(x + s * 0.24, y); ctx.fill();
      ctx.fillStyle = col; ctx.fillRect(x - s * 0.16, y - s * 0.72, s * 0.32, s * 0.62);
      ctx.fillStyle = '#0b0221'; ctx.font = `900 ${Math.max(6, Math.round(s * 0.1))}px system-ui, sans-serif`;
      ctx.fillText('TRY', x, y - s * 0.55); ctx.fillText(fit(ctx, name, s * 0.3), x, y - s * 0.42); ctx.fillText('NEW!', x, y - s * 0.2);
    } else if (pr.id === 'bogo') { // a round sign on a pole
      ctx.fillStyle = '#9aa0b5'; ctx.fillRect(x - 1.5, y - s * 0.95, 3, s * 0.95); ctx.fillRect(x - s * 0.12, y - 3, s * 0.24, 3);
      ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x, y - s * 1.05, s * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.max(6, Math.round(s * 0.11))}px system-ui, sans-serif`;
      ctx.fillText('2 FOR 1', x, y - s * 1.06); ctx.font = `800 ${Math.max(5, Math.round(s * 0.07))}px system-ui, sans-serif`; ctx.fillText(fit(ctx, name, s * 0.36), x, y - s * 0.95);
    } else { // a tasting table with a tray of samples
      ctx.fillStyle = '#6b4423'; ctx.fillRect(x - s * 0.3, y - s * 0.5, s * 0.6, s * 0.08); ctx.fillRect(x - s * 0.26, y - s * 0.42, 3, s * 0.42); ctx.fillRect(x + s * 0.26 - 3, y - s * 0.42, 3, s * 0.42);
      ctx.fillStyle = '#fff'; ctx.fillRect(x - s * 0.3, y - s * 0.46, s * 0.6, s * 0.18);
      ctx.fillStyle = '#e8e8f2'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.53, s * 0.18, s * 0.04, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 5; i++) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x - s * 0.12 + i * s * 0.06, y - s * 0.56, Math.max(1.5, s * 0.025), 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = col; ctx.font = `900 ${Math.max(6, Math.round(s * 0.1))}px system-ui, sans-serif`; ctx.fillText(fit(ctx, `TASTE ${name}`, s * 0.62), x, y - s * 0.33);
    }
  }

  // the stockroom: a low rack bay for each line, boxes on it, its name, and a light that goes red when it's low
  function drawPile(ctx, W, H, G) {
    const r = run;
    r.bay.forEach((n, line) => {
      const b = bayAt(line), s = scaleAt(b.y, H), x = b.x * W, y = b.y * H, w = (bayAt(1).x - bayAt(0).x) * W * 0.86, h = s * 0.95;
      ctx.fillStyle = '#4b5263'; ctx.fillRect(x - w / 2, y - h, 3, h); ctx.fillRect(x + w / 2 - 3, y - h, 3, h);
      for (const k of [0.05, 0.5, 0.95]) { ctx.fillStyle = '#8a90a2'; ctx.fillRect(x - w / 2, y - h * k - 2, w, 3); }
      const boxes = Math.min(6, Math.ceil(n / Math.max(1, r.cap * 2))), size = w * 0.36;
      for (let i = 0; i < boxes; i++) drawBox(ctx, x - w * 0.22 + (i % 2) * w * 0.44, y - h * 0.05 - Math.floor(i / 2) * h * 0.45 - 2 - (i >= 4 ? 0 : 0), size, G);
      const col = LINE_COLORS[line], fs = Math.max(7, Math.round(Math.min(s * 0.15, w * 0.24)));
      ctx.font = `900 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center';
      const label = fit(ctx, r.lines[line].toUpperCase(), w * 0.92);
      ctx.fillStyle = '#0b0221'; roundRect(ctx, x - w * 0.5, y - h - fs * 1.5, w, fs * 1.3, 3); ctx.fill();
      ctx.fillStyle = col; ctx.fillText(label, x, y - h - fs * 0.5);
      const low = bayLow(line), on = !low || Math.sin(r.t * 8) > 0;
      ctx.fillStyle = n <= 0 ? (on ? '#ff3b3b' : '#5a1010') : low ? '#ffb020' : '#4ade80';
      ctx.beginPath(); ctx.arc(x + w * 0.38, y - h - fs * 1.75, Math.max(2.5, fs * 0.32), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.max(8, Math.round(fs * 0.9))}px system-ui, sans-serif`;
      ctx.fillText(`${n}`, x, y + fs * 0.9);
    });
    // the stockroom sign
    const b0 = bayAt(0), s0 = scaleAt(b0.y, H);
    ctx.font = `800 ${Math.max(8, Math.round(s0 * 0.15))}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText('STOCKROOM', (bayAt(0).x + bayAt(r.bay.length - 1).x) / 2 * W, b0.y * H - s0 * 1.35);
    if (r.van && r.van.state !== 'out') { ctx.font = '800 11px system-ui, sans-serif'; ctx.fillStyle = '#7fe9ff'; ctx.fillText('🚚 Delivery at the back', Math.max(70, bayAt(1).x * W), b0.y * H + s0 * 0.45); }
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
    drawWear(ctx, p, px, py, s, front);
    // an umbrella when it's raining outside
    if ((r.weather === 'rain' || r.weather === 'snow') && p.y < L.wall + 0.005 && p.kind !== 'courier') {
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
    // the clerk's cloth or mop while cleaning
    if ((p.kind === 'clerk' || p.kind === 'me' || p.kind === 'staffer') && p.state === 'choring' && p.chore !== 'stock') {
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
    if (p.kind === 'clerk' || p.kind === 'me' || p.kind === 'staffer') {
      ctx.fillStyle = r.decor.uniform.color; roundRect(ctx, px - s * 0.18, py - s * 1.26, s * 0.36, s * 0.52, s * 0.06); ctx.fill();
      if (front) { ctx.fillStyle = '#0b0221'; ctx.font = `800 ${Math.round(Math.max(6, s * 0.09))}px system-ui, sans-serif`; ctx.fillText('STAFF', px, py - s * 1.08); }
    }
    // a box in their arms (clerk and courier)
    if (((p.kind === 'clerk' || p.kind === 'me' || p.kind === 'staffer') && p.carry > 0) || (p.kind === 'courier' && p.box > 0)) drawBox(ctx, px, py - s * 0.62, s * 0.55, G);
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
    drawTags(ctx, p, px, py, s, W, G);
  }

  // a burst pipe: water spreading over the floor, and a spray from the leak until it's fixed
  function drawPuddle(ctx, W, H) {
    const r = run, pp = r.pipe, s = scaleAt(pp.y, H), rad = s * (0.3 + pp.size * 1.6);
    ctx.fillStyle = 'rgba(120,190,255,.38)'; ctx.beginPath(); ctx.ellipse(pp.x * W, pp.y * H, rad, rad * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(220,240,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(pp.x * W, pp.y * H, rad * (0.5 + 0.3 * Math.sin(r.t * 3)), rad * 0.17, 0, 0, Math.PI * 2); ctx.stroke();
    if (!pp.fixed) {
      ctx.fillStyle = '#9aa0b5'; ctx.fillRect(pp.x * W - 3, pp.y * H - s * 0.12, 6, s * 0.12);
      ctx.fillStyle = 'rgba(160,215,255,.85)';
      for (let i = 0; i < 10; i++) { const k = (r.t * 2.5 + i / 10) % 1; ctx.beginPath(); ctx.arc(pp.x * W + Math.sin(i * 2.3) * k * s * 0.4, pp.y * H - s * 0.12 - Math.sin(k * Math.PI) * s * 0.5, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  // scarves, hats and sunglasses for the season; a backpack, briefcase or walking stick for who they are
  function drawWear(ctx, p, px, py, s, front) {
    const wear = p.look.wear, lift = p.moving ? 0.02 * s : 0;
    if (!wear || !wear.length) return;
    const col = CAR_COLORS[(p.look.skin * 3 + p.look.hairColor) % CAR_COLORS.length];
    const y = (h) => py - h * s - lift;
    if (wear.includes('backpack') && !front) { ctx.fillStyle = '#3b4a6b'; roundRect(ctx, px - s * 0.15, y(1.42), s * 0.3, s * 0.36, s * 0.06); ctx.fill(); ctx.fillStyle = col; ctx.fillRect(px - s * 0.1, y(1.2), s * 0.2, s * 0.06); }
    if (wear.includes('backpack') && front) { ctx.fillStyle = '#3b4a6b'; ctx.fillRect(px - s * 0.17, y(1.42), s * 0.04, s * 0.3); ctx.fillRect(px + s * 0.13, y(1.42), s * 0.04, s * 0.3); }
    if (wear.includes('scarf')) { ctx.fillStyle = col; roundRect(ctx, px - s * 0.13, y(1.53), s * 0.26, s * 0.08, s * 0.03); ctx.fill(); ctx.fillRect(px + (front ? -0.08 : 0.04) * s, y(1.47), s * 0.06, s * 0.2); }
    if (wear.includes('beanie')) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, y(1.74), s * 0.14, Math.PI, 0); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(px, y(1.9), s * 0.035, 0, Math.PI * 2); ctx.fill(); }
    if (wear.includes('shades') && front) { ctx.fillStyle = '#111'; roundRect(ctx, px - s * 0.1, y(1.73), s * 0.2, s * 0.05, s * 0.02); ctx.fill(); }
    if (wear.includes('briefcase')) { ctx.fillStyle = '#4a2f1d'; roundRect(ctx, px + s * 0.2, y(0.66), s * 0.2, s * 0.15, s * 0.02); ctx.fill(); ctx.fillStyle = '#c9a227'; ctx.fillRect(px + s * 0.29, y(0.64), s * 0.03, s * 0.03); }
    if (wear.includes('flyers')) { ctx.fillStyle = '#fff'; ctx.fillRect(px + s * 0.22, y(1.0), s * 0.16, s * 0.2); ctx.fillStyle = '#ff2a6d'; ctx.fillRect(px + s * 0.24, y(0.96), s * 0.12, s * 0.04); }
    if (wear.includes('clipboard')) { ctx.fillStyle = '#c9a26b'; ctx.fillRect(px - s * 0.38, y(1.05), s * 0.18, s * 0.24); ctx.fillStyle = '#fff'; ctx.fillRect(px - s * 0.36, y(1.02), s * 0.14, s * 0.18); }
    if (wear.includes('cane')) { ctx.strokeStyle = '#6b4423'; ctx.lineWidth = Math.max(1.5, s * 0.035); ctx.beginPath(); ctx.moveTo(px + s * 0.28, y(0.62)); ctx.lineTo(px + s * 0.34, py); ctx.stroke(); }
  }

  // name badges, the queue's patience bars and speech bubbles, over a person (both views)
  function drawTags(ctx, p, px, py, s, W, G) {
    const r = run;
    // you, out on the shop floor
    if (p.kind === 'me') {
      const bob = Math.sin(r.t * 5) * 2;
      ctx.fillStyle = '#ffd23f'; ctx.font = `900 ${Math.round(Math.max(11, s * 0.24))}px system-ui, sans-serif`;
      ctx.fillText('▼ YOU', px, py - s * 2.15 + bob);
      ctx.strokeStyle = 'rgba(255,210,63,.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(px, py, s * 0.42, s * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
      // where you're heading
      if (p.path && p.path.length && p.state === 'walk' && r.r3d) {
        const end = p.path[p.path.length - 1], [ex, ey] = r.r3d.project(end[0], end[1], 0);
        ctx.strokeStyle = 'rgba(255,210,63,.6)'; ctx.beginPath(); ctx.ellipse(ex, ey, s * 0.25, s * 0.08, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // a helper on the floor: their name and how much energy they have left
    if (p.kind === 'staffer') {
      const st = r.staff[p.i], k = st.energy / 100, w = s * 0.6;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(px - w / 2, py - s * 2.12, w, 4);
      ctx.fillStyle = k > 0.5 ? '#4ade80' : k > 0.25 ? '#ffd23f' : '#ff6b6b'; ctx.fillRect(px - w / 2, py - s * 2.12, w * k, 4);
      ctx.font = `800 ${Math.round(Math.max(9, s * 0.17))}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
      ctx.fillText(`${st.job === 'door' ? '🚪' : '📦'} ${st.m.name}`, px, py - s * 2.2);
    }
    // a little face: 😍 a bargain, 💸 too dear, 🤔 thinking it over, 😤 waiting too long
    if (p.react) {
      const k = 1 - p.react.t / 1.6;
      ctx.globalAlpha = Math.min(1, p.react.t / 0.4);
      ctx.font = `${Math.round(Math.max(14, s * 0.38))}px system-ui, sans-serif`;
      ctx.fillText(p.react.icon, px + s * 0.42, py - s * (2.0 + k * 0.5));
      ctx.globalAlpha = 1;
    }
    // what kind of shopper (a small badge) when they're inside
    if (p.badge && p.y > L.wall && p.state !== 'leaving' && !(p.bubble && p.bubbleT > 0)) {
      ctx.font = `${p.reg ? 800 : 400} ${Math.round(Math.max(10, s * (p.reg ? 0.18 : 0.24)))}px system-ui, sans-serif`; ctx.fillStyle = p.reg ? '#ffd23f' : '#fff';
      ctx.fillText(p.reg ? `⭐ ${p.name}` : p.badge, px + (p.reg ? 0 : s * 0.3), py - s * 1.85);
    }
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

  // rect: draw just the screen into this rectangle (the 3D till uses it as a texture)
  function drawPOS(ctx, base, W, H, G, serving, rect) {
    const r = run;
    const sw = rect ? rect.w : Math.min(W * 0.32, 200), sh = rect ? rect.h : H * 0.125;
    const sx = rect ? rect.x : clamp(base[0] - sw / 2, 4, W - sw - 4), sy = rect ? rect.y : base[1] - H * 0.014 - sh;
    // stand
    if (!rect) { ctx.fillStyle = '#2a2a35'; ctx.fillRect(base[0] - 3, sy + sh, 6, base[1] - sy - sh); ctx.fillRect(base[0] - 14, base[1] - 3, 28, 4); }
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
    if (r.power) {
      ctx.fillStyle = '#020608'; ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = '#ff6b6b'; ctx.font = `800 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('⚡ NO POWER', x0 + w / 2, y0 + h * 0.45); ctx.fillText('Cash only, by hand', x0 + w / 2, y0 + h * 0.7);
    } else if (recent || (serving && serving.basket)) {
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

  // part: 'static' (cached) or 'live', like the shop front
  function drawCounter(ctx, W, H, G, part) {
    const r = run, far = L.counter * H, near = far + H * 0.075, S = part !== 'live', LV = part !== 'static';
    const f = (near - far) / (near - VP_Y * H);
    // a point on the counter top: u across (0 left, 1 right), v from our edge (0) to the shoppers' edge (1)
    const P = (u, v) => toVP(-0.02 * W + u * 1.04 * W, near, f * v, W, H);
    const pr = P(0.4, 0.07), cr = P(0.575, 0.8), serving = r.people.find((x) => x.state === 'serving');
    r.printerXY = [pr[0], pr[1] - 12];
    if (S) {
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
    // conveyor belt, rollers, the scanner, the receipt printer, the card reader and the bagging stand
    ctx.fillStyle = '#16121c'; poly(ctx, [P(0.05, 0.85), P(0.45, 0.85), P(0.45, 0.15), P(0.05, 0.15)]); ctx.fill();
    ctx.fillStyle = '#9aa0b5';
    for (const u of [0.05, 0.45]) { poly(ctx, [P(u - 0.006, 0.88), P(u + 0.006, 0.88), P(u + 0.006, 0.12), P(u - 0.006, 0.12)]); ctx.fill(); }
    ctx.fillStyle = '#3a3f4f'; poly(ctx, [P(0.47, 0.8), P(0.57, 0.8), P(0.57, 0.2), P(0.47, 0.2)]); ctx.fill();
    ctx.fillStyle = 'rgba(5,217,232,.35)'; poly(ctx, [P(0.48, 0.72), P(0.56, 0.72), P(0.56, 0.28), P(0.48, 0.28)]); ctx.fill();
    ctx.fillStyle = '#2a2a35'; roundRect(ctx, pr[0] - 12, pr[1] - 11, 24, 11, 2); ctx.fill();
    ctx.fillStyle = '#0b0b10'; ctx.fillRect(pr[0] - 8, pr[1] - 11, 16, 2);
    ctx.fillStyle = '#1b1b24'; roundRect(ctx, cr[0] - 9, cr[1] - 16, 18, 20, 3); ctx.fill();
    const bs = P(0.955, 0.5), bw = W * 0.035;
    ctx.fillStyle = '#9aa0b5'; ctx.fillRect(bs[0] - bw, bs[1] - H * 0.045, 2, H * 0.045); ctx.fillRect(bs[0] + bw, bs[1] - H * 0.045, 2, H * 0.045);
    ctx.fillRect(bs[0] - bw, bs[1] - H * 0.045, bw * 2 + 2, 2);
    ctx.fillStyle = '#c99a5b'; ctx.fillRect(bs[0] - bw * 0.7, bs[1] - H * 0.04, bw * 1.4, H * 0.038);
    ctx.fillStyle = '#a87a40'; ctx.fillRect(bs[0] - bw * 0.7, bs[1] - H * 0.04, bw * 1.4, 3);
    }
    if (!LV) return;
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
    // the belt moves while scanning
    ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
    for (let k = 0; k < 20; k++) {
      const u = 0.05 + ((k * 0.02 + r.belt * 0.08) % 0.4);
      ctx.beginPath(); ctx.moveTo(...P(u, 0.85)); ctx.lineTo(...P(u, 0.15)); ctx.stroke();
    }
    // the scanner's laser
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
    // the receipt rolls out of the printer while scanning
    {
      const paid = r.lastSale && r.t - r.lastSale.t < 0.15;
      const k = serving ? clamp(1 - serving.timer / (serving.serveDur || 0.5), 0, 1) : paid ? 1 : 0;
      if (k > 0) {
        const len = k * H * 0.03;
        ctx.fillStyle = '#fafafa'; ctx.fillRect(pr[0] - 6, pr[1] - 11 - len, 12, len);
        ctx.fillStyle = '#c4c4c4'; for (let y = pr[1] - 14; y > pr[1] - 11 - len + 2; y -= 3) ctx.fillRect(pr[0] - 4, y, 8, 1);
      }
    }
    // the card reader's light
    ctx.fillStyle = r.lastSale && r.lastSale.method === 'card' && r.t - r.lastSale.t < 1.6 ? '#4ade80' : '#1e3a2a'; ctx.fillRect(cr[0] - 6, cr[1] - 13, 12, 6);
    // till screen on a stand, facing you: the sale being rung up, then PAID
    drawPOS(ctx, P(0.74, 0.45), W, H, G, serving);
    // you and your helpers, behind the counter
    const sellerS = H * 0.13;
    const staffXs = [0.2, 0.8, 0.08, 0.92, 0.32, 0.68];
    // whoever is scanning moves their arms, item to item
    const busy = (who) => r.people.some((x) => x.state === 'serving' && x.servedBy === who);
    const pose = (who) => (busy(who) ? { phase: r.t * 14 + (typeof who === 'number' ? who : 3), stride: 0.3 } : { phase: 0, stride: 0 });
    r.staff.forEach((st, i) => {
      const sx = W * staffXs[i % staffXs.length];
      if (st.job !== 'till' && st.job !== 'break') return; // out on the shop floor
      if (st.brk > 0 || st.job === 'break') { // on a break
        ctx.fillStyle = 'rgba(11,2,33,.85)'; roundRect(ctx, sx - 30, H - sellerS * 0.7, 60, 16, 5); ctx.fill();
        ctx.fillStyle = '#7fe9ff'; ctx.font = '800 10px system-ui, sans-serif'; ctx.fillText('☕ ON BREAK', sx, H - sellerS * 0.7 + 12);
        return;
      }
      NeonLooks.drawRunner(ctx, sx, H + sellerS * 0.55, sellerS * 0.85, pose(i), NeonLooks.byId(NeonLooks.OUTFITS, st.look.outfit), r.t, st.look);
      ctx.fillStyle = 'rgba(11,2,33,.8)'; roundRect(ctx, sx - 26, H - 16, 52, 14, 4); ctx.fill();
      ctx.fillStyle = st.energy < 40 ? '#ff9f6b' : '#fff'; ctx.font = '700 9px system-ui, sans-serif';
      ctx.fillText(`${T.SKILLS[st.m.skill].icon} ${st.m.name}`, sx, H - 6);
    });
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
    return { shelves: shelfTotal(), pile: run.pile, incoming: run.incoming, clerk: carried(), baskets: baskets + floor, total: run.b.stock };
  };

  return {
    online: onlineInfo, packOrder, getGfx, setGfx, getSaver, setSaver, lowBattery, open, serve, refill, order, setPrice, closeEarly, clock, frontWaiting, stockInfo, pointerDown, pointerMove, pointerUp, tap, zoomBy, panBy, resetZoom,
    _route: (a, b) => routeTo(a, b), _spot: (ui) => unitSpot(UNITS[ui]), _zone: (p) => zoneOf(p),
    _samples: () => Object.keys(SAMPLES),
    orbit, snapshot, is3D: () => !!(run && run.r3d),
    nightShift, night: nightInfo, endNight: () => { if (run && run.night) endNight(); },
    getView, setView, has3D, nudgeLine, linePrice, answerRequest, request: requestInfo, team, setJob, JOBS, toggleWalk, canWalk, walking: () => !!(run && run.me), actions: () => nearby().map(({ id, label }) => ({ id, label })), act: doAction, goal: goalInfo,
    plan: { PROMOS, FURNITURE, trend: trending, shapes: planShapes, draw: drawPlan, hit: planHit, move: planMove, lineNames, unitLines, PROP_KINDS, colors: LINE_COLORS },
    layout: () => ({ SIDE, HOL_COLS, MUD_SPOT, ANNEX, LEVEL2_DX, LEVEL2_Y, BAY_X, BAY_Z, L, UNITS, ROWS, unitLine: run && run.unitLine, lines: run && run.lines, FRONT, FRIDGE, PILE, PROPS, JUNGLE, KIOSK, COFFEE, TABLE, LAMPS, CLERK_HOME, VAN_X, BX, holidayProps, onSale, dayK, nightAt, skyAt }),
    _drawPOS: (...a) => drawPOS(...a),
    eventInfo, callPlumber, fixPipe,
    toggleTill2, resolveReturn, pendingReturn: () => !!(run && run.pendingReturn), active: () => !!run, current: () => run,
  };
})();
