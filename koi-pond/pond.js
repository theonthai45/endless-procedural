'use strict';
/* =====================================================================
   Koi Pond — procedural top-down koi pond.
   Rendering: WebGL2 (fish layer + surface layer FBOs, composited by a
   water shader with refraction, caustics, shadows and specular).
   Performance: static layers (pond bed / paper) are cached; caustics, dapple
   and soft shadows run in a half-resolution light pass; a dynamic-resolution
   controller scales the render size to hold 60 fps (debug: ?scale=0.7 pins it).
   The fps meter sits at the bottom of the controls panel.
   Realistic style: koi bodies are 3D meshes skinned on the GPU along the swim
   spine and lit per pixel (scales, eyes, gill plates, metallic sheen, sub-surface
   warmth); the pond bed is a cached, height-lit field of procedural pebbles.
   All textures (koi skins, fins, lily pads, lotus, petals, food) are
   painted procedurally into a 2D canvas atlas at start-up — no external assets.
   Sound: two CC0 ambience loops (./sounds/, falling back to BigSoundBank)
   plus water plops synthesised live with Web Audio.
   ===================================================================== */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rint = n => (Math.random() * n) | 0;
const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hexRgb = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
const shade = (h, f) => '#' + hexRgb(h).map(v => Math.round(clamp(f >= 0 ? v + (255 - v) * f : v * (1 + f), 0, 255)).toString(16).padStart(2, '0')).join('');

/* ---------------- settings ---------------- */
const KEY = 'koi-pond-v1';
const small = Math.min(innerWidth, innerHeight) < 640;
const defaults = {
  style: 'ink', koi: small ? 5 : 8, fish: small ? 10 : 18, pads: small ? 6 : 10, lotus: small ? 2 : 4, petals: small ? 8 : 14, autofeed: true,
  sound: true, vMaster: 80, on_fountain: true, v_fountain: 40, on_chimes: true, v_chimes: 25, on_plops: true, v_plops: 70,
};
let S = { ...defaults };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
let pondSeed = (Math.random() * 1e9) | 0;

/* ---------------- WebGL2 ---------------- */
const canvas = document.getElementById('pond');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
if (!gl) {
  document.body.insertAdjacentHTML('beforeend', '<div class="nogl">This koi pond needs WebGL2.<br>Please open it in a recent Chrome, Edge, Firefox or Safari.</div>');
  throw new Error('WebGL2 unavailable');
}
canvas.addEventListener('webglcontextlost', e => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());

/* ---------------- world ---------------- */
let W = innerWidth, H = innerHeight, baseLen = 120, uScale = 1;
function computeScale() { const m = Math.min(W, H); baseLen = clamp(m * 0.19, 64, 250); uScale = clamp(m / 900, 0.45, 1.6); }
computeScale();

/* =====================================================================
   TEXTURE ATLAS (procedural painting)
   ===================================================================== */
const AT = 2048;
const atlasCv = document.createElement('canvas'); atlasCv.width = AT; atlasCv.height = AT;
const actx = atlasCv.getContext('2d');
let atlasDirty = true;
let shX = 0, shY = 0, shH = 0;
function alloc(w, h) {
  const P = 4;
  if (shX + w + P * 2 > AT) { shX = 0; shY += shH; shH = 0; }
  const r = { x: shX + P, y: shY + P, w, h };
  shX += w + P * 2; shH = Math.max(shH, h + P * 2);
  r.u0 = r.x / AT; r.v0 = r.y / AT; r.u1 = (r.x + w) / AT; r.v1 = (r.y + h) / AT;
  return r;
}
const BW = 320, BH = 100, PADX = 8, LEN = 304, HALF = 40, CY = 50;   // koi body texture
const TW = 160, TH = 120;   // tail
const PW = 80, PH = 80;     // pectoral
const DW = 160, DH = 40;    // dorsal
const MW = 64, MH = 20;     // small fish
const PAD = 256, LOT = 192, FOOD = 24, PET = 32;
const MAXKOI = 20;
const SL = { koi: [], minnow: [], pad: [], lotus: [], food: [], petal: [] };
for (let i = 0; i < MAXKOI; i++) SL.koi.push({ body: alloc(BW, BH) });
for (let i = 0; i < MAXKOI; i++) SL.koi[i].tail = alloc(TW, TH);
for (let i = 0; i < MAXKOI; i++) SL.koi[i].pec = alloc(PW, PH);
for (let i = 0; i < MAXKOI; i++) SL.koi[i].dorsal = alloc(DW, DH);
for (let i = 0; i < 6; i++) SL.pad.push(alloc(PAD, PAD));
for (let i = 0; i < 3; i++) SL.lotus.push(alloc(LOT, LOT));
for (let i = 0; i < 4; i++) SL.minnow.push(alloc(MW, MH));
for (let i = 0; i < 3; i++) SL.food.push(alloc(FOOD, FOOD));
for (let i = 0; i < 5; i++) SL.petal.push(alloc(PET, PET));

function tmp(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function put(slot, c) { actx.clearRect(slot.x - 3, slot.y - 3, slot.w + 6, slot.h + 6); actx.drawImage(c, slot.x, slot.y); atlasDirty = true; }

/* ---- palettes ---- */
const COL = { white: '#f3eee5', hi: '#d6361a', hi2: '#e2522a', sumi: '#1a1715', gold: '#eaa92c', plat: '#e4e3dc', asagi: '#7893a8', chagoi: '#8a6742', yellow: '#efc843', orange: '#ec7f26' };
const INKC = { white: '#fffdf8', hi: '#c2361f', hi2: '#cd4c27', sumi: '#2a2624', gold: '#d29a3c', plat: '#fcf9f2', asagi: '#8b9aa5', chagoi: '#9a7a56', yellow: '#d9b54c', orange: '#d0752f' };

/* ---- koi body silhouette (top-down) ---- */
function hwProfile(u) {
  if (u <= 0) return 0; if (u >= 1) return 0.26;
  if (u < 0.2) { const t = u / 0.2; return 0.88 * Math.pow(Math.sin(t * Math.PI / 2), 0.62); }
  if (u < 0.38) { const t = (u - 0.2) / 0.18; return 0.88 + 0.12 * (t * t * (3 - 2 * t)); }
  const t = (u - 0.38) / 0.62; return 0.26 + 0.74 * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * t), 0.95);
}
const BODY_PATH = (() => {
  const p = new Path2D(), n = 72;
  for (let i = 0; i <= n; i++) { const u = i / n, x = PADX + u * LEN, y = CY - hwProfile(u) * HALF; i ? p.lineTo(x, y) : p.moveTo(x, y); }
  for (let i = n; i >= 0; i--) { const u = i / n; p.lineTo(PADX + u * LEN, CY + hwProfile(u) * HALF); }
  p.closePath(); return p;
})();
const BODY_OUTLINE = (() => {   // open outline (no line across the tail root)
  const p = new Path2D(), n = 72;
  for (const s of [-1, 1]) for (let i = 0; i <= n * 0.97; i++) { const u = i / n, x = PADX + u * LEN, y = CY + s * hwProfile(u) * HALF; i ? p.lineTo(x, y) : p.moveTo(x, y); }
  return p;
})();

/* ---- koi varieties ---- */
function stepPatches(d, color, nMin, nMax) {
  const n = nMin + rint(nMax - nMin + 1);
  let u = rnd(0.02, 0.12);
  for (let i = 0; i < n; i++) {
    const len = rnd(0.12, 0.3), u1 = Math.min(0.92, u + len);
    if (u1 - u < 0.08) break;
    const vs = rnd(0.25, 0.75), cnt = Math.max(3, Math.round((u1 - u) * 45)), circles = [];
    for (let j = 0; j < cnt; j++) circles.push({ u: rnd(u + 0.03, u1 - 0.03), v: rnd(-vs, vs), r: rnd(0.05, 0.095) });
    d.patches.push({ c: color, edge: rnd(0.7, 0.86), circles });
    u = u1 + rnd(0.04, 0.15); if (u > 0.85) break;
  }
}
function spots(d, color, n, rMin, rMax, u0 = 0.22, u1 = 0.88) {
  for (let i = 0; i < n; i++) {
    const cu = rnd(u0, u1), cv = rnd(-0.8, 0.8), circles = [], k = 2 + rint(3);
    for (let j = 0; j < k; j++) circles.push({ u: cu + rnd(-0.03, 0.03), v: cv + rnd(-0.2, 0.2), r: rnd(rMin, rMax) });
    d.patches.push({ c: color, edge: 0.76, circles });
  }
}
const VARIETIES = [
  ['Kohaku', 5, d => { d.base = 'white'; stepPatches(d, 'hi', 2, 4); }],
  ['Taisho Sanke', 3.5, d => { d.base = 'white'; stepPatches(d, 'hi', 2, 3); spots(d, 'sumi', 3 + rint(4), 0.025, 0.05); d.fin.stripes = true; }],
  ['Showa', 3, d => { d.base = 'sumi'; stepPatches(d, 'hi', 2, 3); spots(d, 'white', 2 + rint(3), 0.045, 0.085); d.fin = { c: 'white', moto: true }; }],
  ['Tancho', 1.2, d => { d.base = 'white'; d.patches.push({ c: 'hi', edge: 0.9, circles: [{ u: 0.1, v: 0, r: rnd(0.06, 0.075) }] }); }],
  ['Ogon', 1.5, d => { d.base = 'gold'; d.metallic = true; d.fin.c = 'gold'; }],
  ['Platinum Ogon', 1.2, d => { d.base = 'plat'; d.metallic = true; d.fin.c = 'plat'; }],
  ['Yamabuki', 1, d => { d.base = 'yellow'; d.metallic = true; d.fin.c = 'yellow'; }],
  ['Asagi', 1.2, d => {
    d.base = 'asagi'; d.scales = 'net'; d.fin.c = 'hi';
    for (const s of [-1, 1]) d.patches.push({ c: 'hi', edge: 0.7, circles: Array.from({ length: 9 }, () => ({ u: rnd(0.15, 0.9), v: s * rnd(0.9, 1.15), r: rnd(0.04, 0.07) })).concat([{ u: 0.08, v: s * 0.85, r: 0.05 }]) });
  }],
  ['Chagoi', 1, d => { d.base = 'chagoi'; d.scales = 'net'; d.fin.c = 'chagoi'; }],
  ['Kujaku', 1.2, d => { d.base = 'plat'; d.metallic = true; d.scales = 'net'; stepPatches(d, 'orange', 2, 3); d.fin.c = 'plat'; }],
  ['Benigoi', 0.8, d => { d.base = 'hi2'; d.fin.c = 'hi2'; }],
  ['Shiro Utsuri', 0.8, d => { d.base = 'sumi'; spots(d, 'white', 4 + rint(3), 0.06, 0.1, 0.05, 0.9); d.fin = { c: 'white', moto: true }; }],
  ['Hi Utsuri', 0.7, d => { d.base = 'sumi'; spots(d, 'hi2', 4 + rint(3), 0.06, 0.1, 0.05, 0.9); d.fin = { c: 'hi2', moto: true }; }],
  ['Kumonryu', 0.6, d => { d.base = 'sumi'; d.scales = 'doitsu'; spots(d, 'white', 5, 0.05, 0.09, 0.05, 0.9); d.fin = { c: 'white', moto: true }; }],
  ['Ochiba', 0.6, d => { d.base = 'asagi'; d.scales = 'net'; spots(d, 'chagoi', 3, 0.06, 0.09, 0.1, 0.85); d.fin.c = 'asagi'; }],
];
function makeDesc() {
  const total = VARIETIES.reduce((s, v) => s + v[1], 0);
  let r = Math.random() * total, vt = VARIETIES[0];
  for (const v of VARIETIES) { r -= v[1]; if (r <= 0) { vt = v; break; } }
  const d = { name: vt[0], base: 'white', patches: [], scales: 'normal', metallic: false, fin: { c: 'white' }, butterfly: Math.random() < 0.22, ginrin: Math.random() < 0.2, seed: (Math.random() * 1e9) | 0 };
  vt[2](d);
  if (d.scales === 'normal' && Math.random() < 0.18) d.scales = 'doitsu';
  // tail root colour follows the patch nearest the tail
  for (const p of d.patches) if (p.c !== 'white' && p.circles.some(c => c.u > 0.86)) d.fin.root = p.c;
  return d;
}

