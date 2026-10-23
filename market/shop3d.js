// Neon Tycoon: the hands-on shop in real 3D (three.js / WebGL).
//
// The shop simulation (people, stock, sales) stays in shop.js and works in its own flat
// coordinates: x across (0..1) and y from the street (0.16) through the door (0.27) to the
// till (0.79). Here those are turned into metres with the same perspective the classic view
// drew, so everything lands in the same place: X across the room, Z from the front wall (0)
// toward the till (9), Y up.
import * as THREE from './vendor/three.module.min.js';

const T = window.NeonTycoon, art = window.NeonShopArt;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- flat shop coordinates -> metres ----------
const sAt = (y) => 0.035 + 0.075 * clamp((y - 0.16) / 0.63, 0, 1.7); // goes on past the counter (the back door)
const SB = sAt(0.27), SC = sAt(0.79), RW = 9, RD = 9;
const zOf = (y) => (RD * (1 / SB - 1 / sAt(y))) / (1 / SB - 1 / SC);
const xOf = (x, y) => (x - 0.5) * (RW / 0.86) * (SB / sAt(y));
function toFlat(X, Z) {
  const s = 1 / (1 / SB - (Z * (1 / SB - 1 / SC)) / RD);
  const y = 0.16 + ((s - 0.035) / 0.075) * 0.63;
  return [0.5 + X / ((RW / 0.86) * (SB / s)), y];
}
const UP_DX = 20, UP_Y = 3.0;
function wpos(x, y) { let X = xOf(x, y), Y = 0; if (X > UP_DX / 2) { X -= UP_DX; Y = UP_Y; } return [X, Y, zOf(y)]; }
const ROOM = { ceil: 4, back: 11.3, winLo: 1.55, winHi: 3.3, doorH: 2.5 };

// ---------- materials and textures ----------
const mats = new Map();
function mat(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial(Object.assign({ color }, opts)));
  return mats.get(key);
}
function canvasTex(w, h, paint, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}
// a flat sign with text
function signTex(text, opts = {}) {
  const { w = 512, h = 96, bg = '#0b0221', color = '#ffd23f', glow, font = 900, border } = opts;
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); }
    let size = h * 0.62;
    g.font = `${font} ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > w * 0.92 && size > 8) { size -= 2; g.font = `${font} ${size}px system-ui, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (glow) { g.shadowColor = glow; g.shadowBlur = h * 0.15; }
    g.fillStyle = color; g.fillText(text, w / 2, h * 0.54);
  });
}
// a soft round glow, for pools of lamplight and the halo round a neon sign
let glowCache = null;
const glowTex = () => glowCache || (glowCache = canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
}));
const glowMat = (color) => new THREE.MeshBasicMaterial({ map: glowTex(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
// swap a sign's texture, freeing the old one
function setMap(mesh, tex) { if (mesh.material.map) mesh.material.map.dispose(); mesh.material.map = tex; mesh.material.needsUpdate = true; }
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
function at(o, x, y, z) { o.position.set(x, y, z); return o; }
function rotX(o, a) { o.rotation.x = a; return o; }

// ---------- fewer draw calls: plain-coloured parts merged into one vertex-coloured mesh ----------
const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const plain = (o) => o.isMesh && !o.isInstancedMesh && o.material && o.material.isMeshLambertMaterial && !o.material.map && !o.material.transparent && !o.material.vertexColors && !(o.material.emissiveIntensity > 0 && o.material.emissive.getHex()) && !o.userData.live;
// meshes: [mesh, matrix] pairs; returns one mesh
function mergeMeshes(list) {
  let n = 0;
  const geos = list.map(([m, mx]) => { const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(mx); n += g.attributes.position.count; return [g, m.material.color]; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [g, c] of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += g.attributes.position.count; g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(geo, vcMat);
}
// merge a group's direct plain children (in the group's own space)
function bakeChildren(g) {
  const list = g.children.filter(plain);
  if (list.length < 2) return;
  for (const m of list) { m.updateMatrix(); g.remove(m); }
  g.add(mergeMeshes(list.map((m) => [m, m.matrix])));
  for (const m of list) m.geometry.dispose();
}
// merge every plain mesh under root (static scenery) into one, in world space
function bakeAll(root, skip) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse((o) => { if (plain(o) && !skip(o)) list.push(o); });
  for (const m of list) m.parent.remove(m);
  if (list.length) root.add(mergeMeshes(list.map((m) => [m, m.matrixWorld])));
  for (const m of list) m.geometry.dispose();
}

// ---------- product shapes (with the 2D pack drawings as their labels) ----------
// a round pack turned from its outline ([radius, height] from the bottom up), centred like the boxes
function lathe(pts, seg = 16) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.translate(0, -pts[pts.length - 1][1] / 2, 0);
  return g;
}
// several parts as one shape (each keeps its label mapping): [geometry, x, y, z, rotX]
function joinGeos(parts) {
  const geos = parts.map(([g, x = 0, y = 0, z = 0, rx = 0]) => { const n = g.index ? g.toNonIndexed() : g; if (rx) n.rotateX(rx); n.translate(x, y, z); return n; });
  const cat = (k, w) => { const out = new Float32Array(geos.reduce((a, g) => a + g.attributes[k].count * w, 0)); let o = 0; for (const g of geos) { out.set(g.attributes[k].array, o); o += g.attributes[k].array.length; } return new THREE.BufferAttribute(out, w); };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', cat('position', 3)); geo.setAttribute('normal', cat('normal', 3)); geo.setAttribute('uv', cat('uv', 2));
  return geo;
}
// a coffee bag: a box pinched and folded at the top
function bag() {
  const g = new THREE.BoxGeometry(1, 1.6, 0.6, 1, 6, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.35) p.setZ(i, p.getZ(i) * (1 - 0.75 * Math.min(1, (y - 0.35) / 0.35))); }
  g.computeVertexNormals();
  return g;
}
const SHAPES = {
  drinks: { geo: () => lathe([[0, 0], [0.42, 0], [0.5, 0.08], [0.5, 1.72], [0.44, 1.84], [0.4, 1.86], [0.41, 1.9], [0, 1.9]]), w: 1, h: 1.9 },
  noodles: { geo: () => lathe([[0, 0], [0.47, 0], [0.5, 0.04], [0.62, 1.16], [0.67, 1.19], [0.67, 1.25], [0, 1.25]]), w: 1.24, h: 1.25 },
  coffee: { geo: bag, w: 1, h: 1.6 },
  vinyl: { geo: () => joinGeos([[new THREE.BoxGeometry(1.6, 1.6, 0.08)], [new THREE.CylinderGeometry(0.72, 0.72, 0.03, 24), 0.18, 0.12, -0.06, Math.PI / 2]]), w: 1.6, h: 1.6 },
  holo: { geo: () => joinGeos([[new THREE.BoxGeometry(1.1, 1.3, 0.7), 0, -0.075, 0], [new THREE.BoxGeometry(0.5, 0.15, 0.04), 0, 0.65, -0.2]]), w: 1.1, h: 1.45 },
  sneakers: { geo: () => joinGeos([[new THREE.BoxGeometry(1.7, 0.62, 1), 0, -0.09, 0], [new THREE.BoxGeometry(1.78, 0.18, 1.08), 0, 0.31, 0]]), w: 1.78, h: 0.8 },
  chips: { geo: () => joinGeos([[new THREE.BoxGeometry(0.9, 1.3, 0.06)], [new THREE.BoxGeometry(0.5, 0.55, 0.14), 0, -0.12, 0.08], [new THREE.BoxGeometry(0.16, 0.08, 0.04), 0, 0.56, 0]]), w: 0.9, h: 1.3 },
  signs: { geo: () => new THREE.BoxGeometry(1.7, 1.25, 0.15), w: 1.7, h: 1.25 },
  bottle: { geo: () => lathe([[0, 0], [0.38, 0], [0.4, 0.05], [0.4, 1.05], [0.3, 1.35], [0.16, 1.6], [0.16, 1.78], [0.19, 1.8], [0.19, 1.9], [0, 1.9]], 12), w: 0.8, h: 1.9 },
};
const packTexCache = new Map();
function packTex(good, v) {
  const key = good + v;
  if (!packTexCache.has(key)) {
    packTexCache.set(key, canvasTex(96, 128, (g) => {
      const pal = { drinks: '#ff2a6d', noodles: '#f4f1de', coffee: '#6b4423', vinyl: '#ff2a6d', holo: '#9b5de5', sneakers: '#ff7a00', chips: '#1d3557', signs: '#14082a', bottle: '#4ade80' };
      g.fillStyle = pal[good] || '#888'; g.fillRect(0, 0, 96, 128);
      art.pack(g, good, 48, 122, 112, v, 1);
    }));
  }
  return packTexCache.get(key);
}

// ---------- people ----------
const OUT = () => window.NeonLooks.OUTFITS;
function figure(look, opts = {}) {
  const N = window.NeonLooks, of = N.byId(OUT(), look.outfit), skin = N.SKINS[look.skin] || N.SKINS[2];
  const hair = N.HAIR_COLORS[look.hairColor || 0] || '#1a1418';
  const g = new THREE.Group();
  const jacket = mat(of.holo ? '#05d9e8' : of.jacket), arms = mat(of.arms), pants = mat(of.pants), shoes = mat(of.shoes), skinM = mat(skin), hairM = mat(hair);
  // legs and arms hang from pivots so they can swing
  const limb = (w, len, m, x, y) => { const pv = new THREE.Group(); pv.position.set(x, y, 0); const l = box(w, len, w, m); l.position.y = -len / 2; pv.add(l); g.add(pv); return pv; };
  g.userData.legL = limb(0.14, 0.82, pants, -0.1, 0.86); g.userData.legR = limb(0.14, 0.82, pants, 0.1, 0.86);
  for (const leg of [g.userData.legL, g.userData.legR]) leg.add(at(box(0.16, 0.08, 0.26, shoes), 0, -0.82, 0.05));
  const torso = at(box(0.42, 0.62, 0.24, jacket), 0, 1.18, 0); g.add(torso);
  g.add(at(box(0.43, 0.06, 0.25, mat(of.stripe)), 0, 1.1, 0));
  g.userData.armL = limb(0.11, 0.62, arms, -0.28, 1.46); g.userData.armR = limb(0.11, 0.62, arms, 0.28, 1.46);
  for (const arm of [g.userData.armL, g.userData.armR]) arm.add(at(box(0.1, 0.1, 0.1, skinM), 0, -0.66, 0));
  // the head turns on its own (to look along a shelf, or at a shopper)
  const headG = new THREE.Group(); headG.position.set(0, 1.55, 0); g.add(headG); g.userData.head = headG;
  const hadd = (o, x, y, z) => headG.add(at(o, x, y - 1.55, z));
  hadd(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skinM), 0, 1.68, 0);
  hadd(box(0.04, 0.03, 0.02, mat('#1a1418')), -0.05, 1.7, 0.14); hadd(box(0.04, 0.03, 0.02, mat('#1a1418')), 0.05, 1.7, 0.14); // eyes
  // hair styles
  const hs = look.hair;
  if (hs !== 'buzz') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(hs === 'afro' ? 0.21 : 0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI * (hs === 'afro' ? 0.7 : 0.55)), hairM);
    hadd(cap, 0, 1.7, -0.01);
    if (hs === 'long' || hs === 'locs') hadd(box(0.3, 0.32, 0.08, hairM), 0, 1.55, -0.12);
    if (hs === 'ponytail' || hs === 'bun') hadd(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), hairM), 0, hs === 'bun' ? 1.84 : 1.6, -0.17);
  }
  if (of.acc === 'cap') hadd(box(0.32, 0.06, 0.36, mat(of.accColor)), 0, 1.82, 0.05);
  if (of.acc === 'crown') hadd(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 6), mat(of.accColor)), 0, 1.86, 0);
  if (of.acc === 'headphones') hadd(box(0.36, 0.08, 0.08, mat(of.accColor)), 0, 1.72, 0);
  if (of.acc === 'headband') hadd(box(0.32, 0.05, 0.32, mat(of.accColor)), 0, 1.74, 0);
  if (of.acc === 'mohawk') hadd(box(0.05, 0.14, 0.26, mat(of.accColor)), 0, 1.86, 0);
  // a soft shadow on the floor
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01; g.add(sh);
  g.userData.holo = of.holo ? torso : null;
  if (opts.apron) g.add(at(box(0.34, 0.5, 0.02, mat(opts.apron)), 0, 1.12, 0.13));
  if (of.holo) torso.userData.live = true; // its colour shifts every frame
  bakeChildren(g);
  for (const k of ['legL', 'legR', 'armL', 'armR', 'head']) bakeChildren(g.userData[k]);
  g.traverse((o) => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
  return g;
}

