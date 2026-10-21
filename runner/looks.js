'use strict';

// Runner outfits and trails: definitions, drawing, and trail simulation.
window.NeonLooks = (() => {
  const PINK = '#ff2a6d', CYAN = '#05d9e8', YELLOW = '#f9c80e', GOLD = '#ffd23f';

  const OUTFITS = [
    { id: 'classic', name: 'Classic', cost: 0, desc: 'The original neon jacket',
      jacket: CYAN, arms: '#04a8b4', stripe: PINK, pants: '#1b1035', shoes: YELLOW, head: '#1b1035' },
    { id: 'pink', name: 'Hot Pink', cost: 100, desc: 'Pink jacket + cyan cap',
      jacket: PINK, arms: '#c81e55', stripe: CYAN, pants: '#1b1035', shoes: CYAN, head: '#1b1035', acc: 'cap', accColor: CYAN },
    { id: 'sunset', name: 'Sunset Punk', cost: 200, desc: 'Orange jacket + mohawk',
      jacket: '#ff7a00', arms: '#d45f00', stripe: YELLOW, pants: '#3a1a5c', shoes: PINK, head: '#1b1035', acc: 'mohawk', accColor: PINK },
    { id: 'dj', name: 'DJ', cost: 350, desc: 'Purple suit + headphones',
      jacket: '#7b2ff7', arms: '#5a1fc0', stripe: CYAN, pants: '#120622', shoes: '#ffffff', head: '#1b1035', acc: 'headphones', accColor: CYAN },
    { id: 'ninja', name: 'Cyber Ninja', cost: 600, desc: 'Stealth suit + red headband',
      jacket: '#1c1c2a', arms: '#121220', stripe: '#ff3030', pants: '#121220', shoes: '#ff3030', head: '#1c1c2a', acc: 'headband', accColor: '#ff3030' },
    { id: 'gold', name: 'Golden King', cost: 1500, desc: 'Solid gold + a crown',
      jacket: GOLD, arms: '#d4a017', stripe: '#fff5c2', pants: '#3a2a05', shoes: '#ffffff', head: '#1b1035', acc: 'crown', accColor: GOLD },
    { id: 'holo', name: 'Hologram', cost: 3000, desc: 'Colour-shifting hologram suit',
      jacket: CYAN, arms: '#04a8b4', stripe: '#ffffff', pants: '#2a1a4a', shoes: '#ffffff', head: '#2a1a4a', holo: true, acc: 'headphones', accColor: '#ffffff' },
  ];

  const TRAILS = [
    { id: 'none', name: 'No Trail', cost: 0, icon: '🚫', desc: 'Just you and the road' },
    { id: 'streak', name: 'Neon Streak', cost: 150, icon: '💫', desc: 'Cyan light from your shoes' },
    { id: 'fire', name: 'Fire Feet', cost: 300, icon: '🔥', desc: 'Leave flames behind you' },
    { id: 'rainbow', name: 'Rainbow', cost: 600, icon: '🌈', desc: 'A full rainbow ribbon' },
    { id: 'sparkle', name: 'Stardust', cost: 1000, icon: '✨', desc: 'Golden sparkles everywhere' },
    { id: 'lightning', name: 'Lightning', cost: 2000, icon: '⚡', desc: 'Crackling electric bolts' },
  ];

  const byId = (list, id) => list.find((x) => x.id === id) || list[0];

  // ---------- Runner (screen space: x,y = feet, s = pixels per unit) ----------
  function line(ctx, x0, y0, x1, y1, color, w) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }

  function drawRunner(ctx, x, y, s, pose, outfit, t) {
    const of = outfit;
    let jacket = of.jacket, arms = of.arms;
    ctx.save();
    if (of.holo) {
      const h = (t * 90) % 360;
      jacket = `hsl(${h}, 100%, 62%)`;
      arms = `hsl(${(h + 40) % 360}, 90%, 48%)`;
      ctx.globalAlpha = 0.88;
    }
    ctx.translate(x, y);
    ctx.rotate((pose.lean || 0) * 0.18);
    ctx.lineCap = 'round';
    const air = !!pose.air;
    const run = air ? 0 : Math.sin(pose.phase || 0);
    const hipY = -0.85 * s;

    // legs (from behind: the leg pushing off is down, the swinging one is lifted)
    const legs = [[-0.13, air ? 0.25 : Math.max(0, run) * 0.32], [0.13, air ? 0.12 : Math.max(0, -run) * 0.32]];
    for (const [lx, lift] of legs) {
      const fx = lx * s, fy = -lift * s;
      line(ctx, lx * s * 0.8, hipY, fx, fy - 0.06 * s, of.pants, 0.17 * s);
      ctx.fillStyle = of.shoes;
      ctx.fillRect(fx - 0.09 * s, fy - 0.1 * s, 0.18 * s, 0.1 * s);
    }
    // arms
    const swing = air ? -0.25 : run * 0.18;
    line(ctx, -0.3 * s, -1.38 * s, -0.36 * s, (-0.95 + swing) * s, arms, 0.13 * s);
    line(ctx, 0.3 * s, -1.38 * s, 0.36 * s, (-0.95 - swing) * s, arms, 0.13 * s);
    // torso
    ctx.fillStyle = jacket;
    roundRect(ctx, -0.3 * s, -1.48 * s, 0.6 * s, 0.68 * s, 0.12 * s);
    ctx.fill();
    ctx.fillStyle = of.stripe;
    ctx.fillRect(-0.3 * s, -1.2 * s, 0.6 * s, 0.07 * s);
    // head
    const hy = -1.66 * s, hr = 0.17 * s;
    ctx.fillStyle = of.head;
    ctx.beginPath(); ctx.arc(0, hy, hr, 0, Math.PI * 2); ctx.fill();
    drawAccessory(ctx, of, s, hy, hr, t);
    ctx.restore();
  }

  function drawAccessory(ctx, of, s, hy, hr, t) {
    const c = of.accColor;
    switch (of.acc) {
      case 'cap':
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, hy + 0.01 * s, hr * 1.08, Math.PI, 0); ctx.fill();
        ctx.fillRect(-hr * 1.1, hy - 0.01 * s, hr * 2.2, 0.05 * s);
        break;
      case 'mohawk':
        ctx.fillStyle = c;
        for (let i = 0; i < 4; i++) {
          const yy = hy - hr * 0.6 + i * 0.07 * s;
          ctx.beginPath();
          ctx.moveTo(-0.04 * s, yy); ctx.lineTo(0, yy - 0.16 * s); ctx.lineTo(0.04 * s, yy); ctx.closePath(); ctx.fill();
        }
        break;
      case 'headphones':
        ctx.strokeStyle = c; ctx.lineWidth = 0.05 * s;
        ctx.beginPath(); ctx.arc(0, hy, hr * 1.2, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        ctx.fillStyle = c;
        ctx.fillRect(-hr * 1.35, hy - 0.06 * s, 0.08 * s, 0.14 * s);
        ctx.fillRect(hr * 1.35 - 0.08 * s, hy - 0.06 * s, 0.08 * s, 0.14 * s);
        break;
      case 'headband': {
        ctx.fillStyle = c;
        ctx.fillRect(-hr, hy - 0.06 * s, hr * 2, 0.06 * s);
        const wave = Math.sin(t * 14) * 0.05 * s;
        ctx.strokeStyle = c; ctx.lineWidth = 0.04 * s;
        ctx.beginPath();
        ctx.moveTo(hr * 0.7, hy - 0.03 * s);
        ctx.quadraticCurveTo(hr * 1.6, hy + wave, hr * 2.4, hy + 0.04 * s - wave);
        ctx.stroke();
        break;
      }
      case 'crown':
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(-hr, hy - hr * 0.6);
        ctx.lineTo(-hr, hy - hr * 1.7); ctx.lineTo(-hr * 0.5, hy - hr * 1.15);
        ctx.lineTo(0, hy - hr * 2); ctx.lineTo(hr * 0.5, hy - hr * 1.15);
        ctx.lineTo(hr, hy - hr * 1.7); ctx.lineTo(hr, hy - hr * 0.6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = PINK;
        ctx.beginPath(); ctx.arc(0, hy - hr * 0.95, hr * 0.18, 0, Math.PI * 2); ctx.fill();
        break;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Trails (world space; the runner stays at z = 0) ----------
  // History points are stored by the distance they were recorded at, so a point
  // recorded `back` units ago now sits at z = -back, streaming toward the camera.
  const createTrail = () => ({ pts: [], parts: [], spawn: 0 });
  const rand = (a, b) => a + Math.random() * (b - a);
  const FIRE = [PINK, '#ff7a00', GOLD];
  const RAINBOW = ['#ff3b3b', '#ff9a00', '#ffe600', '#2ee86b', '#05d9e8', '#8a4dff'];

  function updateTrail(tr, type, runner, distance, speed, dt, minZ) {
    tr.pts.push({ x: runner.x, y: runner.y, d: distance });
    tr.pts = tr.pts.filter((p) => distance - p.d < -minZ);
    if (tr.pts.length > 80) tr.pts.splice(0, tr.pts.length - 80);

    for (const p of tr.parts) {
      p.z -= speed * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    tr.parts = tr.parts.filter((p) => p.life > 0 && p.z > minZ);

    const rate = type === 'fire' ? 110 : type === 'sparkle' ? 40 : 0;
    if (!rate) return;
    tr.spawn += rate * dt;
    while (tr.spawn >= 1) {
      tr.spawn -= 1;
      if (type === 'fire') {
        const foot = Math.random() < 0.5 ? -0.13 : 0.13;
        tr.parts.push({ x: runner.x + foot + rand(-0.05, 0.05), y: runner.y + 0.05, z: rand(-0.3, 0),
          vx: rand(-0.3, 0.3), vy: rand(0.8, 2.2), life: rand(0.2, 0.35), max: 0.35, size: rand(0.07, 0.13),
          c: FIRE[(Math.random() * 3) | 0] });
      } else {
        tr.parts.push({ x: runner.x + rand(-0.45, 0.45), y: runner.y + rand(0.2, 1.6), z: rand(-0.5, 0),
          vx: rand(-0.2, 0.2), vy: rand(-0.3, 0.4), life: rand(0.3, 0.6), max: 0.6, size: rand(0.05, 0.09),
          c: Math.random() < 0.7 ? GOLD : '#ffffff' });
      }
    }
  }

  function ribbon(ctx, proj, pts, distance, minZ, xOff, y, color, width, jitter = 0) {
    const n = pts.length;
    if (n < 2) return;
    let prev = null;
    for (let i = n - 1; i >= 0; i--) {
      const p = pts[i];
      const z = -(distance - p.d);
      const k = z / minZ; // 0 at the runner, 1 at the oldest point
      const j = jitter * (1 - k * 0.8); // calmer near the camera, where everything looks bigger
      const jx = j ? (Math.random() - 0.5) * j : 0;
      const jy = j ? (Math.random() - 0.5) * j : 0;
      const sp = proj(p.x + xOff + jx, p.y + y + jy, z);
      if (prev) {
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(sp.x, sp.y);
        ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, width * sp.s * (1 - k * 0.5)); ctx.stroke();
      }
      prev = sp;
    }
    ctx.globalAlpha = 1;
  }

  function star(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.35 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }

  function drawTrail(ctx, proj, tr, type, distance, t, minZ) {
    if (type === 'none') return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (type) {
      case 'streak':
        for (const fx of [-0.13, 0.13]) {
          ribbon(ctx, proj, tr.pts, distance, minZ, fx, 0.05, 'rgba(5,217,232,.35)', 0.22);
          ribbon(ctx, proj, tr.pts, distance, minZ, fx, 0.05, CYAN, 0.09);
          ribbon(ctx, proj, tr.pts, distance, minZ, fx, 0.05, '#ffffff', 0.03);
        }
        break;
      case 'rainbow':
        RAINBOW.forEach((c, i) => ribbon(ctx, proj, tr.pts, distance, minZ, (i - 2.5) * 0.1, 0.04, c, 0.1));
        break;
      case 'lightning':
        ribbon(ctx, proj, tr.pts, distance, minZ, 0, 0.6, 'rgba(5,217,232,.35)', 0.25, 0.5);
        ribbon(ctx, proj, tr.pts, distance, minZ, 0, 0.6, CYAN, 0.08, 0.5);
        ribbon(ctx, proj, tr.pts, distance, minZ, 0, 0.6, '#ffffff', 0.035, 0.35);
        break;
      default:
        for (const p of tr.parts) {
          const sp = proj(p.x, p.y, p.z);
          const k = Math.max(0, p.life / p.max);
          ctx.globalAlpha = k;
          ctx.fillStyle = p.c;
          const r = p.size * sp.s * (type === 'fire' ? (0.4 + k * 0.6) : (0.6 + 0.4 * Math.sin(t * 20 + p.x * 9)));
          if (type === 'fire') { ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill(); }
          else star(ctx, sp.x, sp.y, Math.max(0.5, r * 1.6));
        }
    }
    ctx.restore();
  }

  return { OUTFITS, TRAILS, byId, drawRunner, createTrail, updateTrail, drawTrail };
})();