/* ---- koi painters ---- */
function drawPatches(x, d, C, ink) {
  for (const p of d.patches) {
    const col = C[p.c];
    for (const c of p.circles) {
      const cx = PADX + c.u * LEN, cy = CY + c.v * HALF, r = c.r * LEN;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      if (!ink) { g.addColorStop(0, col); g.addColorStop(p.edge, col); g.addColorStop(1, rgba(col, 0)); }
      else { g.addColorStop(0, rgba(col, 0.9)); g.addColorStop(0.55, rgba(col, 0.78)); g.addColorStop(1, rgba(col, 0)); }
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    }
    if (!ink && p.c !== 'white') {   // inner depth of colour
      for (const c of p.circles) {
        const cx = PADX + c.u * LEN, cy = CY + c.v * HALF, r = c.r * LEN * 0.6;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba(shade(col, -0.12), 0.35)); g.addColorStop(1, rgba(shade(col, -0.12), 0));
        x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
      }
    }
  }
}
function drawScales(x, d, rng) {
  const s = 8.6;
  if (d.scales === 'doitsu') {
    for (let u = 0.27; u < 0.9; u += 0.058) {
      const px = PADX + u * LEN, hw = hwProfile(u) * HALF;
      for (const vy of [0, -0.72, 0.72]) {
        const r = vy ? 4.5 : 6.5;
        x.beginPath(); x.ellipse(px, CY + vy * hw, r * 1.15, r * 0.85, 0, 0, TAU);
        x.fillStyle = 'rgba(255,255,255,.07)'; x.fill();
        x.lineWidth = 1.1; x.strokeStyle = 'rgba(0,0,0,.28)'; x.stroke();
      }
    }
    return;
  }
  const net = d.scales === 'net';
  let col = 0;
  for (let px = PADX + 0.24 * LEN; px < PADX + LEN + s; px += s * 0.72, col++) {
    const off = (col & 1) * s * 0.5;
    for (let py = CY - HALF - s + off; py < CY + HALF + s; py += s) {
      if (net) {
        x.lineWidth = 2.2; x.strokeStyle = d.base === 'chagoi' ? 'rgba(40,22,8,.32)' : 'rgba(18,32,48,.42)';
      } else { x.lineWidth = 0.9; x.strokeStyle = d.base === 'sumi' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.13)'; }
      x.beginPath(); x.arc(px, py, s * 0.62, -Math.PI * 0.55, Math.PI * 0.55); x.stroke();
      x.lineWidth = 0.8; x.strokeStyle = d.metallic ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.14)';
      x.beginPath(); x.arc(px - 1.3, py, s * 0.6, -1.25, -0.15); x.stroke();
    }
  }
}
function shadeColumns(x, ink) {
  for (let px = 0; px < BW; px += 2) {
    const u = clamp((px - PADX) / LEN, 0.001, 1), hw = Math.max(1, hwProfile(u) * HALF);
    const g = x.createLinearGradient(0, CY - hw, 0, CY + hw);
    if (!ink) {
      g.addColorStop(0, 'rgba(0,0,0,.36)'); g.addColorStop(0.18, 'rgba(0,0,0,.1)');
      g.addColorStop(0.4, 'rgba(255,255,255,.07)'); g.addColorStop(0.48, 'rgba(255,255,255,.13)'); g.addColorStop(0.58, 'rgba(255,255,255,.05)');
      g.addColorStop(0.8, 'rgba(0,0,0,.14)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
    } else {
      g.addColorStop(0, 'rgba(60,50,40,.2)'); g.addColorStop(0.22, 'rgba(60,50,40,0)'); g.addColorStop(0.78, 'rgba(60,50,40,0)'); g.addColorStop(1, 'rgba(60,50,40,.24)');
    }
    x.fillStyle = g; x.fillRect(px, CY - hw, 2, hw * 2);
  }
}
/* Realistic mode: the body texture is pure pigment (albedo). Volume, scales, eyes,
   gill plates, sheen and translucency are all computed by the 3D koi shader. The
   texture spans the full slot (no silhouette mask) because the mesh wraps it around
   the body: texture y = CY + t * hw(u), t = -1..1 across the back. */
function paintBodyReal(d) {
  const [c, x] = tmp(BW, BH), base = COL[d.base], rng = mulberry32(d.seed);
  x.fillStyle = base; x.fillRect(0, 0, BW, BH);
  // living-skin variation: blotchy pigment density, never a flat fill
  for (let i = 0; i < 70; i++) {
    const cx = rng() * BW, cy = rng() * BH, r = 6 + rng() * 22;
    blob(x, cx, cy, r, d.base === 'sumi' ? `rgba(70,62,58,${0.05 + rng() * 0.09})` : rng() < 0.5 ? `rgba(255,252,246,${0.05 + rng() * 0.08})` : rgba(shade(base, -0.25), 0.04 + rng() * 0.06));
  }
  if (d.base === 'white' || d.base === 'plat') {   // shiroji: faint warm flush on the head, cooler flanks
    blob(x, PADX + 0.06 * LEN, CY, 34, 'rgba(240,190,170,.22)');
  }
  if (d.base === 'asagi') {   // pale indigo back, lighter flanks
    const g = x.createLinearGradient(0, CY - HALF, 0, CY + HALF);
    g.addColorStop(0, 'rgba(225,232,236,.55)'); g.addColorStop(0.3, 'rgba(225,232,236,0)'); g.addColorStop(0.7, 'rgba(225,232,236,0)'); g.addColorStop(1, 'rgba(225,232,236,.55)');
    x.fillStyle = g; x.fillRect(0, 0, BW, BH);
  }
  // patterns: sharp leading edge (kiwa), softer trailing edge (sashi) — the shader
  // additionally snaps edges to the scale grid
  for (const p of d.patches) {
    const col = COL[p.c];
    for (const cc of p.circles) {
      const cx = PADX + cc.u * LEN, cy = CY + cc.v * HALF, r = cc.r * LEN;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, col); g.addColorStop(Math.min(0.96, p.edge + 0.1), col); g.addColorStop(1, rgba(col, 0));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    }
    if (p.c !== 'white') for (let i = 0; i < 14; i++) {   // pigment density inside the patch
      const cc = p.circles[(rng() * p.circles.length) | 0], cx = PADX + cc.u * LEN + (rng() - 0.5) * 12, cy = CY + cc.v * HALF + (rng() - 0.5) * 12;
      blob(x, cx, cy, cc.r * LEN * (0.3 + rng() * 0.4), rgba(shade(col, p.c === 'sumi' ? 0.08 : -0.16), 0.22));
    }
  }
  // nostrils & lips
  x.fillStyle = 'rgba(20,12,10,.55)';
  for (const s of [-1, 1]) { x.beginPath(); x.ellipse(PADX + 0.04 * LEN, CY + s * 6.5, 1.8, 1.3, 0, 0, TAU); x.fill(); }
  blob(x, PADX + 0.004 * LEN, CY, 9, d.base === 'sumi' ? 'rgba(60,50,46,.5)' : 'rgba(200,140,120,.35)');
  return c;
}
function paintBody(d, ink) {
  if (!ink) return paintBodyReal(d);
  const [c, x] = tmp(BW, BH), C = ink ? INKC : COL, base = C[d.base], rng = mulberry32(d.seed);
  if (d.metallic && !ink) {
    const g = x.createLinearGradient(PADX, 0, PADX + LEN, 0);
    g.addColorStop(0, shade(base, 0.28)); g.addColorStop(0.35, base); g.addColorStop(0.7, shade(base, 0.12)); g.addColorStop(1, shade(base, -0.12));
    x.fillStyle = g;
  } else x.fillStyle = base;
  x.fillRect(0, 0, BW, BH);
  if (ink && d.base === 'sumi') {   // ink wash variation in black koi
    for (let i = 0; i < 16; i++) {
      const cx = rng() * BW, cy = CY + (rng() - 0.5) * 40, r = 10 + rng() * 26, g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(110,100,92,.32)'); g.addColorStop(1, 'rgba(110,100,92,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  drawPatches(x, d, C, ink);
  if (!ink) drawScales(x, d, rng);
  else {   // sparse brush scales
    x.lineWidth = 0.9;
    for (let u = 0.3; u < 0.86; u += 0.05) for (let v = -0.5; v <= 0.5; v += 0.33) {
      if (rng() < 0.45) continue;
      const px = PADX + u * LEN, py = CY + (v + ((u * 20 | 0) & 1) * 0.16) * hwProfile(u) * HALF;
      x.strokeStyle = d.base === 'sumi' ? 'rgba(255,250,240,.16)' : 'rgba(35,30,28,.26)';
      x.beginPath(); x.arc(px, py, 4.6, -1.5, 1.5); x.stroke();
    }
    for (let i = 0; i < 260; i++) {   // pigment granulation
      x.fillStyle = `rgba(30,24,20,${0.03 + rng() * 0.05})`; x.fillRect(PADX + rng() * LEN, CY + (rng() - 0.5) * 70, 1, 1);
    }
  }
  shadeColumns(x, ink);
  // head details
  const hx = PADX + 0.1 * LEN;
  if (!ink) {
    let g = x.createRadialGradient(hx, CY - 5, 0, hx, CY - 5, 20);
    g.addColorStop(0, `rgba(255,255,255,${d.base === 'sumi' ? 0.14 : 0.26})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(hx - 22, CY - 27, 44, 44);
    if (d.metallic) {
      g = x.createLinearGradient(0, CY - 16, 0, CY + 16);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,.28)'); g.addColorStop(0.5, 'rgba(255,255,255,.4)'); g.addColorStop(0.58, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(PADX + 0.05 * LEN, CY - 16, 0.75 * LEN, 32);
    }
    x.strokeStyle = 'rgba(0,0,0,.2)'; x.lineWidth = 1.3;
    x.beginPath(); x.ellipse(PADX + 0.135 * LEN, CY, 0.075 * LEN, hwProfile(0.21) * HALF * 0.98, 0, -1.25, 1.25); x.stroke();
    x.fillStyle = 'rgba(0,0,0,.35)';
    for (const s of [-1, 1]) { x.beginPath(); x.ellipse(PADX + 0.035 * LEN, CY + s * 5, 1.4, 1.1, 0, 0, TAU); x.fill(); }
  } else {
    x.strokeStyle = d.base === 'sumi' ? 'rgba(255,250,240,.35)' : 'rgba(30,25,22,.6)'; x.lineWidth = 1.5;
    x.beginPath(); x.ellipse(PADX + 0.135 * LEN, CY, 0.075 * LEN, hwProfile(0.21) * HALF * 0.95, 0, -1.1, 1.1); x.stroke();
  }
  // mask to silhouette
  x.globalCompositeOperation = 'destination-in'; x.fillStyle = '#000'; x.fill(BODY_PATH);
  x.globalCompositeOperation = 'source-atop';
  x.lineJoin = 'round';
  if (!ink) { x.strokeStyle = 'rgba(0,0,0,.32)'; x.lineWidth = 2; x.stroke(BODY_OUTLINE); }
  x.globalCompositeOperation = 'source-over';
  if (ink) { x.strokeStyle = 'rgba(28,23,20,.85)'; x.lineWidth = 2.3; x.stroke(BODY_OUTLINE); x.strokeStyle = 'rgba(28,23,20,.25)'; x.lineWidth = 4; x.stroke(BODY_OUTLINE); }
  // eyes
  const eu = 0.075, ex = PADX + eu * LEN, ey = hwProfile(eu) * HALF - 2.4;
  for (const s of [-1, 1]) {
    x.fillStyle = ink ? '#1c1816' : '#120f0d';
    x.beginPath(); x.ellipse(ex, CY + s * ey, ink ? 2.4 : 3.3, ink ? 2.4 : 2.5, 0, 0, TAU); x.fill();
    if (!ink) { x.fillStyle = 'rgba(255,255,255,.75)'; x.beginPath(); x.arc(ex - 1, CY + s * ey - 0.8, 0.85, 0, TAU); x.fill(); }
  }
  return c;
}
function fanPath(rx, ry, len, halfAng, fork, ruffle, seed, paddle) {
  const p = new Path2D(), n = 48, ph = (seed % 1000) / 100;
  p.moveTo(rx, ry - 5);
  for (let i = 0; i <= n; i++) {
    const a = -halfAng + 2 * halfAng * i / n, s = Math.abs(a) / halfAng;
    let R = paddle ? len * (1 - 0.38 * s * s) : len * (1 - fork + fork * Math.pow(s, 1.3)) * (1 - 0.28 * Math.pow(s, 10));
    R *= 1 + ruffle * Math.sin(a * 23 + ph) + ruffle * 0.6 * Math.sin(a * 41 + ph * 2);
    p.lineTo(rx + Math.cos(a) * R, ry + Math.sin(a) * R);
  }
  p.lineTo(rx, ry + 5); p.closePath(); return p;
}
function paintFin(x, path, rx, ry, len, halfAng, d, ink, rays, rng) {
  const C = ink ? INKC : COL, fin = d.fin, col = C[fin.c] || C.white, rootC = fin.root ? C[fin.root] : col;
  if (!ink) {
    // translucent membrane: dense near the root, nearly clear at the tips
    const g = x.createRadialGradient(rx, ry, 0, rx, ry, len);
    const metal = d.metallic;
    g.addColorStop(0, rgba(rootC, 0.9)); g.addColorStop(0.22, rgba(col, metal ? 0.72 : 0.6)); g.addColorStop(0.6, rgba(col, metal ? 0.42 : 0.3));
    g.addColorStop(0.9, rgba(shade(col, 0.15), 0.16)); g.addColorStop(1, rgba(shade(col, 0.2), 0.1));
    x.fillStyle = g; x.fill(path);
    x.save(); x.clip(path);
    if (fin.moto) {
      const g2 = x.createRadialGradient(rx, ry, 0, rx, ry, len * 0.52);
      g2.addColorStop(0, rgba(COL.sumi, 0.88)); g2.addColorStop(0.55, rgba(COL.sumi, 0.6)); g2.addColorStop(1, rgba(COL.sumi, 0));
      x.fillStyle = g2; x.fillRect(0, 0, x.canvas.width, x.canvas.height);
    }
    // soft folds in the membrane between rays
    for (let i = 0; i < rays * 2; i++) {
      const a = -halfAng * 1.1 + (i + 0.5) / (rays * 2) * halfAng * 2.2;
      x.strokeStyle = i & 1 ? 'rgba(0,10,8,.05)' : 'rgba(255,255,255,.05)'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(rx, ry); x.lineTo(rx + Math.cos(a) * len * 1.1, ry + Math.sin(a) * len * 1.1); x.stroke();
    }
    // segmented, branching fin rays (lepidotrichia)
    const nR = Math.round(rays * 1.4);
    for (let i = 0; i < nR; i++) {
      const a = -halfAng * 1.05 + (i + 0.5) / nR * halfAng * 2.1 + (rng() - 0.5) * 0.02;
      const fork = 0.45 + rng() * 0.2, spread = halfAng / nR * 0.45;
      const ex = rx + Math.cos(a) * len * fork, ey = ry + Math.sin(a) * len * fork;
      const ray = (w, c) => {
        x.strokeStyle = c; x.lineWidth = w; x.beginPath(); x.moveTo(rx, ry); x.lineTo(ex, ey);
        for (const s of [-1, 1]) { x.moveTo(ex, ey); x.lineTo(rx + Math.cos(a + s * spread) * len * 1.08, ry + Math.sin(a + s * spread) * len * 1.08); }
        x.stroke();
      };
      ray(1.6, 'rgba(10,20,18,.10)'); ray(0.7, metal ? 'rgba(255,250,235,.42)' : 'rgba(255,255,255,.3)');
      // segment joints along each ray
      x.fillStyle = 'rgba(255,255,255,.12)';
      for (let t = 0.2; t < fork; t += 0.09) { x.beginPath(); x.arc(rx + Math.cos(a) * len * t, ry + Math.sin(a) * len * t, 0.7, 0, TAU); x.fill(); }
    }
    if (fin.stripes) {
      for (let i = 0; i < 4; i++) {
        const a = -halfAng + rng() * halfAng * 2;
        x.strokeStyle = rgba(COL.sumi, 0.65); x.lineWidth = 2.4;
        x.beginPath(); x.moveTo(rx + Math.cos(a) * len * 0.15, ry + Math.sin(a) * len * 0.15); x.lineTo(rx + Math.cos(a) * len * 0.75, ry + Math.sin(a) * len * 0.75); x.stroke();
      }
    }
    // the free edge is thinner and slightly frayed
    x.globalCompositeOperation = 'destination-out';
    x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 3; x.stroke(path);
    x.globalCompositeOperation = 'source-over';
    x.restore();
  } else {
    const tint = (fin.c === 'white' || fin.c === 'plat') ? '#5a524c' : col;
    const g = x.createRadialGradient(rx, ry, 0, rx, ry, len);
    g.addColorStop(0, rgba(fin.root ? C[fin.root] : tint, 0.4)); g.addColorStop(1, rgba(tint, 0.06));
    x.fillStyle = g; x.fill(path);
    x.save(); x.clip(path);
    if (fin.moto) { const g2 = x.createRadialGradient(rx, ry, 0, rx, ry, len * 0.45); g2.addColorStop(0, 'rgba(30,26,24,.85)'); g2.addColorStop(1, 'rgba(30,26,24,0)'); x.fillStyle = g2; x.fillRect(0, 0, x.canvas.width, x.canvas.height); }
    x.strokeStyle = 'rgba(30,25,22,.3)'; x.lineWidth = 0.8;
    for (let i = 0; i < rays; i += 1) {
      if (rng() < 0.35) continue;
      const a = -halfAng + (i + 0.5) / rays * halfAng * 2;
      x.beginPath(); x.moveTo(rx + Math.cos(a) * len * 0.1, ry + Math.sin(a) * len * 0.1); x.lineTo(rx + Math.cos(a) * len * (0.7 + rng() * 0.3), ry + Math.sin(a) * len * (0.7 + rng() * 0.3)); x.stroke();
    }
    x.restore();
    x.strokeStyle = 'rgba(30,25,22,.6)'; x.lineWidth = 1.2; x.stroke(path);
  }
}
function paintKoi(k) {
  const ink = S.style === 'ink', d = k.desc, s = k.slot, rng = mulberry32(d.seed + 7);
  put(s.body, paintBody(d, ink));
  let [c, x] = tmp(TW, TH);
  paintFin(x, fanPath(4, TH / 2, 150, 0.42, d.butterfly ? 0.16 : 0.3, d.butterfly ? 0.035 : 0.012, d.seed, false), 4, TH / 2, 150, 0.42, d, ink, 18, rng);
  put(s.tail, c);
  [c, x] = tmp(PW, PH);
  paintFin(x, fanPath(4, PH / 2, 72, 0.6, 0, d.butterfly ? 0.03 : 0.01, d.seed + 3, true), 4, PH / 2, 72, 0.6, d, ink, 11, rng);
  put(s.pec, c);
  [c, x] = tmp(DW, DH);
  const p = new Path2D();
  p.moveTo(4, 20); p.bezierCurveTo(50, 9, 130, 11, 156, 20); p.bezierCurveTo(130, 29, 50, 31, 4, 20); p.closePath();
  const C = ink ? INKC : COL, fc = C[d.fin.c] || C.white;
  if (!ink) {
    // seen from above the dorsal fin is a thin, slightly translucent blade along the spine
    const dc = d.base === 'sumi' ? COL.sumi : fc;
    const g = x.createLinearGradient(0, 8, 0, 32);
    g.addColorStop(0, rgba(dc, 0)); g.addColorStop(0.4, rgba(shade(dc, -0.1), 0.35)); g.addColorStop(0.5, rgba(shade(dc, -0.3), 0.6)); g.addColorStop(0.6, rgba(shade(dc, -0.1), 0.35)); g.addColorStop(1, rgba(dc, 0));
    x.fillStyle = g; x.fill(p);
    x.save(); x.clip(p); x.lineWidth = 0.8;
    for (let i = 8; i < 156; i += 5) { x.strokeStyle = 'rgba(255,255,255,.2)'; x.beginPath(); x.moveTo(i, 10); x.lineTo(i + 7, 30); x.stroke(); }
    x.restore();
    x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(8, 21); x.bezierCurveTo(60, 21.4, 120, 21.2, 150, 20.6); x.stroke();
  } else {
    x.fillStyle = 'rgba(40,34,30,.12)'; x.fill(p);
    x.strokeStyle = 'rgba(30,25,22,.55)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(6, 20); x.bezierCurveTo(60, 17, 120, 18, 150, 20); x.stroke();
  }
  put(s.dorsal, c);
}

/* ---- small fish ---- */
function paintMinnow(type, ink) {
  const [c, x] = tmp(MW, MH), cy = MH / 2, body = new Path2D(), n = 30;
  for (let i = 0; i <= n; i++) { const u = i / n, hw = 5.4 * Math.pow(Math.sin(Math.PI * (u * 0.9 + 0.04)), 0.7) * (u < 0.3 ? 1 : 1 - (u - 0.3) * 0.5); const px = 2 + u * 44; i ? body.lineTo(px, cy - hw) : body.moveTo(px, cy - hw); }
  for (let i = n; i >= 0; i--) { const u = i / n, hw = 5.4 * Math.pow(Math.sin(Math.PI * (u * 0.9 + 0.04)), 0.7) * (u < 0.3 ? 1 : 1 - (u - 0.3) * 0.5); body.lineTo(2 + u * 44, cy + hw); }
  body.closePath();
  const tail = new Path2D(); tail.moveTo(43, cy); tail.lineTo(62, cy - 7.5); tail.quadraticCurveTo(55, cy, 62, cy + 7.5); tail.closePath();
  const pals = [['#9aa596', '#4c5844', '#d3d9cc'], ['#f07a22', '#d45a14', '#f9b46a'], ['#e3d49c', '#a59a6a', '#f2ead0'], ['#7b6a55', '#3f3326', '#a89a84']];
  const [mid, back, edge] = pals[type];
  if (!ink) {
    x.fillStyle = rgba(mid, 0.55); x.fill(tail);
    const g = x.createLinearGradient(0, cy - 6, 0, cy + 6);
    g.addColorStop(0, edge); g.addColorStop(0.35, mid); g.addColorStop(0.5, back); g.addColorStop(0.65, mid); g.addColorStop(1, edge);
    x.fillStyle = g; x.fill(body);
    if (type === 3) { x.fillStyle = 'rgba(30,20,10,.5)'; for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(10 + i * 3.8, cy + (i % 2 ? 2 : -2), 1, 0, TAU); x.fill(); } }
    x.fillStyle = '#111'; for (const s of [-1, 1]) { x.beginPath(); x.arc(7.5, cy + s * 3.4, 1.15, 0, TAU); x.fill(); }
  } else {
    const ink2 = type === 1 ? 'rgba(196,64,34,.82)' : type === 2 ? 'rgba(70,62,56,.35)' : 'rgba(34,30,28,.82)';
    x.fillStyle = ink2; x.fill(body);
    x.strokeStyle = ink2; x.lineWidth = 1; x.stroke(tail);
    x.fillStyle = type === 2 ? 'rgba(70,62,56,.25)' : 'rgba(34,30,28,.4)'; x.fill(tail);
    x.fillStyle = '#111'; for (const s of [-1, 1]) { x.beginPath(); x.arc(7.5, cy + s * 3.2, 1.2, 0, TAU); x.fill(); }
  }
  return c;
}

/* ---- lily pads & lotus leaves ---- */
function padPath(cx, cy, R, notch, rng) {
  const p = new Path2D(), nh = notch ? 0.1 + rng() * 0.06 : 0, n = 96, ph = [rng() * 6, rng() * 6, rng() * 6];
  if (notch) p.moveTo(cx + R * 0.05, cy);
  for (let i = 0; i <= n; i++) {
    const a = nh + (TAU - 2 * nh) * i / n;
    const r = R * (1 + 0.012 * Math.sin(a * 5 + ph[0]) + 0.008 * Math.sin(a * 11 + ph[1]) + (notch ? 0 : 0.022 * Math.sin(a * 7 + ph[2])));
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    (i === 0 && !notch) ? p.moveTo(px, py) : p.lineTo(px, py);
  }
  p.closePath(); return { p, nh };
}
function blob(x, cx, cy, r, col) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); }
function paintPad(v, ink) {
  const [c, x] = tmp(PAD, PAD), cx = 128, cy = 128, R = 118, rng = mulberry32(pondSeed + v * 101);
  const lotus = v >= 4, { p, nh } = padPath(cx, cy, R, !lotus, rng);
  const veins = (n, curve) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = nh + (TAU - 2 * nh) * (i + 0.5) / n, b = a + (rng() - 0.5) * curve;
      out.push([cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 1.02, cx + Math.cos(b) * R * 0.5, cy + Math.sin(b) * R * 0.5]);
    }
    return out;
  };
  if (!ink) {
    const pals = [['#64913f', '#45742d', '#2f5520'], ['#6e9842', '#4c7b2d', '#3a5e20'], ['#5a823b', '#3d6727', '#2a4b1b'], ['#7d9b45', '#5d7f31', '#4c6123'], ['#76a083', '#557f68', '#3d6551'], ['#6b9779', '#4b775f', '#355a46']][v];
    const g = x.createRadialGradient(cx - 12, cy - 14, 4, cx, cy, R);
    g.addColorStop(0, pals[0]); g.addColorStop(0.72, pals[1]); g.addColorStop(1, pals[2]);
    x.fillStyle = g; x.fill(p);
    x.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 70; i++) { const a = rng() * TAU, r = Math.sqrt(rng()) * R; blob(x, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 8 + rng() * 26, rng() < 0.5 ? 'rgba(175,205,115,.10)' : 'rgba(18,38,10,.13)'); }
    if (v === 3 || (!lotus && rng() < 0.3)) for (let i = 0; i < 4; i++) { const a = rng() * TAU, r = R * (0.75 + rng() * 0.25); blob(x, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 12 + rng() * 22, 'rgba(178,150,62,.55)'); }
    const vs = veins(lotus ? 20 : 24, lotus ? 0.04 : 0.25);
    for (const [ex, ey, qx, qy] of vs) {
      x.strokeStyle = lotus ? 'rgba(210,235,200,.2)' : 'rgba(205,230,160,.13)'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(qx, qy, ex, ey); x.stroke();
      x.strokeStyle = 'rgba(15,35,10,.14)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(cx + 1.5, cy + 1.5); x.quadraticCurveTo(qx + 1.5, qy + 1.5, ex + 1.5, ey + 1.5); x.stroke();
    }
    if (lotus) {
      blob(x, cx, cy, R * 0.55, 'rgba(200,225,190,.18)');
      x.fillStyle = 'rgba(190,215,170,.8)'; x.beginPath(); x.arc(cx, cy, 6, 0, TAU); x.fill();
    } else { x.fillStyle = 'rgba(190,215,140,.5)'; x.beginPath(); x.arc(cx, cy, 3, 0, TAU); x.fill(); }
    if (v === 1) { x.strokeStyle = 'rgba(150,55,40,.4)'; x.lineWidth = 7; x.stroke(p); }
    x.strokeStyle = 'rgba(225,240,185,.16)'; x.lineWidth = 7; x.stroke(p);   // waxy upturned rim
    x.strokeStyle = 'rgba(15,32,8,.22)'; x.lineWidth = 1.2; x.stroke(p);
    blob(x, cx - 40, cy - 46, 70, 'rgba(255,255,255,.10)');
    x.globalCompositeOperation = 'source-over';
    const drops = 2 + ((rng() * 5) | 0);
    for (let i = 0; i < drops; i++) {
      const a = rng() * TAU, r = rng() * R * 0.7, dx = cx + Math.cos(a) * r, dy = cy + Math.sin(a) * r, dr = 2 + rng() * 3.2;
      x.fillStyle = 'rgba(10,30,5,.28)'; x.beginPath(); x.ellipse(dx + 1.2, dy + 1.6, dr, dr * 0.9, 0, 0, TAU); x.fill();
      const g2 = x.createRadialGradient(dx, dy, 0, dx, dy, dr); g2.addColorStop(0, 'rgba(230,245,225,.06)'); g2.addColorStop(1, 'rgba(230,245,225,.35)');
      x.fillStyle = g2; x.beginPath(); x.arc(dx, dy, dr, 0, TAU); x.fill();
      x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(dx - dr * 0.35, dy - dr * 0.35, dr * 0.28, 0, TAU); x.fill();
    }
  } else {
    x.fillStyle = lotus ? 'rgba(48,56,46,.55)' : 'rgba(78,92,68,.34)'; x.fill(p);
    x.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 9; i++) { const a = rng() * TAU, r = rng() * R * 0.8; blob(x, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 30 + rng() * 70, rng() < 0.6 ? (lotus ? 'rgba(25,28,24,.42)' : 'rgba(35,45,32,.34)') : 'rgba(110,130,95,.22)'); }
    blob(x, cx + (rng() - 0.5) * 80, cy + (rng() - 0.5) * 80, 90, 'rgba(250,245,232,.28)');
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(20,20,18,${rng() * 0.08})`; x.fillRect(rng() * PAD, rng() * PAD, 1.4, 1.4); }
    x.globalCompositeOperation = 'destination-out';
    x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = lotus ? 2.2 : 1.5;
    for (const [ex, ey, qx, qy] of veins(lotus ? 12 : 13, 0.5)) { x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(qx, qy, ex, ey); x.stroke(); }
    x.globalCompositeOperation = 'source-over';
    x.save(); x.setLineDash([60 + rng() * 80, 20 + rng() * 40]); x.lineDashOffset = rng() * 100;
    x.strokeStyle = 'rgba(28,30,26,.6)'; x.lineWidth = 1.6; x.stroke(p); x.restore();
  }
  return c;
}
function petal(x, len, wid, c0, c1, c2, ink) {
  const p = new Path2D(); p.moveTo(0, 0);
  p.bezierCurveTo(len * 0.25, -wid, len * 0.8, -wid * 0.85, len, 0); p.bezierCurveTo(len * 0.8, wid * 0.85, len * 0.25, wid, 0, 0);
  if (!ink) {
    const g = x.createLinearGradient(0, 0, len, 0); g.addColorStop(0, c0); g.addColorStop(0.55, c1); g.addColorStop(1, c2);
    x.fillStyle = g; x.fill(p);
    const sb = x.shadowBlur; x.shadowBlur = 0;
    x.strokeStyle = 'rgba(190,60,110,.1)'; x.lineWidth = 0.7;
    for (let j = -1; j <= 1; j++) { x.beginPath(); x.moveTo(len * 0.1, 0); x.quadraticCurveTo(len * 0.5, j * wid * 0.5, len * 0.92, j * wid * 0.15); x.stroke(); }
    x.strokeStyle = 'rgba(170,40,90,.12)'; x.lineWidth = 0.8; x.stroke(p);
    x.shadowBlur = sb;
  } else {
    const g = x.createLinearGradient(0, 0, len, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(220,120,140,.18)'); g.addColorStop(1, 'rgba(208,72,108,.55)');
    x.fillStyle = g; x.fill(p); x.strokeStyle = 'rgba(55,38,38,.72)'; x.lineWidth = 1.1; x.stroke(p);
  }
}
function paintLotus(v, ink) {
  const [c, x] = tmp(LOT, LOT), rng = mulberry32(pondSeed + 900 + v);
  const tips = ['#e0507e', '#efa9c0', '#d23a6c'][v], mids = ['#f6c0d2', '#fbe3ea', '#f3a9c2'][v];
  x.translate(LOT / 2, LOT / 2);
  if (!ink) { x.shadowColor = 'rgba(0,0,0,.3)'; x.shadowBlur = 8; x.shadowOffsetX = 2; x.shadowOffsetY = 3; }
  const r0 = rng() * TAU;
  for (let i = 0; i < 8; i++) { x.save(); x.rotate(r0 + i * TAU / 8 + (rng() - 0.5) * 0.15); petal(x, 86, 27, '#fff7f8', mids, tips, ink); x.restore(); }
  for (let i = 0; i < 8; i++) { x.save(); x.rotate(r0 + TAU / 16 + i * TAU / 8 + (rng() - 0.5) * 0.15); petal(x, 68, 23, '#fffafa', mids, tips, ink); x.restore(); }
  for (let i = 0; i < 6; i++) { x.save(); x.rotate(r0 + i * TAU / 6 + 0.3); petal(x, 44, 16, '#ffffff', '#fde9ef', mids, ink); x.restore(); }
  x.shadowBlur = 0; x.shadowOffsetX = x.shadowOffsetY = 0;
  for (let i = 0; i < 48; i++) {
    const a = rng() * TAU, r1 = 23 + rng() * 6;
    x.strokeStyle = ink ? 'rgba(60,45,30,.55)' : '#efc041'; x.lineWidth = ink ? 0.8 : 1.4;
    x.beginPath(); x.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); x.stroke();
    x.fillStyle = ink ? 'rgba(200,150,60,.7)' : '#f8da6c'; x.beginPath(); x.arc(Math.cos(a) * r1, Math.sin(a) * r1, 1.6, 0, TAU); x.fill();
  }
  const g = x.createRadialGradient(-3, -3, 1, 0, 0, 14);
  g.addColorStop(0, ink ? 'rgba(215,180,90,.75)' : '#ece887'); g.addColorStop(1, ink ? 'rgba(170,140,60,.75)' : '#aeaa45');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 13, 0, TAU); x.fill();
  x.fillStyle = ink ? 'rgba(40,30,20,.8)' : '#7f7d2e';
  for (let i = 0; i < 7; i++) { const a = i * TAU / 7; x.beginPath(); x.arc(Math.cos(a) * 7, Math.sin(a) * 7, 1.7, 0, TAU); x.fill(); }
  x.beginPath(); x.arc(0, 0, 1.7, 0, TAU); x.fill();
  return c;
}
function paintFood(v, ink) {
  const [c, x] = tmp(FOOD, FOOD);
  if (!ink) {
    const cols = [['#b7793c', '#6b3f1a'], ['#d4723a', '#8a3416'], ['#9a8a3c', '#585020']][v];
    x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.arc(13, 13.5, 7, 0, TAU); x.fill();
    const g = x.createRadialGradient(10, 10, 1, 12, 12, 7.2); g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]);
    x.fillStyle = g; x.beginPath(); x.arc(12, 12, 7, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,240,210,.55)'; x.beginPath(); x.arc(9.7, 9.5, 1.8, 0, TAU); x.fill();
  } else { x.fillStyle = 'rgba(38,30,26,.88)'; x.beginPath(); x.ellipse(12, 12, 5, 4.4, v, 0, TAU); x.fill(); }
  return c;
}
function paintPetal(v, ink) {
  const [c, x] = tmp(PET, PET); x.translate(16, 16);
  if (v <= 1) {   // plum petal
    const p = new Path2D(); p.moveTo(-8, 0); p.bezierCurveTo(-8, -12, 9, -12, 10, -2); p.lineTo(7, 0); p.lineTo(10, 2); p.bezierCurveTo(9, 12, -8, 12, -8, 0);
    if (!ink) { const g = x.createRadialGradient(-7, 0, 0, -2, 0, 14); g.addColorStop(0, v ? '#f3c9d3' : '#e2869f'); g.addColorStop(1, v ? '#fff7f8' : '#f8c6d4'); x.fillStyle = g; x.fill(p); x.strokeStyle = 'rgba(170,70,100,.25)'; x.lineWidth = 0.8; x.stroke(p); }
    else { x.fillStyle = v ? 'rgba(220,150,165,.32)' : 'rgba(205,85,110,.5)'; x.fill(p); x.strokeStyle = 'rgba(70,40,40,.45)'; x.lineWidth = 0.8; x.stroke(p); }
  } else if (v <= 3) {   // willow / fallen leaf
    const p = new Path2D(); p.moveTo(-14, 0); p.quadraticCurveTo(0, -5.5, 14, 0); p.quadraticCurveTo(0, 5.5, -14, 0);
    if (!ink) { x.fillStyle = v === 2 ? '#7f9c44' : '#c4a24a'; x.fill(p); x.strokeStyle = v === 2 ? '#5d7a2c' : '#94742a'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-13, 0); x.lineTo(13, 0); x.stroke(); }
    else { x.fillStyle = 'rgba(40,40,34,.6)'; x.fill(p); }
  } else {   // whole plum blossom
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5, px = Math.cos(a) * 6.5, py = Math.sin(a) * 6.5;
      if (!ink) { const g = x.createRadialGradient(px * 0.4, py * 0.4, 0, px, py, 7); g.addColorStop(0, '#e98aa4'); g.addColorStop(1, '#fbd9e2'); x.fillStyle = g; }
      else x.fillStyle = 'rgba(205,85,110,.42)';
      x.beginPath(); x.arc(px, py, 6.2, 0, TAU); x.fill();
      if (ink) { x.strokeStyle = 'rgba(60,35,35,.5)'; x.lineWidth = 0.7; x.stroke(); }
    }
    x.fillStyle = ink ? 'rgba(60,40,20,.8)' : '#f2c84b';
    for (let i = 0; i < 9; i++) { const a = i * TAU / 9; x.beginPath(); x.arc(Math.cos(a) * 3, Math.sin(a) * 3, 0.9, 0, TAU); x.fill(); }
  }
  return c;
}
function paintStatic() {
  const ink = S.style === 'ink';
  SL.pad.forEach((s, i) => put(s, paintPad(i, ink)));
  SL.lotus.forEach((s, i) => put(s, paintLotus(i, ink)));
  SL.minnow.forEach((s, i) => put(s, paintMinnow(i, ink)));
  SL.food.forEach((s, i) => put(s, paintFood(i, ink)));
  SL.petal.forEach((s, i) => put(s, paintPetal(i, ink)));
}

