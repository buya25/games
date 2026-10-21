'use strict';

// Ghost challenges: a run is packed into a share link so a friend can race it on
// the same track. The track comes from a seed; the run is the runner's position
// sampled ten times a second.
window.NeonGhost = (() => {
  const SAMPLE_STEPS = 6; // a sample every 6 fixed 1/60 s steps = 10 per second
  const VERSION = 1;

  // Small fast seeded PRNG (mulberry32): same seed, same track for everyone.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const newSeed = () => (Math.random() * 4294967296) >>> 0;

  // ---------- recording ----------
  // run = { seed, look: {outfit, trail, skin, hair, hairColor}, name, samples: [{d, x, y}], crashed }
  function createRecorder(seed, look, name) {
    return { seed, look: { ...look }, name, samples: [], crashed: false };
  }
  const record = (rec, d, x, y) => rec.samples.push({ d, x, y });

  // ---------- binary packing ----------
  const b64url = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64url = (str) => {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };

  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  // ids = lookup tables so looks travel as small indexes
  function pack(run, ids) {
    const name = new TextEncoder().encode((run.name || 'Runner').slice(0, 12));
    const n = Math.min(run.samples.length, 65535);
    const buf = new Uint8Array(16 + name.length + n * 3);
    const dv = new DataView(buf.buffer);
    let o = 0;
    dv.setUint8(o++, VERSION);
    dv.setUint32(o, run.seed >>> 0); o += 4;
    const idx = (list, v) => Math.max(0, list.indexOf(v));
    dv.setUint8(o++, idx(ids.outfits, run.look.outfit));
    dv.setUint8(o++, idx(ids.trails, run.look.trail));
    dv.setUint8(o++, run.look.skin | 0);
    dv.setUint8(o++, idx(ids.hairs, run.look.hair));
    dv.setUint8(o++, run.look.hairColor | 0);
    dv.setUint8(o++, run.crashed ? 1 : 0);
    dv.setUint8(o++, name.length);
    buf.set(name, o); o += name.length;
    dv.setUint16(o, n); o += 2;
    // per sample: distance step (0.1 units), x (0.05 units, signed), height (0.05 units)
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const s = run.samples[i];
      const dd = Math.max(0, Math.min(255, Math.round((s.d - prev) * 10)));
      prev += dd / 10;
      dv.setUint8(o++, dd);
      dv.setInt8(o++, Math.max(-127, Math.min(127, Math.round(s.x / 0.05))));
      dv.setUint8(o++, Math.max(0, Math.min(255, Math.round(s.y / 0.05))));
    }
    return buf.subarray(0, o);
  }

  function unpack(buf, ids) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let o = 0;
    if (dv.getUint8(o++) !== VERSION) throw new Error('unknown challenge version');
    const seed = dv.getUint32(o); o += 4;
    const look = {
      outfit: ids.outfits[dv.getUint8(o++)] || ids.outfits[0],
      trail: ids.trails[dv.getUint8(o++)] || ids.trails[0],
      skin: dv.getUint8(o++),
      hair: ids.hairs[dv.getUint8(o++)] || ids.hairs[0],
      hairColor: dv.getUint8(o++),
    };
    const crashed = dv.getUint8(o++) === 1;
    const nameLen = dv.getUint8(o++);
    const name = new TextDecoder().decode(buf.subarray(o, o + nameLen)); o += nameLen;
    const n = dv.getUint16(o); o += 2;
    const samples = [];
    let d = 0;
    for (let i = 0; i < n; i++) {
      d += dv.getUint8(o++) / 10;
      samples.push({ d, x: dv.getInt8(o++) * 0.05, y: dv.getUint8(o++) * 0.05 });
    }
    return { seed, look, name, crashed, samples };
  }

  // 'z' + deflated data when the browser can compress, else 'r' + raw data
  async function encode(run, ids) {
    const raw = pack(run, ids);
    if (canZip) return 'z' + b64url(await pipe(raw, new CompressionStream('deflate-raw')));
    return 'r' + b64url(raw);
  }

  async function decode(code, ids) {
    const kind = code[0], bytes = unb64url(code.slice(1));
    if (kind === 'z') return unpack(await pipe(bytes, new DecompressionStream('deflate-raw')), ids);
    if (kind === 'r') return unpack(bytes, ids);
    throw new Error('bad challenge code');
  }

  // Where the ghost is after `steps` fixed steps of play (interpolated between samples).
  // Sample i was taken after (i + 1) * SAMPLE_STEPS steps; before the first one the runner
  // was at the start line.
  const START = { d: 0, x: 0, y: 0 };
  function sampleAt(run, steps) {
    const f = steps / SAMPLE_STEPS - 1, n = run.samples.length;
    if (!n) return { ...START, done: true };
    if (f >= n - 1) return { ...run.samples[n - 1], done: true };
    const i = Math.floor(f), t = f - i;
    const a = i < 0 ? START : run.samples[i], b = run.samples[i + 1];
    return { d: a.d + (b.d - a.d) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, done: false };
  }

  const finalDistance = (run) => (run.samples.length ? run.samples[run.samples.length - 1].d : 0);

  return { SAMPLE_STEPS, seeded, newSeed, createRecorder, record, encode, decode, sampleAt, finalDistance };
})();
