'use strict';

// Neon City: buildings the player buys with coins. Shown in the shop preview
// and as the skyline behind the road while running.
window.NeonCity = (() => {
  const PINK = '#ff2a6d', CYAN = '#05d9e8', YELLOW = '#f9c80e', GOLD = '#ffd23f';
  const BODY = '#1d0a3d', BODY2 = '#2b0f55';

  // x = slot position in city units from the centre; costs[i] buys level i + 1.
  const BUILDINGS = [
    { id: 'apartment', name: 'Apartment', x: -30, w: 14, h: 14, costs: [50, 120, 250],
      levels: ['A cosy 2-floor apartment', 'Add a 3rd floor', 'Penthouse + rooftop sign'] },
    { id: 'house', name: 'House', x: 28, w: 18, h: 15, costs: [150, 300],
      levels: ['Your own house', 'Neon trim + palm tree'] },
    { id: 'garage', name: 'Garage', x: -47, w: 15, h: 8, costs: [300, 500],
      levels: ['Garage with a car', 'Glowing sports car'] },
    { id: 'club', name: 'Night Club', x: 45, w: 18, h: 13, costs: [600, 1000],
      levels: ['Neon night club', 'Sweeping spotlights'] },
    { id: 'tower', name: 'Skyscraper', x: -10, w: 11, h: 37, costs: [1000, 2000, 3000],
      levels: ['A tall skyscraper', 'Build it higher', 'Sky-high + antenna'] },
    { id: 'billboard', name: 'Billboard', x: 11, w: 20, h: 28, costs: [5000],
      levels: ['Giant billboard with your name'] },
  ];

  // Cheap deterministic "random" so windows don't flicker randomly every frame.
  const hash = (a, b, c) => {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  function rect(ctx, x, y, w, h, fill, stroke, lw) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h); }
  }

  function windows(ctx, x, y, w, h, cols, rows, u, seed, t, colors = [CYAN, YELLOW]) {
    const cw = w / cols, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = hash(seed, r, c);
        const on = v < 0.65 || (v < 0.8 && Math.sin(t * 0.7 + v * 40) > 0);
        ctx.fillStyle = on ? colors[(r + c + seed) % colors.length] : '#12052a';
        ctx.globalAlpha = on ? 0.85 : 1;
        ctx.fillRect(x + c * cw + cw * 0.22, y + r * rh + rh * 0.22, cw * 0.56, rh * 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  const draw = {
    apartment(ctx, lv, x, base, u, t) {
      const floors = lv + 1, w = 14 * u, fh = 6 * u, h = floors * fh;
      const left = x - w / 2, top = base - h;
      rect(ctx, left, top, w, h, BODY, PINK, Math.max(1, u * 0.35));
      windows(ctx, left + u, top + u, w - 2 * u, h - 2 * u, 3, floors * 2, u, 1, t);
      if (lv >= 3) {
        rect(ctx, left + 3 * u, top - 3.5 * u, w - 6 * u, 3 * u, '#0b0221', CYAN, Math.max(1, u * 0.3));
        ctx.fillStyle = CYAN;
        ctx.font = `bold ${2.2 * u}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('HOME', x, top - 2 * u);
      }
    },

    house(ctx, lv, x, base, u, t) {
      const w = 16 * u, h = 9 * u, left = x - w / 2, top = base - h;
      rect(ctx, left, top, w, h, BODY2);
      ctx.beginPath();
      ctx.moveTo(left - u, top); ctx.lineTo(x, top - 6 * u); ctx.lineTo(left + w + u, top); ctx.closePath();
      ctx.fillStyle = '#3d1670'; ctx.fill();
      if (lv >= 2) { ctx.strokeStyle = CYAN; ctx.lineWidth = Math.max(1.5, u * 0.5); ctx.stroke(); }
      rect(ctx, x - 1.8 * u, base - 5 * u, 3.6 * u, 5 * u, YELLOW);                     // door
      rect(ctx, left + 2 * u, top + 2 * u, 3.5 * u, 3 * u, GOLD);                        // windows
      rect(ctx, left + w - 5.5 * u, top + 2 * u, 3.5 * u, 3 * u, GOLD);
      if (lv >= 2) {
        // palm tree
        const px = left - 3 * u;
        ctx.strokeStyle = '#3a1a5c'; ctx.lineWidth = u * 0.9;
        ctx.beginPath(); ctx.moveTo(px, base); ctx.quadraticCurveTo(px + u, base - 6 * u, px - 0.5 * u, base - 12 * u); ctx.stroke();
        ctx.strokeStyle = PINK; ctx.lineWidth = u * 0.6;
        const sway = Math.sin(t * 1.5) * 0.15;
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.7 + sway;
          ctx.beginPath();
          ctx.moveTo(px - 0.5 * u, base - 12 * u);
          ctx.quadraticCurveTo(px - 0.5 * u + Math.cos(a) * 3 * u, base - 12 * u + Math.sin(a) * 3 * u - u,
            px - 0.5 * u + Math.cos(a) * 5 * u, base - 12 * u + Math.sin(a) * 5 * u + 2 * u);
          ctx.stroke();
        }
      }
    },

    garage(ctx, lv, x, base, u, t) {
      const w = 15 * u, h = 8 * u, left = x - w / 2, top = base - h;
      rect(ctx, left, top, w, h, BODY, PINK, Math.max(1, u * 0.35));
      rect(ctx, left + 1.5 * u, top + 2 * u, w - 3 * u, h - 2 * u, '#0b0221');
      // car
      const cc = lv >= 2 ? PINK : '#5a4a8a';
      const cy = base - 1.2 * u;
      ctx.fillStyle = cc;
      ctx.fillRect(x - 5 * u, cy - 2.5 * u, 10 * u, 2 * u);
      ctx.fillRect(x - 3 * u, cy - 4.2 * u, 6 * u, 1.8 * u);
      ctx.fillStyle = '#0b0221';
      ctx.beginPath(); ctx.arc(x - 3 * u, cy - 0.4 * u, 1 * u, 0, Math.PI * 2); ctx.arc(x + 3 * u, cy - 0.4 * u, 1 * u, 0, Math.PI * 2); ctx.fill();
      if (lv >= 2) {
        ctx.fillStyle = YELLOW;
        ctx.fillRect(x - 5 * u, cy - 2.3 * u, 1.2 * u, 0.8 * u);
        ctx.fillRect(x + 3.8 * u, cy - 2.3 * u, 1.2 * u, 0.8 * u);
        ctx.fillStyle = CYAN; ctx.font = `bold ${1.6 * u}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('GARAGE', x, top + u);
      }
    },

    club(ctx, lv, x, base, u, t) {
      const w = 18 * u, h = 13 * u, left = x - w / 2, top = base - h;
      if (lv >= 2) {
        // spotlights sweeping the sky (drawn first so the building sits on top)
        for (const [ox, ph] of [[-5, 0], [5, 2]]) {
          const a = -Math.PI / 2 + Math.sin(t * 0.9 + ph) * 0.5;
          const sx = x + ox * u, sy = top;
          const len = 45 * u, spread = 0.08;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(a - spread) * len, sy + Math.sin(a - spread) * len);
          ctx.lineTo(sx + Math.cos(a + spread) * len, sy + Math.sin(a + spread) * len);
          ctx.closePath();
          ctx.fillStyle = 'rgba(5,217,232,.13)'; ctx.fill();
        }
      }
      rect(ctx, left, top, w, h, BODY2, CYAN, Math.max(1, u * 0.35));
      rect(ctx, x - 2.5 * u, base - 5 * u, 5 * u, 5 * u, '#0b0221', PINK, Math.max(1, u * 0.3));
      const on = Math.sin(t * 4) > -0.6;
      ctx.fillStyle = on ? PINK : '#5a1035';
      ctx.font = `900 italic ${4.2 * u}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('CLUB', x, top + 4 * u);
      windows(ctx, left + u, top + 6.5 * u, w - 2 * u, 2.2 * u, 6, 1, u, 7, t * 3, [PINK, CYAN, YELLOW]);
    },

    tower(ctx, lv, x, base, u, t) {
      const w = 11 * u, h = (25 + lv * 12) * u, left = x - w / 2, top = base - h;
      rect(ctx, left, top, w, h, '#170833', CYAN, Math.max(1, u * 0.35));
      windows(ctx, left + u, top + 2 * u, w - 2 * u, h - 3 * u, 3, Math.round(h / (3 * u)), u, 3, t);
      rect(ctx, left - u, top - u, w + 2 * u, u, CYAN);
      if (lv >= 3) {
        ctx.strokeStyle = '#8a7fb0'; ctx.lineWidth = Math.max(1, u * 0.4);
        ctx.beginPath(); ctx.moveTo(x, top - u); ctx.lineTo(x, top - 9 * u); ctx.stroke();
        if (Math.sin(t * 3) > 0) { ctx.fillStyle = '#ff3030'; ctx.beginPath(); ctx.arc(x, top - 9 * u, 0.8 * u, 0, Math.PI * 2); ctx.fill(); }
      }
    },

    billboard(ctx, lv, x, base, u, t, name) {
      const bw = 20 * u, bh = 8 * u, top = base - 28 * u;
      ctx.fillStyle = '#3a1a5c';
      ctx.fillRect(x - 4 * u, top + bh, 1.2 * u, 28 * u - bh);
      ctx.fillRect(x + 2.8 * u, top + bh, 1.2 * u, 28 * u - bh);
      rect(ctx, x - bw / 2, top, bw, bh, '#0b0221', YELLOW, Math.max(1.5, u * 0.5));
      const label = (name || 'PLAYER').toUpperCase();
      let size = 4 * u;
      ctx.font = `900 italic ${size}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      if (tw > bw * 0.88) { size *= (bw * 0.88) / tw; ctx.font = `900 italic ${size}px system-ui, sans-serif`; }
      const hue = (t * 40) % 360;
      ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x, top + bh / 2);
    },
  };

  // Faint outline of an unbuilt lot, used in the shop preview.
  function ghost(ctx, b, x, base, u) {
    ctx.save();
    ctx.setLineDash([u * 0.8, u * 0.8]);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = Math.max(1, u * 0.3);
    ctx.strokeRect(x - (b.w * u) / 2, base - b.h * u, b.w * u, b.h * u);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = `bold ${3 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', x, base - (b.h * u) / 2);
  }

  // Draw every building. cx = screen x of the city centre, base = ground line,
  // u = pixels per city unit. Order: tall/back ones first.
  const ORDER = ['tower', 'billboard', 'club', 'apartment', 'house', 'garage'];
  function drawCity(ctx, levels, cx, base, u, t, opts = {}) {
    for (const id of ORDER) {
      const b = BUILDINGS.find((k) => k.id === id);
      const lv = levels[id] || 0;
      const x = cx + b.x * u;
      if (lv > 0) draw[id](ctx, lv, x, base, u, t, opts.name);
      else if (opts.ghosts) ghost(ctx, b, x, base, u);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  return { BUILDINGS, drawCity };
})();