/* =====================================================================
   RIPPLES — CPU height-field wave simulation; its gradient is uploaded as an RG16F texture
   ===================================================================== */
let GX = 0, GY = 0, FX = 0, FY = 0;   // scratch outputs of rip.gradAt / flowAt (no per-call allocation)
const rip = {
  cell: 4, gw: 0, gh: 0, a: null, b: null, g: null, tex: gl.createTexture(), dirty: true,
  resize() {
    this.cell = Math.max(3, Math.ceil(Math.max(W, H) / 430));
    this.gw = Math.ceil(W / this.cell) + 3; this.gh = Math.ceil(H / this.cell) + 3;
    this.a = new Float32Array(this.gw * this.gh); this.b = new Float32Array(this.gw * this.gh);
    this.g = new Float32Array(this.gw * this.gh * 2); this.dirty = true;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, this.gw, this.gh, 0, gl.RG, gl.FLOAT, this.g);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  },
  drop(x, y, r, str) {
    const { gw, gh, a } = this, cx = x / this.cell + 1, cy = y / this.cell + 1;
    const x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(gw - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(gh - 2, Math.ceil(cy + r));
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const ex = ix - cx, ey = iy - cy, d2 = ex * ex + ey * ey;
      if (d2 < r * r) a[iy * gw + ix] += str * (0.5 + 0.5 * Math.cos(Math.PI * Math.sqrt(d2) / r));
    }
  },
  step() {
    const { a, b, gw, gh } = this, damp = 0.985;
    for (let y = 1; y < gh - 1; y++) { let i = y * gw + 1; for (let x = 1; x < gw - 1; x++, i++) b[i] = ((a[i - 1] + a[i + 1] + a[i - gw] + a[i + gw]) * 0.5 - b[i]) * damp; }
    this.a = b; this.b = a; this.dirty = true;
  },
  gradAt(x, y) {   // writes GX, GY
    const gw = this.gw, a = this.a, ix = clamp(Math.round(x / this.cell + 1), 1, gw - 2), iy = clamp(Math.round(y / this.cell + 1), 1, this.gh - 2), i = iy * gw + ix;
    GX = a[i + 1] - a[i - 1]; GY = a[i + gw] - a[i - gw];
  },
  upload() {   // only when the field actually advanced (120 Hz displays step every other frame)
    if (!this.dirty) return; this.dirty = false;
    // upload the central-difference gradient (RG) instead of the height: the shaders need one
    // bilinear tap per pixel instead of four (bilinear filtering commutes with the difference)
    const { a, g, gw, gh } = this;
    for (let y = 1; y < gh - 1; y++) { let i = y * gw + 1; for (let x = 1; x < gw - 1; x++, i++) { g[i * 2] = a[i + 1] - a[i - 1]; g[i * 2 + 1] = a[i + gw] - a[i - gw]; } }
    gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RG, gl.FLOAT, g);
  }
};

/* =====================================================================
   ENTITIES
   ===================================================================== */
let time = 0;
const koi = [], minnows = [], pads = [], flowers = [], petals = [], food = [];
function flowAt(x, y) { FX = Math.sin(y * 0.003 + time * 0.05) * 4 + 2; FY = Math.cos(x * 0.0027 - time * 0.04) * 4; }   // writes FX, FY

