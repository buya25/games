'use strict';

// Hands-on shop day: shoppers walk past, come in, check your price, queue, and you serve
// them at the counter. Seen from behind the counter: you (and any staff) in the front,
// shoppers walking toward you from the door.
window.NeonShop = (() => {
  const T = window.NeonTycoon;
  const DAY_SECONDS = 75;          // 9:00 to 21:00
  const OPEN_H = 9, CLOSE_H = 21;
  const STAFF = [0, 1, 3];         // helpers by stall tier
  const STAFF_SERVE = 4;           // seconds a helper takes per shopper
  const CUSTOMERS = [26, 40, 55];  // shoppers who walk in on a normal day, by tier

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
  };

  // ---------- people ----------
  const randomLook = () => {
    const L = window.NeonLooks;
    const pick = (a) => a[(Math.random() * a.length) | 0];
    return { outfit: pick(L.OUTFITS).id, skin: (Math.random() * 5) | 0, hair: pick(L.HAIRS).id, hairColor: (Math.random() * 6) | 0 };
  };

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
    run = {
      s, b, ui, t: 0, entrants, qtyMean, spawned: 0, nextSpawn: 0.5,
      people: [], effects: [], staffTimers: STAFF[tier] ? Array(STAFF[tier]).fill(0).map((_, i) => i * 1.3) : [],
      served: 0, sold: 0, revenue: 0, lostPrice: 0, lostWait: 0, lostStock: 0, closed: false, last: performance.now(), raf: 0,
      sellerLook: (() => { try { return Object.assign({ outfit: 'classic', skin: 2, hair: 'short', hairColor: 0 }, JSON.parse(localStorage.getItem('neonDash.look') || '{}')); } catch { return {}; } })(),
      staffLooks: Array.from({ length: STAFF[tier] }, randomLook),
    };
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

  // ---------- layout (fractions of the canvas) ----------
  const L = { street: 0.2, door: 0.3, counter: 0.79 };
  const depthScale = (y, H) => H * (0.035 + 0.075 * Math.max(0, Math.min(1, (y - L.street * H) / ((L.counter - L.street) * H))));

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
      patience: 10 + Math.random() * 8, wait: 0, bubble: null, timer: 0, mood: undefined, bag: false,
    });
  }

  const queue = () => run.people.filter((p) => p.state === 'queue' || p.state === 'serving').sort((a, b) => a.qAt - b.qAt);
  const queueSpot = (i) => ({ x: 0.5 + (i % 2 ? 0.06 : -0.06) * Math.min(1, i), y: L.counter - 0.06 - i * 0.055 });

  function moveToward(p, tx, ty, dt, speed = 0.22) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d < 0.004) { p.x = tx; p.y = ty; return true; }
    const m = Math.min(d, speed * dt);
    p.x += (dx / d) * m; p.y += (dy / d) * m;
    p.phase += dt * 9;
    return false;
  }

  function leave(p, mood, bubble) {
    p.state = 'leaving'; p.mood = mood; p.bubble = bubble; p.timer = 0;
  }

  // ---------- simulation ----------
  function step(dt) {
    const r = run;
    r.t += dt;
    const open = r.t < DAY_SECONDS;
    // shoppers arrive spread over the day, a little faster at lunch and in the evening
    if (open && r.spawned < r.entrants && r.t >= r.nextSpawn) {
      addShopper();
      const gap = (DAY_SECONDS * 0.9) / r.entrants;
      r.nextSpawn = r.t + gap * (0.5 + Math.random());
    }
    if (open && Math.random() < dt * 0.6) addPasser();

    const price = T.shelfPrice(r.s, r.b), mult = r.b.mult || T.RETAIL;
    for (const p of r.people) {
      if (p.bubbleT !== undefined) p.bubbleT -= dt;
      if (p.kind === 'passer') { p.x += p.dir * p.speed * dt; p.phase += dt * 8; continue; }
      switch (p.state) {
        case 'street': // walk along the pavement, turn in at the door
          p.x += p.dir * p.speed * dt; p.phase += dt * 8;
          if (Math.abs(p.x - 0.5) < 0.02) { p.state = 'enter'; p.x = 0.5; }
          if (!open) { p.kind = 'passer'; }
          break;
        case 'enter':
          if (moveToward(p, 0.5, L.door + 0.08, dt)) {
            p.state = 'browse'; p.timer = 0.9 + Math.random() * 0.9;
            p.shelf = Math.random() < 0.5 ? 0.22 : 0.78;
          }
          break;
        case 'browse': // walk to a shelf and look at the price
          if (moveToward(p, p.shelf, L.door + 0.18, dt)) {
            p.timer -= dt;
            if (p.timer <= 0) {
              if (r.b.stock <= 0) { r.lostStock++; leave(p, 'sad', '📦❌'); break; }
              if (mult > p.limit) { r.lostPrice++; leave(p, 'angry', '😒'); break; }
              p.bubble = mult < p.limit * 0.8 ? '😍' : '🙂'; p.bubbleT = 1.2;
              p.state = 'queue'; p.qAt = r.t; p.mood = 'happy';
            }
          }
          break;
        case 'queue': {
          const q = queue(), i = q.indexOf(p), spot = queueSpot(i);
          moveToward(p, spot.x, spot.y, dt, 0.25);
          p.wait += dt;
          if (p.wait > p.patience * 0.6) p.mood = 'meh';
          if (p.wait > p.patience) { r.lostWait++; leave(p, 'angry', '😠'); sfx.huff(); }
          break;
        }
        case 'serving':
          p.timer -= dt;
          if (p.timer <= 0) finishSale(p);
          break;
        case 'leaving': {
          const outY = L.street, outX = p.x < 0.5 ? -0.12 : 1.12;
          if (p.y > L.street + 0.005) moveToward(p, 0.5, outY, dt, 0.24);
          else { p.y = outY; p.x += (outX < 0 ? -1 : 1) * 0.14 * dt; p.phase += dt * 8; }
          break;
        }
      }
    }
    // staff serve the front of the queue on their own
    r.staffTimers = r.staffTimers.map((tm) => {
      tm -= dt;
      if (tm <= 0) {
        const p = queue().find((x) => x.state === 'queue' && x.y > L.counter - 0.13);
        if (p) { startServe(p, 0.5); return STAFF_SERVE * (0.8 + Math.random() * 0.4); }
        return 0.3;
      }
      return tm;
    });
    for (const fx of r.effects) { fx.t += dt; fx.y -= dt * 0.08; }
    r.effects = r.effects.filter((fx) => fx.t < 1.1);
    r.people = r.people.filter((p) => p.x > -0.2 && p.x < 1.2);
    // the day ends at closing time once the shop is empty (or 10 s after closing)
    if (!open && !r.closed) { r.closed = true; for (const p of r.people) if (p.state === 'street') p.kind = 'passer'; }
    const inside = r.people.some((p) => p.kind === 'shopper' && p.state !== 'leaving');
    if (r.closed && (!inside || r.t > DAY_SECONDS + 10)) {
      for (const p of r.people) if (p.kind === 'shopper' && (p.state === 'queue' || p.state === 'browse')) r.lostWait++;
      r.done = true;
    }
  }

  function startServe(p, time) {
    p.state = 'serving'; p.timer = time;
  }

  function finishSale(p) {
    const r = run;
    const res = T.shopSale(r.s, r.b.id, p.qty);
    if (!res.ok) { r.lostStock++; leave(p, 'sad', '📦❌'); return; }
    r.served++; r.sold += res.qty; r.revenue += res.revenue;
    p.bag = true;
    leave(p, 'happy', '😊');
    r.effects.push({ text: `+$${Math.round(res.revenue).toLocaleString()}`, x: p.x, y: L.counter - 0.1, t: 0 });
    sfx.ching();
    try { navigator.vibrate && navigator.vibrate(12); } catch { /* ignore */ }
  }

  // tap: serve whoever is at the front of the queue (you are quick: 0.35 s)
  function serve() {
    if (!run) return false;
    const p = queue().find((x) => x.state === 'queue' && x.y > L.counter - 0.13);
    if (!p) return false;
    startServe(p, 0.35);
    return true;
  }
  function closeEarly() { if (run) run.t = Math.max(run.t, DAY_SECONDS); }
  function refill() { if (!run) return { ok: false }; return T.refillShelves(run.s, run.b.id); }
  function setPrice(mult) { if (!run) return; T.setShelfPrice(run.s, run.b.id, mult); }
  const frontWaiting = () => !!(run && queue().some((x) => x.state === 'queue' && x.y > L.counter - 0.13));

  // ---------- drawing ----------
  function draw() {
    const r = run, cv = r.ui.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const G = T.G[r.b.good], tierName = T.STALLS[r.b.tier].name;

    // back wall (also clears last frame around the floor)
    ctx.fillStyle = '#0d0420'; ctx.fillRect(0, 0, W, H);
    // night street
    let g = ctx.createLinearGradient(0, 0, 0, L.street * H);
    g.addColorStop(0, '#0b0221'); g.addColorStop(1, '#3a0d55');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, L.street * H + 4);
    ctx.fillStyle = '#211038'; ctx.fillRect(0, (L.street - 0.02) * H, W, 0.05 * H);   // pavement
    ctx.fillStyle = 'rgba(5,217,232,.5)'; ctx.fillRect(0, (L.street + 0.03) * H, W, 2);
    // shop front: wall, awning, sign, door
    ctx.fillStyle = '#1a0838'; ctx.fillRect(0, (L.street + 0.03) * H, W, (L.door - L.street) * H);
    for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#ff2a6d' : '#f2f2f2'; ctx.fillRect((i / 10) * W, (L.street + 0.03) * H, W / 10 + 1, 0.025 * H); }
    ctx.font = `900 ${Math.round(H * 0.026)}px system-ui, sans-serif`; ctx.textAlign = 'center';
    // sign boards either side of the door
    ctx.font = `900 ${Math.round(Math.min(H * 0.024, W * 0.045))}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`${G.icon} ${tierName.toUpperCase()}`, W * 0.21, (L.street + 0.082) * H);
    ctx.fillText(G.name.toUpperCase(), W * 0.79, (L.street + 0.082) * H);
    ctx.fillStyle = '#0b0221'; ctx.fillRect(W * 0.42, (L.street + 0.055) * H, W * 0.16, (L.door - L.street - 0.045) * H);
    ctx.strokeStyle = '#05d9e8'; ctx.lineWidth = 2; ctx.strokeRect(W * 0.42, (L.street + 0.055) * H, W * 0.16, (L.door - L.street - 0.045) * H);

    // shop floor in perspective
    const fy0 = L.door * H + 6, fy1 = L.counter * H;
    ctx.fillStyle = '#160a2e';
    ctx.beginPath(); ctx.moveTo(W * 0.28, fy0); ctx.lineTo(W * 0.72, fy0); ctx.lineTo(W, fy1); ctx.lineTo(0, fy1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(5,217,232,.12)'; ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) { const y = fy0 + (fy1 - fy0) * (i / 6) ** 1.4; const k = (y - fy0) / (fy1 - fy0); ctx.beginPath(); ctx.moveTo(W * (0.28 - 0.28 * k), y); ctx.lineTo(W * (0.72 + 0.28 * k), y); ctx.stroke(); }
    // shelves on both walls, filled to match your stock
    const room = T.STALLS[r.b.tier] ? T.unitsPerDay(T.STALLS[r.b.tier].cap, r.b.good) * 3 : 1;
    const fill = Math.max(0, Math.min(1, r.b.stock / room));
    for (const side of [0, 1]) {
      const x0 = side ? W * 0.82 : W * 0.04, sw = W * 0.14;
      for (let row = 0; row < 4; row++) {
        const y = fy0 + 20 + row * (fy1 - fy0 - 60) / 4;
        ctx.fillStyle = '#2b0f55'; ctx.fillRect(x0, y + 22, sw, 5);
        const items = Math.round(fill * 12) - row * 3;
        ctx.font = `${Math.round(H * 0.022)}px system-ui, sans-serif`; ctx.textAlign = 'left';
        for (let k = 0; k < Math.max(0, Math.min(3, items)); k++) ctx.fillText(G.icon, x0 + 2 + k * sw / 3.2, y + 20);
      }
    }
    // price tag on the wall
    const price = T.shelfPrice(r.s, r.b);
    ctx.fillStyle = '#ffd23f'; ctx.font = `900 ${Math.round(H * 0.024)}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(`${G.icon} $${price < 100 ? price.toFixed(2) : Math.round(price).toLocaleString()}`, W / 2, fy0 + 0.05 * H);

    // people, far to near
    const people = r.people.slice().sort((a, b) => a.y - b.y);
    for (const p of people) {
      const px = p.x * W, py = p.y * H, s = depthScale(py, H);
      const moving = p.kind === 'passer' || ['street', 'enter', 'leaving'].includes(p.state) || (p.state === 'browse' && p.timer > 0.85) || p.state === 'queue';
      const faceUs = p.kind === 'shopper' && p.state !== 'leaving' && p.state !== 'street';
      NeonLooks.drawRunner(ctx, px, py, s, { front: faceUs, phase: p.phase, stride: moving ? 0.35 : 0, mood: p.mood }, NeonLooks.byId(NeonLooks.OUTFITS, p.look.outfit), r.t, p.look);
      if (p.bag) { ctx.font = `${Math.round(s * 0.45)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('🛍️', px + s * 0.35, py - s * 0.75); }
      // what they want, and how patient they are
      if (p.state === 'queue' || p.state === 'serving') {
        const k = Math.max(0, 1 - p.wait / p.patience);
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(px - s * 0.3, py - s * 2.15, s * 0.6, 5);
        ctx.fillStyle = k > 0.5 ? '#4ade80' : k > 0.25 ? '#ffd23f' : '#ff6b6b'; ctx.fillRect(px - s * 0.3, py - s * 2.15, s * 0.6 * k, 5);
        ctx.font = `800 ${Math.round(Math.max(11, s * 0.28))}px system-ui, sans-serif`; ctx.fillStyle = '#fff';
        ctx.fillText(`${p.qty}× ${G.icon}`, px, py - s * 2.25);
      }
      if (p.bubble && (p.state === 'leaving' || (p.bubbleT || 0) > 0)) {
        ctx.font = `${Math.round(Math.max(16, s * 0.5))}px system-ui`; ctx.textAlign = 'center';
        ctx.fillText(p.bubble, px, py - s * 2.0);
      }
    }
    // the front of the queue glows: tap to serve
    const front = queue().find((x) => x.state === 'queue' && x.y > L.counter - 0.13);
    if (front) {
      const s = depthScale(front.y * H, H);
      ctx.strokeStyle = `rgba(255,210,63,${0.5 + 0.4 * Math.sin(r.t * 8)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(front.x * W, front.y * H, s * 0.5, s * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // the counter, with you (and staff) behind it, seen from behind
    const cy = L.counter * H;
    g = ctx.createLinearGradient(0, cy, 0, H);
    g.addColorStop(0, '#3d1670'); g.addColorStop(1, '#1d0a3d');
    ctx.fillStyle = g; ctx.fillRect(0, cy + 6, W, H - cy);
    ctx.fillStyle = '#ff2a6d'; ctx.fillRect(0, cy + 4, W, 4);
    ctx.font = `${Math.round(H * 0.035)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('🧾', W * 0.62, cy + 0.045 * H);
    const sellerS = H * 0.13;
    const staffXs = [0.2, 0.8, 0.08, 0.92];
    run.staffLooks.forEach((lk, i) => NeonLooks.drawRunner(ctx, W * staffXs[i], H + sellerS * 0.55, sellerS * 0.85, { phase: 0, stride: 0 }, NeonLooks.byId(NeonLooks.OUTFITS, lk.outfit), r.t, lk));
    NeonLooks.drawRunner(ctx, W * 0.5, H + sellerS * 0.5, sellerS, { phase: 0, stride: 0 }, NeonLooks.byId(NeonLooks.OUTFITS, r.sellerLook.outfit), r.t, r.sellerLook);
    // floating takings
    for (const fx of r.effects) {
      ctx.globalAlpha = Math.max(0, 1 - fx.t);
      ctx.font = `900 ${Math.round(H * 0.03)}px system-ui, sans-serif`; ctx.fillStyle = '#ffd23f';
      ctx.fillText(fx.text, fx.x * W, fx.y * H);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  // clock text for the HUD
  const clock = () => {
    if (!run) return '';
    const h = OPEN_H + (Math.min(run.t, DAY_SECONDS) / DAY_SECONDS) * (CLOSE_H - OPEN_H);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 15) * 15;
    return run.t >= DAY_SECONDS ? 'Closing…' : `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  return { open, serve, refill, setPrice, closeEarly, clock, frontWaiting, active: () => !!run, current: () => run };
})();
