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

  // ---------- Runner ----------
  // A simple skeleton animated in side view (y up, z forward), then projected as
  // seen from behind and slightly above: things further forward appear higher.
  const HAIRS = [
    { id: 'short', name: 'Short' }, { id: 'buzz', name: 'Buzz' }, { id: 'long', name: 'Long' },
    { id: 'ponytail', name: 'Ponytail' }, { id: 'bun', name: 'Bun' }, { id: 'afro', name: 'Afro' },
    { id: 'locs', name: 'Locs' },
  ];
  const HAIR_COLORS = ['#1a1418', '#4a2c1a', '#c99a4b', '#a3412a', '#ff2a6d', '#05d9e8'];
  const SKINS = ['#f3cfb3', '#e0a986', '#c08058', '#8d5a3b', '#5a3825'];
  const DEPTH = 0.18;
  const B = { hip: 0.93, hipW: 0.1, thigh: 0.45, shin: 0.46, shoulderY: 1.42, shoulderW: 0.235, upper: 0.29, fore: 0.27 };

  // Darken (amt < 0) or lighten (amt > 0) a #rrggbb colour.
  function shade(hex, amt) {
    if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return hex;
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }

  // Blend two #rrggbb colours (other colour formats are returned unchanged).
  const isHex = (c) => typeof c === 'string' && c[0] === '#' && c.length === 7;
  function mix(a, b, t) {
    if (!isHex(a) || !isHex(b)) return a;
    const A = parseInt(a.slice(1), 16), Bc = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((A >> sh) & 255) * (1 - t) + ((Bc >> sh) & 255) * t);
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
  }

  // Shading across a rounded body part: neon rim light on both edges (pink from the
  // left, cyan from the right), a soft highlight, and shadow toward the edges.
  // k scales the contrast (1 for limbs, lower for big flat areas like the back).
  function roundShade(ctx, x0, y0, x1, y1, color, k = 1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    if (!isHex(color)) { g.addColorStop(0, color); g.addColorStop(1, color); return g; }
    g.addColorStop(0, mix(color, '#ff2a6d', 0.45 * k));
    g.addColorStop(0.12, shade(color, -0.3 * k));
    g.addColorStop(0.42, color);
    g.addColorStop(0.58, shade(color, 0.14 * k));
    g.addColorStop(0.86, shade(color, -0.32 * k));
    g.addColorStop(1, mix(color, '#05d9e8', 0.4 * k));
    return g;
  }

  // A limb segment as a tapered, muscled shape. prof = [[t, halfWidth], ...] from a0 (t=0)
  // to a1 (t=1), in body units; a0/a1 are screen points.
  function limb(ctx, a0, a1, prof, color, s) {
    const dx = a1.x - a0.x, dy = a1.y - a0.y, len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if (nx < 0) { nx = -nx; ny = -ny; } // n points to screen-right, so shading stays consistent
    const side = (sign) => prof.map(([tt, hw]) => ({ x: a0.x + dx * tt + sign * nx * hw * s, y: a0.y + dy * tt + sign * ny * hw * s }));
    const pts = [...side(-1), ...side(1).reverse()];
    const maxW = Math.max(...prof.map((q) => q[1])) * s;
    const mx = (a0.x + a1.x) / 2, my = (a0.y + a1.y) / 2;
    ctx.fillStyle = roundShade(ctx, mx - nx * maxW, my - ny * maxW, mx + nx * maxW, my + ny * maxW, color);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.closePath();
    ctx.fill();
    // rounded joints at both ends
    for (const [pt, hw] of [[a0, prof[0][1]], [a1, prof[prof.length - 1][1]]]) {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, hw * s, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Running gait for one leg at stride phase a (the other leg is half a cycle apart).
  // k = stride intensity: 0 standing still, 1 full running stride.
  // The thigh drives well forward (knee lift) and extends less far back; the knee
  // flexes a little through stance to cushion the landing and a lot during the
  // recovery swing (heel kick). Stance is centred on a = π, recovery on a = 0.
  function legPose(a, k = 1) {
    const sa = Math.sin(a);
    const thigh = k * (sa > 0 ? 0.85 : 0.45) * sa;
    const rec = Math.max(0, Math.cos(a));
    const stance = Math.max(0, -Math.cos(a));
    return { thigh, knee: k * (0.12 + 0.3 * stance + 1.6 * rec * rec) };
  }

  const footY = (p) => B.hip - Math.cos(p.thigh) * B.thigh - Math.cos(p.thigh - p.knee) * B.shin;
  const BOUNCE = 0.09;  // height of the flight arc between footfalls
  const CONTACT = 0.45; // share of each step with a foot planted

  // Running is not walking: each step has a contact part (stance foot planted on the
  // road) and a flight part where the body arcs up and both feet are in the air.
  // Footfalls happen once per half cycle, centred on a = 0 and a = π.
  function gaitLift(a, k) {
    const planted = -Math.min(footY(legPose(a, k)), footY(legPose(a + Math.PI, k))) + 0.01;
    const u = ((((a + (CONTACT * Math.PI) / 2) % Math.PI) + Math.PI) % Math.PI) / Math.PI; // 0..1 within a step
    const flight = u < CONTACT ? 0 : Math.sin((Math.PI * (u - CONTACT)) / (1 - CONTACT));
    return planted + k * BOUNCE * flight;
  }

  function limbChain(x0, y0, z0, ang1, len1, ang2, len2) {
    const x1 = x0, y1 = y0 - Math.cos(ang1) * len1, z1 = z0 + Math.sin(ang1) * len1;
    const y2 = y1 - Math.cos(ang2) * len2, z2 = z1 + Math.sin(ang2) * len2;
    return [{ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, { x: x1, y: y2, z: z2 }];
  }

  // Hair seen from behind. hc = screen centre of the head; sw = stride swing (-1..1).
  function drawHair(ctx, style, color, hc, s, t, sw) {
    const cap = (ry, dy) => { ctx.beginPath(); ctx.ellipse(0, hc.y - dy * s, 0.115 * s, ry * s, 0, 0, Math.PI * 2); ctx.fill(); };
    const strand = (x0, y0, x1, y1, w) => {
      ctx.lineWidth = w * s;
      ctx.beginPath(); ctx.moveTo(x0 * s, hc.y + y0 * s);
      ctx.quadraticCurveTo(x0 * s, hc.y + ((y0 + y1) / 2) * s, x1 * s, hc.y + y1 * s); ctx.stroke();
    };
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round';
    const swing = sw * 0.06 + Math.sin(t * 9) * 0.01; // hair lags the stride
    switch (style) {
      case 'buzz':
        ctx.globalAlpha *= 0.85; cap(0.11, 0.035); ctx.globalAlpha /= 0.85;
        break;
      case 'long':
        cap(0.125, 0.022);
        ctx.beginPath();
        ctx.moveTo(-0.118 * s, hc.y - 0.01 * s);
        ctx.quadraticCurveTo(-0.14 * s, hc.y + 0.14 * s, (-0.12 + swing) * s, hc.y + 0.27 * s);
        ctx.quadraticCurveTo(swing * s, hc.y + 0.31 * s, (0.12 + swing) * s, hc.y + 0.27 * s);
        ctx.quadraticCurveTo(0.14 * s, hc.y + 0.14 * s, 0.118 * s, hc.y - 0.01 * s);
        ctx.closePath(); ctx.fill();
        break;
      case 'ponytail':
        cap(0.125, 0.022);
        strand(0, 0.02, swing * 1.6, 0.3, 0.075);
        strand(swing * 1.6, 0.3, swing * 2.2, 0.38, 0.05);
        ctx.fillStyle = '#ff2a6d';
        ctx.beginPath(); ctx.arc(0, hc.y + 0.03 * s, 0.03 * s, 0, Math.PI * 2); ctx.fill();
        break;
      case 'bun':
        cap(0.125, 0.022);
        ctx.beginPath(); ctx.arc(0, hc.y - 0.1 * s, 0.065 * s, 0, Math.PI * 2); ctx.fill();
        break;
      case 'afro':
        ctx.beginPath(); ctx.arc(0, hc.y - 0.035 * s, 0.17 * s, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 12; i++) {
          const ang = (i / 12) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(Math.cos(ang) * 0.16 * s, hc.y - 0.035 * s + Math.sin(ang) * 0.16 * s, 0.035 * s, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'locs':
        cap(0.125, 0.022);
        for (let i = 0; i < 7; i++) {
          const x0 = -0.1 + i * 0.033;
          strand(x0, 0.02, x0 * 1.2 + swing * (0.8 + (i % 3) * 0.2), 0.26 + (i % 2) * 0.03, 0.032);
        }
        break;
      default: // short
        cap(0.125, 0.022);
    }
  }

  // Eyes, brows and mouth for the front view. mood: 'happy' | 'meh' | 'sad' | 'angry' | undefined.
  function drawFace(ctx, hy, s, mood) {
    const ink = '#1b1035';
    ctx.fillStyle = ink;
    for (const ex of [-0.042, 0.042]) { ctx.beginPath(); ctx.arc(ex * s, hy + 0.005 * s, Math.max(0.8, 0.014 * s), 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, 0.012 * s); ctx.lineCap = 'round';
    if (mood === 'angry') {
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * 0.065 * s, hy - 0.04 * s); ctx.lineTo(sd * 0.02 * s, hy - 0.022 * s); ctx.stroke(); }
    }
    const my = hy + 0.062 * s, mw = 0.035 * s;
    ctx.beginPath();
    if (mood === 'happy') ctx.arc(0, my - 0.02 * s, mw, 0.15 * Math.PI, 0.85 * Math.PI);
    else if (mood === 'sad' || mood === 'angry') ctx.arc(0, my + 0.025 * s, mw, 1.2 * Math.PI, 1.8 * Math.PI);
    else { ctx.moveTo(-mw * 0.8, my); ctx.lineTo(mw * 0.8, my); }
    ctx.stroke();
  }

  // lk = the player's look: { skin, hair, hairColor } (a number is treated as a skin index)
  function drawRunner(ctx, x, y, s, pose, outfit, t, lk = {}) {
    if (typeof lk === 'number') lk = { skin: lk };
    const of = outfit;
    const skin = SKINS[lk.skin === undefined ? 2 : lk.skin] || SKINS[2];
    const hairColor = HAIR_COLORS[lk.hairColor || 0] || HAIR_COLORS[0];
    let jacket = of.jacket, sleeve = of.arms;
    if (of.holo) {
      const h = (t * 90) % 360;
      jacket = `hsl(${h}, 100%, 62%)`;
      sleeve = `hsl(${(h + 40) % 360}, 90%, 52%)`;
    }
    const air = !!pose.air;
    const a = pose.phase || 0;

    // --- pose ---
    let L, R, armL, armR;
    const fall = pose.fall;
    if (fall && !fall.grounded) {
      // tumbling: knees pulled up, arms flailing
      L = { thigh: 0.7, knee: 1.3 }; R = { thigh: -0.3, knee: 0.7 };
      armL = { sh: 2.1 + Math.sin(fall.t * 24) * 0.6, el: 0.4 };
      armR = { sh: 1.7 + Math.cos(fall.t * 21) * 0.6, el: 0.6 };
    } else if (fall) {
      // lying on the road, limp
      L = { thigh: 0.35, knee: 0.6 }; R = { thigh: -0.1, knee: 0.25 };
      armL = { sh: 1.5, el: 0.35 }; armR = { sh: -0.35, el: 0.7 };
    } else if (air) {
      L = { thigh: 0.95, knee: 1.7 }; R = { thigh: -0.15, knee: 1.15 };
      armL = { sh: -0.45, el: 0.9 }; armR = { sh: 0.5, el: 1.0 };
    } else {
      const k = pose.stride === undefined ? 1 : pose.stride;
      L = legPose(a, k); R = legPose(a + Math.PI, k);
      // arms pump opposite to the leg on the same side; the elbow stays near 90° and
      // closes a little as the hand drives forward and up toward the chest
      const idle = (1 - k) * 0.04 * Math.sin(t * 2); // slight breathing sway when standing
      const sw = Math.sin(a);
      armL = { sh: -0.85 * k * sw + idle, el: 0.25 + k * (1.35 - 0.4 * sw) };
      armR = { sh: 0.85 * k * sw - idle, el: 0.25 + k * (1.35 + 0.4 * sw) };
      // landing squash: knees bend and the hips drop (the feet stay planted)
      const q = pose.squash || 0;
      if (q > 0) {
        for (const leg of [L, R]) { leg.thigh += 0.45 * q; leg.knee += 0.95 * q; }
        armL.sh -= 0.25 * q; armR.sh -= 0.25 * q;
      }
    }
    const legs = [[-1, L], [1, R]].map(([side, p]) => ({
      side, kind: 'leg', pts: limbChain(side * B.hipW, B.hip, 0, p.thigh, B.thigh, p.thigh - p.knee, B.shin), kick: p.knee,
    }));
    const running = !fall && !air;
    const k = running ? (pose.stride === undefined ? 1 : pose.stride) : 0;
    let lift = 0;
    if (fall) lift = 0.12 * Math.abs(Math.sin(pose.roll || 0)); // body thickness when lying on its side
    else if (running) {
      lift = gaitLift(a, k);
      // landing squash keeps the feet planted while the knees bend
      const q = Math.min(1, (pose.squash || 0) * 4);
      if (q > 0) lift += (-Math.min(legs[0].pts[2].y, legs[1].pts[2].y) + 0.02 - lift) * q;
    }
    const twist = running ? 0.07 * k * Math.sin(a) : 0; // shoulders counter-rotate against the hips
    const arms = [[-1, armL, twist], [1, armR, -twist]].map(([side, p, tz]) => {
      const pts = limbChain(side * B.shoulderW, B.shoulderY, tz, p.sh, B.upper, p.sh + p.el, B.fore);
      const fwd = Math.max(-1, Math.min(1, p.sh / 0.85)); // +1 arm forward, -1 arm back
      pts[1].x = side * B.shoulderW * (1.05 + 0.15 * Math.max(0, -fwd)); // elbow flares out when back
      pts[2].x = side * B.shoulderW * (0.85 - 0.35 * Math.max(0, fwd)); // hand comes across when forward
      return { side, kind: 'arm', pts };
    });
    // the body shifts a little over whichever foot is on the ground
    const sway = k * Math.cos(a);

    // pose.front: seen from the front (facing the camera), e.g. shoppers walking up to you.
    // Mirror left/right and flip depth so the near side is drawn last.
    const front = !!pose.front, zs = front ? -1 : 1;
    const P = (px, py, pz) => ({ x: (front ? -px : px) * s, y: -(py + lift + zs * pz * DEPTH) * s });

    ctx.save();
    if (of.holo) ctx.globalAlpha *= 0.9; // multiply, so ghosts stay see-through
    ctx.translate(x + sway * 0.035 * s, y);
    ctx.rotate(fall ? pose.roll || 0 : (pose.lean || 0) * 0.16 + sway * 0.025);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pt = (q) => P(q.x, q.y, q.z);

    // Muscle profiles (half-widths along each segment, in body units).
    const THIGH = [[0, 0.083], [0.3, 0.088], [0.7, 0.071], [1, 0.056]];
    const SHIN = [[0, 0.055], [0.28, 0.064], [0.65, 0.048], [1, 0.036]];
    const UPPER = [[0, 0.05], [0.4, 0.049], [1, 0.04]];
    const FORE = [[0, 0.039], [0.3, 0.04], [1, 0.028]];

    const drawShoe = (f, kick) => {
      const w = 0.16 * s, h = 0.11 * s;
      if (kick > 0.9) {
        // heel kicked up toward the camera: we see the sole and its tread
        ctx.fillStyle = '#2b2b33';
        ctx.beginPath(); ctx.ellipse(f.x, f.y - 0.03 * s, w * 0.5, h * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = Math.max(1, 0.008 * s);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(f.x - w * 0.35, f.y - 0.03 * s + i * h * 0.16); ctx.lineTo(f.x + w * 0.35, f.y - 0.03 * s + i * h * 0.16); ctx.stroke();
        }
        return;
      }
      // heel counter: coloured upper, white midsole, dark pull tab
      const x0 = f.x - w / 2, y0 = f.y - h;
      ctx.fillStyle = roundShade(ctx, x0, 0, x0 + w, 0, of.shoes);
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.12, y0);
      ctx.lineTo(x0 + w * 0.88, y0);
      ctx.quadraticCurveTo(x0 + w, y0 + h * 0.2, x0 + w, f.y - h * 0.25);
      ctx.lineTo(x0, f.y - h * 0.25);
      ctx.quadraticCurveTo(x0, y0 + h * 0.2, x0 + w * 0.12, y0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2f2f2';
      ctx.beginPath(); ctx.ellipse(f.x, f.y - h * 0.16, w * 0.52, h * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(f.x - w * 0.08, y0 - h * 0.05, w * 0.16, h * 0.32);
    };

    const drawLeg = (lg) => {
      const [hp, kn, ft] = lg.pts;
      const H = pt(hp), K = pt(kn), F = pt(ft);
      limb(ctx, H, K, THIGH, of.pants, s);
      limb(ctx, K, F, SHIN, of.pants, s);
      // ankle cuff
      const cx = K.x + (F.x - K.x) * 0.86, cy = K.y + (F.y - K.y) * 0.86;
      ctx.fillStyle = shade(of.pants, -0.35);
      ctx.beginPath(); ctx.arc(cx, cy, 0.04 * s, 0, Math.PI * 2); ctx.fill();
      drawShoe(F, lg.kick);
    };

    const drawArm = (arm) => {
      const [sh, el, hd] = arm.pts;
      const S = pt(sh), E = pt(el), Hh = pt(hd);
      limb(ctx, E, Hh, FORE, skin, s);
      limb(ctx, S, E, UPPER, sleeve, s);
      // sleeve cuff at the elbow, then a loose fist
      ctx.fillStyle = shade(of.arms, -0.2);
      ctx.beginPath(); ctx.arc(E.x, E.y, 0.05 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = roundShade(ctx, Hh.x - 0.05 * s, 0, Hh.x + 0.05 * s, 0, skin);
      ctx.beginPath(); ctx.ellipse(Hh.x, Hh.y, 0.05 * s, 0.043 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = Math.max(1, 0.008 * s);
      ctx.beginPath(); ctx.moveTo(Hh.x - 0.03 * s, Hh.y + 0.012 * s); ctx.lineTo(Hh.x + 0.03 * s, Hh.y + 0.012 * s); ctx.stroke();
    };

    // soft contact shadow under each foot, fading as the foot lifts
    for (const lg of legs) {
      const ft = lg.pts[2], height = ft.y + lift;
      const g = P(ft.x, -lift, ft.z);
      const k2 = Math.max(0, 1 - height / 0.35);
      if (k2 <= 0) continue;
      ctx.fillStyle = `rgba(0,0,0,${0.45 * k2})`;
      ctx.beginPath(); ctx.ellipse(g.x, g.y, 0.09 * s * (1.3 - 0.3 * k2), 0.03 * s, 0, 0, Math.PI * 2); ctx.fill();
    }

    const drawBody = () => {
      // hips / shorts
      const hl = P(-0.17, 0.86, 0), hr = P(0.17, 1.04, 0);
      ctx.fillStyle = of.pants;
      ctx.beginPath();
      ctx.moveTo(hl.x, hr.y); ctx.lineTo(hr.x, hr.y); ctx.lineTo(hr.x * 0.95, hl.y);
      ctx.quadraticCurveTo(0, hl.y + 0.05 * s, hl.x * 0.95, hl.y); ctx.closePath(); ctx.fill();
      // torso: waist -> chest -> rounded shoulders -> neckline
      const q = (px, py) => P(px, py, 0);
      const w0 = q(-0.155, 0.97), c0 = q(-0.2, 1.3), s0 = q(-0.225, 1.41), n0 = q(-0.075, 1.5);
      const n1 = q(0.075, 1.5), s1 = q(0.225, 1.41), c1 = q(0.2, 1.3), w1 = q(0.155, 0.97);
      const top = q(0, 1.47);
      ctx.beginPath();
      ctx.moveTo(w0.x, w0.y);
      ctx.quadraticCurveTo(c0.x * 1.05, (w0.y + c0.y) / 2, c0.x, c0.y);
      ctx.quadraticCurveTo(s0.x * 1.02, s0.y + 0.02 * s, s0.x * 0.85, s0.y - 0.04 * s);
      ctx.quadraticCurveTo(n0.x * 1.6, top.y, n0.x, n0.y);
      ctx.lineTo(n1.x, n1.y);
      ctx.quadraticCurveTo(n1.x * 1.6, top.y, s1.x * 0.85, s1.y - 0.04 * s);
      ctx.quadraticCurveTo(s1.x * 1.02, s1.y + 0.02 * s, c1.x, c1.y);
      ctx.quadraticCurveTo(c1.x * 1.05, (w1.y + c1.y) / 2, w1.x, w1.y);
      // the hem flutters a little with the stride
      const flap = running ? Math.sin(a * 2) * 0.018 * k : 0;
      ctx.quadraticCurveTo(0, w0.y + (0.02 + flap) * s, w0.x, w0.y);
      ctx.closePath();
      ctx.fillStyle = of.holo ? jacket : roundShade(ctx, c0.x * 1.1, 0, c1.x * 1.1, 0, of.jacket, 0.5); ctx.fill();
      ctx.strokeStyle = shade(of.jacket, -0.35); ctx.lineWidth = 0.02 * s; ctx.stroke();
      // stripe, spine seam and a soft shadow on one side for volume
      ctx.save(); ctx.clip();
      const st = q(0, 1.25);
      ctx.fillStyle = of.stripe; ctx.fillRect(-0.3 * s, st.y, 0.6 * s, 0.06 * s);
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.012 * s;
      ctx.beginPath(); ctx.moveTo(0, top.y + 0.04 * s); ctx.lineTo(0, w0.y); ctx.stroke();
      // shoulder blades shift with the arm swing
      ctx.strokeStyle = 'rgba(0,0,0,.07)'; ctx.lineWidth = 0.012 * s;
      for (const sd of front ? [] : [-1, 1]) {
        const bx = sd * 0.1 * s, by = q(0, 1.36).y + (running ? sd * Math.sin(a) * 0.012 * k * s : 0);
        ctx.beginPath(); ctx.arc(bx, by, 0.07 * s, sd < 0 ? -0.3 : Math.PI - 1.1, sd < 0 ? 1.1 : Math.PI + 0.3); ctx.stroke();
      }
      // gentle shadow at the small of the back
      const lb = ctx.createLinearGradient(0, q(0, 1.15).y, 0, w0.y);
      lb.addColorStop(0, 'rgba(0,0,0,0)'); lb.addColorStop(1, 'rgba(0,0,0,.22)');
      ctx.fillStyle = lb; ctx.fillRect(-0.3 * s, q(0, 1.15).y, 0.6 * s, w0.y - q(0, 1.15).y + 0.05 * s);
      ctx.restore();
      // neck
      const nk = q(0, 1.47), nt = q(0, 1.58);
      ctx.strokeStyle = roundShade(ctx, -0.05 * s, 0, 0.05 * s, 0, isHex(skin) ? skin : '#c08058'); ctx.lineWidth = 0.1 * s;
      ctx.beginPath(); ctx.moveTo(nk.x, nk.y); ctx.lineTo(nt.x, nt.y); ctx.stroke();
      // head: ears, skin, then hair covering the back of the head
      const hc = q(0, 1.68);
      ctx.fillStyle = shade(skin, -0.1);
      ctx.beginPath(); ctx.ellipse(-0.115 * s, hc.y + 0.01 * s, 0.028 * s, 0.042 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0.115 * s, hc.y + 0.01 * s, 0.028 * s, 0.042 * s, 0, 0, Math.PI * 2); ctx.fill();
      const style = lk.hair || 'short', sw = running ? k * Math.sin(a) : 0;
      if (front) {
        // hair behind the head (a ponytail hides behind it), then the face, then the fringe
        drawHair(ctx, style === 'ponytail' ? 'short' : style, hairColor, hc, s, t, sw);
        ctx.fillStyle = roundShade(ctx, -0.11 * s, 0, 0.11 * s, 0, skin);
        ctx.beginPath(); ctx.ellipse(0, hc.y + 0.005 * s, 0.105 * s, 0.13 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.beginPath(); ctx.rect(-0.4 * s, hc.y - 0.5 * s, 0.8 * s, 0.45 * s); ctx.clip();
        drawHair(ctx, style === 'ponytail' || style === 'locs' || style === 'long' ? 'short' : style, hairColor, hc, s, t, 0);
        ctx.restore();
        drawFace(ctx, hc.y, s, pose.mood);
      } else {
        ctx.fillStyle = roundShade(ctx, -0.11 * s, 0, 0.11 * s, 0, skin);
        ctx.beginPath(); ctx.ellipse(0, hc.y, 0.11 * s, 0.135 * s, 0, 0, Math.PI * 2); ctx.fill();
        drawHair(ctx, style, hairColor, hc, s, t, sw);
      }
      drawAccessory(ctx, of, s, hc.y, 0.13 * s, t);
    };

    // painter's order: furthest from the camera first
    const parts = [
      ...legs.map((l) => ({ z: (l.pts[1].z + l.pts[2].z) / 2 - 0.05, draw: () => drawLeg(l) })),
      ...arms.map((r) => ({ z: (r.pts[1].z + r.pts[2].z) / 2, draw: () => drawArm(r) })),
      { z: 0, draw: drawBody },
    ];
    parts.sort((p, q) => (q.z - p.z) * zs).forEach((p) => p.draw());
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

  return { OUTFITS, TRAILS, SKINS, HAIRS, HAIR_COLORS, byId, drawRunner, createTrail, updateTrail, drawTrail };
})();