class Koi {
  constructor(i) {
    this.i = i; this.slot = SL.koi[i]; this.N = 14;
    for (const k of ['px', 'py', 'rx', 'ry', 'tx', 'ty']) this[k] = new Float32Array(this.N);
    this.desc = makeDesc(); this.spawn(); paintKoi(this);
  }
  spawn() {
    this.L = baseLen * rnd(0.72, 1.15); this.girth = rnd(0.93, 1.08);
    this.heading = rnd(TAU);
    const x = rnd(0.15, 0.85) * W, y = rnd(0.15, 0.85) * H, seg = this.L / (this.N - 1);
    for (let i = 0; i < this.N; i++) { this.px[i] = x - Math.cos(this.heading) * seg * i; this.py[i] = y - Math.sin(this.heading) * seg * i; }
    this.speed = this.L * 0.3; this.cruise = this.L * rnd(0.2, 0.4); this.cruiseT = rnd(3, 10);
    this.phase = rnd(TAU); this.finPhase = rnd(TAU); this.turnRate = 0;
    this.depth = rnd(0.2, 0.8); this.depthT = this.depth; this.depthTimer = rnd(4, 15);
    this.w1 = rnd(0.08, 0.2); this.w2 = rnd(0.2, 0.45); this.s1 = rnd(100); this.s2 = rnd(100);
    this.target = null; this.retarget = 0; this.reaction = rnd(0.15, 1.3); this.gulp = 0; this.eatCd = 0; this.wakeT = 0;
    this.pickWaypoint();
  }
  pickWaypoint() {
    // choose a destination in open water, preferring points roughly ahead and a few body
    // lengths away; occasionally allow a bigger change of direction for variety
    const L = this.L, hx = this.px[0], hy = this.py[0], m = Math.min(L * 0.7, Math.min(W, H) * 0.22);
    const bold = Math.random() < 0.2;
    let best = null, bs = -1e9;
    for (let i = 0; i < 14; i++) {
      const x = rnd(m, W - m), y = rnd(m, H - m), d = Math.hypot(x - hx, y - hy);
      if (d < L * 2.2) continue;
      const ang = Math.abs(wrapA(Math.atan2(y - hy, x - hx) - this.heading));
      const sc = -ang * (bold ? 0.2 : 1.3) - Math.abs(d - L * 5) / (L * 5) + Math.random() * 1.2;
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    if (!best) best = [W / 2 + rnd(-L, L), H / 2 + rnd(-L, L)];
    this.wx = best[0]; this.wy = best[1];
    this.wpT = this.wpAge = rnd(7, 16);
  }
  rescale(f) { const hx = this.px[0], hy = this.py[0]; this.L *= f; for (let i = 0; i < this.N; i++) { this.px[i] = hx + (this.px[i] - hx) * f; this.py[i] = hy + (this.py[i] - hy) * f; } }
  chooseTarget() {
    let best = null, bc = Infinity; const hx = this.px[0], hy = this.py[0], diag = Math.hypot(W, H);
    for (const f of food) {
      if (!f.landed || f.gone) continue;
      const ex = f.x - hx, ey = f.y - hy, d = Math.sqrt(ex * ex + ey * ey);
      if (f.age < this.reaction + d / diag * 1.5) continue;
      const c = d * (1 + Math.abs(wrapA(Math.atan2(f.y - hy, f.x - hx) - this.heading)) * 0.25);
      if (c < bc) { bc = c; best = f; }
    }
    this.target = best;
  }
  update(dt) {
    const L = this.L, N = this.N, seg = L / (N - 1), px = this.px, py = this.py;
    const hx = px[0], hy = py[0], dx = Math.cos(this.heading), dy = Math.sin(this.heading);
    if ((this.retarget -= dt) <= 0) { this.retarget = rnd(0.3, 0.6); this.chooseTarget(); }
    if (this.target && this.target.gone) { this.target = null; this.retarget = 0.05; }
    const chasing = !!this.target;
    // Navigation: swim towards a waypoint (absolute goal), so paths are mostly straight
    // with purposeful turns, instead of a heading-relative wander that drifts into circles.
    const wdx = this.wx - hx, wdy = this.wy - hy;
    if ((this.wpT -= dt) <= 0 || wdx * wdx + wdy * wdy < L * L * 0.81) this.pickWaypoint();
    // zero-mean meander: a gentle S-weave around the goal line, never a sustained turn
    const meander = Math.sin(time * this.w1 + this.s1) * 0.14 + Math.sin(time * this.w2 + this.s2) * 0.06;
    const wa = Math.atan2(this.wy - hy, this.wx - hx) + meander;
    let ax = Math.cos(wa), ay = Math.sin(wa);
    // edges (look-ahead): if heading out of the pond, re-plan towards open water
    const look = L * 1.5, fx = hx + dx * look, fy = hy + dy * look, m = L * 0.5;
    let bx = 0, by = 0;
    if (fx < m) bx += (m - fx) / L; if (fx > W - m) bx -= (fx - (W - m)) / L;
    if (fy < m) by += (m - fy) / L; if (fy > H - m) by -= (fy - (H - m)) / L;
    if ((bx || by) && this.wpT < this.wpAge - 1.5) this.pickWaypoint();
    ax += bx * 1.5; ay += by * 1.5;
    // separation from other koi
    for (const o of koi) {
      if (o === this) continue;
      for (let j = 0; j <= 10; j += 5) {
        const ex = hx - o.px[j], ey = hy - o.py[j], d2 = ex * ex + ey * ey, rr = (L + o.L) * 0.36;
        if (d2 < rr * rr && d2 > 1e-3) { const d = Math.sqrt(d2), w = (1 - d / rr) * (1.15 - Math.abs(this.depth - o.depth)) * (chasing ? 0.35 : 1.3); ax += ex / d * w; ay += ey / d * w; }
      }
    }
    let tSpeed = this.cruise;
    if (chasing) {
      const ex = this.target.x - hx, ey = this.target.y - hy, d = Math.sqrt(ex * ex + ey * ey) || 1;
      ax = ax * 0.25 + ex / d * 2.4; ay = ay * 0.25 + ey / d * 2.4;
      tSpeed = Math.min(L * 1.3, L * 0.35 + d * 1.3);
      // if the pellet is beside/behind and close, brake and pivot instead of orbiting it
      const off = Math.abs(wrapA(Math.atan2(ey, ex) - this.heading));
      if (d < L * 2) tSpeed *= clamp(Math.cos(off), 0.2, 1);
    } else if ((this.cruiseT -= dt) <= 0) { this.cruiseT = rnd(3, 10); this.cruise = L * (Math.random() < 0.15 ? rnd(0.6, 0.9) : rnd(0.15, 0.42)); }
    // Turning: angular velocity proportional to heading error (settles onto the goal, no
    // overshoot), capped, and smoothed so turns ease in/out. Koi slow down into sharp turns,
    // which tightens the turning radius the way real fish pivot.
    const turn = wrapA(Math.atan2(ay, ax) - this.heading);
    const maxRate = chasing ? 2.6 : 1.25;
    const want = clamp(turn * (chasing ? 3.2 : 1.6), -maxRate, maxRate);
    this.turnRate += (want - this.turnRate) * (1 - Math.exp(-dt * (chasing ? 6 : 3.5)));
    this.heading += this.turnRate * dt;
    tSpeed *= 1 - 0.45 * Math.min(1, Math.abs(turn) / 1.6);
    this.speed += (tSpeed - this.speed) * Math.min(1, dt * (chasing ? 2.2 : 0.9));
    px[0] += Math.cos(this.heading) * this.speed * dt; py[0] += Math.sin(this.heading) * this.speed * dt;
    px[0] = clamp(px[0], -L * 0.5, W + L * 0.5); py[0] = clamp(py[0], -L * 0.5, H + L * 0.5);
    // spine follow with bend limit
    for (let i = 1; i < N; i++) {
      let a = Math.atan2(py[i - 1] - py[i], px[i - 1] - px[i]);
      const pa = i >= 2 ? Math.atan2(py[i - 2] - py[i - 1], px[i - 2] - px[i - 1]) : this.heading;
      const df = wrapA(a - pa), lim = i >= 2 ? 0.27 : 0.35;
      if (df > lim) a = pa + lim; else if (df < -lim) a = pa - lim;
      px[i] = px[i - 1] - Math.cos(a) * seg; py[i] = py[i - 1] - Math.sin(a) * seg;
    }
    this.phase += dt * (2.2 + 6.5 * this.speed / L);
    this.finPhase += dt * (1.8 + Math.abs(this.turnRate) * 1.5);
    // depth
    if ((this.depthTimer -= dt) <= 0) { this.depthTimer = rnd(6, 18); this.depthT = rnd(0.1, 0.85); }
    const dT = chasing ? 0.02 : this.depthT;
    this.depth += (dT - this.depth) * Math.min(1, dt * (chasing ? 1.2 : 0.22));
    // eating
    this.gulp = Math.max(0, this.gulp - dt); this.eatCd -= dt;
    const sx = px[0] + Math.cos(this.heading) * L * 0.02, sy = py[0] + Math.sin(this.heading) * L * 0.02;
    const r1 = L * 0.32, r1s = r1 * r1, r2s = L * L * 0.01;
    if (this.depth < 0.4) for (const f of food) {
      if (f.gone || !f.landed) continue;
      const ex = sx - f.x, ey = sy - f.y, d2 = ex * ex + ey * ey;
      if (d2 >= r1s) continue;
      if (this.depth < 0.35) { f.vx += ex * dt * 5; f.vy += ey * dt * 5; }   // suction
      if (d2 < r2s && this.eatCd <= 0) {
        f.gone = true; this.eatCd = 0.18; this.gulp = 0.35;
        rip.drop(sx, sy, 2.2, 0.7); audio.plop(sx, 'gulp', L / baseLen);
        if (f === this.target) { this.target = null; this.retarget = 0.05; }
      }
    }
    if (!chasing && this.depth < 0.12 && Math.random() < dt * 0.05) { rip.drop(sx, sy, 2, 0.45); this.gulp = 0.3; audio.plop(sx, 'surface', L / baseLen); }
    if (this.depth < 0.25 && this.speed > L * 0.45 && (this.wakeT -= dt) <= 0) { this.wakeT = 0.14; rip.drop(sx, sy, 1.5, 0.07 * (1 - this.depth * 4)); }
  }
}

class Minnow {
  constructor() {
    const r = Math.random(); this.type = r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.88 ? 2 : 3;
    this.N = 5; for (const k of ['px', 'py', 'rx', 'ry', 'tx', 'ty']) this[k] = new Float32Array(this.N);
    this.spawn();
  }
  spawn() {
    this.len = baseLen * rnd(0.2, 0.28) * (this.type === 1 ? 1.15 : 1);
    const x = rnd(W), y = rnd(H), a = rnd(TAU), seg = this.len / (this.N - 1);
    for (let i = 0; i < this.N; i++) { this.px[i] = x - Math.cos(a) * seg * i; this.py[i] = y - Math.sin(a) * seg * i; }
    this.vx = Math.cos(a) * this.len; this.vy = Math.sin(a) * this.len; this.wa = a;
    this.phase = rnd(TAU); this.depth = rnd(0.25, 0.75); this.burst = 0; this.nib = 0;
  }
  rescale(f) { this.len *= f; }
  update(dt) {
    const L = this.len, x = this.px[0], y = this.py[0];
    let ax = 0, ay = 0, cx = 0, cy = 0, avx = 0, avy = 0, n = 0;
    for (const o of minnows) {
      if (o === this || o.type !== this.type) continue;
      const dx = o.px[0] - x, dy = o.py[0] - y, d2 = dx * dx + dy * dy;
      if (d2 < L * L * 36) {
        n++; cx += dx; cy += dy; avx += o.vx; avy += o.vy;
        if (d2 < L * L * 1.7) { const d = Math.sqrt(d2) || 1, s = (1 - d / (L * 1.3)) * L * 10; ax -= dx / d * s; ay -= dy / d * s; }
      }
    }
    if (n) { ax += cx / n * 0.9; ay += cy / n * 0.9; ax += (avx / n - this.vx) * 1.4; ay += (avy / n - this.vy) * 1.4; }
    this.wa += (Math.random() - 0.5) * dt * 7;
    ax += Math.cos(this.wa) * L * 2.2; ay += Math.sin(this.wa) * L * 2.2;
    const m = L * 3;
    if (x < m) ax += (m - x) * 7; if (x > W - m) ax -= (x - (W - m)) * 7;
    if (y < m) ay += (m - y) * 7; if (y > H - m) ay -= (y - (H - m)) * 7;
    for (const k of koi) for (let j = 0; j <= 6; j += 6) {
      const dx = x - k.px[j], dy = y - k.py[j], d2 = dx * dx + dy * dy, r = k.L * 0.55;
      if (d2 < r * r && d2 > 1e-4) { const d = Math.sqrt(d2); ax += dx / d * (1 - d / r) * L * 45; ay += dy / d * (1 - d / r) * L * 45; this.burst = 0.5; }
    }
    let feeding = false;
    if (food.length) {
      let best = null, bd = L * L * 900;
      for (const f of food) { if (f.gone || !f.landed) continue; const ex = f.x - x, ey = f.y - y, d2 = ex * ex + ey * ey; if (d2 < bd) { bd = d2; best = f; } }
      bd = Math.sqrt(bd);
      if (best) {
        feeding = true; ax += (best.x - x) / (bd || 1) * L * 16; ay += (best.y - y) / (bd || 1) * L * 16;
        this.nib -= dt;
        if (bd < L * 0.45 && this.nib <= 0) {
          this.nib = rnd(0.5, 1.1); best.size -= 0.3; rip.drop(best.x, best.y, 1.3, 0.15); audio.plop(best.x, 'nibble');
          if (best.size < 0.2) best.gone = true;
        }
      }
    }
    this.burst = Math.max(0, this.burst - dt);
    this.vx += ax * dt; this.vy += ay * dt;
    let sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const maxS = L * (feeding ? 4.2 : 2.4) * (this.burst > 0 ? 1.7 : 1), minS = L * 0.5;
    if (sp > maxS) { this.vx *= maxS / sp; this.vy *= maxS / sp; sp = maxS; } else if (sp < minS) { this.vx *= minS / (sp || 1); this.vy *= minS / (sp || 1); sp = minS; }
    this.px[0] += this.vx * dt; this.py[0] += this.vy * dt;
    const seg = L / (this.N - 1), head = Math.atan2(this.vy, this.vx);
    for (let i = 1; i < this.N; i++) {
      let a = Math.atan2(this.py[i - 1] - this.py[i], this.px[i - 1] - this.px[i]);
      const pa = i >= 2 ? Math.atan2(this.py[i - 2] - this.py[i - 1], this.px[i - 2] - this.px[i - 1]) : head;
      const df = wrapA(a - pa); if (df > 0.5) a = pa + 0.5; else if (df < -0.5) a = pa - 0.5;
      this.px[i] = this.px[i - 1] - Math.cos(a) * seg; this.py[i] = this.py[i - 1] - Math.sin(a) * seg;
    }
    this.phase += dt * (8 + sp / L * 3);
  }
}

function makePads() {
  pads.length = 0;
  const n = S.pads; if (!n) return;
  const rng = mulberry32(pondSeed + 31);
  const clusters = Math.max(1, Math.round(n / 5));
  const centers = [];
  for (let c = 0; c < clusters; c++) {
    // bias clusters towards edges and corners
    const ex = rng() < 0.5 ? rng() * 0.3 : 0.7 + rng() * 0.3, ey = rng() < 0.5 ? rng() * 0.35 : 0.65 + rng() * 0.35;
    centers.push(rng() < 0.5 ? [ex * W, rng() * H] : [rng() * W, ey * H]);
  }
  for (let i = 0; i < n; i++) {
    const [ccx, ccy] = centers[i % clusters], r = baseLen * (0.34 + rng() * 0.32);
    let best = null;
    for (let t = 0; t < 30; t++) {
      const a = rng() * TAU, dd = Math.sqrt(rng()) * baseLen * (1.2 + n * 0.12);
      const x = clamp(ccx + Math.cos(a) * dd, 0, W), y = clamp(ccy + Math.sin(a) * dd, 0, H);
      let overlap = 0; for (const p of pads) overlap = Math.max(overlap, (p.r + r) * 0.92 - Math.hypot(p.x - x, p.y - y));
      if (!best || overlap < best.o) best = { x, y, o: overlap };
      if (overlap <= 0) break;
    }
    pads.push({ x: best.x, y: best.y, ax: best.x, ay: best.y, vx: 0, vy: 0, r, rot: rng() * TAU, vr: 0, v: (rng() * 6) | 0 });
  }
}
function makeFlowers() {
  flowers.length = 0;
  const rng = mulberry32(pondSeed + 77), used = new Set();
  for (let i = 0; i < S.lotus; i++) {
    let pi = -1;
    if (pads.length) for (let t = 0; t < 8; t++) { const c = (rng() * pads.length) | 0; if (!used.has(c)) { pi = c; used.add(c); break; } }
    const base = pi >= 0 ? pads[pi].r : baseLen * 0.5;
    flowers.push({ pad: pi, ox: (rng() - 0.5) * base * 0.5, oy: (rng() - 0.5) * base * 0.5, x: rnd(W * 0.1, W * 0.9), y: rnd(H * 0.1, H * 0.9), vx: 0, vy: 0, r: base * (0.5 + rng() * 0.2) + baseLen * 0.06, rot: rng() * TAU, v: (rng() * 3) | 0, ph: rng() * TAU });
  }
}
function makePetal() { return { x: rnd(W), y: rnd(H), vx: 0, vy: 0, rot: rnd(TAU), vr: rnd(-0.3, 0.3), v: rint(5), s: baseLen * rnd(0.1, 0.15) }; }
function syncCounts() {
  while (koi.length < S.koi) koi.push(new Koi(koi.length));
  while (koi.length > S.koi) koi.pop();
  while (minnows.length < S.fish) minnows.push(new Minnow());
  while (minnows.length > S.fish) minnows.pop();
  if (pads.length !== S.pads) { makePads(); makeFlowers(); }
  if (flowers.length !== S.lotus) makeFlowers();
  while (petals.length < S.petals) petals.push(makePetal());
  while (petals.length > S.petals) petals.pop();
}
function dropFood(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU), r = Math.sqrt(Math.random()) * baseLen * 0.3;
    food.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: Math.cos(a) * r * 0.4, vy: Math.sin(a) * r * 0.4, age: 0, delay: rnd(0.02, 0.2), size: 1, v: rint(3), rot: rnd(TAU), landed: false, gone: false });
  }
  while (food.length > 320) food.shift();
}

