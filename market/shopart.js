'use strict';

// Drawings for the hands-on shop: product packaging (cached as small sprites, since a full
// shop draws hundreds of packs a frame) and the props that make the shop feel lived in.
window.NeonShopArt = (() => {
  const PALETTES = {
    drinks: [['#ff2a6d', '#ffd23f'], ['#05d9e8', '#0b0221'], ['#9b5de5', '#4ade80'], ['#22c55e', '#fff'], ['#ff7a00', '#fff'], ['#e8e8f2', '#ff2a6d']],
    noodles: [['#e63946', '#ffd23f'], ['#ffd23f', '#e63946'], ['#2a9d8f', '#fff']],
    coffee: [['#6b4423', '#e9c46a'], ['#1d1d1d', '#e76f51'], ['#2a9d8f', '#f4f1de']],
    vinyl: [['#ff2a6d', '#ffd23f'], ['#05d9e8', '#9b5de5'], ['#f4a261', '#264653']],
    holo: [['#9b5de5', '#05d9e8'], ['#ff2a6d', '#ffd23f'], ['#4ade80', '#05d9e8']],
    sneakers: [['#ff7a00', '#fff'], ['#111', '#05d9e8'], ['#e8e8f2', '#ff2a6d']],
    chips: [['#1d3557', '#ffd23f'], ['#2a2a35', '#4ade80'], ['#3a0d55', '#05d9e8']],
    signs: [['#ff2a6d', '#ff2a6d'], ['#05d9e8', '#05d9e8'], ['#ffd23f', '#ffd23f']],
    bottle: [['#4ade80', '#fff'], ['#05d9e8', '#fff'], ['#ff7a00', '#fff'], ['#e8e8f2', '#05d9e8']],
    candy: [['#ff2a6d', '#fff'], ['#ffd23f', '#e63946'], ['#4ade80', '#fff'], ['#9b5de5', '#ffd23f'], ['#05d9e8', '#fff']],
  };

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const shine = (ctx, x, y, w, h) => { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x, y, w, h); };

  // Each drawer paints a pack with its bottom centre at (0, 0); s is the pack's height.
  const DRAW = {
    drinks(ctx, s, [c, a]) { // a can
      const w = s * 0.52, h = s * 0.96;
      ctx.fillStyle = c; rr(ctx, -w / 2, -h, w, h, w * 0.18); ctx.fill();
      ctx.fillStyle = '#c9cdd8'; ctx.fillRect(-w / 2 + 1, -h, w - 2, h * 0.08); ctx.fillRect(-w / 2 + 1, -h * 0.06, w - 2, h * 0.06);
      ctx.fillStyle = a; ctx.fillRect(-w / 2, -h * 0.62, w, h * 0.2);
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-w * 0.08, -h * 0.6); ctx.lineTo(w * 0.12, -h * 0.52); ctx.lineTo(-w * 0.02, -h * 0.5); ctx.lineTo(w * 0.1, -h * 0.43); ctx.lineTo(-w * 0.14, -h * 0.52); ctx.lineTo(0, -h * 0.54); ctx.closePath(); ctx.fill();
      shine(ctx, -w * 0.32, -h * 0.9, w * 0.12, h * 0.8);
    },
    bottle(ctx, s, [c, a]) {
      const w = s * 0.42, h = s;
      ctx.fillStyle = c; ctx.globalAlpha = 0.9;
      rr(ctx, -w / 2, -h * 0.72, w, h * 0.72, w * 0.25); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-w / 2, -h * 0.6); ctx.quadraticCurveTo(-w * 0.18, -h * 0.82, -w * 0.16, -h * 0.9); ctx.lineTo(w * 0.16, -h * 0.9); ctx.quadraticCurveTo(w * 0.18, -h * 0.82, w / 2, -h * 0.6); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8e8f2'; ctx.fillRect(-w * 0.18, -h, w * 0.36, h * 0.1);
      ctx.fillStyle = a; ctx.fillRect(-w / 2, -h * 0.5, w, h * 0.2);
      shine(ctx, -w * 0.3, -h * 0.68, w * 0.12, h * 0.55);
    },
    noodles(ctx, s, [c, a]) { // a noodle cup
      const t = s * 0.64, b = s * 0.48, h = s * 0.74;
      ctx.fillStyle = '#f4f1de'; ctx.beginPath(); ctx.moveTo(-b / 2, 0); ctx.lineTo(b / 2, 0); ctx.lineTo(t / 2, -h); ctx.lineTo(-t / 2, -h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-b * 0.53, -h * 0.25); ctx.lineTo(b * 0.53, -h * 0.25); ctx.lineTo(t * 0.47, -h * 0.75); ctx.lineTo(-t * 0.47, -h * 0.75); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = a; ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath(); for (let i = 0; i < 4; i++) { const x = -t * 0.3 + i * t * 0.18; ctx.moveTo(x, -h * 0.35); ctx.quadraticCurveTo(x + t * 0.08, -h * 0.5, x, -h * 0.62); } ctx.stroke();
      ctx.fillStyle = '#c9cdd8'; rr(ctx, -t / 2 - 1, -h - s * 0.06, t + 2, s * 0.08, 2); ctx.fill();
      ctx.fillStyle = a; ctx.fillRect(t * 0.32, -h - s * 0.1, t * 0.18, s * 0.06);
    },
    coffee(ctx, s, [c, a]) { // a bag of beans
      const w = s * 0.56, h = s * 0.92;
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.lineTo(w * 0.46, -h * 0.82); ctx.lineTo(-w * 0.46, -h * 0.82); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-w * 0.46, -h, w * 0.92, h * 0.18);
      ctx.fillStyle = c; ctx.fillRect(-w * 0.46, -h, w * 0.92, h * 0.12);
      ctx.fillStyle = a; ctx.beginPath(); ctx.arc(0, -h * 0.45, w * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, -h * 0.45, w * 0.1, w * 0.15, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = a; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-w * 0.04, -h * 0.55); ctx.quadraticCurveTo(w * 0.04, -h * 0.45, -w * 0.02, -h * 0.35); ctx.stroke();
      shine(ctx, -w * 0.38, -h * 0.76, w * 0.08, h * 0.65);
    },
    vinyl(ctx, s, [c, a]) { // a record in its sleeve, the disc peeking out
      const w = s * 0.86;
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(w * 0.12, -w / 2 - w * 0.08, w * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(w * 0.12, -w / 2 - w * 0.08, w * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.fillRect(-w / 2, -w, w * 0.9, w);
      ctx.fillStyle = a; ctx.beginPath(); ctx.arc(-w * 0.05, -w * 0.5, w * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-w * 0.05, -w * 0.5, w * 0.1, 0, Math.PI * 2); ctx.fill();
      shine(ctx, -w * 0.46, -w * 0.96, w * 0.06, w * 0.9);
    },
    holo(ctx, s, [c, a]) { // a toy in a window box
      const w = s * 0.64, h = s * 0.84;
      ctx.fillStyle = c; ctx.fillRect(-w / 2, -h, w, h);
      const g = ctx.createLinearGradient(-w / 2, -h, w / 2, -h);
      g.addColorStop(0, '#ff2a6d'); g.addColorStop(0.5, '#05d9e8'); g.addColorStop(1, '#ffd23f');
      ctx.fillStyle = g; ctx.fillRect(-w / 2, -h, w, h * 0.16);
      ctx.fillStyle = 'rgba(200,240,255,.55)'; ctx.fillRect(-w * 0.36, -h * 0.76, w * 0.72, h * 0.62);
      ctx.fillStyle = '#b07a3e';
      ctx.beginPath(); ctx.arc(0, -h * 0.5, w * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-w * 0.15, -h * 0.63, w * 0.07, 0, Math.PI * 2); ctx.arc(w * 0.15, -h * 0.63, w * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-w * 0.14, -h * 0.36, w * 0.28, h * 0.2);
      ctx.fillStyle = a; ctx.fillRect(-w / 2, -h * 0.1, w, h * 0.1);
    },
    sneakers(ctx, s, [c, a]) { // a shoebox
      const w = s * 0.96, h = s * 0.46;
      ctx.fillStyle = c; ctx.fillRect(-w / 2, -h, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-w / 2, -h * 0.72, w, 1.5);
      ctx.strokeStyle = a; ctx.lineWidth = Math.max(1.2, s * 0.06);
      ctx.beginPath(); ctx.moveTo(-w * 0.2, -h * 0.3); ctx.quadraticCurveTo(0, -h * 0.08, w * 0.25, -h * 0.5); ctx.stroke();
      shine(ctx, -w / 2, -h, w, h * 0.08);
    },
    chips(ctx, s, [c, a]) { // a chip in a blister pack
      const w = s * 0.56, h = s * 0.8;
      ctx.fillStyle = c; rr(ctx, -w / 2, -h, w, h, 2); ctx.fill();
      ctx.fillStyle = '#0b0221'; ctx.beginPath(); ctx.arc(0, -h * 0.88, w * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(220,240,255,.45)'; rr(ctx, -w * 0.36, -h * 0.72, w * 0.72, h * 0.52, 3); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillRect(-w * 0.2, -h * 0.6, w * 0.4, w * 0.4);
      ctx.fillStyle = a; for (let i = 0; i < 4; i++) { ctx.fillRect(-w * 0.26, -h * 0.58 + i * w * 0.1, w * 0.06, 1.2); ctx.fillRect(w * 0.2, -h * 0.58 + i * w * 0.1, w * 0.06, 1.2); }
      ctx.fillStyle = a; ctx.fillRect(-w / 2, -h * 0.14, w, h * 0.08);
    },
    signs(ctx, s, [c]) { // a small neon sign on a backing board
      const w = s * 0.9, h = s * 0.66;
      ctx.fillStyle = '#14082a'; rr(ctx, -w / 2, -h, w, h, 3); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.2, s * 0.05); ctx.shadowColor = c; ctx.shadowBlur = s * 0.2;
      ctx.beginPath(); ctx.moveTo(0, -h * 0.22);
      ctx.bezierCurveTo(-w * 0.45, -h * 0.55, -w * 0.15, -h * 0.95, 0, -h * 0.68);
      ctx.bezierCurveTo(w * 0.15, -h * 0.95, w * 0.45, -h * 0.55, 0, -h * 0.22); ctx.stroke();
      ctx.shadowBlur = 0;
    },
    candy(ctx, s, [c, a]) { // a chocolate bar or a pack of gum
      const w = s * 0.4, h = s * 0.7;
      ctx.fillStyle = c; rr(ctx, -w / 2, -h, w, h, 1.5); ctx.fill();
      ctx.fillStyle = a; ctx.fillRect(-w / 2, -h * 0.6, w, h * 0.18);
      shine(ctx, -w * 0.4, -h * 0.95, w * 0.12, h * 0.85);
    },
  };

  const cache = new Map();
  // draw a pack with its bottom centre at (x, y), about `size` px tall
  function pack(ctx, good, x, y, size, v = 0, dpr = 1) {
    const pal = PALETTES[good] || PALETTES.drinks;
    const px = Math.max(4, Math.round(size));
    const key = `${good}|${px}|${v % pal.length}|${dpr}`;
    let img = cache.get(key);
    if (!img) {
      const c = document.createElement('canvas');
      const pad = Math.ceil(px * 0.3);
      c.width = Math.ceil((px * 1.3 + pad * 2) * dpr); c.height = Math.ceil((px * 1.2 + pad) * dpr);
      const g = c.getContext('2d');
      g.scale(dpr, dpr); g.translate(c.width / dpr / 2, px * 1.2 + pad / 2);
      (DRAW[good] || DRAW.drinks)(g, px, pal[v % pal.length]);
      img = { c, w: c.width / dpr, h: c.height / dpr, oy: px * 1.2 + pad / 2 };
      if (cache.size > 600) cache.clear();
      cache.set(key, img);
    }
    ctx.drawImage(img.c, x - img.w / 2, y - img.oy, img.w, img.h);
  }

  // ---------- props ----------
  function plant(ctx, x, y, s) {
    ctx.fillStyle = '#b5651d'; ctx.beginPath(); ctx.moveTo(x - s * 0.22, y - s * 0.4); ctx.lineTo(x + s * 0.22, y - s * 0.4); ctx.lineTo(x + s * 0.16, y); ctx.lineTo(x - s * 0.16, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a4b16'; ctx.fillRect(x - s * 0.24, y - s * 0.44, s * 0.48, s * 0.07);
    const leaves = [[-0.3, -1.1, -0.6], [0.28, -1.05, 0.6], [0, -1.35, 0], [-0.2, -0.8, -1.1], [0.22, -0.78, 1.1], [0.05, -1.0, 0.3]];
    for (const [dx, dy, rot] of leaves) {
      ctx.fillStyle = dx < 0 ? '#1f9d55' : '#2fbf6b';
      ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s * 0.75, s * 0.12, s * 0.32, rot, 0, Math.PI * 2); ctx.fill();
    }
  }
  function bin(ctx, x, y, s) {
    ctx.fillStyle = '#3a3f4f'; ctx.beginPath(); ctx.moveTo(x - s * 0.22, y - s * 0.6); ctx.lineTo(x + s * 0.22, y - s * 0.6); ctx.lineTo(x + s * 0.18, y); ctx.lineTo(x - s * 0.18, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#555c70'; ctx.fillRect(x - s * 0.25, y - s * 0.66, s * 0.5, s * 0.08);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x - s * 0.15, y - s * 0.55, s * 0.05, s * 0.5);
  }
  function wetFloor(ctx, x, y, s) {
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(x - s * 0.18, y); ctx.lineTo(x - s * 0.06, y - s * 0.62); ctx.lineTo(x + s * 0.06, y - s * 0.62); ctx.lineTo(x + s * 0.18, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#b08800'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = `900 ${Math.max(6, Math.round(s * 0.16))}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('⚠', x, y - s * 0.36); ctx.font = `800 ${Math.max(5, Math.round(s * 0.07))}px system-ui, sans-serif`; ctx.fillText('WET', x, y - s * 0.18); ctx.fillText('FLOOR', x, y - s * 0.09);
  }
  function basketStack(ctx, x, y, s) {
    for (let i = 0; i < 4; i++) {
      const by = y - i * s * 0.08, w = s * 0.5, h = s * 0.22;
      ctx.fillStyle = i === 3 ? '#ff2a6d' : '#d61e5a'; ctx.fillRect(x - w / 2, by - h, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 1; k < 5; k++) ctx.fillRect(x - w / 2 + (k * w) / 5, by - h + 2, 1, h - 4);
    }
    ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - s * 0.46, s * 0.18, Math.PI, 0); ctx.stroke();
  }
  function camera(ctx, x, y, s, t) {
    ctx.fillStyle = '#2a2a35'; ctx.fillRect(x - 1, y, 2, s * 0.25);
    ctx.save(); ctx.translate(x, y + s * 0.3); ctx.rotate(0.5 + Math.sin(t * 0.4) * 0.35);
    ctx.fillStyle = '#d7dbe8'; rr(ctx, -s * 0.1, -s * 0.12, s * 0.55, s * 0.24, 3); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(s * 0.45, 0, s * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (Math.sin(t * 4) > 0) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x + 4, y + s * 0.18, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  function clock(ctx, x, y, r, hours) {
    ctx.fillStyle = '#f4f1de'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a2a35'; ctx.lineWidth = Math.max(1.5, r * 0.15); ctx.stroke();
    ctx.fillStyle = '#2a2a35';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.fillRect(x + Math.sin(a) * r * 0.75 - 0.5, y - Math.cos(a) * r * 0.75 - 0.5, 1, 1); }
    const hand = (a, len, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * len, y - Math.cos(a) * len); ctx.stroke(); };
    hand(((hours % 12) / 12) * Math.PI * 2, r * 0.5, 1.6); hand((hours % 1) * Math.PI * 2, r * 0.75, 1);
  }
  function lamp(ctx, x, y, s, warm, cordTop = 0) {
    ctx.strokeStyle = 'rgba(20,20,30,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, cordTop); ctx.lineTo(x, y - s * 0.3); ctx.stroke();
    ctx.fillStyle = '#1b1b26'; ctx.beginPath(); ctx.moveTo(x - s * 0.5, y); ctx.quadraticCurveTo(x, y - s * 0.6, x + s * 0.5, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = warm; ctx.beginPath(); ctx.ellipse(x, y, s * 0.42, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- shop decoration, bought with arcade coins ----------
  const DECOR = {
    floor: [
      { id: 'checker', name: 'Purple checker', cost: 0, a: '#1b0d38', b: '#22113f' },
      { id: 'marble', name: 'White marble', cost: 300, a: '#d2cce0', b: '#c2bbd4', vein: true },
      { id: 'wood', name: 'Oak boards', cost: 400, a: '#6b4423', b: '#77502c', planks: true },
      { id: 'grid', name: 'Neon grid', cost: 600, a: '#0b0221', b: '#0e0428', line: '#05d9e8' },
    ],
    walls: [
      { id: 'plum', name: 'Plum paint', cost: 0, wall: '#2a1248', trim: '#3d1a66' },
      { id: 'mint', name: 'Mint paint', cost: 200, wall: '#2c675c', trim: '#3f8a7c' },
      { id: 'sand', name: 'Sand paint', cost: 200, wall: '#7e6a4a', trim: '#a08860' },
      { id: 'night', name: 'Midnight blue', cost: 300, wall: '#101a3a', trim: '#1c2a5a' },
    ],
    sign: [
      { id: 'gold', name: 'Gold glow', cost: 0, color: '#ffd23f', glow: '#ff7a00' },
      { id: 'pink', name: 'Hot pink', cost: 250, color: '#ff5c8a', glow: '#ff2a6d' },
      { id: 'cyan', name: 'Ice cyan', cost: 250, color: '#7fe9ff', glow: '#05d9e8' },
      { id: 'rainbow', name: 'Rainbow', cost: 800, color: '#fff', glow: '#9b5de5', rainbow: true },
    ],
    plants: [
      { id: 'one', name: 'One plant', cost: 0 },
      { id: 'none', name: 'No plants', cost: 0 },
      { id: 'jungle', name: 'Urban jungle', cost: 500 },
    ],
    music: [
      { id: 'chill', name: 'Chill', cost: 0 },
      { id: 'synth', name: 'Synthwave', cost: 300 },
      { id: 'jazz', name: 'Lounge jazz', cost: 300 },
      { id: 'off', name: 'No music', cost: 0 },
    ],
    uniform: [
      { id: 'green', name: 'Green aprons', cost: 0, color: '#22c55e' },
      { id: 'red', name: 'Red aprons', cost: 150, color: '#ef4444' },
      { id: 'blue', name: 'Blue aprons', cost: 150, color: '#3b82f6' },
      { id: 'black', name: 'Black aprons', cost: 250, color: '#1f2937' },
    ],
  };
  const DECOR_NAMES = { floor: 'Floor', walls: 'Walls', sign: 'Shop sign', plants: 'Plants', music: 'Music', uniform: 'Staff uniforms' };
  const DECOR_KEY = 'neonTycoon.decor';
  function loadDecor() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(DECOR_KEY) || '{}') || {}; } catch { d = {}; }
    d.owned = Array.isArray(d.owned) ? d.owned : [];
    for (const k of Object.keys(DECOR)) if (!DECOR[k].some((x) => x.id === d[k])) d[k] = DECOR[k][0].id;
    return d;
  }
  function saveDecor(d) { try { localStorage.setItem(DECOR_KEY, JSON.stringify(d)); } catch { /* ignore */ } }
  // the chosen item in each category
  function decor() {
    const d = loadDecor(), out = {};
    for (const k of Object.keys(DECOR)) out[k] = DECOR[k].find((x) => x.id === d[k]);
    return out;
  }
  const owns = (d, cat, id) => DECOR[cat].find((x) => x.id === id).cost === 0 || d.owned.includes(`${cat}:${id}`);

  return { DECOR, DECOR_NAMES, loadDecor, saveDecor, decor, owns, pack, plant, bin, wetFloor, basketStack, camera, clock, lamp, palettes: (good) => (PALETTES[good] || PALETTES.drinks).length };
})();