// ---------- the renderer ----------
function supported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

function create(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 200);
  const view = { dist: 1, tx: 0, tz: 0, yaw: 0, tilt: 0 }; // zoom (1 = default), pan of the target, and the turn round it (360°)
  let scene, run, L, G, parts, figs = new Map(), lastSig = '';
  const ray = new THREE.Raycaster(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function attach(r) {
    run = r; L = window.NeonShop.layout(); G = T.G[r.b.good];
    figs = new Map(); lastSig = '';
    view.dist = 1; view.tx = 0; view.tz = 0; view.yaw = 0; view.tilt = 0;
    scene = new THREE.Scene();
    parts = {};
    buildRoom(); buildStreet(); buildUnits(); buildFridge(); buildCounter(); buildProps(); buildLights();
    // everything that never moves or changes colour becomes one mesh
    const live = new Set([parts.dynamic, ...parts.doors, parts.drawer, parts.cash, ...(parts.gates || []), ...parts.units, parts.frontWall, parts.nb[-1], parts.nb[1]]);
    for (const g of [parts.frontWall, parts.nb[-1], parts.nb[1]]) bakeChildren(g);
    for (const u of parts.units) bakeChildren(u); // shelving stays in its own group, so a drop can find it
    bakeAll(scene, (o) => { for (let p = o; p; p = p.parent) if (live.has(p)) return true; return false; });
    // what casts and catches shadows: the room's solid things, and the floor
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.material || !o.material.isMeshLambertMaterial || o.material.transparent) return;
      o.castShadow = true; o.receiveShadow = o.material === vcMat;
    });
    parts.floor.receiveShadow = true; parts.floor.castShadow = false;
    setShadows(window.NeonShop.getGfx() !== 'low' && (run.dprCap || 2) >= 1.5);
    canvas.style.display = 'block';
  }
  // soft shadows cost a second pass, so they're on only when the phone keeps up
  let shadowsOn = false;
  function setShadows(on) {
    shadowsOn = on;
    renderer.shadowMap.enabled = on; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    parts.key.castShadow = on;
    if (scene) scene.traverse((o) => { if (o.material && o.receiveShadow) o.material.needsUpdate = true; });
  }
  function detach() {
    canvas.style.display = 'none';
    // free the day's geometry and textures (shared materials and product labels are kept)
    const keepMats = new Set(mats.values()), keepTex = new Set([...packTexCache.values(), glowCache]);
    if (scene) scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) {
        if (m.map && !keepTex.has(m.map)) m.map.dispose();
        if (!keepMats.has(m) && m !== vcMat) m.dispose();
      }
    });
    if (parts.key) parts.key.shadow.dispose(); // the light's shadow map
    renderer.renderLists.dispose();
    scene = null; run = null; packMatCache = null;
  }

  // ---------- the room ----------
  function buildRoom() {
    const r = run, dec = r.decor, F = L.FRONT;
    // floor: the chosen style as a repeating texture
    const fl = dec.floor;
    const floorTex = canvasTex(256, 256, (g) => {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (fl.planks ? j % 2 : (i + j) % 2) ? fl.a : fl.b; g.fillRect(i * 64, j * 64, 64, 64); }
      if (fl.line) { g.strokeStyle = fl.line; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); } }
      if (fl.planks) { g.fillStyle = 'rgba(0,0,0,.25)'; for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) g.fillRect(((j * 97 + k * 83) % 256), j * 64, 2, 64); }
      if (fl.vein) { g.strokeStyle = 'rgba(120,110,150,.35)'; g.lineWidth = 1.5; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(k * 50, 0); g.bezierCurveTo(k * 50 + 40, 90, k * 50 - 20, 170, k * 50 + 30, 256); g.stroke(); } }
    }, [RW / 2.4, (ROOM.back) / 2.4]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, ROOM.back), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, ROOM.back / 2); scene.add(floor);
    parts.floor = floor;
    // scuffs from the season's wear
    const scuffM = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false });
    for (const [sx, sy, sr] of r.b.wear.scuffs) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.25 + sr, 12), scuffM);
      m.rotation.x = -Math.PI / 2; m.scale.set(1, 0.4, 1); m.position.set(xOf(sx, sy), 0.012, zOf(sy)); scene.add(m);
    }
    // side walls (painted), the back wall behind the till
    const wallM = mat(dec.walls.wall);
    // the side walls (a megastore's right wall has an arch through to the annex)
    const sideWall = (s, z0, z1, y0 = 0, y1 = ROOM.ceil) => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, y1 - y0), wallM);
      w.rotation.y = s * -Math.PI / 2; w.position.set(s * RW / 2, (y0 + y1) / 2, (z0 + z1) / 2); scene.add(w);
      if (!y0) scene.add(at(box(0.04, 0.14, z1 - z0, mat(dec.walls.trim)), s * (RW / 2 - 0.02), 0.07, (z0 + z1) / 2)); // skirting
    };
    sideWall(-1, 0, ROOM.back);
    if (r.b.tier >= 2) { const [a0, a1] = L.ANNEX.arch; sideWall(1, 0, a0); sideWall(1, a1, ROOM.back); sideWall(1, a0, a1, 2.7, ROOM.ceil); buildAnnex(); } else sideWall(1, 0, ROOM.back);
    const backW = new THREE.Mesh(new THREE.PlaneGeometry(RW, ROOM.ceil), wallM); backW.rotation.y = Math.PI; backW.position.set(0, ROOM.ceil / 2, ROOM.back); scene.add(backW);
    // decor on the side walls: a poster, a fire extinguisher, an exit sign, an escalator in a megastore
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1), new THREE.MeshBasicMaterial({ map: canvasTex(140, 100, (g) => { const gr = g.createLinearGradient(0, 0, 140, 100); gr.addColorStop(0, '#ff2a6d'); gr.addColorStop(1, '#05d9e8'); g.fillStyle = gr; g.fillRect(0, 0, 140, 100); g.fillStyle = '#fff'; g.font = '900 22px system-ui'; g.textAlign = 'center'; g.fillText('NEON CITY', 70, 58); }) }));
    poster.rotation.y = Math.PI / 2; poster.position.set(-RW / 2 + 0.02, 2.3, 3); scene.add(poster);
    scene.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10), mat('#d61e1e')), RW / 2 - 0.12, 0.35, 4));
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.25), new THREE.MeshBasicMaterial({ map: signTex('EXIT', { w: 128, h: 54, bg: '#16a34a', color: '#fff' }) }));
    exit.rotation.y = -Math.PI / 2; exit.position.set(RW / 2 - 0.02, 3.2, 2); scene.add(exit);
    if (r.b.tier >= 2) { // a sign over the arch
      const lv = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.36), new THREE.MeshBasicMaterial({ map: signTex('ANNEX · ⬆ LEVEL 2', { w: 320, h: 68, bg: '#05d9e8', color: '#0b0221' }) }));
      lv.rotation.y = -Math.PI / 2; lv.position.set(RW / 2 - 0.03, 3.1, (L.ANNEX.arch[0] + L.ANNEX.arch[1]) / 2); scene.add(lv);
    }
    // the front wall: bricks around two big windows and the door
    const frontFrom = scene.children.length;
    const brick = canvasTex(128, 64, (g) => {
      g.fillStyle = '#26102a'; g.fillRect(0, 0, 128, 64);
      const shades = ['#5a1f45', '#4e1a3d', '#63244c', '#541c41'];
      for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) { g.fillStyle = shades[(row * 7 + col * 3 + 8) % 4]; g.fillRect(col * 32 + (row % 2 ? 16 : 0) + 1, row * 8 + 1, 30, 6); }
    }, [1, 1]);
    const brickPiece = (x0, x1, y0, y1) => {
      const t = brick.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set((x1 - x0) / 1.2, (y1 - y0) / 0.6);
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.3), new THREE.MeshLambertMaterial({ map: t }));
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.15); scene.add(m);
    };
    const wx = F.windows.map(([a, b]) => [xOf(a, 0.27), xOf(b, 0.27)]), dx = [xOf(F.door[0], 0.27), xOf(F.door[1], 0.27)];
    brickPiece(-RW / 2, wx[0][0], 0, ROOM.ceil); brickPiece(wx[1][1], RW / 2, 0, ROOM.ceil);
    brickPiece(wx[0][1], dx[0], 0, ROOM.ceil); brickPiece(dx[1], wx[1][0], 0, ROOM.ceil);
    for (const [a, b] of wx) { brickPiece(a, b, 0, ROOM.winLo); brickPiece(a, b, ROOM.winHi, ROOM.ceil); }
    brickPiece(dx[0], dx[1], ROOM.doorH, ROOM.ceil);
    // window frames and glass
    const frameM = mat('#1b1b26');
    // the glass: a faint tint with diagonal streaks of reflected light
    const glassM = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, map: canvasTex(128, 128, (g) => {
      g.fillStyle = 'rgba(140,210,255,.12)'; g.fillRect(0, 0, 128, 128);
      g.save(); g.translate(64, 64); g.rotate(-0.6); g.translate(-64, -64);
      for (const [x, w, a] of [[30, 18, 0.22], [56, 6, 0.16], [92, 26, 0.12]]) { const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, -60, w, 260); }
      g.restore();
    }) });
    for (const [a, b] of wx) {
      const w = b - a, h = ROOM.winHi - ROOM.winLo, cy = (ROOM.winLo + ROOM.winHi) / 2;
      scene.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassM), (a + b) / 2, cy, -0.05));
      for (const y of [ROOM.winLo, ROOM.winHi, ROOM.winHi - 0.35]) scene.add(at(box(w, 0.07, 0.12, frameM), (a + b) / 2, y, -0.05));
      for (const x of [a, (a + b) / 2, b]) scene.add(at(box(0.07, h, 0.12, frameM), x, cy, -0.05));
      scene.add(at(box(w + 0.1, 0.06, 0.3, mat('#cfc8e6')), (a + b) / 2, ROOM.winLo - 0.03, 0.05)); // sill
    }
    // window stickers: the OPEN sign and a poster
    parts.openSign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.3), new THREE.MeshBasicMaterial({ transparent: true }));
    parts.openSign.position.set(wx[0][0] + 0.8, 2.7, 0.02); scene.add(parts.openSign);
    parts.poster = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({}));
    parts.poster.position.set(wx[0][1] - 0.6, 2.25, 0.02); scene.add(parts.poster);
    parts.openState = parts.posterState = null;
    // the shop's name, lit, over the windows; the wooden board for a little stall
    const label = `${G.icon} ${G.name.toUpperCase()} · ${T.STALLS[r.b.tier].name.toUpperCase()}`, sg = dec.sign;
    const nameTex = r.b.tier === 0 ? signTex(label, { w: 1024, h: 112, bg: '#4a2f1b', color: '#f4e3c3', border: '#2a1a0d' })
      : signTex(label, { w: 1024, h: 112, bg: '#140628', color: sg.rainbow ? '#ffffff' : sg.color, glow: sg.glow });
    parts.nameSign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.6), new THREE.MeshBasicMaterial({ map: nameTex }));
    parts.nameSign.position.set(0, 3.62, 0.02); scene.add(parts.nameSign);
    // at night a neon sign throws a glow on the wall around it
    if (r.b.tier > 0) { parts.signGlow = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.8), glowMat(sg.rainbow ? '#ff7ad9' : sg.color)); parts.signGlow.position.set(0, 3.62, 0.012); scene.add(parts.signGlow); }
    parts.openGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.9), glowMat('#ff2a6d')); parts.openGlow.position.copy(parts.openSign.position); parts.openGlow.position.z = 0.012; scene.add(parts.openGlow);
    // marquee bulbs for a megastore, and holiday lights
    if (r.b.tier >= 2) {
      parts.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 60);
      for (let i = 0; i < 60; i++) { const m = new THREE.Matrix4().makeTranslation(-3.2 + (i % 30) * (6.4 / 29), i < 30 ? 3.94 : 3.3, 0.04); parts.bulbs.setMatrixAt(i, m); }
      scene.add(parts.bulbs);
    }
    if (r.holiday) {
      const cols = { xmas: ['#ff3b3b', '#4ade80', '#ffd23f', '#05d9e8'], halloween: ['#ff7a00', '#9b5de5'], valentine: ['#ff5c8a', '#ffffff'], summer: ['#ffd23f', '#05d9e8'] }[r.holiday.id];
      parts.holLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4), new THREE.MeshBasicMaterial({ color: '#fff' }), 70);
      parts.holCols = cols.map((c) => new THREE.Color(c));
      for (let i = 0; i < 70; i++) { const x = -RW / 2 + 0.2 + i * ((RW - 0.4) / 69); parts.holLights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 3.22 + Math.sin(i * 0.9) * 0.05, 0.08)); }
      scene.add(parts.holLights);
    }
    // the sliding glass doors
    const dw = (dx[1] - dx[0]) / 2;
    parts.doors = [-1, 1].map((s) => {
      const d = new THREE.Group();
      d.add(new THREE.Mesh(new THREE.PlaneGeometry(dw, ROOM.doorH), new THREE.MeshBasicMaterial({ color: '#9fdcff', transparent: true, opacity: 0.18, depthWrite: false })));
      for (const [w, h, x, y] of [[dw, 0.06, 0, ROOM.doorH / 2], [dw, 0.12, 0, -ROOM.doorH / 2 + 0.06], [0.05, ROOM.doorH, -dw / 2, 0], [0.05, ROOM.doorH, dw / 2, 0]]) d.add(at(box(w, h, 0.05, mat('#a7adbf')), x, y, 0));
      d.add(at(box(0.04, 0.5, 0.06, mat('#d7dbe8')), s < 0 ? dw / 2 - 0.1 : -dw / 2 + 0.1, 0, 0.04));
      d.userData = { home: (dx[0] + dx[1]) / 2 + s * dw / 2, s, dw };
      d.position.set(d.userData.home, ROOM.doorH / 2, -0.12); scene.add(d);
      return d;
    });
    const ent = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.22), new THREE.MeshBasicMaterial({ map: signTex('ENTRANCE', { w: 256, h: 52, bg: '#0b0221', color: '#4ade80' }) }));
    ent.position.set(0, ROOM.doorH + 0.2, 0.02); scene.add(ent);
    const mat2 = new THREE.Mesh(new THREE.PlaneGeometry(dx[1] - dx[0], 0.9), new THREE.MeshLambertMaterial({ map: signTex('WELCOME', { w: 256, h: 96, bg: '#26262e', color: 'rgba(255,255,255,.35)' }) }));
    mat2.rotation.x = -Math.PI / 2; mat2.position.set(0, 0.012, 0.6); scene.add(mat2);
    // roller shutters, rolled up (or down before opening / after closing)
    parts.shutters = [...wx.map(([a, b]) => [a, b, ROOM.winLo, ROOM.winHi]), [dx[0], dx[1], 0, ROOM.doorH]].map(([a, b, y0, y1]) => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(b - a, y1 - y0), new THREE.MeshLambertMaterial({ map: canvasTex(32, 64, (g) => { g.fillStyle = '#8a8fa0'; g.fillRect(0, 0, 32, 64); g.fillStyle = 'rgba(0,0,0,.3)'; for (let y = 0; y < 64; y += 6) g.fillRect(0, y, 32, 2); }, [1, (y1 - y0) / 0.3]) }));
      s.userData = { top: y1, h: y1 - y0, x: (a + b) / 2 }; scene.add(s); return s;
    });
    // everything on the front wall goes in one group, so it can be cut away when you look in from the street
    parts.frontWall = new THREE.Group();
    for (const o of scene.children.slice(frontFrom)) if (o !== mat2) parts.frontWall.add(o);
    scene.add(parts.frontWall);
  }

  // ---------- a megastore's annex: a second room with Level 2 above its front half, and stairs ----------
  function buildAnnex() {
    const a = L.ANNEX, dec = run.decor, wallM = mat(dec.walls.wall), H2 = 6.2, cx = (a.X0 + a.X1) / 2;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(a.X1 - a.X0, a.Z1 - a.Z0), parts.floor.material); fl.rotation.x = -Math.PI / 2; fl.position.set(cx, 0.001, (a.Z0 + a.Z1) / 2); scene.add(fl); parts.annexFloor = fl;
    // walls: the far side, the front and the back
    const far = new THREE.Mesh(new THREE.PlaneGeometry(a.Z1 - a.Z0, H2), wallM); far.rotation.y = -Math.PI / 2; far.position.set(a.X1, H2 / 2, (a.Z0 + a.Z1) / 2); scene.add(far);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(a.X1 - a.X0, H2), wallM); front.position.set(cx, H2 / 2, a.Z0); scene.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(a.X1 - a.X0, H2), wallM); back.rotation.y = Math.PI; back.position.set(cx, H2 / 2, a.Z1); scene.add(back);
    // the outside of the annex wall above the main shop's wall
    const top = new THREE.Mesh(new THREE.PlaneGeometry(a.Z1 - a.Z0, H2 - ROOM.ceil), wallM); top.rotation.y = -Math.PI / 2; top.position.set(a.X0, (H2 + ROOM.ceil) / 2, (a.Z0 + a.Z1) / 2); scene.add(top);
    // Level 2: a deck over the front of the annex, a glass rail along its edge, the stairs up the far side
    const [z0, z1] = a.l2;
    scene.add(at(box(a.X1 - a.X0, 0.16, z1 - z0, mat('#3b2350')), cx, UP_Y - 0.08, (z0 + z1) / 2));
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(a.X1 - a.X0, z1 - z0), parts.floor.material); deck.rotation.x = -Math.PI / 2; deck.position.set(cx, UP_Y + 0.005, (z0 + z1) / 2); scene.add(deck);
    const rail = new THREE.Mesh(new THREE.PlaneGeometry(a.X1 - a.X0 - 0.9, 0.9), new THREE.MeshBasicMaterial({ color: '#9fdcff', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    rail.position.set(cx - 0.45, UP_Y + 0.45, z1); scene.add(rail);
    scene.add(at(box(a.X1 - a.X0 - 0.9, 0.05, 0.06, mat('#c9cdd8')), cx - 0.45, UP_Y + 0.92, z1));
    const st = a.stair, n = 12, run2 = (st.Z0 - st.Z1) / n;
    for (let i = 0; i < n; i++) scene.add(at(box(0.8, UP_Y * (i + 1) / n, run2, mat(i % 2 ? '#9aa0b5' : '#aab0c4')), st.X, (UP_Y * (i + 1) / n) / 2, st.Z0 - run2 * (i + 0.5)));
    const l2 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.32), new THREE.MeshBasicMaterial({ map: signTex('LEVEL 2', { w: 256, h: 60, bg: '#0b0221', color: '#05d9e8', border: '#05d9e8' }) }));
    l2.position.set(cx, UP_Y + 1.9, z0 + 0.02); scene.add(l2);
    // lights: one over the annex floor, one over Level 2
    for (const [y, z] of [[2.7, 6.6], [UP_Y + 2.4, 2.4]]) { const l = new THREE.PointLight('#ffd9a0', 7, 8, 1.3); l.position.set(cx, y, z); scene.add(l); (parts.annexLights = parts.annexLights || []).push(l); }
  }

  // ---------- outside: pavement, road, buildings, the rival shop ----------
  function buildStreet() {
    const r = run;
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(60, 9), mat('#8a8496')); pave.rotation.x = -Math.PI / 2; pave.position.set(0, 0, -4.5); scene.add(pave);
    scene.add(at(box(60, 0.15, 0.3, mat('#a49cb4')), 0, 0.07, -9));
    const roadTex = canvasTex(64, 64, (g) => { g.fillStyle = '#2a2833'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#ffd23f'; g.fillRect(0, 30, 32, 4); }, [30, 1]);
    parts.roadTex = roadTex;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 6), new THREE.MeshLambertMaterial({ map: roadTex })); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.005, -12); scene.add(road);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(60, 4), mat('#7a7486')); far.rotation.x = -Math.PI / 2; far.position.set(0, 0.01, -17); scene.add(far);
    // the ground everywhere, and the shops either side of ours (seen from above: their roofs)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat('#5f5a6a')); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, 0); scene.add(ground);
    parts.nb = { [-1]: new THREE.Group(), [1]: new THREE.Group() };
    scene.add(parts.nb[-1], parts.nb[1]);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const nb = parts.nb[sx];
      const w = 7 + i, x = sx * (RW / 2 + 0.15 + w / 2 + i * 7.2) + (sx > 0 && run.b.tier >= 2 ? 4.7 : 0), h = 4.4 + ((i * 7 + (sx > 0 ? 3 : 0)) % 4) * 0.5;
      nb.add(at(box(w, h, 14, mat(['#3a2f4a', '#43354f', '#352a44'][i])), x, h / 2, 6.4));
      nb.add(at(box(w - 0.4, 0.2, 13.6, mat('#2a2238')), x, h + 0.1, 6.4));
      nb.add(at(box(1.2, 0.7, 1, mat('#8a8fa0')), x - sx * 1.2, h + 0.55, 4 + i));
      nb.add(at(box(w, 0.6, 0.1, mat(['#ff2a6d', '#05d9e8', '#ffd23f'][(i + (sx > 0)) % 3])), x, 3.4, -0.6));
    }
    // buildings across the road, with windows that light up at night
    parts.winMats = [];
    for (let i = 0; i < 12; i++) {
      const w = 3 + (i * 37 % 5), h = 6 + (i * 53 % 9), x = -26 + i * 4.6 + (i % 3);
      const wm = new THREE.MeshLambertMaterial({ map: canvasTex(64, 128, (g) => { g.fillStyle = '#5d6f8f'; g.fillRect(0, 0, 64, 128); g.fillStyle = '#c8e6ff'; for (let y = 6; y < 124; y += 14) for (let xx = 6; xx < 60; xx += 14) g.fillRect(xx, y, 7, 8); }), emissive: '#ffd27a', emissiveIntensity: 0 });
      parts.winMats.push(wm);
      scene.add(at(box(w, h, 3, wm), x, h / 2, -21));
    }
    // the rival shop opposite
    if (r.rival) {
      const g = new THREE.Group();
      g.add(at(box(6, 4, 2, mat('#c9c2d8')), 0, 2, 0));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.7), new THREE.MeshBasicMaterial({ map: signTex(r.rival.name.toUpperCase(), { w: 512, h: 64, bg: r.rival.sale ? '#ff3b3b' : '#3b82f6', color: '#fff' }) }));
      g.add(at(sign, 0, 3.55, 1.02));
      g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicMaterial({ color: '#fff3c8' })), 1, 1.5, 1.01));
      const price = T.price(r.s, r.b.district, r.b.good) * r.rival.mult;
      g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.8), new THREE.MeshBasicMaterial({ map: signTex(`${r.rival.sale ? 'SALE ' : ''}${G.icon} $${price < 100 ? price.toFixed(2) : Math.round(price)}`, { w: 256, h: 110, bg: r.rival.sale ? '#ff3b3b' : '#ffd23f', color: r.rival.sale ? '#fff' : '#0b0221' }) })), -1.8, 1.7, 1.02));
      g.position.set(4, 0, -18); scene.add(g);
    }
    // street-market stalls
    if (r.event === 'market') {
      for (const [i, x] of [[0, -5], [1, 0], [2, 6]]) {
        const st = new THREE.Group();
        st.add(at(box(2.2, 0.9, 1, mat('#6b4423')), 0, 0.45, 0));
        st.add(at(box(2.4, 0.08, 1.3, mat(['#ff2a6d', '#05d9e8', '#ffd23f'][i])), 0, 2.1, 0));
        for (const sx of [-1.1, 1.1]) st.add(at(box(0.06, 2.1, 0.06, mat('#2a2a35')), sx, 1.05, 0.5));
        st.position.set(x, 0, -14.3); scene.add(st);
      }
    }
    // street lamps
    for (const x of [-7, 7]) { scene.add(at(box(0.1, 4.5, 0.1, mat('#2a2a35')), x, 2.25, -8.6)); const head = at(box(0.5, 0.12, 0.25, new THREE.MeshBasicMaterial({ color: '#fff2c4' })), x + 0.2, 4.5, -8.6); scene.add(head); (parts.streetLamps = parts.streetLamps || []).push(head); }
    // rain or snow
    if (r.weather === 'rain' || r.weather === 'snow') {
      const n = 500, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = -2 - Math.random() * 16; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      parts.precip = new THREE.Points(geo, new THREE.PointsMaterial({ color: r.weather === 'snow' ? '#ffffff' : '#c8dcff', size: r.weather === 'snow' ? 0.09 : 0.05, transparent: true, opacity: 0.8 }));
      scene.add(parts.precip);
    }
  }

  // ---------- shelving and the products on it ----------
  function unitGeom(u) {
    if (u.m) { // the annex and Level 2: laid out in metres
      const m = u.m, h = m.wall ? 1.45 : 1.55, depth = m.wall ? 0.5 : 0.85, z = m.Z - depth / 2;
      return { x0: m.X0, x1: m.X1, w: m.X1 - m.X0, h, depth, z, front: m.Z, back: m.Z - depth, wall: m.wall, y0: u.zone === 'up' ? UP_Y : 0, dx: u.dx || 0 };
    }
    const wall = u.wall, x0 = xOf(u.x0, u.base), x1 = xOf(u.x1, u.base);
    const h = wall ? 1.45 : 1.55, depth = wall ? 0.5 : 0.85, z = wall ? 0.32 : zOf(u.base) - depth / 2;
    return { x0, x1, w: x1 - x0, h, depth, z, front: z + depth / 2, back: z - depth / 2, wall, y0: 0, dx: 0 };
  }
  const shelfH = (gm, row) => 0.14 + row * ((gm.h - 0.2) / 3);
  function buildUnits() {
    const r = run;
    parts.units = L.UNITS.map((u, ui) => {
      const gm = unitGeom(u), g = new THREE.Group(), body = mat('#2d1060'), panel = mat('#3c1878'), board = mat('#6a34c8'), strip = mat('#e4defa');
      g.add(at(box(gm.w, gm.h, 0.04, panel), (gm.x0 + gm.x1) / 2, gm.h / 2, gm.wall ? gm.back : gm.z));
      for (const x of [gm.x0, gm.x1]) g.add(at(box(0.05, gm.h, gm.depth, body), x, gm.h / 2, gm.z));
      g.add(at(box(gm.w, 0.04, gm.depth, mat('#5b2bb5')), (gm.x0 + gm.x1) / 2, gm.h, gm.z));
      g.add(at(box(gm.w, 0.12, gm.depth, mat('#12052a')), (gm.x0 + gm.x1) / 2, 0.06, gm.z));
      for (let row = 0; row < 3; row++) {
        const y = shelfH(gm, row);
        g.add(at(box(gm.w - 0.06, 0.03, gm.depth - 0.02, board), (gm.x0 + gm.x1) / 2, y, gm.z));
        g.add(at(box(gm.w - 0.06, 0.05, 0.015, strip), (gm.x0 + gm.x1) / 2, y - 0.01, gm.front));
        if (!gm.wall) g.add(at(box(gm.w - 0.06, 0.05, 0.015, strip), (gm.x0 + gm.x1) / 2, y - 0.01, gm.back));
      }
      // the price tag on the middle shelf
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), new THREE.MeshBasicMaterial({}));
      tag.position.set((gm.x0 + gm.x1) / 2, shelfH(gm, 1) - 0.03, gm.front + 0.012); g.add(tag);
      // a light-box sign on top of an island
      // a light-box sign naming the line on it: on top of an island, along the top of a wall unit
      const line = L.unitLine ? L.unitLine[ui] : 0, lc = ['#05d9e8', '#ff2a6d', '#ffd23f'][line];
      const lname = (L.lines && L.lines[line] || `AISLE ${ui + 1}`).toUpperCase();
      const s = new THREE.Mesh(new THREE.PlaneGeometry(gm.wall ? Math.min(1.4, gm.w * 0.8) : 1.2, 0.28), new THREE.MeshBasicMaterial({ map: signTex(`${G.icon} ${lname}`, { w: 256, h: 60, bg: '#0b0221', color: lc, border: lc }) }));
      if (gm.wall) s.position.set((gm.x0 + gm.x1) / 2, gm.h + 0.2, gm.front - 0.05); else s.position.set((gm.x0 + gm.x1) / 2, gm.h + 0.3, gm.front - 0.2);
      g.add(s);
      // a shelf sign under one spot
      const tk = r.talkers[ui], ts = tk && r.slots[tk.slot];
      if (ts && ts.u === ui) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.1), new THREE.MeshBasicMaterial({ map: signTex(tk.talk[0], { w: 200, h: 48, bg: tk.talk[1], color: '#0b0221' }) }));
        t.position.set(clamp(xOf(ts.x, u.base), gm.x0 + 0.25, gm.x1 - 0.25), shelfH(gm, ts.row) - 0.07, gm.front + 0.012); g.add(t);
      }
      g.userData = { ui, gm, tag, tagText: '' };
      g.position.y = gm.y0; // Level 2 shelves stand on the upper floor
      scene.add(g);
      return g;
    });
    // the products: one instanced mesh per colourway, filled from the shop's shelf spots
    const sh = SHAPES[r.b.good] || SHAPES.coffee, geo = sh.geo();
    const cap = r.slots.length * 6 * 2;
    parts.packs = Array.from({ length: 6 }, (_, v) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: packTex(r.b.good, v), emissive: r.b.good === 'signs' ? '#ff2a6d' : '#000', emissiveIntensity: r.b.good === 'signs' ? 0.25 : 0 }), cap);
      m.count = 0; scene.add(m); return m;
    });
    parts.packShape = sh;
    parts.stickers = new THREE.InstancedMesh(new THREE.CircleGeometry(0.045, 12), new THREE.MeshBasicMaterial({ color: '#ffd23f' }), r.slots.length);
    parts.stickers.count = 0; scene.add(parts.stickers);
  }
  // put the packs where the shop's shelf spots say they are
  function updatePacks() {
    const r = run, sig = r.slots.map((sl) => sl.n + (sl.pop > 0 ? 'p' + sl.pop.toFixed(2) : '') + (r.stickers && r.stickers.has(sl) ? 's' : '')).join(',');
    if (sig === lastSig) return;
    lastSig = sig;
    const counts = [0, 0, 0, 0, 0, 0], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let stickers = 0;
    for (const sl of r.slots) {
      if (sl.n <= 0) continue;
      const u = L.UNITS[sl.u], gm = unitGeom(u), cols = u.cols, colW = gm.w / cols, rowH = (gm.h - 0.2) / 3;
      const k = Math.min((colW * 0.42) / parts.packShape.w, (rowH * 0.78) / parts.packShape.h);
      const vis = clamp(Math.ceil(Math.sqrt(sl.n / r.cap) * 6), 1, 6), x = xOf(sl.x, u.base) - gm.dx, y = gm.y0 + shelfH(gm, sl.row) + 0.015;
      const pop = sl.pop > 0 ? 1 + sl.pop * 1.2 : 1;
      for (let i = 0; i < vis; i++) {
        const f = i % 2, d = Math.floor(i / 2), step = Math.min(0.14, (gm.depth / 2 - 0.05) / 3);
        for (const side of gm.wall ? [1] : [1, -1]) {
          const s2 = k * (i < 2 ? pop : 1);
          p.set(x + (f - 0.5) * colW * 0.48, y + (parts.packShape.h * s2) / 2, (side > 0 ? gm.front : gm.back) - side * (0.08 + d * step));
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? 0 : Math.PI);
          sc.set(s2, s2, s2);
          const mesh = parts.packs[sl.v % 6];
          mesh.setMatrixAt(counts[sl.v % 6]++, m4.compose(p, q, sc));
        }
      }
      if (r.stickers && r.stickers.has(sl)) parts.stickers.setMatrixAt(stickers++, m4.makeTranslation(x + colW * 0.1, y + parts.packShape.h * k * 0.6, gm.front + 0.02));
    }
    parts.packs.forEach((m, v) => { m.count = counts[v]; m.instanceMatrix.needsUpdate = true; });
    parts.stickers.count = stickers; parts.stickers.instanceMatrix.needsUpdate = true;
  }

  // ---------- the fridge ----------
  function buildFridge() {
    const F = L.FRIDGE, x0 = xOf(F.x0, 0.27), x1 = xOf(F.x1, 0.27), w = x1 - x0, h = 2.3, z = 0.4, g = new THREE.Group();
    g.add(at(box(w, h, 0.7, mat('#1b1b26')), (x0 + x1) / 2, h / 2, z));
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, h - 0.45), new THREE.MeshBasicMaterial({ color: '#dff6ff' })), (x0 + x1) / 2, h / 2 - 0.1, z + 0.36));
    const bottles = new THREE.InstancedMesh(SHAPES.bottle.geo(), new THREE.MeshLambertMaterial({ color: '#fff' }), 40), m4 = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    run.fridge.forEach((row, ri) => row.forEach((it, ci) => {
      const bx = x0 + 0.12 + (ci + 0.5) * ((w - 0.24) / row.length), by = 0.35 + ri * 0.42;
      bottles.setMatrixAt(n, m4.compose(new THREE.Vector3(bx, by + 0.15, z + 0.3), new THREE.Quaternion(), new THREE.Vector3(0.09, 0.15, 0.09)));
      bottles.setColorAt(n++, col.set(['#4ade80', '#05d9e8', '#ff7a00', '#ff2a6d', '#ffd23f', '#e8e8f2'][it.v % 6]));
    }));
    g.add(bottles);
    for (let ri = 0; ri < 4; ri++) g.add(at(box(w - 0.12, 0.02, 0.5, mat('#c9d6e0')), (x0 + x1) / 2, 0.3 + ri * 0.42, z + 0.1));
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.45), new THREE.MeshBasicMaterial({ color: '#cdefff', transparent: true, opacity: 0.18 })), (x0 + x1) / 2, h / 2 - 0.1, z + 0.38));
    g.add(at(box(0.04, h - 0.45, 0.04, mat('#3a3a48')), (x0 + x1) / 2, h / 2 - 0.1, z + 0.39));
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, 0.24), new THREE.MeshBasicMaterial({ map: signTex('❄ COLD DRINKS', { w: 256, h: 56, bg: '#0b0221', color: '#7fe9ff', glow: '#05d9e8' }) })), (x0 + x1) / 2, h - 0.16, z + 0.36));
    scene.add(g);
  }

  // ---------- the counter and till ----------
  function buildCounter() {
    const z0 = zOf(0.79), w = 2 * Math.abs(xOf(0, 0.79)) + 0.4, g = new THREE.Group();
    const stone = canvasTex(256, 64, (gg) => { gg.fillStyle = '#c4bddc'; gg.fillRect(0, 0, 256, 64); for (let i = 0; i < 260; i++) { gg.fillStyle = Math.random() < 0.5 ? 'rgba(60,40,90,.35)' : 'rgba(255,255,255,.6)'; gg.fillRect(Math.random() * 256, Math.random() * 64, 2, 1.5); } });
    g.add(at(box(w, 0.06, 0.85, new THREE.MeshLambertMaterial({ map: stone })), 0, 1.0, z0 + 0.4));
    g.add(at(box(w, 0.97, 0.75, mat('#3b2350')), 0, 0.485, z0 + 0.42));
    g.add(at(box(w, 0.03, 0.03, mat('#ff2a6d')), 0, 1.0, z0 - 0.02));
    // drawers on our side
    for (let i = 0; i < 4; i++) if (i !== 2) g.add(at(box(w / 4 - 0.12, 0.3, 0.02, mat('#45275e')), -w / 2 + (i + 0.5) * (w / 4), 0.7, z0 + 0.8));
    parts.drawer = at(box(w / 4 - 0.12, 0.3, 0.35, mat('#2b1640')), -w / 2 + 2.5 * (w / 4), 0.7, z0 + 0.65); g.add(parts.drawer);
    parts.cash = at(box(w / 4 - 0.2, 0.05, 0.3, mat('#22c55e')), -w / 2 + 2.5 * (w / 4), 0.84, z0 + 0.65); g.add(parts.cash);
    // the conveyor belt, scanner, card reader
    const beltTex = canvasTex(64, 16, (gg) => { gg.fillStyle = '#16121c'; gg.fillRect(0, 0, 64, 16); gg.fillStyle = 'rgba(255,255,255,.12)'; for (let x = 0; x < 64; x += 8) gg.fillRect(x, 0, 1, 16); }, [6, 1]);
    parts.beltTex = beltTex;
    g.add(at(box(1.8, 0.02, 0.5, new THREE.MeshLambertMaterial({ map: beltTex })), -w / 2 + 1.2, 1.04, z0 + 0.3));
    g.add(at(box(0.45, 0.03, 0.45, mat('#3a3f4f')), -w / 2 + 2.35, 1.04, z0 + 0.3));
    g.add(rotX(at(new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), new THREE.MeshBasicMaterial({ color: '#05d9e8', transparent: true, opacity: 0.4 })), -w / 2 + 2.35, 1.06, z0 + 0.3), -Math.PI / 2));
    parts.laser = at(box(0.36, 0.01, 0.01, new THREE.MeshBasicMaterial({ color: '#ff3b3b' })), -w / 2 + 2.35, 1.08, z0 + 0.3); g.add(parts.laser);
    parts.reader = at(box(0.14, 0.2, 0.08, mat('#1b1b24')), 0.4, 1.13, z0 + 0.12); g.add(parts.reader);
    parts.readerLight = at(new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ color: '#1e3a2a' })), 0.4, 1.18, z0 + 0.165); g.add(parts.readerLight);
    // the till screen: the classic till display drawn onto a texture
    const posC = document.createElement('canvas'); posC.width = 420; posC.height = 230;
    parts.posCtx = posC.getContext('2d'); parts.posTex = new THREE.CanvasTexture(posC); parts.posTex.colorSpace = THREE.SRGBColorSpace;
    g.add(at(box(0.06, 0.35, 0.06, mat('#2a2a35')), 1.2, 1.2, z0 + 0.45));
    g.add(at(box(1.15, 0.65, 0.06, mat('#0d0d14')), 1.2, 1.62, z0 + 0.45));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.07, 0.58), new THREE.MeshBasicMaterial({ map: parts.posTex }));
    scr.position.set(1.2, 1.62, z0 + 0.485); g.add(scr);
    // bagging stand
    g.add(at(box(0.5, 0.35, 0.3, mat('#c99a5b')), w / 2 - 0.4, 1.2, z0 + 0.35));
    // the receipt
    parts.receipt = at(new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1), new THREE.MeshBasicMaterial({ color: '#fafafa' })), -w / 2 + 2.0, 1.05, z0 + 0.75); g.add(parts.receipt);
    g.add(at(box(0.26, 0.1, 0.16, mat('#2a2a35')), -w / 2 + 2.0, 1.08, z0 + 0.75));
    scene.add(g);
    parts.counterW = w; parts.counterZ = z0;
    // you and your staff behind the till
    parts.staffFigs = [];
  }

  // ---------- props ----------
  function buildProps() {
    parts.dynamic = new THREE.Group(); scene.add(parts.dynamic);
    parts.boxGeo = new THREE.BoxGeometry(0.5, 0.36, 0.42);
    parts.boxMat = [mat('#a8713a'), mat('#a8713a'), mat('#c68d4f'), mat('#a8713a'), new THREE.MeshLambertMaterial({ map: canvasTex(64, 48, (g) => { g.fillStyle = '#a8713a'; g.fillRect(0, 0, 64, 48); g.fillStyle = '#e2c08a'; g.fillRect(28, 0, 8, 48); art.pack(g, run.b.good, 14, 44, 30, 0, 1); }) }), mat('#a8713a')];
    // the stockroom: a metal rack bay for each line, its name on top and a light (green, amber when low, flashing red when empty)
    parts.bays = L.lines.map((name, i) => {
      const g = new THREE.Group(), steel = mat('#8a90a2'), col = ['#05d9e8', '#ff2a6d', '#ffd23f'][i];
      for (const x of [-0.25, 0.25]) for (const z of [-0.24, 0.24]) g.add(at(box(0.04, 1.5, 0.04, steel), x, 0.75, z));
      for (const y of [0.08, 0.62, 1.16]) g.add(at(box(0.52, 0.03, 0.5, mat('#5b6273')), 0, y, 0));
      for (const side of [1, -1]) {
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.17), new THREE.MeshBasicMaterial({ map: signTex(name.toUpperCase(), { w: 200, h: 56, bg: '#0b0221', color: col, border: col }) }));
        sg.position.set(0, 1.62, side * 0.01); if (side < 0) sg.rotation.y = Math.PI; g.add(sg);
      }
      const light = at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#4ade80' })), 0.27, 1.62, 0);
      g.add(light);
      g.position.set(L.BAY_X[i], 0, L.BAY_Z); scene.add(g);
      return { g, light, boxes: [] };
    });
    // the back door, and the yard behind the shop where the van parks
    scene.add(at(box(1.15, 2.25, 0.08, mat('#3a3f4f')), -4, 1.12, ROOM.back - 0.05));
    scene.add(at(box(0.08, 0.08, 0.1, mat('#c9cdd8')), -3.6, 1.1, ROOM.back - 0.1));
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), new THREE.MeshBasicMaterial({ map: signTex('DELIVERIES', { w: 200, h: 56, bg: '#16a34a', color: '#fff' }) }));
    exit.rotation.y = Math.PI; exit.position.set(-4, 2.45, ROOM.back - 0.1); scene.add(exit);
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), mat('#55505e')); yard.rotation.x = -Math.PI / 2; yard.position.set(-1, 0.002, ROOM.back + 3.6); scene.add(yard);
    const r = run, plants = r.decor.plants.id;
    const list = L.PROPS.concat(plants === 'jungle' ? L.JUNGLE : []).filter(([k]) => !(k === 'plant' && plants === 'none')).concat(L.holidayProps());
    for (const [kind, x, y] of list) {
      const g = new THREE.Group(), X = xOf(x, y), Z = zOf(y);
      if (kind === 'plant') {
        g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.4, 10), mat('#b5651d')), 0, 0.2, 0));
        for (let i = 0; i < 7; i++) { const lf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(i % 2 ? '#1f9d55' : '#2fbf6b')); lf.scale.set(0.6, 1.9, 0.6); lf.position.set(Math.sin(i * 2.4) * 0.18, 0.75 + (i % 3) * 0.12, Math.cos(i * 2.4) * 0.18); lf.rotation.z = Math.sin(i * 2.4) * 0.5; g.add(lf); }
      } else if (kind === 'baskets') {
        for (let i = 0; i < 4; i++) g.add(at(box(0.5, 0.2, 0.36, mat(i === 3 ? '#ff2a6d' : '#d61e5a')), 0, 0.1 + i * 0.08, 0));
      } else if (kind === 'wet') {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.65, 4), new THREE.MeshLambertMaterial({ map: signTex('⚠', { w: 64, h: 64, bg: '#ffd23f', color: '#111' }) }));
        s.position.y = 0.33; s.rotation.y = Math.PI / 4; g.add(s);
      } else if (kind === 'bin') {
        g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.6, 12), mat('#3a3f4f')), 0, 0.3, 0));
      } else if (kind === 'candy') {
        for (let row = 0; row < 3; row++) {
          g.add(at(box(0.7, 0.02, 0.3, mat('#9aa0b5')), 0, 0.3 + row * 0.35, 0));
          for (let i = 0; i < 4; i++) g.add(at(box(0.1, 0.16, 0.06, mat(['#ff2a6d', '#ffd23f', '#4ade80', '#9b5de5'][(i + row) % 4])), -0.25 + i * 0.17, 0.39 + row * 0.35, 0));
        }
        g.add(at(box(0.7, 0.18, 0.03, new THREE.MeshBasicMaterial({ map: signTex('SWEETS', { w: 128, h: 32, bg: '#ff2a6d', color: '#fff' }) })), 0, 1.3, 0));
      } else if (kind === 'xmastree') {
        g.add(at(box(0.12, 0.3, 0.12, mat('#6b4423')), 0, 0.15, 0));
        for (let i = 0; i < 3; i++) g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.6 - i * 0.15, 0.7, 10), mat('#1f9d55')), 0, 0.6 + i * 0.4, 0));
        g.add(at(new THREE.Mesh(new THREE.OctahedronGeometry(0.1), new THREE.MeshBasicMaterial({ color: '#ffd23f' })), 0, 1.75, 0));
      } else if (kind === 'pumpkin') {
        const pm = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshLambertMaterial({ color: '#ff7a00', emissive: '#ff5a00', emissiveIntensity: 0.25 })); pm.scale.y = 0.75; pm.position.y = 0.2; g.add(pm);
      } else if (kind === 'hearts') {
        for (let i = 0; i < 3; i++) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5c8a' })), (i - 1) * 0.3, 0.5 + (i % 2) * 0.25, 0));
      }
      g.position.set(X, 0, Z); scene.add(g);
    }
    // promotions on the floor, in their line's colour
    for (const pr of r.promos || []) {
      const g = new THREE.Group(), col = ['#05d9e8', '#ff2a6d', '#ffd23f'][pr.line], name = (r.lines[pr.line] || '').toUpperCase();
      const face = (w, h, tex, y, z = 0, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(0, y, z); m.rotation.y = ry; g.add(m); };
      if (pr.id === 'poster') { // an A-board, both sides
        for (const sd of [1, -1]) { const b = box(0.6, 0.95, 0.04, mat('#2a2a35')); b.position.set(0, 0.47, sd * 0.13); b.rotation.x = sd * 0.16; g.add(b); }
        const tex = canvasTex(120, 180, (c) => { c.fillStyle = col; c.fillRect(0, 0, 120, 180); c.fillStyle = '#0b0221'; c.textAlign = 'center'; c.font = '900 26px system-ui'; c.fillText('TRY', 60, 50); c.font = '900 20px system-ui'; c.fillText(name.slice(0, 9), 60, 95); c.font = '900 26px system-ui'; c.fillText('NEW!', 60, 150); });
        face(0.5, 0.8, tex, 0.5, 0.16); face(0.5, 0.8, tex, 0.5, -0.16, Math.PI);
      } else if (pr.id === 'bogo') { // a round sign on a pole
        g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 8), mat('#9aa0b5')), 0, 0.75, 0));
        g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), mat('#2a2a35')), 0, 0.02, 0));
        const tex = canvasTex(160, 160, (c) => { c.fillStyle = col; c.beginPath(); c.arc(80, 80, 80, 0, Math.PI * 2); c.fill(); c.fillStyle = '#ff3b3b'; c.beginPath(); c.arc(80, 80, 70, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = '900 34px system-ui'; c.fillText('2 FOR 1', 80, 82); c.font = '800 18px system-ui'; c.fillText(name.slice(0, 10), 80, 110); });
        for (const ry of [0, Math.PI]) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(0, 1.7, ry ? -0.01 : 0.01); m.rotation.y = ry; g.add(m); }
      } else { // a tasting table with a tray of samples
        g.add(at(box(0.9, 0.05, 0.5, mat('#6b4423')), 0, 0.8, 0));
        for (const x of [-0.4, 0.4]) for (const z of [-0.2, 0.2]) g.add(at(box(0.04, 0.8, 0.04, mat('#4a3020')), x, 0.4, z));
        g.add(at(box(0.92, 0.35, 0.02, new THREE.MeshBasicMaterial({ map: signTex(`TASTE ${name}`, { w: 256, h: 96, bg: '#ffffff', color: col.replace('#ffd23f', '#b38600') }) })), 0, 0.6, 0.26));
        g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), mat('#e8e8f2')), 0, 0.84, 0));
        for (let i = 0; i < 6; i++) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.06, 8), mat(col)), Math.cos(i) * 0.12, 0.88, Math.sin(i) * 0.12));
      }
      g.position.set(xOf(pr.x, pr.y), 0, zOf(pr.y)); scene.add(g);
    }
    // upgrades you can see: self-checkout, coffee corner, security gates
    const up = r.up;
    if (up.selfcheck) {
      const g = new THREE.Group();
      g.add(at(box(0.12, 1, 0.12, mat('#2a2a35')), 0, 0.5, 0)); g.add(at(box(0.6, 0.16, 0.45, mat('#3a3a48')), 0, 1.05, 0));
      parts.kioskScreen = at(new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshBasicMaterial({ color: '#0f3a46' })), 0, 1.45, 0.05); g.add(parts.kioskScreen);
      g.position.set(xOf(L.KIOSK.x, L.KIOSK.y), 0, zOf(L.KIOSK.y)); scene.add(g);
    }
    if (up.coffee) {
      const g = new THREE.Group();
      g.add(at(box(0.9, 0.95, 0.6, mat('#6b4423')), 0, 0.47, 0)); g.add(at(box(0.36, 0.45, 0.35, mat('#c9cdd8')), -0.15, 1.18, 0));
      g.add(at(box(0.9, 0.2, 0.02, new THREE.MeshBasicMaterial({ map: signTex('☕ COFFEE', { w: 160, h: 40, bg: '#6b4423', color: '#ffd23f' }) })), 0, 0.75, 0.31));
      g.position.set(xOf(L.COFFEE.x, L.COFFEE.y), 0, zOf(L.COFFEE.y)); scene.add(g);
      const t = new THREE.Group();
      t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6), mat('#2a2a35')), 0, 0.37, 0)); t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16), mat('#e8e8f2')), 0, 0.75, 0));
      t.position.set(xOf(L.TABLE.x, L.TABLE.y), 0, zOf(L.TABLE.y)); scene.add(t);
    }
    if (up.gates) {
      parts.gates = [L.FRONT.door[0] + 0.01, L.FRONT.door[1] - 0.01].map((gx) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.4), new THREE.MeshLambertMaterial({ color: '#e6f0ff', transparent: true, opacity: 0.5, emissive: '#05d9e8', emissiveIntensity: 0.3 }));
        m.position.set(xOf(gx, 0.29), 0.7, zOf(0.29)); scene.add(m); return m;
      });
    }
  }

  // ---------- lights ----------
  function buildLights() {
    parts.hemi = new THREE.HemisphereLight('#cfd8ff', '#3a2a50', 1.2); scene.add(parts.hemi);
    parts.amb = new THREE.AmbientLight('#ffffff', 0.35); scene.add(parts.amb);
    parts.sun = new THREE.DirectionalLight('#fff3dd', 1.2); parts.sun.position.set(3, 9, -12); parts.sun.target.position.set(0, 0, 5); scene.add(parts.sun, parts.sun.target);
    // a soft key light from above the till: it casts the shadows (when graphics allow)
    parts.key = new THREE.DirectionalLight('#fff1dc', 0); parts.key.position.set(-3, 12, 0.5); parts.key.target.position.set(0.5, 0, 6);
    const sc = parts.key.shadow.camera; sc.left = -6.5; sc.right = 6.5; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 25;
    parts.key.shadow.mapSize.set(1024, 1024); parts.key.shadow.bias = -0.0006; parts.key.shadow.normalBias = 0.03; parts.key.shadow.radius = 3;
    scene.add(parts.key, parts.key.target);
    parts.pools = [];
    parts.lamps = L.LAMPS.map(([lx, , fy]) => {
      const X = xOf(lx, fy), Z = zOf(fy), g = new THREE.Group();
      // a small brass pendant high up, so it doesn't hide the shop below
      g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 12, 1, true), mat('#c9a24a', { side: THREE.DoubleSide })), 0, ROOM.ceil - 0.3, 0));
      const bulb = at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff2c4' })), 0, ROOM.ceil - 0.38, 0); g.add(bulb);
      const light = new THREE.PointLight('#ffd9a0', 9, 10, 1.3); light.position.set(0, ROOM.ceil - 0.5, 0); g.add(light);
      const pool = rotX(at(new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), glowMat('#ffc777')), 0, 0.014, 0), -Math.PI / 2); g.add(pool); parts.pools.push(pool);
      g.position.set(X, 0, Z); scene.add(g);
      return { light, bulb };
    });
  }

  // ---------- people ----------
  function syncPeople(dt) {
    const r = run, seen = new Set();
    const all = r.people.concat([r.clerk], r.van && r.van.courier ? [r.van.courier] : [], r.me ? [r.me] : [], r.staff.filter((st) => st.body).map((st) => st.body));
    for (const p of all) {
      if (p.kind === 'clerk' && (p.state === 'till' || (p.state === 'toTill' && p.y > L.L.counter - 0.04))) continue;
      seen.add(p);
      let f = figs.get(p);
      if (!f) {
        f = figure(p.look, { apron: p.kind === 'clerk' || p.kind === 'me' || p.kind === 'staffer' ? r.decor.uniform.color : null });
        if (p.child) f.scale.setScalar(0.66);
        f.userData.yaw = 0; f.userData.last = null;
        figs.set(p, f); parts.dynamic.add(f);
      }
      let [X, Y, Z] = wpos(p.x + (p.ox || 0), p.y);
      if (p.climb) { // on the stairs: between the bottom and the top
        const st = L.ANNEX.stair, k = clamp(p.climb.t, 0, 1), up = p.climb.up ? k : 1 - k;
        X = st.X; Z = st.Z0 + 0.3 + (st.Z1 - 0.3 - (st.Z0 + 0.3)) * up; Y = UP_Y * up;
      }
      // face the way they're walking; otherwise the shelf (back), or the till (front)
      const last = f.userData.last;
      let yaw = f.userData.yaw;
      if (last && Math.hypot(X - last[0], Z - last[1]) > 0.002) yaw = Math.atan2(X - last[0], Z - last[1]);
      else if (p.facing === 'back' && p.kind !== 'passer') yaw = Math.PI;
      else if (p.facing === 'front') yaw = 0;
      f.userData.last = [X, Z];
      let dy = yaw - f.userData.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      f.userData.yaw += dy * Math.min(1, dt * 10);
      f.rotation.y = f.userData.yaw;
      f.position.set(X, Y, Z);
      // walking: legs and arms swing; a raised hand for help; carrying things
      const moving = p.kind === 'passer' || p.moving || p.state === 'street', sw = moving ? Math.sin(p.phase || 0) * 0.55 : 0;
      f.userData.legL.rotation.x = sw; f.userData.legR.rotation.x = -sw;
      f.userData.armL.rotation.x = -sw * 0.8; f.userData.armR.rotation.x = p.hand ? -Math.PI * 0.9 + Math.sin(r.t * 8) * 0.1 : sw * 0.8;
      const carrying = ((p.kind === 'clerk' || p.kind === 'me' || p.kind === 'staffer') && p.carry > 0) || (p.kind === 'courier' && p.box > 0 && !p.trolley);
      const trolley = p.kind === 'courier' && p.trolley;
      setHeld(f, 'trolley', trolley, () => {
        const t = new THREE.Group();
        t.add(at(box(0.62, 0.04, 0.85, mat('#3a3f4f')), 0, 0.14, 0.75));
        for (const x of [-0.27, 0.27]) for (const z of [0.4, 1.1]) { const w = at(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), mat('#111')), x, 0.07, z); w.rotation.z = Math.PI / 2; t.add(w); }
        t.add(at(box(0.62, 0.9, 0.04, mat('#3a3f4f')), 0, 0.6, 0.33)); t.add(at(box(0.66, 0.05, 0.05, mat('#ff2a6d')), 0, 1.06, 0.3));
        t.userData.boxes = [];
        for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(parts.boxGeo, parts.boxMat); b.position.set(i % 2 ? 0.14 : -0.14, 0.34 + Math.floor(i / 2) * 0.37, 0.8); b.scale.setScalar(0.55 + (i % 2) * 0.05); t.add(b); t.userData.boxes.push(b); }
        return t;
      });
      if (trolley) { f.userData.armL.rotation.x = f.userData.armR.rotation.x = -1.0; const tb = f.userData.held_trolley.userData.boxes; tb.forEach((b, i) => { b.visible = p.box > 0 && i < Math.ceil(p.box / Math.max(1, r.cap * 3)) + 1; }); }
      if (carrying) { f.userData.armL.rotation.x = f.userData.armR.rotation.x = -1.2; }
      // looking along the shelf while they browse
      const head = f.userData.head, browsing = ['look', 'consider', 'wait', 'help', 'pick'].includes(p.state);
      if (head) head.rotation.y += ((browsing ? Math.sin(r.t * 1.1 + (p.phase || 0)) * 0.6 : 0) - head.rotation.y) * Math.min(1, dt * 4);
      if (p.state === 'choring') { f.userData.armR.rotation.x = -1.3 + Math.sin(p.phase) * 0.5; f.userData.armL.rotation.x = -0.9 + Math.cos(p.phase) * 0.4; }
      setHeld(f, 'box', carrying, () => { const b = new THREE.Mesh(parts.boxGeo, parts.boxMat); b.position.set(0, 1.15, 0.38); return b; });
      setHeld(f, 'basket', p.basket > 0 && !p.hidden, () => { const b = new THREE.Group(); b.add(at(box(0.36, 0.2, 0.26, mat('#ff2a6d')), 0, 0, 0)); b.add(at(box(0.3, 0.12, 0.2, packMat()), 0, 0.12, 0)); b.position.set(-0.3, 0.75, 0.05); return b; });
      setHeld(f, 'bag', p.bag, () => at(box(0.26, 0.32, 0.12, mat('#f2e3c6')), 0.32, 0.72, 0));
      setHeld(f, 'hold', p.hold, () => { const m = new THREE.Mesh(SHAPES[r.b.good] ? SHAPES[r.b.good].geo() : SHAPES.coffee.geo(), packMat()); m.scale.setScalar(0.12); m.position.set(0.25, 1.35, 0.15); return m; });
      setHeld(f, 'umbrella', (r.weather === 'rain' || r.weather === 'snow') && p.y < L.L.wall + 0.005 && p.kind !== 'courier', () => { const u = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(['#ff2a6d', '#05d9e8', '#ffd23f', '#9b5de5'][(p.look.skin + p.look.hairColor) % 4])); u.position.y = 2.15; return u; });
      if (f.userData.holo) f.userData.holo.material = mat(`hsl(${(r.t * 90) % 360}, 100%, 62%)`);
    }
    for (const [p, f] of figs) if (!seen.has(p)) { parts.dynamic.remove(f); figs.delete(p); dropFig(f); }
  }
  // free a figure's own geometry once they've gone (shared box shapes stay)
  function dropFig(f) { f.traverse((o) => { if (o.geometry && o.geometry !== parts.boxGeo) o.geometry.dispose(); }); }
  let packMatCache = null;
  const packMat = () => packMatCache || (packMatCache = new THREE.MeshLambertMaterial({ map: packTex(run.b.good, 0) }));
  function setHeld(f, key, on, make) {
    const k = 'held_' + key;
    if (on && !f.userData[k]) { f.userData[k] = make(); f.add(f.userData[k]); }
    if (!on && f.userData[k]) { f.remove(f.userData[k]); dropFig(f.userData[k]); f.userData[k] = null; }
  }
  // staff behind the counter, facing the shop
  function syncStaff() {
    const r = run, z = parts.counterZ + 1.15, w = parts.counterW;
    const want = [{ key: 'you', look: r.sellerLook, x: 0, show: !(r.away > 0), who: -1 }]
      .concat(r.staff.map((st, i) => ({ key: 'st' + i, look: st.look, x: [-0.3, 0.3, -0.42, 0.42][i % 4] * w, show: st.job === 'till' && !(st.brk > 0), who: i })))
      .concat(r.till2 && r.clerk.state === 'till' ? [{ key: 'till2', look: r.clerk.look, x: 0.2 * w, show: true, who: 'till2', apron: r.decor.uniform.color }] : []);
    parts.staffMap = parts.staffMap || new Map();
    const keep = new Set();
    for (const s of want) {
      keep.add(s.key);
      let f = parts.staffMap.get(s.key);
      if (!f) { f = figure(s.look, { apron: s.apron }); f.rotation.y = Math.PI; parts.staffMap.set(s.key, f); parts.dynamic.add(f); }
      f.visible = s.show; f.position.set(s.x, 0, z);
      const busy = r.people.some((p) => p.state === 'serving' && p.servedBy === s.who);
      const a = busy ? Math.sin(r.t * 14) * 0.6 - 0.8 : 0;
      f.userData.armL.rotation.x = a; f.userData.armR.rotation.x = busy ? -Math.sin(r.t * 14) * 0.6 - 0.8 : 0;
      // a wave hello when a shopper comes in, and a glance round the shop now and then
      if (!busy && r.greetT > 0 && (s.who === -1 || (r.away > 0 && s.who === 0))) { f.userData.armR.rotation.x = -2.7; f.userData.armR.rotation.z = Math.sin(r.t * 16) * 0.35; }
      else f.userData.armR.rotation.z = 0;
      if (f.userData.head) f.userData.head.rotation.y = Math.sin(r.t * 0.6 + s.x * 3) * 0.35;
    }
    for (const [k, f] of parts.staffMap) if (!keep.has(k)) { parts.dynamic.remove(f); parts.staffMap.delete(k); dropFig(f); }
  }

  // ---------- things that change every frame ----------
  function syncWorld(dt) {
    const r = run, k = L.dayK(), night = L.nightAt(k), lights = r.power ? 0 : r.lights;
    // sky, sun and street lights through the day
    const [top, bot] = L.skyAt(k).map((c) => new THREE.Color(c));
    const sky = top.lerp(bot, 0.4);
    if (r.weather === 'rain' || r.weather === 'snow') sky.lerp(new THREE.Color('#6a6f7c'), 0.5);
    else if (r.weather === 'cloudy') sky.lerp(new THREE.Color('#8a8f9c'), 0.3);
    scene.background = sky;
    parts.sun.intensity = 1.6 * (1 - night);
    parts.sun.color.set(k > 0.6 ? '#ffb070' : '#fff3dd');
    parts.hemi.intensity = (0.8 + 0.7 * (1 - night)) * (0.3 + 0.7 * lights) * (shadowsOn ? 0.55 : 1);
    parts.amb.intensity = (0.3 + 0.45 * lights) * (shadowsOn ? 0.6 : 1);
    parts.key.intensity = (shadowsOn ? 1.9 : 0.7) * lights;
    for (const pl of parts.pools) pl.material.opacity = 0.22 * lights * (0.6 + 0.4 * night);
    if (parts.signGlow) parts.signGlow.material.opacity = (0.08 + 0.5 * night) * (r.power ? 0 : 1);
    parts.openGlow.material.opacity = !r.closed && r.intro <= 0.3 && !r.power ? 0.12 + 0.45 * night : 0;
    for (const l of parts.annexLights || []) l.intensity = 7 * lights;
    for (const l of parts.lamps) { l.light.intensity = 9 * lights; l.bulb.material.color.set(lights > 0.5 ? '#fff2c4' : '#4a4a40'); }
    for (const wm of parts.winMats) wm.emissiveIntensity = night * 0.9;
    for (const h of parts.streetLamps || []) h.material.color.set(night > 0.1 ? '#fff2c4' : '#8a8a96');
    // doors and shutters
    for (const d of parts.doors) { // they slide with a little bounce at the end
      const u = d.userData; u.k = u.k || 0; u.v = u.v || 0;
      u.v += ((r.doorOpen - u.k) * 90 - u.v * 11) * Math.min(dt, 0.05); u.k += u.v * Math.min(dt, 0.05);
      d.position.x = u.home + u.s * clamp(u.k, -0.03, 1.04) * u.dw * 0.92;
    }
    for (const s of parts.shutters) { const hh = s.userData.h * r.shutter; s.visible = hh > 0.01; s.scale.y = Math.max(0.001, r.shutter); s.position.set(s.userData.x, s.userData.top - hh / 2, 0.06); }
    // signs that change: OPEN / CLOSED, the poster (SALE!), price tags
    const open = !r.closed && r.intro <= 0.3;
    if (parts.openState !== open) { parts.openState = open; setMap(parts.openSign, signTex(open ? 'OPEN' : 'CLOSED', { w: 256, h: 72, bg: '#0a0219', color: open ? '#ff5c8a' : '#7a4a5a', glow: open ? '#ff2a6d' : null, border: open ? '#ff2a6d' : '#5a2a3a' })); }
    const sale = L.onSale();
    if (parts.posterState !== sale) { parts.posterState = sale; setMap(parts.poster, canvasTex(160, 100, (g) => { const gr = g.createLinearGradient(0, 0, 0, 100); gr.addColorStop(0, sale ? '#ff3b3b' : '#ffd23f'); gr.addColorStop(1, sale ? '#b80f2e' : '#ff7a00'); g.fillStyle = gr; g.fillRect(0, 0, 160, 100); art.pack(g, r.b.good, 80, 66, 46, 0, 1); g.fillStyle = sale ? '#fff' : '#0b0221'; g.font = '900 20px system-ui'; g.textAlign = 'center'; g.fillText(sale ? 'SALE!' : 'FRESH!', 80, 92); })); }
    // each unit's tag shows its line's price (red when that line is on sale)
    for (const u of parts.units) {
      const lm = window.NeonShop.linePrice(r.b, r.unitLine[u.userData.ui]), sl = sale || lm < 0.999, price = T.shelfPrice(r.s, r.b) * lm;
      const label = `${sl ? 'SALE ' : ''}$${price < 100 ? price.toFixed(2) : Math.round(price).toLocaleString()}`;
      if (u.userData.tagText !== label) { u.userData.tagText = label; setMap(u.userData.tag, signTex(label, { w: 192, h: 60, bg: sl ? '#ff3b3b' : '#ffd23f', color: sl ? '#fff' : '#0b0221' })); }
    }
    // marquee bulbs and holiday lights twinkle
    if (parts.bulbs) { const c = new THREE.Color(); for (let i = 0; i < 60; i++) parts.bulbs.setColorAt(i, c.set((i + Math.floor(r.t * 8)) % 3 === 0 ? '#fff6c4' : '#5a4a20')); parts.bulbs.instanceColor.needsUpdate = true; }
    if (parts.holLights) { const c = new THREE.Color(); for (let i = 0; i < 70; i++) parts.holLights.setColorAt(i, (i + Math.floor(r.t * 3)) % 4 ? parts.holCols[i % parts.holCols.length] : c.set('#333')); parts.holLights.instanceColor.needsUpdate = true; }
    if (parts.gates) for (const g of parts.gates) g.material.emissive.set(r.alarm > 0 && Math.sin(r.t * 30) > 0 ? '#ff3b3b' : '#05d9e8');
    // the counter: belt, laser, card reader, cash drawer, receipt, till screen
    const serving = r.people.find((p) => p.state === 'serving');
    parts.beltTex.offset.x = -r.belt * 0.5;
    parts.laser.visible = !!serving && Math.sin(r.t * 40) > -0.3;
    parts.readerLight.material.color.set(r.lastSale && r.lastSale.method === 'card' && r.t - r.lastSale.t < 1.6 ? '#4ade80' : '#1e3a2a');
    const out = r.drawer > 0 ? Math.min(1, r.drawer * 4) : 0;
    parts.drawer.position.z = parts.counterZ + 0.65 + out * 0.3; parts.cash.position.z = parts.drawer.position.z; parts.cash.visible = out > 0.1;
    const rk = serving ? clamp(1 - serving.timer / (serving.serveDur || 0.5), 0, 1) : r.lastSale && r.t - r.lastSale.t < 0.15 ? 1 : 0;
    parts.receipt.visible = rk > 0; parts.receipt.scale.y = Math.max(0.01, rk * 0.3); parts.receipt.position.y = 1.12 + rk * 0.15;
    const pc = parts.posCtx;
    if (r.t - (parts.posAt || -1) > 0.1 || r.t < parts.posAt) { parts.posAt = r.t;
    pc.setTransform(1, 0, 0, 1, 0, 0); pc.fillStyle = '#0d0d14'; pc.fillRect(0, 0, 420, 230);
    window.NeonShop._drawPOS(pc, null, 420, 230, G, serving, { x: 0, y: 0, w: 420, h: 230 });
    parts.posTex.needsUpdate = true; }
    if (parts.kioskScreen) parts.kioskScreen.material.color.set(r.kioskBusy && r.kioskBusy.state === 'kiosk' ? '#05d9e8' : '#0f3a46');
    // the road's lane markings, falling rain or snow
    parts.roadTex.offset.x = (r.t * 0.15) % 1;
    if (parts.precip) {
      const a = parts.precip.geometry.attributes.position, sp = r.weather === 'snow' ? 0.8 : 9;
      for (let i = 0; i < a.count; i++) { let y = a.getY(i) - sp * dt; if (y < 0) y += 8; a.setY(i, y); if (r.weather === 'snow') a.setX(i, a.getX(i) + Math.sin(r.t + i) * 0.003); }
      a.needsUpdate = true;
    }
    syncPile(); syncVehicles(); syncFloorItems();
  }
  function syncPile() {
    const r = run;
    parts.bays.forEach((bay, line) => {
      const left = r.bay[line] || 0, n = Math.min(6, Math.ceil(left / Math.max(1, r.cap * 2)));
      while (bay.boxes.length < n) { const b = new THREE.Mesh(parts.boxGeo, parts.boxMat), i = bay.boxes.length; b.scale.setScalar(0.42); b.castShadow = true; b.position.set(i % 2 ? 0.11 : -0.11, 0.17 + Math.floor(i / 2) * 0.54, 0); bay.g.add(b); bay.boxes.push(b); }
      while (bay.boxes.length > n) bay.g.remove(bay.boxes.pop());
      const low = left < r.cap * 3;
      bay.light.material.color.set(left <= 0 ? (Math.sin(r.t * 8) > 0 ? '#ff3b3b' : '#4a1010') : low ? '#ffb020' : '#4ade80');
    });
    // boxes being dropped
    parts.falling = parts.falling || [];
    while (parts.falling.length < r.boxes.length) { const b = new THREE.Mesh(parts.boxGeo, parts.boxMat); scene.add(b); parts.falling.push(b); }
    while (parts.falling.length > r.boxes.length) scene.remove(parts.falling.pop());
    r.boxes.forEach((bx, i) => parts.falling[i].position.set(xOf(bx.x, bx.ty), 0.2 + Math.max(0, (bx.ty - bx.y) * 12), zOf(bx.ty)));
  }
  function syncFloorItems() {
    const r = run;
    parts.floorItems = parts.floorItems || new Map();
    for (const f of r.floor) if (!parts.floorItems.has(f)) { const m = new THREE.Mesh(parts.packShape.geo(), packMat()); m.scale.setScalar(0.12); m.rotation.set(Math.PI / 2, 0, f.rot); m.position.set(xOf(f.x, f.y), 0.08, zOf(f.y)); scene.add(m); parts.floorItems.set(f, m); }
    for (const [f, m] of parts.floorItems) if (!r.floor.includes(f)) { scene.remove(m); dropFig(m); parts.floorItems.delete(f); }
  }
  function car(color, w = 4) {
    const g = new THREE.Group();
    g.add(at(box(w, 0.7, 1.8, mat(color)), 0, 0.6, 0)); g.add(at(box(w * 0.5, 0.55, 1.6, mat(color)), -w * 0.05, 1.2, 0));
    g.add(at(box(w * 0.46, 0.4, 1.62, mat('#16243a')), -w * 0.05, 1.2, 0));
    for (const x of [-w * 0.32, w * 0.32]) for (const z of [-0.85, 0.85]) g.add(rotX(at(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12), mat('#111')), x, 0.32, z), Math.PI / 2));
    bakeChildren(g);
    return g;
  }
  function syncVehicles() {
    const r = run;
    parts.cars = parts.cars || new Map();
    for (const c of r.cars) if (!parts.cars.has(c)) { const m = car(c.color); m.position.z = c.dir > 0 ? -11 : -13; scene.add(m); parts.cars.set(c, m); }
    for (const [c, m] of parts.cars) { if (!r.cars.includes(c)) { scene.remove(m); dropFig(m); parts.cars.delete(c); } else { m.position.x = xOf(c.x, 0.16); m.rotation.y = c.dir > 0 ? 0 : Math.PI; } }
    // the delivery van
    if (r.van && !parts.van) {
      parts.van = new THREE.Group();
      parts.van.add(at(box(4, 2.4, 2, mat('#e8e8f2')), -0.6, 1.4, 0)); parts.van.add(at(box(1.6, 1.7, 1.9, mat('#05d9e8')), 1.9, 1.05, 0));
      parts.van.add(at(new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.6), new THREE.MeshBasicMaterial({ map: signTex('NEON FREIGHT', { w: 512, h: 80, bg: '#e8e8f2', color: '#3a0d55' }) })), -0.6, 1.6, 1.01));
      for (const x of [-1.8, 1.8]) for (const z of [-0.95, 0.95]) parts.van.add(rotX(at(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 12), mat('#111')), x, 0.4, z), Math.PI / 2));
      scene.add(parts.van);
    }
    if (!r.van && parts.van) { scene.remove(parts.van); dropFig(parts.van); parts.van = null; }
    if (parts.van) { parts.van.position.set((r.van.x - L.VAN_X) * 18 - 2.5, 0, ROOM.back + 2.4); parts.van.rotation.y = Math.PI; } // round the back
    // a parade, the police
    parts.parade = parts.parade || [];
    if (r.parade.length && !parts.parade.length) for (const m of r.parade) { const f = figure(m.look); f.add(at(box(0.6, 0.4, 0.02, mat(m.flag)), 0.4, 2.2, 0)); scene.add(f); parts.parade.push(f); }
    r.parade.forEach((m, i) => { const f = parts.parade[i]; if (!f) return; f.position.set(xOf(m.x, 0.16), 0, -12); f.rotation.y = Math.PI / 2; const sw = Math.sin(m.phase) * 0.5; f.userData.legL.rotation.x = sw; f.userData.legR.rotation.x = -sw; });
    if (r.police && !parts.police) { parts.police = car('#f2f2f2', 4.4); parts.police.add(at(box(0.6, 0.12, 0.4, new THREE.MeshBasicMaterial({ color: '#ff3b3b' })), 0, 1.55, 0)); scene.add(parts.police); }
    if (!r.police && parts.police) { scene.remove(parts.police); dropFig(parts.police); parts.police = null; }
    if (parts.police) { parts.police.position.set(xOf(r.police.x, 0.16), 0, -11); parts.police.children[parts.police.children.length - 1].material.color.set(Math.sin(r.t * 20) > 0 ? '#ff3b3b' : '#3b82f6'); }
    // dogs outside
    parts.dogs = parts.dogs || new Map();
    for (const d of r.dogs) if (!parts.dogs.has(d)) {
      const g = new THREE.Group(), c = mat(['#b07a3e', '#3a2a1a', '#e8e0d0'][d.look]);
      g.add(at(box(0.25, 0.22, 0.55, c), 0, 0.38, 0)); g.add(at(box(0.2, 0.2, 0.22, c), 0, 0.55, 0.32));
      for (const [x, z] of [[-0.08, 0.2], [0.08, 0.2], [-0.08, -0.2], [0.08, -0.2]]) g.add(at(box(0.06, 0.28, 0.06, c), x, 0.14, z));
      g.userData.tail = at(box(0.04, 0.04, 0.22, c), 0, 0.48, -0.32); g.add(g.userData.tail);
      scene.add(g); parts.dogs.set(d, g);
    }
    for (const [d, g] of parts.dogs) {
      if (!r.dogs.includes(d)) { scene.remove(g); dropFig(g); parts.dogs.delete(d); continue; }
      g.position.set(xOf(d.x, d.y), 0, zOf(d.y) - 0.2); g.rotation.y = d.moving ? Math.PI / 2 : 0;
      g.userData.tail.rotation.y = Math.sin(d.phase * 2) * 0.6;
    }
  }

  // ---------- camera ----------
  const BASE = { pos: new THREE.Vector3(0, 9.4, 14.4), look: new THREE.Vector3(0, 0, 4.6) };
  let followK = 0, fx = 0, fy = 0, fz = 4.6;
  function placeCamera(W, H, dt) {
    camera.aspect = W / H;
    // fit the room's width on a narrow phone screen
    camera.fov = clamp(48 / Math.min(1, (W / H) / 0.75), 40, 64);
    const r = run, tgt = BASE.look.clone().add(new THREE.Vector3(view.tx, 0, view.tz));
    // turned round the target (drag to go all the way round) and tilted up or down
    const base = BASE.pos.clone().sub(BASE.look), D = base.length(), el = clamp(Math.asin(base.y / D) + view.tilt, 0.28, 1.45), az = Math.atan2(base.x, base.z) + view.yaw;
    let pos = tgt.clone().add(new THREE.Vector3(D * Math.cos(el) * Math.sin(az), D * Math.sin(el), D * Math.cos(el) * Math.cos(az)));
    let dist = view.dist;
    // walking the floor: the camera follows you, a little closer in
    followK += ((r.me ? 1 : 0) - followK) * Math.min(1, dt * 3);
    if (r.me) { const [mx, my, mz] = wpos(r.me.x, r.me.y); fx += (mx - fx) * Math.min(1, dt * 4); fy += ((r.me.climb ? UP_Y / 2 : my) - fy) * Math.min(1, dt * 3); fz += (mz - fz) * Math.min(1, dt * 4); }
    if (followK > 0.001) {
      const off = new THREE.Vector3(fx * 0.8, fy, clamp(fz - 1.2, 0, 8) - BASE.look.z).multiplyScalar(followK); // (up to Level 2 with you)
      tgt.add(off); pos.add(off); dist = dist + (Math.min(dist, 0.62) - dist) * followK;
    }
    pos = tgt.clone().add(pos.sub(tgt).multiplyScalar(dist));
    // a camera move on a big sale or the van arriving
    if (r.cam) {
      const z = 1 + (r.cam.z - 1) * Math.sin(Math.PI * clamp(r.cam.t / r.cam.dur, 0, 1));
      const focus = new THREE.Vector3(xOf(r.cam.x, r.cam.y), 1, zOf(clamp(r.cam.y, 0.16, 0.85)));
      pos.lerp(focus, (z - 1) * 1.5); tgt.lerp(focus, (z - 1) * 2.5);
    }
    camera.position.copy(pos); camera.lookAt(tgt);
    camera.updateProjectionMatrix();
    // cut away what's between you and the shop: the front wall from the street side, the neighbours from theirs
    parts.frontWall.visible = pos.z > 0.6 || pos.y > 14;
    parts.nb[-1].visible = pos.x > -RW / 2 - 0.5; parts.nb[1].visible = pos.x < RW / 2 + (run.b.tier >= 2 ? 5 : 0.5);
  }

  let lastW = 0, lastH = 0, lastDpr = 0;
  const info = () => renderer.info.render;
  function render(dt) {
    if (!scene) return;
    const W = canvas.clientWidth, H = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, run.dprCap || 2);
    if (!W || !H) return;
    if (W !== lastW || H !== lastH || dpr !== lastDpr) { renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); lastW = W; lastH = H; lastDpr = dpr; }
    if (shadowsOn && (run.dprCap || 2) < 1.5) setShadows(false); // the phone's struggling: drop the shadows first
    placeCamera(W, H, dt);
    updatePacks(); syncPeople(dt); syncStaff(); syncWorld(dt);
    renderer.render(scene, camera);
  }

  // ---------- from the screen to the shop and back ----------
  const v3 = new THREE.Vector3();
  // a point in the shop (flat coords, h metres up) on screen: [x, y, pixels per metre]
  function project(x, y, h = 0) {
    const [X, Y, Z] = wpos(x, y);
    v3.set(X, Y + h, Z).project(camera);
    const W = canvas.clientWidth, H = canvas.clientHeight, d = camera.position.distanceTo(new THREE.Vector3(X, Y + h, Z));
    return [(v3.x + 1) / 2 * W, (1 - v3.y) / 2 * H, H / (2 * Math.tan((camera.fov * Math.PI) / 360) * d), v3.z < 1];
  }
  function cast(sx, sy) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    ray.setFromCamera(new THREE.Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1), camera);
    return ray;
  }
  // where on the shop floor a screen point is, in flat coords
  const upPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -UP_Y);
  function toFlatAt(sx, sy) {
    if (run && run.b.tier >= 2) { // Level 2's floor first
      const a = L.ANNEX, up = cast(sx, sy).ray.intersectPlane(upPlane, new THREE.Vector3());
      if (up && up.x > a.X0 && up.x < a.X1 && up.z > a.l2[0] && up.z < a.l2[1]) return toFlat(up.x + UP_DX, up.z);
    }
    const hit = cast(sx, sy).ray.intersectPlane(floorPlane, new THREE.Vector3());
    return hit ? toFlat(hit.x, hit.z) : null;
  }
  // which shelving unit is under a screen point
  function unitAt(sx, sy) {
    const hits = cast(sx, sy).intersectObjects(parts.units, true);
    return hits.length ? hits[0].object.parent.userData.ui ?? -1 : -1;
  }
  // where a shelf spot is on screen (for goods flying into a basket)
  function slotOnScreen(sl) {
    const u = L.UNITS[sl.u], gm = unitGeom(u);
    v3.set(xOf(sl.x, u.base) - gm.dx, gm.y0 + shelfH(gm, sl.row) + 0.15, gm.front).project(camera);
    return [(v3.x + 1) / 2 * canvas.clientWidth, (1 - v3.y) / 2 * canvas.clientHeight];
  }
  // a shelving unit's outline on screen [x0, y0, x1, y1], for showing where a box will go
  function unitRect(ui) {
    const gm = unitGeom(L.UNITS[ui]), W = canvas.clientWidth, H = canvas.clientHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [gm.x0, gm.x1]) for (const y of [gm.y0, gm.y0 + gm.h]) for (const z of [gm.front, gm.back]) {
      v3.set(x, y, z).project(camera);
      const sx = (v3.x + 1) / 2 * W, sy = (1 - v3.y) / 2 * H;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return [x0, y0, x1, y1];
  }
  function zoom(f) { view.dist = clamp(view.dist / f, 0.4, 1); if (view.dist > 0.98) { view.tx = 0; view.tz = 0; } }
  const zoomLevel = () => 1 / view.dist;
  // how much the camera is looking out at the street (for the street noise): near the windows and zoomed in
  const streetness = () => clamp((3 - (BASE.look.z + view.tz)) / 3, 0, 1) * clamp((1 - view.dist) / 0.4, 0, 1);
  // slide the view (two fingers): along the screen, whichever way round you're looking
  function pan(dx, dy) {
    const k = 0.012 * view.dist * 2, mx = -dx * k, mz = -dy * k, c = Math.cos(view.yaw), sn = Math.sin(view.yaw);
    view.tx = clamp(view.tx + mx * c + mz * sn, -4, run && run.b.tier >= 2 ? 8 : 4); view.tz = clamp(view.tz - mx * sn + mz * c, -6, 5);
  }
  // turn round the shop (one finger): sideways all the way round, up and down a little
  function orbit(dx, dy) { view.yaw -= dx * 0.009; view.tilt = clamp(view.tilt + dy * 0.004, -0.5, 0.7); }
  const rotated = () => Math.abs(Math.sin(view.yaw / 2)) > 0.01 || Math.abs(view.tilt) > 0.01 || Math.abs(view.tx) + Math.abs(view.tz) > 0.05;
  function resetView() { view.dist = 1; view.tx = 0; view.tz = 0; view.yaw = 0; view.tilt = 0; }
  // a picture of the shop as it is now (photo mode)
  function snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', 0.92); }
  const zoomed = () => view.dist < 0.98;

  return { info, _shadows: () => shadowsOn, _mem: () => renderer.info.memory, _scene: () => scene, _camera: camera, attach, detach, render, project, toFlatAt, unitAt, unitRect, slotOnScreen, zoom, zoomLevel, streetness, orbit, rotated, snapshot, pan, resetView, zoomed, xOf, zOf };
}

window.NeonShop3D = { supported, create };
window.dispatchEvent(new Event('neonshop3d'));