/* ---------------- update ---------------- */
let autoT = rnd(6, 12);
function update(dt) {
  for (const k of koi) k.update(dt);
  for (const m of minnows) m.update(dt);
  const fsize = clamp(baseLen * 0.045, 4, 9);
  let fw = 0;
  for (let i = 0; i < food.length; i++) {
    const f = food[i];
    if (f.gone || f.age > 70) { f.gone = true; continue; }
    food[fw++] = f;
    if (!f.landed) { f.delay -= dt; if (f.delay <= 0) { f.landed = true; rip.drop(f.x, f.y, 2.4, 0.8); audio.plop(f.x, 'pellet'); } continue; }
    f.age += dt;
    rip.gradAt(f.x, f.y); flowAt(f.x, f.y);
    f.vx += (FX - GX * 260) * dt; f.vy += (FY - GY * 260) * dt;
    for (const p of pads) { const dx = f.x - p.x, dy = f.y - p.y, d2 = dx * dx + dy * dy, rr = p.r * 0.95; if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2); f.vx += dx / d * 40 * dt; f.vy += dy / d * 40 * dt; } }
    const damp = Math.exp(-1.6 * dt); f.vx *= damp; f.vy *= damp;
    f.x = clamp(f.x + f.vx * dt, fsize, W - fsize); f.y = clamp(f.y + f.vy * dt, fsize, H - fsize);
    f.rot += f.vx * 0.002;
  }
  food.length = fw;
  for (const p of pads) {
    rip.gradAt(p.x, p.y); flowAt(p.x, p.y); const gx = GX, gy = GY;
    p.vx += ((p.ax - p.x) * 0.25 - gx * 120 + FX * 0.15) * dt; p.vy += ((p.ay - p.y) * 0.25 - gy * 120 + FY * 0.15) * dt;
    for (const q of pads) {
      if (q === p) continue;
      const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy, rr = (p.r + q.r) * 0.9;
      if (d2 >= rr * rr || d2 < 1e-4) continue;
      const d = Math.sqrt(d2), o = rr - d;
      p.vx += dx / d * o * 0.8 * dt; p.vy += dy / d * o * 0.8 * dt;
    }
    const damp = Math.exp(-0.9 * dt); p.vx *= damp; p.vy *= damp;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vr += (Math.random() - 0.5) * dt * 0.02 + (gx - gy) * dt * 0.4; p.vr *= Math.exp(-0.6 * dt); p.rot += p.vr * dt;
  }
  for (const f of flowers) {
    if (f.pad >= 0 && pads[f.pad]) {
      const p = pads[f.pad], c = Math.cos(p.rot), s = Math.sin(p.rot);
      f.x = p.x + f.ox * c - f.oy * s; f.y = p.y + f.ox * s + f.oy * c;
    } else {
      rip.gradAt(f.x, f.y); flowAt(f.x, f.y);
      f.vx += (FX * 0.2 - GX * 100) * dt; f.vy += (FY * 0.2 - GY * 100) * dt; f.vx *= Math.exp(-dt); f.vy *= Math.exp(-dt);
      f.x = clamp(f.x + f.vx * dt, f.r, W - f.r); f.y = clamp(f.y + f.vy * dt, f.r, H - f.r);
    }
  }
  for (const p of petals) {
    rip.gradAt(p.x, p.y); flowAt(p.x, p.y);
    p.vx += (FX * 1.5 - GX * 250 - p.vx) * dt; p.vy += (FY * 1.5 - GY * 250 - p.vy) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    const m = p.s * 2;
    if (p.x < -m) p.x = W + m; if (p.x > W + m) p.x = -m; if (p.y < -m) p.y = H + m; if (p.y > H + m) p.y = -m;
  }
  // ambient: insects touching the surface
  if (Math.random() < dt * 0.4) { const ix = rnd(W); rip.drop(ix, rnd(H), 1.4, rnd(0.12, 0.3)); audio.plop(ix, 'insect'); }
  if (S.autofeed && (autoT -= dt) <= 0) { autoT = rnd(14, 26); dropFood(rnd(0.15, 0.85) * W, rnd(0.15, 0.85) * H, 8 + rint(5)); }
}

/* =====================================================================
   RENDERING
   ===================================================================== */
const VS_SPRITE = `#version 300 es
layout(location=0) in vec2 aPos; layout(location=1) in vec2 aUv; layout(location=2) in vec4 aTint; layout(location=3) in float aA;
uniform vec2 uRes; out vec2 vUv; out vec4 vTint; out float vA;
void main(){ vUv=aUv; vTint=aTint; vA=aA; vec2 c=aPos/uRes*2.0-1.0; gl_Position=vec4(c.x,-c.y,0.0,1.0); }`;
const FS_SPRITE = `#version 300 es
precision mediump float;
uniform sampler2D uTex; in vec2 vUv; in vec4 vTint; in float vA; out vec4 o;
void main(){ vec4 c=texture(uTex,vUv); c.rgb=mix(c.rgb, vTint.rgb*c.a, vTint.a); o=c*vA; }`;
const VS_FULL = `#version 300 es
out vec2 vUv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
const FS_COMP = `#version 300 es
precision highp float;
uniform sampler2D uFish, uSurf, uRip, uFloor, uLight; uniform vec2 uFloorOff;
uniform vec2 uRes; uniform float uTime, uMode, uScale; uniform vec4 uRipMap;
// dynamic resolution: fish/surface/light targets are drawn into a sub-rectangle of their texture
uniform vec2 uVp, uVh, uLp, uLh; uniform float uLodB;
in vec2 vUv; out vec4 o;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 h22(vec2 p){ float n=h21(p); return vec2(n, h21(p+n+17.3)); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+17.1; a*=0.5; } return s; }
vec3 voro(vec2 x){ vec2 n=floor(x), f=fract(x); float d1=8.0, d2=8.0, id=0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 oo=h22(n+g)*0.8+0.1; vec2 r=g+oo-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=h21(n+g+0.37); } else if(d<d2){ d2=d; } }
  return vec3(sqrt(d1), sqrt(d2)-sqrt(d1), id); }
float caustic(vec2 uv, float t){
  vec2 p=mod(uv*6.2831853, 6.2831853)-250.0; vec2 i=p; float c=1.0, inten=0.005;
  for(int n=0;n<4;n++){ float tt=t*(1.0-(3.5/float(n+1)));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten))); }
  c/=4.0; c=1.17-pow(c,1.4); return pow(abs(c),8.0); }
// natural pond bed: rounded river pebbles of mixed size and stone type, half sunk
// in gravel and silt, filmed with algae; lit from its own height field
vec4 pebbleLayer(vec2 q, float seed, float minS, float maxS){
  vec2 n=floor(q), f=fract(q); float hb=0.0, id=0.0, edge=0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j)), cell=n+g+seed;
    vec2 c=g+0.15+h22(cell)*0.7-f;
    float a=h21(cell+3.1)*6.2831853, cs=cos(a), sn=sin(a);
    vec2 d=vec2(cs*c.x+sn*c.y, -sn*c.x+cs*c.y);
    float sz=mix(minS,maxS,h21(cell+7.7)), el=0.55+0.4*h21(cell+1.9);
    d+=vec2(noise(d*4.0+cell)-0.5, noise(d*4.0+cell+9.0)-0.5)*0.08;   // irregular outline
    float e=length(d/vec2(sz,sz*el));
    float hh=pow(max(0.0,1.0-e*e),0.6)*sz;
    if(hh>hb){ hb=hh; id=h21(cell+0.37); edge=e; } }
  return vec4(hb, id, edge, 0.0); }
vec3 stoneCol(float id, vec2 p){
  vec3 c=vec3(0.46,0.44,0.40);                                          // granite grey
  c=mix(c, vec3(0.56,0.48,0.38), step(0.55,id));                        // tan sandstone
  c=mix(c, vec3(0.29,0.31,0.32), step(0.78,id));                        // basalt
  c=mix(c, vec3(0.52,0.38,0.30), step(0.9,id));                         // rust
  c=mix(c, vec3(0.62,0.60,0.56), step(0.96,id));                        // quartz
  c*=0.82+0.36*fract(id*13.7);
  float sp=fbm(p*0.22+id*50.0);                                         // mineral grain
  c*=0.9+0.2*smoothstep(0.3,0.7,sp);
  return c; }
float bedHeight(vec2 p, float sc, out vec4 big, out vec4 mid, out vec4 grv, out float silt, out float hB, out float hM, out float hG){
  vec2 q=p/(58.0*sc);
  big=pebbleLayer(q, 0.0, 0.26, 0.5);
  mid=pebbleLayer(q*2.7+13.0, 5.0, 0.3, 0.48);
  grv=pebbleLayer(q*9.0+41.0, 11.0, 0.32, 0.5);
  silt=smoothstep(0.38,0.72,fbm(p/(300.0*sc)+7.0));                     // silt drifts bury the small stuff
  hB=big.x*58.0*sc; hM=mid.x*21.5*sc*(1.0-silt*0.8); hG=grv.x*6.4*sc*(1.0-silt);
  return max(hB, max(hM, hG)); }
vec3 pondFloor(vec2 p){
  float sc=max(uScale,0.55);
  vec4 big, mid, grv; float silt, hB, hM, hG;
  float h=bedHeight(p, sc, big, mid, grv, silt, hB, hM, hG);
  vec3 col;
  if(h==hB) col=stoneCol(big.y, p/sc);
  else if(h==hM) col=stoneCol(mid.y, p/sc+31.0)*0.92;
  else col=stoneCol(grv.y, p/sc+77.0)*0.8;
  vec3 siltC=vec3(0.25,0.24,0.18)*(0.85+0.3*fbm(p/(9.0*sc)));
  float gap=1.0-smoothstep(0.0,2.5*sc,h);
  col=mix(col, siltC, gap*0.85);
  // algae film: mostly on top faces, patchy
  float alg=smoothstep(0.4,0.75,fbm(p/(150.0*sc)+3.0));
  col=mix(col, col*vec3(0.55,0.72,0.38)+vec3(0.02,0.04,0.0), alg*0.7);
  // lighting from the height field
  vec4 b1,b2,b3; float s1,h1,h2,h3;
  vec2 dh=vec2(bedHeight(p+vec2(0.75,0.0),sc,b1,b2,b3,s1,h1,h2,h3)-bedHeight(p-vec2(0.75,0.0),sc,b1,b2,b3,s1,h1,h2,h3),
               bedHeight(p+vec2(0.0,0.75),sc,b1,b2,b3,s1,h1,h2,h3)-bedHeight(p-vec2(0.0,0.75),sc,b1,b2,b3,s1,h1,h2,h3))/1.5;
  vec3 n=normalize(vec3(-dh*0.9,1.0));
  vec3 L=normalize(vec3(-0.35,-0.5,0.8));
  float dif=clamp(dot(n,L)*0.75+0.35,0.0,1.3);
  float ao=mix(0.45,1.0,smoothstep(0.0,6.0*sc,h));
  col*=dif*ao;
  col*=0.85+0.3*fbm(p/(70.0*sc)+3.0);
  return col; }
vec2 rg(vec2 p){ return texture(uRip, p*uRipMap.xy+uRipMap.zw).rg; }   // ripple gradient (precomputed per cell)
vec2 VP(vec2 u){ return clamp(u, uVh, 1.0-uVh)*uVp; }   // screen uv -> render-target uv
vec4 litS(vec2 u){ return texture(uLight, clamp(u, uLh, 1.0-uLh)*uLp); }
void main(){
  vec2 uv=vUv, p=vec2(uv.x,1.0-uv.y)*uRes; float t=uTime;
#ifdef FLOOR_PASS
  // static layers, rendered once per resize / new pond / style change
  if(uMode<0.5){ o=vec4(pondFloor(p+uFloorOff),1.0); return; }
  vec3 paper=vec3(0.945,0.915,0.848);
  float fib=noise(p*vec2(0.35,0.04))*noise(p*vec2(0.05,0.4));
  paper*=0.985+0.035*fbm(p*0.08)-0.04*fib;
  paper*=1.0-0.07*smoothstep(0.55,0.85,fbm(p/(380.0*uScale)+3.0));
  o=vec4(paper,1.0); return;
#endif
  vec2 grad=rg(p);
  vec2 amb=vec2(sin(p.x*0.021/uScale+t*0.8+sin(p.y*0.013/uScale+t*0.35)*2.0), cos(p.y*0.018/uScale-t*0.7+sin(p.x*0.011/uScale-t*0.25)*2.0))*0.03;
  vec2 g=grad+amb;
  vec2 off=g*26.0*uScale; vec2 offUv=vec2(off.x,-off.y)/uRes;
  vec2 L1=vec2(20.0,30.0)*uScale/uRes*vec2(1,-1), L2=vec2(36.0,52.0)*uScale/uRes*vec2(1,-1), L3=vec2(12.0,18.0)*uScale/uRes*vec2(1,-1);
#ifdef LIGHT_PASS
  // Everything low-frequency runs here at half resolution: caustics, sun dapple and the
  // blurred fish / leaf shadows (real); drifting wash and soft shadows (ink).
  if(uMode<0.5){
    vec2 cuv=(p+off*1.6)/(360.0*uScale);
    float ca=caustic(cuv+g*0.15, t*0.4)*0.6+caustic(cuv*1.37+vec2(0.31,0.17), t*0.33+2.0)*0.6;
    float n=fbm(p/(420.0*uScale)+vec2(t*0.012,t*0.007)), n2=noise(p/(90.0*uScale)+t*0.05);
    float dap=mix(0.6,1.0,smoothstep(0.38,0.62,n+(n2-0.5)*0.2));
    float sf=textureLod(uFish, VP(uv+offUv*1.6-L1), 2.6+uLodB).a;
    float ssF=textureLod(uSurf, VP(uv+offUv*1.6-L2), 3.6+uLodB).a;
    float ssK=textureLod(uSurf, VP(uv+offUv*0.6-L3), 2.6+uLodB).a;
    float lightF=(1.0-0.72*sf)*(1.0-0.7*ssF)*dap;
    float lightK=(1.0-0.5*ssK)*mix(0.72,1.0,dap);
    o=vec4(ca/(1.0+ca), dap, lightF, lightK);
  } else {
    float w=fbm(p/(520.0*uScale)+vec2(t*0.006,-t*0.004));
    float sf=textureLod(uFish, VP(uv+offUv-L1), 3.0+uLodB).a, ss=textureLod(uSurf, VP(uv+offUv-L2), 3.6+uLodB).a;
    o=vec4(0.0, 1.0-0.08*sf-0.1*ss, smoothstep(0.5,0.85,w), 1.0);
  }
  return;
#endif
  vec4 lt=litS(uv);
  vec2 v2=uv-0.5; float vig=dot(v2*vec2(uRes.x/max(uRes.x,uRes.y), uRes.y/max(uRes.x,uRes.y)), v2)*2.2;
  vec3 col;
  if(uMode<0.5){
    vec3 fl=texture(uFloor, uv+offUv*1.6).rgb;   // pre-rendered bed, refracted
    float ca=lt.r/max(1.0-lt.r,0.004), dap=lt.g, lightF=lt.b, lightK=lt.a;
    col=fl*(0.42+0.58*lightF)+vec3(0.72,0.95,0.85)*ca*lightF*0.5;
    vec3 deep=vec3(0.03,0.14,0.13);
    col=mix(col, deep, 0.58+0.2*clamp(vig,0.0,1.0));
    vec4 f=texture(uFish, VP(uv+offUv*0.6));
    vec3 fc=f.rgb*(0.76+0.36*lightK)+f.a*ca*0.16*lightK*vec3(0.9,1.0,0.95);
    col=col*(1.0-f.a)+fc;
    col=mix(col, vec3(0.07,0.2,0.2), 0.06);
    vec3 nrm=normalize(vec3(-g*2.4,1.0));
    vec3 sun=normalize(vec3(-0.35,-0.5,0.8)); vec3 hv=normalize(sun+vec3(0,0,1));
    float spec=pow(max(dot(nrm,hv),0.0), 300.0)*1.5;
    vec3 sky=mix(vec3(0.16,0.24,0.2), vec3(0.6,0.74,0.78), dap);
    col+=sky*(0.04+min(length(g)*0.9,0.25));
    col+=vec3(1.0,0.97,0.9)*spec*dap;
    vec4 s=texture(uSurf, VP(uv+offUv*0.06));
    col=col*(1.0-s.a)+s.rgb*mix(0.74,1.06,dap);
    col*=1.0-0.38*pow(clamp(vig,0.0,1.0),1.4);
  } else {
    vec3 paper=texture(uFloor, uv).rgb;   // static paper, cached
    paper=mix(paper, paper*vec3(0.83,0.87,0.87), lt.b*0.55);
    float rl=length(grad);
    paper*=1.0-smoothstep(0.03,0.22,rl)*0.32;
    paper*=lt.g;
    vec4 f=texture(uFish, VP(uv+offUv*0.5));
    col=paper*(1.0-f.a+f.rgb);
    vec4 s=texture(uSurf, VP(uv));
    col*=1.0-s.a+s.rgb;
    col*=mix(vec3(1.0), vec3(0.86,0.8,0.7), smoothstep(0.25,0.9,vig));
  }
  col+=(h21(p+fract(t))-0.5)/255.0;
  o=vec4(col,1.0);
}`;
const FS_BLIT = `#version 300 es
precision mediump float;
uniform sampler2D uTex; uniform vec2 uVp, uVh; in vec2 vUv; out vec4 o;
void main(){ o=texture(uTex, clamp(vUv, uVh, 1.0-uVh)*uVp); }`;
/* ---- 3D koi (realistic mode) ------------------------------------------------
   Each koi body is a real 3D surface: a static (u, t) grid is skinned on the GPU
   along the animated spine. Cross-sections are ellipses (width from the top-down
   silhouette, height from a body-depth profile), so normals are analytic. The
   fragment shader adds overlapping scales (with pattern edges snapped to them),
   gill plates, domed glossy eyes, wet specular, metallic reflectance, sub-surface
   warmth and water absorption at the flanks. */
const KOI_GLSL = `
const float PADX=8.0, LEN=304.0, HALF=40.0, CY=50.0;
float hwP(float u){
  if(u<=0.0) return 0.0; if(u>=1.0) return 0.26;
  if(u<0.2){ float t=u/0.2; return 0.88*pow(sin(t*1.5707963),0.62); }
  if(u<0.38){ float t=(u-0.2)/0.18; return 0.88+0.12*(t*t*(3.0-2.0*t)); }
  float t=(u-0.38)/0.62; return 0.26+0.74*pow(0.5+0.5*cos(3.14159265*t),0.95); }`;
const VS_KOI = `#version 300 es
layout(location=0) in vec2 aUT;
uniform vec2 uRes; uniform vec2 uSp[14]; uniform float uKK, uGirth, uPx;
out vec3 vN; out vec3 vTn; out vec3 vB; out vec2 vSurf; out float vEdge; out float vU; out float vT1;
${KOI_GLSL}
// body depth (height / half-width): flatter head, deep shoulders, slim peduncle
float hk(float u){ return mix(0.55,0.95,smoothstep(0.0,0.32,u))*mix(1.0,0.72,smoothstep(0.55,1.0,u)); }
vec2 cr(vec2 p0,vec2 p1,vec2 p2,vec2 p3,float t){ float t2=t*t,t3=t2*t;
  return 0.5*((2.0*p1)+(-p0+p2)*t+(2.0*p0-5.0*p1+4.0*p2-p3)*t2+(-p0+3.0*p1-3.0*p2+p3)*t3); }
vec2 spine(float s){ s=clamp(s,0.0,13.0); int i=int(min(floor(s),12.0)); float f=s-float(i);
  vec2 p1=uSp[i], p2=uSp[i+1];
  vec2 p0= i>0 ? uSp[max(i-1,0)] : 2.0*p1-p2;
  vec2 p3= i<12 ? uSp[min(i+2,13)] : 2.0*p2-p1;
  return cr(p0,p1,p2,p3,f); }
void main(){
  float u=aUT.x, t=aUT.y, phi=t*1.5707963, e=0.006;
  vec2 C=spine(u*13.0);
  vec2 Td=spine(min(u+e,1.0)*13.0)-spine(max(u-e,0.0)*13.0);
  float Lu=length(Td)/(min(u+e,1.0)-max(u-e,0.0)); vec2 T=Td/max(length(Td),1e-4);
  vec2 Lat=vec2(-T.y,T.x);
  float sc=uKK*HALF*uGirth;
  float w=max(hwP(u),0.02)*sc, h=w*hk(u);
  float wu=(max(hwP(min(u+e,1.0)),0.02)-max(hwP(max(u-e,0.0)),0.02))/(2.0*e)*sc;
  float hu=(max(hwP(min(u+e,1.0)),0.02)*hk(min(u+e,1.0))-max(hwP(max(u-e,0.0)),0.02)*hk(max(u-e,0.0)))/(2.0*e)*sc;
  float sp=sin(phi), cp=cos(phi);
  vec3 dU=vec3(T*Lu+Lat*sp*wu, cp*hu);
  vec3 dP=vec3(Lat*cp*w, -sp*h);
  vN=normalize(cross(dU,dP)); vTn=normalize(dU); vB=normalize(dP+vec3(Lat,0.0)*1e-3);
  vec2 P=C+Lat*sp*w;
  vSurf=vec2(PADX+u*LEN, CY+t*hwP(u)*HALF);
  vEdge=(1.0-abs(sp))*w*uPx; vU=u; vT1=t;
  vec2 c=P/uRes*2.0-1.0; gl_Position=vec4(c.x,-c.y,0.0,1.0); }`;
const FS_KOI = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uSlot; uniform float uDepth, uMetal, uScaleType, uSeed, uNet, uGlint;
uniform vec3 uNetCol;
in vec3 vN; in vec3 vTn; in vec3 vB; in vec2 vSurf; in float vEdge; in float vU; in float vT1; out vec4 o;
${KOI_GLSL}
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec3 lin(vec3 c){ return c*c; }
vec3 texA(vec2 sp){ return lin(texture(uTex,(uSlot+clamp(sp,vec2(1.0),vec2(319.0,99.0)))/2048.0).rgb); }
vec3 texC(vec2 sp){ return lin(textureLod(uTex,(uSlot+clamp(sp,vec2(1.0),vec2(319.0,99.0)))/2048.0,0.0).rgb); }
void main(){
  vec3 N=normalize(vN), T=normalize(vTn), B=normalize(vB);
  vec2 sp=vSurf; float t=vT1;
  // ---------- overlapping scales: the most anterior scale covering a point is on top
  float ss=uScaleType>1.5 ? 12.5 : 8.6, cx=ss*0.72, rr=ss*0.7;
  float occ=9.0, bid=0.5; vec2 bd=vec2(0.0), bc=sp;
  float sm=smoothstep(PADX+0.19*LEN,PADX+0.25*LEN,sp.x)*(1.0-smoothstep(PADX+0.975*LEN,PADX+1.0*LEN,sp.x));
  if(sm>0.0){   // no scales on the head: skip the search there
    // single pass over the 3x3 candidates: columns run front to back, the first covering
    // scale wins; 'occ' is the nearest scale edge from the columns in front of it
    float ci=floor(sp.x/cx); bool found=false;
    for(int di=-1;di<=1;di++){
      if(found) break;
      float i=ci+float(di), off=mod(i,2.0)*0.5*ss, x=(i+0.5)*cx, j0=floor((sp.y-off)/ss), cm=9.0;
      for(int dj=-1;dj<=1;dj++){ float j=j0+float(dj); vec2 c=vec2(x,(j+0.5)*ss+off), d=(sp-c)/rr; float r2=dot(d,d);
        if(r2<1.0 && !found){ found=true; bd=d; bc=c; bid=h21(vec2(i,j)+uSeed); }
        cm=min(cm,r2); }
      if(!found && di<=0) occ=min(occ,cm);
    }
  }
  float r2=dot(bd,bd);
  if(uScaleType>1.5){ float tn=abs(t); sm*=max(1.0-smoothstep(0.1,0.2,tn), 1.0-smoothstep(0.07,0.15,abs(tn-0.68))); }
  // ---------- pigment (pattern edges follow the scales: kiwa)
  vec3 aF=texA(sp), aC=texC(bc+vec2(rr*0.2,0.0));
  // snap only where the pattern changes, so flat colour stays smooth
  float edgeP=clamp(length(aF-aC)*3.0,0.0,1.0);
  vec3 alb=mix(aF,aC,0.38*sm*edgeP);
  alb*=1.0+(bid-0.5)*0.07*sm;
  float rim=smoothstep(0.6,1.0,r2)*step(0.0,bd.x);        // free posterior margin of a scale
  float shadow=1.0-smoothstep(1.0,1.32,occ);              // under the edge of the scale in front
  alb=mix(alb, alb*uNetCol, uNet*sm*max(smoothstep(0.35,0.95,r2), shadow));
  alb*=1.0-0.13*shadow*sm;
  // scale relief: dome, raised toward the free edge
  vec2 g=vec2(-bd.x+0.45,-bd.y)*sm*0.12;
  // per-scale tilt makes metallic and gin-rin scales sparkle individually
  g+=(vec2(bid,fract(bid*7.31))-0.5)*sm*(0.04+0.14*uGlint);
  // ---------- head: gill plate (operculum) edge
  float hw21=hwP(0.21)*HALF;
  vec2 ge=vec2((sp.x-(PADX+0.135*LEN))/(0.075*LEN),(sp.y-CY)/hw21);
  float gl1=length(ge), gm=smoothstep(-0.2,0.2,ge.x)*exp(-pow((gl1-1.0)*13.0,2.0));
  alb*=1.0-0.2*gm;
  g+=normalize(ge+1e-4)*gm*0.35*sign(gl1-1.0)*-1.0;
  float head=1.0-smoothstep(PADX+0.17*LEN,PADX+0.24*LEN,sp.x);
  // ---------- eyes: domed, glossy, bronze iris
  float hwe=hwP(0.08)*HALF, eyY=0.8*hwe;
  vec2 ed=vec2(sp.x-(PADX+0.08*LEN), abs(sp.y-CY)-eyY); ed.y*=0.62;
  float de=length(ed)/4.3, eye=1.0-smoothstep(0.9,1.0,de);
  vec3 iris=vec3(0.36,0.26,0.1)*(0.75+0.5*h21(floor(sp*3.0)));
  vec3 ec=mix(vec3(0.004), iris, smoothstep(0.4,0.56,de));
  ec=mix(ec, vec3(0.02,0.016,0.012), smoothstep(0.8,0.95,de));
  alb=mix(alb, ec, eye);
  alb*=1.0-0.35*exp(-pow((de-1.05)*7.0,2.0));   // socket
  g-=normalize(ed+1e-4)*vec2(1.0,sign(sp.y-CY))*eye*de*0.9;
  N=normalize(N-g.x*T-g.y*B);
  // ---------- lighting (sun above-left, light filtered by the water column)
  vec3 L=normalize(vec3(-0.35,-0.5,0.8)), V=vec3(0.0,0.0,1.0), H=normalize(L+V);
  float ndl=dot(N,L), wrap=clamp((ndl+0.3)/1.3,0.0,1.0);
  vec3 sunC=vec3(1.0,0.95,0.85), ambC=vec3(0.30,0.40,0.38);
  float sky=0.5+0.5*clamp(N.z,0.0,1.0);
  vec3 col=alb*(ambC*sky+sunC*wrap*0.95);
  // sub-surface scattering: koi skin glows warm where it thins at the edges and fins
  float sss=pow(1.0-clamp(N.z,0.0,1.0),1.6)*(0.55-0.45*ndl);
  col+=alb*vec3(1.0,0.5,0.35)*sss*0.35*(1.0-uMetal);
  // reflections: Snell's window above, dark water around
  vec3 R=reflect(-V,N); float win=smoothstep(0.15,1.0,R.z);
  vec3 env=mix(vec3(0.03,0.08,0.075), vec3(0.55,0.66,0.64), win*win);
  float nh=max(dot(N,H),0.0);
  float F=0.03+0.97*pow(1.0-clamp(N.z,0.0,1.0),5.0);
  vec3 metalC=alb*(env*1.6+sunC*(pow(nh,24.0)*1.6+pow(nh,300.0)*6.0));
  col=mix(col, metalC, uMetal*0.8);
  col+=env*F*0.4;
  float wet=0.14*pow(nh,36.0)+(0.3+0.4*sm*rim+2.5*eye+0.3*head)*pow(nh,240.0);
  col+=sunC*wet*(1.0-0.5*uMetal);
  col+=sunC*rim*sm*0.012*(1.0+3.0*uGlint);
  // absorption: flanks are seen through more water and lose light and saturation
  float flank=pow(1.0-clamp(N.z,0.0,1.0),2.2);
  col=mix(col, vec3(0.006,0.03,0.028), flank*0.55);
  col=mix(col, vec3(0.0025,0.04,0.036), uDepth*0.42);
  float a=clamp(vEdge+0.5,0.0,1.0)*(1.0-0.85*smoothstep(0.93,1.0,vU));   // peduncle melts into the tail fin
  o=vec4(sqrt(max(col,0.0))*a, a); }`;
function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function program(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
const progSprite = program(VS_SPRITE, FS_SPRITE), progComp = program(VS_FULL, FS_COMP), progKoi = program(VS_KOI, FS_KOI);
const progFloor = program(VS_FULL, FS_COMP.replace('#version 300 es', '#version 300 es\n#define FLOOR_PASS'));
const progLight = program(VS_FULL, FS_COMP.replace('#version 300 es', '#version 300 es\n#define LIGHT_PASS'));
const progBlit = program(VS_FULL, FS_BLIT);
const uF = { res: gl.getUniformLocation(progFloor, 'uRes'), scale: gl.getUniformLocation(progFloor, 'uScale'), off: gl.getUniformLocation(progFloor, 'uFloorOff'), mode: gl.getUniformLocation(progFloor, 'uMode') };
const uL = {}; for (const n of ['uRip', 'uFish', 'uSurf', 'uRes', 'uTime', 'uMode', 'uScale', 'uRipMap', 'uVp', 'uVh', 'uLodB']) uL[n] = gl.getUniformLocation(progLight, n);
const uB = { tex: gl.getUniformLocation(progBlit, 'uTex'), vp: gl.getUniformLocation(progBlit, 'uVp'), vh: gl.getUniformLocation(progBlit, 'uVh') };
let floorDirty = true;
const uK = {}; for (const n of ['uRes', 'uSp', 'uKK', 'uGirth', 'uPx', 'uTex', 'uSlot', 'uDepth', 'uMetal', 'uScaleType', 'uSeed', 'uNet', 'uNetCol', 'uGlint']) uK[n] = gl.getUniformLocation(progKoi, n);
// static koi body grid: KR rings along the body (denser at the head), KM vertices across the back
const KR = 40, KM = 21, koiVao = gl.createVertexArray();
let koiIdxN = 0;
{
  const ut = new Float32Array(KR * KM * 2), idx = [];
  for (let r = 0; r < KR; r++) for (let m = 0; m < KM; m++) { const o = (r * KM + m) * 2; ut[o] = Math.pow(r / (KR - 1), 1.35); ut[o + 1] = m / (KM - 1) * 2 - 1; }
  for (let r = 0; r < KR - 1; r++) for (let m = 0; m < KM - 1; m++) { const a = r * KM + m, b = a + KM; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  koiIdxN = idx.length;
  gl.bindVertexArray(koiVao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, ut, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
}
const uS = { res: gl.getUniformLocation(progSprite, 'uRes'), tex: gl.getUniformLocation(progSprite, 'uTex') };
const uC = {}; for (const n of ['uFish', 'uSurf', 'uRip', 'uFloor', 'uLight', 'uRes', 'uTime', 'uMode', 'uScale', 'uRipMap', 'uVp', 'uVh', 'uLp', 'uLh']) uC[n] = gl.getUniformLocation(progComp, n);
const emptyVao = gl.createVertexArray();

// dynamic vertex batch
const FL = 9;
let vdata = new Float32Array(FL * 6 * 4000), vn = 0;
const tint = [0, 0, 0, 0]; let alpha = 1;
const vbo = gl.createBuffer(), vao = gl.createVertexArray();
gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FL * 4, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FL * 4, 8);
gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FL * 4, 16);
gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, FL * 4, 32);
gl.bindVertexArray(null);
function V(x, y, u, v) {
  if ((vn + 1) * FL > vdata.length) { const nd = new Float32Array(vdata.length * 2); nd.set(vdata); vdata = nd; }
  const o = vn * FL; vdata[o] = x; vdata[o + 1] = y; vdata[o + 2] = u; vdata[o + 3] = v;
  vdata[o + 4] = tint[0]; vdata[o + 5] = tint[1]; vdata[o + 6] = tint[2]; vdata[o + 7] = tint[3]; vdata[o + 8] = alpha; vn++;
}
function quad(ax, ay, au, av, bx, by, bu, bv, cx, cy, cu, cv, dx, dy, du, dv) { V(ax, ay, au, av); V(bx, by, bu, bv); V(cx, cy, cu, cv); V(ax, ay, au, av); V(cx, cy, cu, cv); V(dx, dy, du, dv); }
function sprite(s, cx, cy, hw, hh, ang) {
  const c = Math.cos(ang), si = Math.sin(ang), ax = c * hw, ay = si * hw, bx = -si * hh, by = c * hh;
  quad(cx - ax - bx, cy - ay - by, s.u0, s.v0, cx + ax - bx, cy + ay - by, s.u1, s.v0, cx + ax + bx, cy + ay + by, s.u1, s.v1, cx - ax + bx, cy - ay + by, s.u0, s.v1);
}
const SX = new Float32Array(32), SY = new Float32Array(32), SNX = new Float32Array(32), SNY = new Float32Array(32), SHW = new Float32Array(32), STU = new Float32Array(32);
function strip(n, s) {
  const du = s.u1 - s.u0;
  for (let i = 0; i < n - 1; i++) {
    const j = i + 1, ua = s.u0 + STU[i] * du, ub = s.u0 + STU[j] * du;
    quad(SX[i] + SNX[i] * SHW[i], SY[i] + SNY[i] * SHW[i], ua, s.v0,
         SX[j] + SNX[j] * SHW[j], SY[j] + SNY[j] * SHW[j], ub, s.v0,
         SX[j] - SNX[j] * SHW[j], SY[j] - SNY[j] * SHW[j], ub, s.v1,
         SX[i] - SNX[i] * SHW[i], SY[i] - SNY[i] * SHW[i], ua, s.v1);
  }
}
function finQuad(s, rx, ry, dx, dy, len, flip, rootTex, texW, texH) {
  const k = len / (texW - rootTex), back = rootTex * k, hw = texH / 2 * k, px = -dy, py = dx;
  const ax = rx - dx * back, ay = ry - dy * back, bx = rx + dx * len, by = ry + dy * len, v0 = flip ? s.v1 : s.v0, v1 = flip ? s.v0 : s.v1;
  quad(ax + px * hw, ay + py * hw, s.u0, v0, bx + px * hw, by + py * hw, s.u1, v0, bx - px * hw, by - py * hw, s.u1, v1, ax - px * hw, ay - py * hw, s.u0, v1);
}
function renderSpine(f, A, waveK, headAmp) {
  const N = f.N;
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    let tx = f.px[a] - f.px[b], ty = f.py[a] - f.py[b]; const l = Math.sqrt(tx * tx + ty * ty) || 1; tx /= l; ty /= l;
    const u = i / (N - 1), off = A * (headAmp + (1 - headAmp) * u * u) * Math.sin(f.phase - u * waveK);
    f.rx[i] = f.px[i] - ty * off; f.ry[i] = f.py[i] + tx * off;
  }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    let tx = f.rx[a] - f.rx[b], ty = f.ry[a] - f.ry[b]; const l = Math.sqrt(tx * tx + ty * ty) || 1; f.tx[i] = tx / l; f.ty[i] = ty / l;
  }
}
function setDepthTint(depth) {
  if (S.style === 'ink') { tint[0] = 1; tint[1] = 1; tint[2] = 1; tint[3] = depth * 0.45; }
  else { tint[0] = 0.05; tint[1] = 0.2; tint[2] = 0.19; tint[3] = depth * 0.4; }
}
function drawKoi(k, part = 0) {
  const N = k.N, L = k.L, s = k.slot, d = k.desc, sf = clamp(k.speed / (L * 1.1), 0, 1);
  if (part !== 2) renderSpine(k, L * (0.028 + 0.042 * sf), 4.4, 0.12);
  const rx = k.rx, ry = k.ry, tx = k.tx, ty = k.ty, kk = L / LEN;
  setDepthTint(k.depth); alpha = 1;
  if (part === 2) { drawDorsal(k); return; }
  // pectoral + pelvic fins
  for (let fi = 0; fi < 2; fi++) {
    const i = fi ? 7 : 3, lenF = fi ? (d.butterfly ? 0.17 : 0.12) : (d.butterfly ? 0.3 : 0.2);
    const base = fi ? 0.6 - 0.2 * sf : 0.95 - 0.45 * sf, amp = fi ? 0.12 : 0.28, rootK = fi ? 0.6 : 0.78;
    const u = i / (N - 1), hwB = hwProfile(u) * HALF * kk * k.girth * rootK, nx = -ty[i], ny = tx[i];
    for (let side = 1; side >= -1; side -= 2) {
      const th = base + amp * Math.sin(k.finPhase + side * 1.3) * (1 - 0.6 * sf) + side * clamp(k.turnRate, -1.2, 1.2) * 0.25;
      const c = Math.cos(th), sn = Math.sin(th) * side;
      const dx = -tx[i] * c + nx * sn, dy = -ty[i] * c + ny * sn;
      finQuad(s.pec, rx[i] + nx * hwB * side, ry[i] + ny * hwB * side, dx, dy, L * lenF, side < 0, 4, PW, PH);
    }
  }
  // tail fin (strip)
  const M = 5, last = N - 1, Lt = L * (d.butterfly ? 0.46 : 0.34), kt = Lt / 150;
  const ang = Math.atan2(-ty[last], -tx[last]);
  const bend = wrapA(Math.atan2(ry[last - 1] - ry[last], rx[last - 1] - rx[last]) - Math.atan2(ry[last - 2] - ry[last - 1], rx[last - 2] - rx[last - 1]));
  const sway = (0.25 + 0.35 * sf) * Math.sin(k.phase - 4.4 - 1.1);
  const segT = TW * kt / M, spread = (1.08 - 0.25 * sf) * (d.butterfly ? 1.15 : 1);
  let cx = rx[last] - Math.cos(ang) * 4 * kt, cy = ry[last] - Math.sin(ang) * 4 * kt;
  for (let j = 0; j <= M; j++) {
    const a = ang + (sway - bend * 1.6) * (j / M);
    if (j > 0) { cx += Math.cos(a) * segT; cy += Math.sin(a) * segT; }
    SX[j] = cx; SY[j] = cy; SNX[j] = -Math.sin(a); SNY[j] = Math.cos(a); SHW[j] = TH / 2 * kt * spread; STU[j] = j / M;
  }
  strip(M + 1, s.tail);
  if (part === 1) return;
  // body
  const W2 = BH / 2 * kk * k.girth;
  SX[0] = rx[0] + tx[0] * PADX * kk; SY[0] = ry[0] + ty[0] * PADX * kk; SNX[0] = -ty[0]; SNY[0] = tx[0]; SHW[0] = W2; STU[0] = 0;
  for (let i = 0; i < N; i++) { SX[i + 1] = rx[i]; SY[i + 1] = ry[i]; SNX[i + 1] = -ty[i]; SNY[i + 1] = tx[i]; SHW[i + 1] = W2; STU[i + 1] = (PADX + LEN * i / (N - 1)) / BW; }
  SX[N + 1] = rx[last] - tx[last] * (BW - PADX - LEN) * kk; SY[N + 1] = ry[last] - ty[last] * (BW - PADX - LEN) * kk;
  SNX[N + 1] = -ty[last]; SNY[N + 1] = tx[last]; SHW[N + 1] = W2; STU[N + 1] = 1;
  strip(N + 2, s.body);
  drawDorsal(k);
}
function drawDorsal(k) {
  const N = k.N, L = k.L, rx = k.rx, ry = k.ry, tx = k.tx, ty = k.ty, real = S.style !== 'ink';
  const dl = L * 0.014 * Math.sin(k.phase - 1.5), span = 5 / (N - 1) * L, kd = span / DW;
  for (let i = 4, j = 0; i <= 9; i++, j++) {
    SX[j] = rx[i] - ty[i] * dl; SY[j] = ry[i] + tx[i] * dl; SNX[j] = -ty[i]; SNY[j] = tx[i]; SHW[j] = DH / 2 * kd * (real ? 0.5 : 1.3); STU[j] = j / 5;
  }
  strip(6, k.slot.dorsal);
}
const NETCOL = { asagi: [0.28, 0.36, 0.5], chagoi: [0.5, 0.36, 0.24] }, spBuf = new Float32Array(28);
function drawKoiBody(k) {
  const d = k.desc, s = k.slot.body;
  for (let i = 0; i < 14; i++) { spBuf[i * 2] = k.rx[i]; spBuf[i * 2 + 1] = k.ry[i]; }
  gl.useProgram(progKoi);
  gl.uniform2f(uK.uRes, W, H); gl.uniform2fv(uK.uSp, spBuf);
  gl.uniform1f(uK.uKK, k.L / LEN); gl.uniform1f(uK.uGirth, k.girth); gl.uniform1f(uK.uPx, rw / W);
  gl.uniform1i(uK.uTex, 0); gl.uniform2f(uK.uSlot, s.x, s.y);
  gl.uniform1f(uK.uDepth, k.depth); gl.uniform1f(uK.uMetal, d.metallic ? 1 : 0);
  gl.uniform1f(uK.uScaleType, d.scales === 'doitsu' ? 2 : d.scales === 'net' ? 1 : 0);
  gl.uniform1f(uK.uSeed, (d.seed % 997) * 0.37);
  const net = d.scales === 'net' ? (NETCOL[d.base] || [0.45, 0.45, 0.5]) : null;
  gl.uniform1f(uK.uNet, net ? 1 : 0); gl.uniform3fv(uK.uNetCol, net || [1, 1, 1]);
  gl.uniform1f(uK.uGlint, d.metallic ? 1 : d.ginrin ? 0.6 : 0);
  gl.bindVertexArray(koiVao); gl.drawElements(gl.TRIANGLES, koiIdxN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
}
function drawMinnow(m) {
  renderSpine(m, m.len * 0.07, 3.5, 0.2);
  setDepthTint(m.depth); alpha = 1;
  const kk = m.len / MW;
  for (let i = 0; i < m.N; i++) { SX[i] = m.rx[i]; SY[i] = m.ry[i]; SNX[i] = -m.ty[i]; SNY[i] = m.tx[i]; SHW[i] = MH / 2 * kk; STU[i] = i / (m.N - 1); }
  strip(m.N, SL.minnow[m.type]);
}

/* ---------------- frame pacing: fps meter + dynamic-resolution controller ----------------
   Goal: never drop below 60 fps. Frame intervals are measured every frame; if frames start
   missing the 60 Hz budget the render scale steps down within a few frames, and after a
   stretch of clean frames it probes back up (backing off if the probe fails). Expensive
   one-off events (atlas upload, pond-bed render, resize) are excluded via hold(). */
const PIN = clamp(+new URLSearchParams(location.search).get('scale') || 0, 0, 1);   // debug: ?scale=0.6 pins the render scale
const perf = {
  q: PIN || 1, qMin: 0.5, ceil: 1, holdT: 0.5, slow: 0, simE: 0, gpuSkip: 0, okT: 0, stableT: 0, wait: 2, probeT: 99, vs: 16.7, gpu: 0, gpuN: 0,
  // meter
  n: 0, t: 0, worst: 0, cpu: 0, fps: 0, ms: 0, wMs: 0, cpuMs: 0, el: null,
  hold(s) { this.holdT = Math.max(this.holdT, s); this.slow = 0; if (this.gpuN) this.gpuReset(); },
  tick(ms, cpu, sim) {   // frame interval, main-thread frame time, simulation-only time (ms)
    // ---- meter (published twice a second)
    this.n++; this.t += ms; this.cpu += cpu; if (ms > this.worst) this.worst = ms;
    this.simE = this.simE * 0.9 + sim * 0.1;   // pure JS sim time: GL calls can block when the GPU is saturated, so they don't count
    if (this.t >= 500) {
      this.fps = this.n * 1000 / this.t; this.ms = this.t / this.n; this.wMs = this.worst; this.cpuMs = this.cpu / this.n;
      this.n = 0; this.t = 0; this.cpu = 0; this.worst = 0;
      this.show();
    }
    // ---- controller
    if (PIN) return;
    if (ms > 250) { this.hold(0.5); return; }                    // tab switch / debugger / sleep
    this.vs = Math.min(20, this.vs * 1.002 + 0.002, ms);          // ~display refresh interval (capped at 50 Hz)
    if (this.holdT > 0) { this.holdT -= ms / 1000; return; }
    const sec = ms / 1000, budget = Math.max(1000 / 60, this.vs) * 1.2;   // 20 ms at 60 Hz and 120 Hz
    const gpuOk = this.gpuN > 3, gpuHi = 1000 / 60 * 0.82, gpuLo = 1000 / 60 * 0.68;   // GPU-timer thresholds (13.7 / 11.3 ms)
    this.slow = this.slow * 0.88 + (ms > budget ? 0.12 : 0);
    this.probeT += sec; this.stableT += sec;
    if (this.slow > 0.2 && this.simE < 1000 / 60 * 0.8) {        // ~2 missed frames in the last ~10 (and not sim-bound: lower res wouldn't help)
      if (this.probeT < 3) {                                      // the last step up was one too many: undo it, remember the ceiling
        this.ceil = this.q * 0.99; this.wait = Math.min(this.wait * 2, 40); setScale(this.q / 1.05);
      } else setScale(this.q * (ms > budget * 1.6 ? 0.82 : 0.9));
      this.slow = 0; this.okT = 0; this.stableT = 0; this.holdT = 0.25; this.probeT = 99; this.gpuReset();
    } else if (gpuOk && this.gpu > gpuHi && this.q > this.qMin) { // GPU near budget: step down before frames drop
      setScale(this.q * clamp(Math.sqrt(gpuLo / this.gpu), 0.8, 0.97)); this.gpuReset(); this.holdT = 0.15; this.okT = 0; this.stableT = 0;
    } else if (this.slow < 0.01 && this.q < 1) {
      const next = Math.min(1, this.q * 1.05);
      const room = gpuOk ? this.gpu * (next / this.q) ** 2 < gpuLo : next <= this.ceil;
      if (room && (this.okT += sec) > (gpuOk ? 0.75 : this.wait)) { setScale(next); this.okT = 0; this.probeT = 0; this.holdT = 0.2; this.gpuReset(); }
    } else this.okT = 0;
    if (this.stableT > 8) { this.stableT = 0; this.ceil = Math.min(1, this.ceil * 1.05); this.wait = Math.max(2, this.wait * 0.5); }   // conditions change: let it probe again
  },
  gpuSample(msGpu) { if (this.gpuSkip > 0) { this.gpuSkip--; return; } this.gpu = this.gpuN ? this.gpu * 0.85 + msGpu * 0.15 : msGpu; this.gpuN++; },
  gpuReset() { this.gpuN = 0; this.gpuSkip = gpuTimer.pending.length; },   // results in flight were measured at the old scale
  show() {
    if (!this.el) this.el = { box: document.getElementById('perf'), fps: document.getElementById('fps'), det: document.getElementById('perf-detail') };
    window.__pondPerf = { fps: +this.fps.toFixed(1), ms: +this.ms.toFixed(2), worst: +this.wMs.toFixed(1), cpu: +this.cpuMs.toFixed(2), gpu: this.gpuN ? +this.gpu.toFixed(2) : null, scale: +this.q.toFixed(3), px: rw + 'x' + rh };
    if (!this.el.box || !panel.classList.contains('open')) return;
    const f = Math.round(this.fps);
    this.el.fps.textContent = f;
    this.el.det.textContent = `${this.ms.toFixed(1)} ms · max ${this.wMs.toFixed(0)} · cpu ${this.cpuMs.toFixed(1)}${this.gpuN ? ' · gpu ' + this.gpu.toFixed(1) : ''} · res ${Math.round(this.q * 100)}%`;
    this.el.box.className = 'perf ' + (f >= 58 ? 'ok' : f >= 45 ? 'warn' : 'bad');
  },
};

// GPU frame time, where the browser exposes timer queries (desktop Chrome / Edge): lets the
// controller see headroom directly instead of waiting for missed frames.
const gpuTimer = {
  ext: gl.getExtension('EXT_disjoint_timer_query_webgl2'), pool: [], pending: [],
  begin() {
    if (!this.ext || this.pending.length > 4) return false;
    const q = this.pool.pop() || gl.createQuery(); gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.cur = q; return true;
  },
  end() { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.cur); },
  poll() {
    if (!this.ext) return;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT), ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      this.pending.shift(); this.pool.push(q);
      if (!disjoint && ns > 0) perf.gpuSample(ns / 1e6);
    }
  },
};

/* ---------------- GL targets ---------------- */
const atlasTex = gl.createTexture();
function uploadAtlas() {
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlasCv);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  atlasDirty = false; perf.hold(0.4);
}
function makeTarget(t, w, h, mips = true) {
  if (!t) t = { tex: gl.createTexture(), fb: gl.createFramebuffer() };
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  t.w = w; t.h = h;
  return t;
}
/* Dynamic resolution. Every target is allocated once at the full (canvas) size cw x ch;
   each frame draws into a q-scaled sub-rectangle rw x rh and the result is upscaled to the
   canvas. Changing q costs nothing (no reallocation, no pond-bed re-render), so the
   controller in perf.tick() can react within a few frames. Light pass runs at half of that. */
let fishT = null, surfT = null, floorT = null, lightT = null, compT = null;
let cw = 1, ch = 1, rw = 1, rh = 1, lw = 1, lh = 1;
const coarse = matchMedia('(pointer: coarse)').matches;
function applyResolution() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), maxPix = coarse ? 1.7e6 : 2.8e6;
  const rs = Math.max(0.5, Math.min(dpr, Math.sqrt(maxPix / (W * H))));
  cw = Math.max(1, Math.round(W * rs)); ch = Math.max(1, Math.round(H * rs));
  canvas.width = cw; canvas.height = ch;
  perf.qMin = PIN || clamp(0.55 / rs, 0.3, 0.8);   // never below ~0.55 px per CSS px
  fishT = makeTarget(fishT, cw, ch); surfT = makeTarget(surfT, cw, ch); floorT = makeTarget(floorT, cw, ch);
  compT = makeTarget(compT, cw, ch, false); lightT = makeTarget(lightT, Math.ceil(cw / 2), Math.ceil(ch / 2), false);
  floorDirty = true; setScale(perf.q); perf.hold(0.6);
}
function setScale(q) {
  perf.q = q = clamp(q, perf.qMin, 1);
  rw = Math.max(1, Math.round(cw * q)); rh = Math.max(1, Math.round(ch * q));
  lw = Math.max(1, Math.ceil(rw / 2)); lh = Math.max(1, Math.ceil(rh / 2));
}

/* Sprite batching: geometry for a whole layer is uploaded once; koi bodies (separate
   program) are interleaved via a command list so depth order is preserved. */
const cmds = [], cmdKoi = []; let segStart = 0;
function cutSprites() { if (vn > segStart) cmds.push(-1, segStart, vn - segStart); segStart = vn; }
function beginTarget(target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, rw, rh);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  cmds.length = 0; cmdKoi.length = 0; vn = 0; segStart = 0;
}
function endTarget(target) {
  cutSprites();
  if (vn) { gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, vdata.subarray(0, vn * FL), gl.STREAM_DRAW); }
  let prog = null;
  for (let i = 0; i < cmds.length; i += 3) {
    if (cmds[i] < 0) {
      if (prog !== progSprite) { prog = progSprite; gl.useProgram(progSprite); gl.uniform2f(uS.res, W, H); gl.uniform1i(uS.tex, 0); gl.bindVertexArray(vao); }
      gl.drawArrays(gl.TRIANGLES, cmds[i + 1], cmds[i + 2]);
    } else { prog = progKoi; drawKoiBody(cmdKoi[cmds[i]]); }
  }
  gl.bindVertexArray(null);
  vn = 0; cmds.length = 0; cmdKoi.length = 0; segStart = 0;
  gl.bindTexture(gl.TEXTURE_2D, target.tex); gl.generateMipmap(gl.TEXTURE_2D); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
}
function fullscreenPass() { gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
const drawList = [];
function render() {
  gpuTimer.poll();
  const timing = gpuTimer.begin();
  if (atlasDirty) uploadAtlas();
  rip.upload();
  const ink = S.style === 'ink', mode = ink ? 1 : 0, tm = time % 1000;
  const vpx = rw / cw, vpy = rh / ch, lodB = Math.log2(rw / cw);   // keep blur radii constant in CSS px
  const rm0 = 1 / (rip.cell * rip.gw), rm1 = 1 / (rip.cell * rip.gh), rm2 = 1.5 / rip.gw, rm3 = 1.5 / rip.gh;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // ---- fish layer (sorted deep -> shallow)
  drawList.length = 0; for (const k of koi) drawList.push(k); for (const m of minnows) drawList.push(m);
  drawList.sort((a, b) => b.depth - a.depth);
  beginTarget(fishT);
  for (const f of drawList) {
    if (!(f instanceof Koi)) drawMinnow(f);
    else if (ink) drawKoi(f);
    else { drawKoi(f, 1); cutSprites(); cmds.push(cmdKoi.length, 0, 0); cmdKoi.push(f); drawKoi(f, 2); }
  }
  endTarget(fishT);
  // ---- surface layer
  beginTarget(surfT);
  tint[3] = 0; alpha = 1;
  for (const p of pads) { const h = p.r * 128 / 118; sprite(SL.pad[p.v], p.x, p.y, h, h, p.rot); }
  const fs = clamp(baseLen * 0.045, 4, 9) * 12 / 7;
  for (const f of food) {
    if (f.gone) continue;
    const sc = f.landed ? Math.max(0.35, f.size) : 1 + f.delay * 5;
    alpha = f.landed ? (f.age > 64 ? Math.max(0, (70 - f.age) / 6) : 1) : 0.7;
    sprite(SL.food[f.v], f.x, f.y, fs * sc, fs * sc, f.rot);
  }
  alpha = 1;
  for (const p of petals) { const s = p.v === 2 || p.v === 3 ? p.s * 1.3 : p.s; sprite(SL.petal[p.v], p.x, p.y, s, s, p.rot); }
  for (const f of flowers) { const h = f.r * 1.0, w = Math.sin(time * 0.6 + f.ph) * 0.05; sprite(SL.lotus[f.v], f.x, f.y, h, h, f.rot + w); }
  endTarget(surfT);
  gl.disable(gl.BLEND);
  // ---- static layer: pond bed (real) or paper (ink); full canvas resolution, re-rendered only on resize / new pond / style
  if (floorDirty) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, floorT.fb); gl.viewport(0, 0, cw, ch);
    gl.useProgram(progFloor); gl.uniform2f(uF.res, W, H); gl.uniform1f(uF.scale, uScale); gl.uniform1f(uF.mode, mode);
    gl.uniform2f(uF.off, (pondSeed % 4096) * 1.7, ((pondSeed >> 12) % 4096) * 1.3);
    fullscreenPass();
    gl.bindTexture(gl.TEXTURE_2D, floorT.tex); gl.generateMipmap(gl.TEXTURE_2D);
    floorDirty = false; perf.hold(0.6);
  }
  // ---- light pass (half of render resolution): caustics + dapple / ink wash
  gl.bindFramebuffer(gl.FRAMEBUFFER, lightT.fb); gl.viewport(0, 0, lw, lh);
  gl.useProgram(progLight);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fishT.tex); gl.uniform1i(uL.uFish, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, surfT.tex); gl.uniform1i(uL.uSurf, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, rip.tex); gl.uniform1i(uL.uRip, 2);
  gl.uniform2f(uL.uRes, W, H); gl.uniform1f(uL.uTime, tm); gl.uniform1f(uL.uMode, mode);
  gl.uniform1f(uL.uScale, uScale); gl.uniform4f(uL.uRipMap, rm0, rm1, rm2, rm3);
  gl.uniform2f(uL.uVp, vpx, vpy); gl.uniform2f(uL.uVh, 0.5 / rw, 0.5 / rh); gl.uniform1f(uL.uLodB, lodB);
  fullscreenPass();
  // ---- composite (into the scaled sub-rect, or straight to the canvas at full scale)
  const direct = rw === cw && rh === ch;
  gl.bindFramebuffer(gl.FRAMEBUFFER, direct ? null : compT.fb); gl.viewport(0, 0, rw, rh);
  gl.useProgram(progComp);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fishT.tex); gl.uniform1i(uC.uFish, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, surfT.tex); gl.uniform1i(uC.uSurf, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, rip.tex); gl.uniform1i(uC.uRip, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, floorT.tex); gl.uniform1i(uC.uFloor, 3);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, lightT.tex); gl.uniform1i(uC.uLight, 4);
  gl.uniform2f(uC.uRes, W, H); gl.uniform1f(uC.uTime, tm); gl.uniform1f(uC.uMode, mode);
  gl.uniform1f(uC.uScale, uScale); gl.uniform4f(uC.uRipMap, rm0, rm1, rm2, rm3);
  gl.uniform2f(uC.uVp, vpx, vpy); gl.uniform2f(uC.uVh, 0.5 / rw, 0.5 / rh);
  gl.uniform2f(uC.uLp, lw / lightT.w, lh / lightT.h); gl.uniform2f(uC.uLh, 0.5 / lw, 0.5 / lh);
  fullscreenPass();
  if (!direct) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch);
    gl.useProgram(progBlit);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, compT.tex); gl.uniform1i(uB.tex, 0);
    gl.uniform2f(uB.vp, rw / cw, rh / ch); gl.uniform2f(uB.vh, 0.5 / rw, 0.5 / rh);
    fullscreenPass();
  }
  gl.bindVertexArray(null);
  gl.activeTexture(gl.TEXTURE0);
  if (timing) gpuTimer.end();
}

/* ---------------- resize ---------------- */
function resize() {
  const oW = W, oH = H, oBase = baseLen;
  W = Math.max(1, innerWidth); H = Math.max(1, innerHeight);
  computeScale();
  applyResolution(); rip.resize();
  if (oW !== W || oH !== H) {
    const sx = W / oW, sy = H / oH, f = baseLen / oBase;
    const mv = o => { for (let i = 0; i < o.N; i++) { o.px[i] *= sx; o.py[i] *= sy; } };
    for (const k of koi) { mv(k); k.rescale(f); k.wx *= sx; k.wy *= sy; }
    for (const m of minnows) { mv(m); m.rescale(f); }
    for (const p of [...pads, ...petals, ...flowers, ...food]) { p.x *= sx; p.y *= sy; }
    for (const p of pads) { p.ax *= sx; p.ay *= sy; p.r *= f; }
    for (const p of petals) p.s *= f;
    for (const p of flowers) { p.r *= f; p.ox *= f; p.oy *= f; }
  }
}
let resizeQueued = false;
addEventListener('resize', () => { if (!resizeQueued) { resizeQueued = true; requestAnimationFrame(() => { resizeQueued = false; resize(); }); } });

/* =====================================================================
   SOUND
   - Ambience: CC0 field recordings streamed by two <audio> elements per
     loop and equal-power crossfaded, so the loop seam is never heard.
     Each loop tries ./sounds/ first, then falls back to BigSoundBank.
     Same-origin files are routed through Web Audio (gain works on iOS);
     cross-origin / file:// ones are driven by element.volume instead.
   - Effects: water plops synthesised per event (rising sine "bubble
     resonance" + a filtered noise tick), panned to where they happen and
     sent through a small procedurally generated courtyard reverb.
   ===================================================================== */
const SOUND_CH = [
  { id: 'fountain', name: 'Temple fountain', group: 'Ambience', files: ['sounds/temple-fountain.mp3', 'https://bigsoundbank.com/UPLOAD/mp3/0913.mp3'] },
  { id: 'chimes', name: 'Wind chimes', group: 'Ambience', files: ['sounds/wind-chimes.mp3', 'https://bigsoundbank.com/UPLOAD/mp3/2687.mp3'] },
  { id: 'plops', name: 'Water plops', note: 'feeding & koi', group: 'Effects' },
];
const PLOPS = {   // f: start pitch (Hz), rise: pitch multiplier, dur: s, g: gain, click: noise tick, echo: chance of a 2nd smaller bloop
  pellet:  { f: [950, 1500], rise: [1.25, 1.7], dur: [0.045, 0.08], g: 0.16, click: 0.5 },
  gulp:    { f: [230, 380], rise: [1.9, 2.7], dur: [0.12, 0.2], g: 0.55, click: 0.15, echo: 0.6 },
  surface: { f: [200, 320], rise: [1.8, 2.4], dur: [0.14, 0.22], g: 0.32, click: 0.1, echo: 0.4 },
  drip:    { f: [500, 800], rise: [1.6, 2.2], dur: [0.07, 0.11], g: 0.3, click: 0.2 },
  nibble:  { f: [1300, 1900], rise: [1.2, 1.5], dur: [0.03, 0.05], g: 0.07, click: 0.6 },
  insect:  { f: [1900, 2800], rise: [1.1, 1.3], dur: [0.02, 0.035], g: 0.035, click: 0.8 },
};
const vol = v => Math.pow(clamp(v / 100, 0, 1), 2);   // perceptual slider curve
const XF = 4;                                          // loop crossfade (s)

class Looper {
  constructor(urls) { this.urls = urls; this.els = [this.mk(), this.mk()]; this.cur = 0; this.want = false; this.fade = -1; this.inT = 0; }
  mk() {
    const el = new Audio(); el.preload = 'auto'; el._i = 0; el.xf = 0; el._lv = -1;
    el.addEventListener('error', () => { if (++el._i < this.urls.length) { el.src = this.urls[el._i]; if (el._want) el.play().catch(() => {}); } });
    el.addEventListener('ended', () => {
      if (el !== this.els[this.cur]) return;
      if (this.fade >= 0) this.swap();                                          // crossfade partner already playing
      else if (this.want) { el.currentTime = 0; el.play().catch(() => {}); }   // no partner (very short file / slow device)
    });
    el.addEventListener('loadedmetadata', () => audio.route(el));
    el.src = this.urls[0];
    return el;
  }
  start() {
    this.want = true;
    const a = this.els[this.cur];
    if (a.paused) { a._want = true; a.play().catch(() => {}); }
    const b = this.els[1 - this.cur];   // unlock the second element inside this gesture (iOS)
    if (!b._primed) { b._primed = true; b.muted = true; b.play().then(() => { if (this.fade < 0) b.pause(); b.muted = false; }).catch(() => { b.muted = false; }); }
  }
  stop() { this.want = false; }        // fades out in tick()
  swap() { const a = this.els[this.cur]; a.pause(); a._want = false; a.xf = 0; this.cur = 1 - this.cur; this.els[this.cur].xf = 1; this.fade = -1; }
  halt() { this.want = false; this.fade = -1; this.inT = 0; for (const el of this.els) { el._want = false; el.pause(); el.xf = 0; } }
  tick(dt, g) {
    if (!this.want && this.inT <= 0) return;
    this.inT = clamp(this.inT + dt * (this.want ? 1 / 2.5 : -1 / 0.6), 0, 1);
    if (!this.want && this.inT <= 0) { this.halt(); return; }
    const a = this.els[this.cur], b = this.els[1 - this.cur], d = a.duration;
    if (this.fade < 0 && isFinite(d) && d > XF * 3 && a.currentTime > d - XF) {
      this.fade = 0; b.currentTime = 0; b._want = true; b.muted = false; b.play().catch(() => {});
    }
    if (this.fade >= 0) {   // progress follows the incoming element's real playback position
      this.fade = clamp(Math.max(this.fade, b.currentTime / XF), 0, 1);
      a.xf = Math.cos(this.fade * Math.PI / 2); b.xf = Math.sin(this.fade * Math.PI / 2);
      if (this.fade >= 1) this.swap();
    } else a.xf = 1;
    for (const el of this.els) audio.level(el, el.xf * this.inT * g);
  }
}

const audio = {
  ctx: null, master: null, loopBus: null, plopBus: null, noise: null, loops: {}, recent: new Float64Array(10).fill(-1), ri: 0, mv: 0, susT: 0,
  ensure() {   // first call must happen inside a user gesture
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(comp);
    this.loopBus = ctx.createGain(); this.loopBus.connect(this.master);
    // small courtyard reverb — impulse response generated procedurally
    const len = (ctx.sampleRate * 1.6) | 0, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.22; verb.connect(wet); wet.connect(this.master);
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 6000;
    this.plopBus = ctx.createGain(); this.plopBus.gain.value = 0; this.plopBus.connect(tone); tone.connect(this.master); tone.connect(verb);
    const nb = this.noise = ctx.createBuffer(1, (ctx.sampleRate * 0.05) | 0, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    for (const c of SOUND_CH) if (c.files) this.loops[c.id] = new Looper(c.files);
    return true;
  },
  route(el) {   // same-origin over http(s): route through Web Audio so the gain is honoured everywhere
    if (el._g || !this.ctx || !/^https?:$/.test(location.protocol)) return;
    let same = false; try { same = new URL(el.currentSrc || el.src, location.href).origin === location.origin; } catch (e) {}
    if (!same) return;
    try { const g = this.ctx.createGain(); g.gain.value = 0; this.ctx.createMediaElementSource(el).connect(g); g.connect(this.loopBus); el._g = g; el._lv = -1; } catch (e) {}
  },
  level(el, v) {
    if (el._g) {   // master is applied by the graph
      if (el.volume !== 1) el.volume = 1;
      if (Math.abs(v - el._lv) > 0.003) { el._lv = v; el._g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.06); }
    } else {
      const nv = clamp(v * this.mv, 0, 1);
      if (Math.abs(nv - el.volume) > 0.002 || (nv === 0 && el.volume !== 0)) el.volume = nv;
    }
  },
  apply() {
    const live = S.sound && !document.hidden;
    this.mv = S.sound ? vol(S.vMaster) : 0;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.mv, t, 0.15);
    this.plopBus.gain.setTargetAtTime(S.on_plops ? vol(S.v_plops) : 0, t, 0.05);
    for (const id in this.loops) (live && S['on_' + id] && S['v_' + id] > 0) ? this.loops[id].start() : this.loops[id].stop();
    clearTimeout(this.susT);
    if (live) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
    else this.susT = setTimeout(() => { if (!S.sound || document.hidden) this.ctx.suspend().catch(() => {}); }, 900);
  },
  tick() {
    if (!this.ctx) return;
    const now = performance.now(), dt = Math.min(0.5, (now - (this.lastT || now)) / 1000); this.lastT = now;   // real time, not the capped sim dt
    for (const id in this.loops) {
      let g = vol(S['v_' + id]);
      if (id === 'chimes') g *= 0.4 + 0.6 * (0.5 + 0.3 * Math.sin(time * 0.11) + 0.2 * Math.sin(time * 0.043 + 2));   // the breeze comes and goes
      this.loops[id].tick(dt, g);
    }
  },
  plop(x, kind, size = 1) {
    const ctx = this.ctx;
    if (!ctx || !S.sound || !S.on_plops || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    let busy = 0; for (let i = 0; i < 10; i++) if (now - this.recent[i] < 0.15) busy++;   // max ~10 voices per 150 ms
    if (busy >= 10) return; this.recent[this.ri = (this.ri + 1) % 10] = now;
    const P = PLOPS[kind], t = now + 0.005;
    const f = rnd(P.f[0], P.f[1]) / Math.sqrt(size), rise = rnd(P.rise[0], P.rise[1]), dur = rnd(P.dur[0], P.dur[1]) * Math.sqrt(size), g = P.g * Math.min(1.4, size);
    const o = ctx.createOscillator(), env = ctx.createGain();
    let out = env;
    if (ctx.createStereoPanner) { out = ctx.createStereoPanner(); out.pan.value = clamp(x / W * 2 - 1, -1, 1) * 0.75; env.connect(out); }
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rise, t + dur * 0.7);
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(g, t + 0.006); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env); out.connect(this.plopBus);
    o.start(t); o.stop(t + dur + 0.03);
    if (P.click) {
      const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      n.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = rnd(2500, 4500); bp.Q.value = 1.2;
      ng.gain.setValueAtTime(g * P.click, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.04);
    }
    if (P.echo && Math.random() < P.echo) setTimeout(() => this.plop(x, 'drip', size * 0.6), rnd(60, 140));
  },
};
document.addEventListener('visibilitychange', () => {
  perf.hold(1);
  if (!audio.ctx) return;
  if (document.hidden) for (const id in audio.loops) audio.loops[id].halt();
  audio.apply();
});
const unlock = () => { if (S.sound && audio.ensure()) audio.apply(); };   // browsers only allow audio after a gesture
addEventListener('pointerdown', unlock, true);
addEventListener('keydown', unlock, true);

/* ---------------- input ---------------- */
const hint = document.getElementById('hint');
let hintGone = false;
const hideHint = () => { if (!hintGone) { hintGone = true; hint.classList.add('gone'); } };
setTimeout(hideHint, 9000);
let down = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => {
  down = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  dropFood(e.clientX, e.clientY, 6 + rint(4)); lastX = e.clientX; lastY = e.clientY; hideHint();
});
canvas.addEventListener('pointermove', e => {
  wake();
  if (!down) return;
  if (Math.hypot(e.clientX - lastX, e.clientY - lastY) > 26) { dropFood(e.clientX, e.clientY, 2); lastX = e.clientX; lastY = e.clientY; }
});
const up = () => { down = false; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ---------------- UI ---------------- */
const $ = id => document.getElementById(id);
const panel = $('panel'), seal = $('seal');
const setOpen = o => { panel.classList.toggle('open', o); seal.setAttribute('aria-expanded', o); };
seal.onclick = () => setOpen(!panel.classList.contains('open'));
$('close').onclick = () => setOpen(false);
for (const k of ['koi', 'fish', 'pads', 'lotus', 'petals']) {
  const inp = $(k), out = $('o-' + k);
  inp.value = S[k]; out.textContent = S[k];
  inp.addEventListener('input', () => { S[k] = +inp.value; out.textContent = inp.value; syncCounts(); save(); });
}
$('autofeed').checked = S.autofeed;
$('autofeed').onchange = e => { S.autofeed = e.target.checked; autoT = 2; save(); };
// sound controls
function setSound(on) {
  S.sound = on; save();
  $('snd').checked = on; $('sound').classList.toggle('on', on);
  if (on) audio.ensure();
  audio.apply();
}
$('snd').checked = S.sound; $('sound').classList.toggle('on', S.sound);
$('snd').onchange = e => setSound(e.target.checked);
{
  const r = $('vMaster'), o = $('o-vMaster');
  r.value = S.vMaster; o.textContent = S.vMaster;
  r.addEventListener('input', () => { S.vMaster = +r.value; o.textContent = r.value; audio.apply(); save(); });
  const box = $('snd-ch'); let group = '';
  for (const c of SOUND_CH) {
    if (c.group !== group) { group = c.group; box.insertAdjacentHTML('beforeend', `<p class="grp">${c.group}</p>`); }
    box.insertAdjacentHTML('beforeend',
      `<label class="ch" id="ch-${c.id}"><input type="checkbox" id="on-${c.id}" aria-label="${c.name} on"><span>${c.name}${c.note ? `<small>${c.note}</small>` : ''}</span>` +
      `<output id="o-v-${c.id}"></output><input type="range" id="v-${c.id}" min="0" max="100" step="1" aria-label="${c.name} volume"></label>`);
    const on = $('on-' + c.id), rr = $('v-' + c.id), oo = $('o-v-' + c.id), row = $('ch-' + c.id);
    on.checked = S['on_' + c.id]; rr.value = S['v_' + c.id]; oo.textContent = S['v_' + c.id]; row.classList.toggle('off', !on.checked);
    on.onchange = () => { S['on_' + c.id] = on.checked; row.classList.toggle('off', !on.checked); audio.apply(); save(); };
    rr.addEventListener('input', () => { S['v_' + c.id] = +rr.value; oo.textContent = rr.value; audio.apply(); save(); });
  }
}
function chromeColor(st) { return st === 'ink' ? '#efe7d6' : '#0b2624'; }
function applyChrome(st) {
  const color = chromeColor(st);
  document.documentElement.dataset.style = st;
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  // iOS Safari caches theme-color; rewrite the tags so status / toolbar chrome updates.
  document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove());
  for (const media of [null, '(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = color;
    if (media) meta.media = media;
    document.head.appendChild(meta);
  }
}
function setStyle(st) {
  S.style = st; applyChrome(st);
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.style === st));
  paintStatic(); for (const k of koi) paintKoi(k); floorDirty = true; save();
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => setStyle(b.dataset.style));
function newPond() {
  pondSeed = (Math.random() * 1e9) | 0;
  koi.length = 0; minnows.length = 0; petals.length = 0; food.length = 0; pads.length = 0; flowers.length = 0;
  paintStatic(); makePads(); makeFlowers(); syncCounts(); floorDirty = true;
}
$('reseed').onclick = newPond;
const fsOk = document.fullscreenEnabled || document.webkitFullscreenEnabled;
if (!fsOk) $('full').hidden = true;
function toggleFull() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
}
$('full').onclick = toggleFull;
let wakeTimer = 0;
function wake() { if (!document.body.classList.contains('zen')) return; document.body.classList.add('awake'); clearTimeout(wakeTimer); wakeTimer = setTimeout(() => document.body.classList.remove('awake'), 2500); }
function toggleZen() { const z = document.body.classList.toggle('zen'); if (z) { setOpen(false); hideHint(); } }
$('zen').onclick = toggleZen;
seal.addEventListener('pointerenter', wake);
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  if (k === 'h') toggleZen(); else if (k === 'f' && fsOk) toggleFull(); else if (k === 's') setStyle(S.style === 'ink' ? 'real' : 'ink');
  else if (k === 'm') setSound(!S.sound);
  else if (k === 'escape') setOpen(false);
});

/* ---------------- boot ---------------- */
applyChrome(S.style);
document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.style === S.style));
applyResolution(); rip.resize();
paintStatic(); makePads(); makeFlowers(); syncCounts();

let last = performance.now(), ripAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);   // schedule first: one bad frame never stalls the loop
  const t0 = performance.now(), ms = Math.max(0, now - last); last = now;
  let dt = ms / 1000;
  if (dt > 0.1) dt = 0.1;
  time += dt;
  update(dt);
  audio.tick();
  ripAcc += dt; let st = 0;
  while (ripAcc >= 1 / 60 && st < 3) { rip.step(); ripAcc -= 1 / 60; st++; }
  if (ripAcc > 0.1) ripAcc = 0;
  const t1 = performance.now();
  render();
  perf.tick(ms, performance.now() - t0, t1 - t0);
}
requestAnimationFrame(frame);