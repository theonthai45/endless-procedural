/* ===== Endless Street: core =====
 * Colour, the day/night drawing surface, the facade kit and the street plan. */
var WH = 1000, G = 800, VY = 140;   // world height; building base line; top of the visible world
var KERB = 846, FY = 560;           // kerb line; top of the foreground layer (lamps, trees, poles)

function mulberry32(a) {
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(a, b) {
  var h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function rr(r, a, b) { return a + (b - a) * r(); }

/* ---------- colour ----------
 * Everything is painted once in neutral daylight. Night is a second copy of the same
 * drawing with every colour multiplied down, so time of day never needs a repaint. */
var STYLE = {
  palette: "natural", ornament: 70, trees: true, lamps: true,
  fontSign: "Georgia, serif", fontSans: "Helvetica, Arial, sans-serif", fontJP: "sans-serif"
};
var _cc = {}, _ccKey = "";
function hexRGB(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function adjust(rgb) {
  // palette treatment: pastel lifts and softens, vivid deepens
  var r = rgb[0], g = rgb[1], b = rgb[2], m = (r + g + b) / 3;
  if (STYLE.palette === "pastel") { r = m + (r - m) * 0.75; g = m + (g - m) * 0.75; b = m + (b - m) * 0.75; r += (255 - r) * 0.22; g += (255 - g) * 0.22; b += (255 - b) * 0.22; }
  else if (STYLE.palette === "vivid") { r = m + (r - m) * 1.45; g = m + (g - m) * 1.45; b = m + (b - m) * 1.45; }
  return [r, g, b];
}
function L(hex, extra) {
  if (STYLE.palette !== _ccKey) { _cc = {}; _ccKey = STYLE.palette; }
  var ck = hex + (extra || ""), v = _cc[ck];
  if (v) return v;
  var c = adjust(hexRGB(hex)), f = extra || 1;
  v = "rgb(" + (Math.max(0, Math.min(255, c[0] * f)) | 0) + "," + (Math.max(0, Math.min(255, c[1] * f)) | 0) + "," + (Math.max(0, Math.min(255, c[2] * f)) | 0) + ")";
  _cc[ck] = v;
  return v;
}
// a colour that gives off its own light: it is not darkened in the night copy
function EM(hex) { return "!" + L(hex); }
function night() { return 0; }

var NIGHT = [0.2, 0.235, 0.4], _tc = {};
function tintStr(s) {
  var v = _tc[s];
  if (v) return v;
  var m, r, g, b, a = 1;
  if (s.charAt(0) === "#") {
    if (s.length === 4) { r = parseInt(s[1] + s[1], 16); g = parseInt(s[2] + s[2], 16); b = parseInt(s[3] + s[3], 16); }
    else { r = parseInt(s.slice(1, 3), 16); g = parseInt(s.slice(3, 5), 16); b = parseInt(s.slice(5, 7), 16); }
  } else if ((m = /^rgba?\(([^)]+)\)/.exec(s))) {
    var p = m[1].split(","); r = +p[0]; g = +p[1]; b = +p[2]; if (p.length > 3) a = +p[3];
  } else return s;
  v = "rgba(" + Math.round(r * NIGHT[0]) + "," + Math.round(g * NIGHT[1]) + "," + Math.round(b * NIGHT[2]) + "," + a + ")";
  _tc[s] = v;
  return v;
}

/* ---------- Tee: one set of drawing calls, a day canvas and a night canvas ---------- */
function Tee(a, n) { this.a = a; this.n = n; }
["fillRect", "strokeRect", "clearRect", "beginPath", "moveTo", "lineTo", "arc", "ellipse", "quadraticCurveTo", "bezierCurveTo", "closePath", "rect",
  "fill", "stroke", "clip", "save", "restore", "translate", "rotate", "scale", "setTransform", "fillText", "setLineDash"].forEach(function(m) {
  Tee.prototype[m] = function() { this.a[m].apply(this.a, arguments); this.n[m].apply(this.n, arguments); };
});
Tee.prototype.measureText = function(t) { return this.a.measureText(t); };
["lineWidth", "lineCap", "lineJoin", "globalAlpha", "font", "textAlign", "textBaseline"].forEach(function(p) {
  Object.defineProperty(Tee.prototype, p, { set: function(v) { this.a[p] = v; this.n[p] = v; }, get: function() { return this.a[p]; } });
});
["fillStyle", "strokeStyle"].forEach(function(p) {
  Object.defineProperty(Tee.prototype, p, {
    set: function(v) {
      if (v && v.a) { this.a[p] = v.a; this.n[p] = v.n; }
      else if (v.charCodeAt(0) === 33) { v = v.slice(1); this.a[p] = v; this.n[p] = v; }
      else { this.a[p] = v; this.n[p] = tintStr(v); }
    },
    get: function() { return this.a[p]; }
  });
});
function TeeGrad(a, n) { this.a = a; this.n = n; }
TeeGrad.prototype.addColorStop = function(o, c) {
  if (c.charCodeAt(0) === 33) { c = c.slice(1); this.a.addColorStop(o, c); this.n.addColorStop(o, c); }
  else { this.a.addColorStop(o, c); this.n.addColorStop(o, tintStr(c)); }
};
Tee.prototype.createLinearGradient = function(a, b, c, d) { return new TeeGrad(this.a.createLinearGradient(a, b, c, d), this.n.createLinearGradient(a, b, c, d)); };
Tee.prototype.createRadialGradient = function(a, b, c, d, e, f) { return new TeeGrad(this.a.createRadialGradient(a, b, c, d, e, f), this.n.createRadialGradient(a, b, c, d, e, f)); };

/* ---------- animated-effect emitters and window lights (collected while drawing) ---------- */
var EMIT = {}, EMIT_NEW = [], EMIT_ON = true;
function emit(kind, x, y, extra) {
  if (!EMIT_ON) return;
  var key = kind + ":" + Math.round(x) + ":" + Math.round(y);
  if (EMIT[key]) return;
  var e = { kind: kind, x: x, y: y, extra: extra || {}, key: key };
  EMIT[key] = e; EMIT_NEW.push(e);
}
var WINS = null, LEAN = null;   // WINS: the windows of the tile being drawn; LEAN: a building drawn at a tilt

/* ---------- the facade kit ---------- */
function R(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function orn() { return STYLE.ornament / 100; }
// a pane of glass. By day it reflects the sky; in the night copy it is a hole,
// and the light behind it is switched on and off without touching the facade.
function glass(ctx, r, x, y, w, h, o) {
  o = o || {};
  var roll = r(), curtain = r(), A = ctx.a || ctx;
  var g2 = A.createLinearGradient(x, y, x + w * 0.6, y + h);
  g2.addColorStop(0, L("#8fb0cc", 1.05)); g2.addColorStop(0.55, L("#34424e")); g2.addColorStop(1, L("#232d36"));
  A.fillStyle = g2; A.fillRect(x, y, w, h);
  if (curtain > 0.6 && !o.shop) { A.fillStyle = L("#e9e2d2", 0.85); A.fillRect(x, y, w, h * 0.35); }
  if (!ctx.n) return;
  if (!WINS) { ctx.n.fillStyle = "#0b101c"; ctx.n.fillRect(x, y, w, h); return; }
  ctx.n.clearRect(x, y, w, h);
  WINS.push({ x: x, y: y, w: w, h: h, s: roll, c: curtain, shop: !!o.shop, lean: LEAN, on: null });
}
function frameWindow(ctx, r, x, y, w, h, frame, cols, rows, opts) {
  glass(ctx, r, x, y, w, h, opts);
  ctx.strokeStyle = frame; ctx.lineWidth = Math.max(1.4, w * 0.06);
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = Math.max(0.8, w * 0.03);
  ctx.beginPath();
  for (var i = 1; i < cols; i++) { ctx.moveTo(x + w * i / cols, y); ctx.lineTo(x + w * i / cols, y + h); }
  for (var j = 1; j < rows; j++) { ctx.moveTo(x, y + h * j / rows); ctx.lineTo(x + w, y + h * j / rows); }
  ctx.stroke();
}
function louvres(ctx, x, y, w, h, c, dark) {
  R(ctx, x, y, w, h, c);
  ctx.strokeStyle = dark; ctx.lineWidth = 0.9; ctx.beginPath();
  for (var yy = y + 4; yy < y + h - 1; yy += 4.2) { ctx.moveTo(x + 1.5, yy); ctx.lineTo(x + w - 1.5, yy); }
  ctx.stroke();
  ctx.lineWidth = 1.2; ctx.strokeRect(x, y, w, h);
}
function glowAt(ctx, x, y, rad, col, a) {
  var g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, col.replace(")", "," + a + ")").replace("rgb", "rgba"));
  g.addColorStop(1, col.replace(")", ",0)").replace("rgb", "rgba"));
  ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}
// light that only exists after dark
function nglow(ctx, x, y, rad, col, a) { if (ctx.n) glowAt(ctx.n, x, y, rad, col, a); }
function signText(ctx, text, x, y, size, color, font, align, maxW) {
  ctx.font = size + "px " + font; ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
  var w = ctx.measureText(text).width;
  if (maxW && w > maxW) { size *= maxW / w; ctx.font = size + "px " + font; }
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function railing(ctx, x, y, w, h, c) {
  ctx.strokeStyle = c; ctx.lineWidth = 1.1; ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h);
  for (var bx = x; bx <= x + w; bx += 4) { ctx.moveTo(bx, y); ctx.lineTo(bx, y + h); }
  ctx.stroke();
  if (orn() > 0.4) {
    ctx.beginPath();
    for (var cx = x + 8; cx < x + w - 4; cx += 16) { ctx.moveTo(cx + 4, y + h / 2); ctx.arc(cx, y + h / 2, 4, 0, 6.3); }
    ctx.stroke();
  }
}
// striped shop awning with a scalloped edge
function awning(ctx, x, y, w, h, c1, c2) {
  for (var st = 0; st < w; st += 10) {
    R(ctx, x + st, y, Math.min(5, w - st), h, L(c1));
    R(ctx, x + st + 5, y, Math.min(5, Math.max(0, w - st - 5)), h, L(c2));
  }
  ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(x, y + h, w, 6);
  ctx.fillStyle = L(c1); ctx.beginPath();
  for (var sc = x; sc < x + w - 4; sc += 10) { ctx.moveTo(sc, y + h); ctx.arc(sc + 5, y + h, 5, 0, Math.PI); }
  ctx.fill();
}
function chimney(ctx, x, y, w, h, body, pots, smoke) {
  R(ctx, x, y, w, h, L(body)); R(ctx, x - 2, y - 2, w + 4, 4, L(body, 0.85));
  for (var p = 0; p * 5.5 + 5 < w; p++) R(ctx, x + 2 + p * 5.5, y - 10, 3.5, 8, L(pots));
  if (smoke) emit("smoke", x + w / 2, y - 10);
}
function flowerBox(ctx, r, x, y, w) {
  R(ctx, x, y, w, 6, L("#5b3a1e"));
  for (var fl = 0; fl < 4; fl++) { ctx.fillStyle = L(pick(r, ["#e2524a", "#f3c13a", "#e86fa5", "#ffffff"])); ctx.beginPath(); ctx.arc(x + 3 + fl * (w - 6) / 3, y - 1, 2.4, 0, 6.3); ctx.fill(); }
  ctx.fillStyle = L("#4f7a3a"); ctx.fillRect(x + 1, y - 0.5, w - 2, 1.6);
}
function acUnit(ctx, x, y) {
  R(ctx, x, y, 22, 15, L("#e9e9e4"));
  ctx.strokeStyle = L("#b8b8b2"); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + 14, y + 7.5, 5, 0, 6.3); ctx.stroke();
}
function brickCourses(ctx, x, y, w, h, c, step) {
  ctx.strokeStyle = c; ctx.lineWidth = 0.5; ctx.beginPath();
  for (var by = y + step; by < y + h; by += step) { ctx.moveTo(x, by); ctx.lineTo(x + w, by); }
  ctx.stroke();
}

/* ---------- cities ---------- */
var CITIES = {
  singapore: { label: "Singapore", streets: ["Koon Seng Road", "Joo Chiat Place", "Emerald Hill Road", "Blair Road", "Neil Road", "Petain Road", "Everton Road", "Tembeling Road", "Spottiswoode Park", "Kampong Bahru Road"] },
  paris: { label: "Paris", streets: ["Rue de Rivoli", "Boulevard Haussmann", "Rue du Bac", "Rue Saint-Honoré", "Avenue de l'Opéra", "Rue des Martyrs", "Rue de Rennes", "Boulevard Saint-Germain"] },
  amsterdam: { label: "Amsterdam", streets: ["Keizersgracht", "Prinsengracht", "Herengracht", "Brouwersgracht", "Leidsegracht", "Bloemgracht", "Egelantiersgracht", "Reguliersgracht"] },
  tokyo: { label: "Tokyo", streets: ["Kagurazaka", "Yanaka Ginza", "Shimokitazawa", "Koenji Kitanaka", "Togoshi Ginza", "Omoide Yokocho", "Nakano Broadway", "Sugamo Jizo-dori"] },
  brooklyn: { label: "Brooklyn", streets: ["Joralemon Street", "Garden Place", "Willow Street", "Clinton Street", "Hicks Street", "Pierrepont Street", "Strong Place", "Montague Terrace"] },
  london: { label: "London", streets: ["Doughty Street", "Bedford Row", "Cloudesley Square", "Gibson Square", "Lamb's Conduit Street", "Great Ormond Street", "Fournier Street", "Elder Street"] },
  lisbon: { label: "Lisboa", streets: ["Rua Augusta", "Rua da Bica", "Rua das Flores", "Calçada do Combro", "Rua de São Bento", "Travessa da Queimada", "Rua Garrett", "Largo do Carmo"] },
  hanoi: { label: "Hà Nội", streets: ["Phố Hàng Bạc", "Phố Hàng Gai", "Phố Tạ Hiện", "Phố Hàng Đào", "Phố Mã Mây", "Phố Lãn Ông", "Phố Hàng Buồm", "Phố Đinh Liệt"] }
};
var CITY_KEYS = ["singapore", "paris", "amsterdam", "brooklyn", "lisbon", "tokyo", "london", "hanoi"];
var WIDTH = {
  singapore: [104, 132], paris: [170, 235], amsterdam: [58, 92], tokyo: [68, 132], brooklyn: [86, 118],
  london: [84, 104], lisbon: [96, 150], hanoi: [52, 78]
};
var TERRACED = { singapore: [3, 6], london: [3, 7] };   // houses built in runs that share a roofline

/* ---------- the street plan: blocks laid out in both directions ----------
 * A block is one district: a gap (cross street, square or pocket park), then a run of buildings. */
var PLAN = { seed: 1, lock: "mix", hmul: 1, blocks: [], salt: 0 };
function makeBlock(n, neighbour) {
  var r = mulberry32((Math.imul(PLAN.seed, 7919) + Math.imul(n, 104729) + Math.imul(PLAN.salt, 15485863)) | 0);
  var city = PLAN.lock;
  // a block must come out the same whichever side the plan reaches it from, so its city
  // depends only on its own number: odd and even blocks draw from alternate halves of the list,
  // which also guarantees that neighbours differ
  var ci = Math.floor(r() * CITY_KEYS.length / 2) * 2 + (n & 1);
  if (city === "mix") city = CITY_KEYS[ci];
  var items = [], x = 0, sk = r(), sep = sk < 0.5 ? "cross" : sk < 0.8 ? "square" : "park";
  var sw = Math.round(sep === "cross" ? rr(r, 150, 190) : sep === "square" ? rr(r, 310, 420) : rr(r, 120, 170));
  items.push({ dx: 0, w: sw, type: sep, seed: (r() * 1e9) | 0, city: city, hmul: PLAN.hmul });
  x += sw;
  var count = Math.round(rr(r, 9, 16)), wr = WIDTH[city], run = TERRACED[city], terrace = null;
  for (var i = 0; i < count; i++) {
    var w = Math.round(rr(r, wr[0], wr[1]));
    var b = { dx: x, w: w, type: city, seed: (r() * 1e9) | 0, hmul: PLAN.hmul, city: city };
    if (run) {
      if (!terrace || terrace.left <= 0) terrace = { left: Math.round(rr(r, run[0], run[1])), floors: r() < 0.65 ? 2 : 3, w: w, tone: (r() * 1e9) | 0 };
      b.floors = terrace.floors; b.w = terrace.w; b.tone = terrace.tone; terrace.left--;
    }
    items.push(b);
    x += b.w;
  }
  return { n: n, city: city, street: pick(r, CITIES[city].streets), items: items, w: x, x0: 0, x1: x };
}
function placeBlock(B, x0) {
  B.x0 = x0; B.x1 = x0 + B.w;
  for (var i = 0; i < B.items.length; i++) B.items[i].x = x0 + B.items[i].dx;
}
function planCover(a, b) {
  var Bs = PLAN.blocks, B;
  if (!Bs.length) { B = makeBlock(0, ""); placeBlock(B, -B.items[0].w); Bs.push(B); }
  while (Bs[Bs.length - 1].x1 < b) { B = makeBlock(Bs[Bs.length - 1].n + 1, Bs[Bs.length - 1].city); placeBlock(B, Bs[Bs.length - 1].x1); Bs.push(B); }
  while (Bs[0].x0 > a) { B = makeBlock(Bs[0].n - 1, Bs[0].city); placeBlock(B, Bs[0].x0 - B.w); Bs.unshift(B); }
}
function blockAt(x) {
  var Bs = PLAN.blocks;
  for (var i = 0; i < Bs.length; i++) if (x < Bs[i].x1) return Bs[i];
  return Bs[Bs.length - 1] || null;
}
function districtAt(x) { return blockAt(x); }
function itemsIn(x0, x1) {
  var out = [], Bs = PLAN.blocks;
  for (var i = 0; i < Bs.length; i++) {
    if (Bs[i].x1 < x0 || Bs[i].x0 > x1) continue;
    for (var j = 0; j < Bs[i].items.length; j++) { var it = Bs[i].items[j]; if (it.x < x1 && it.x + it.w > x0) out.push(it); }
  }
  return out;
}
function prunePlan(a, b) {
  var Bs = PLAN.blocks;
  while (Bs.length > 2 && Bs[0].x1 < a) Bs.shift();
  while (Bs.length > 2 && Bs[Bs.length - 1].x0 > b) Bs.pop();
}
// new settings take over beyond what has been drawn, in the direction of travel
function replan(edge, dir) {
  var Bs = PLAN.blocks, B;
  PLAN.salt++;
  if (!Bs.length) return;
  if (dir > 0) {
    while (Bs.length > 1 && Bs[Bs.length - 1].x0 >= edge) Bs.pop();
    B = Bs[Bs.length - 1];
    B.items = B.items.filter(function(it) { return it.x < edge; });
    var last = B.items[B.items.length - 1];
    if (last) { B.x1 = last.x + last.w; B.w = B.x1 - B.x0; }
  } else {
    while (Bs.length > 1 && Bs[0].x1 <= edge) Bs.shift();
    B = Bs[0];
    B.items = B.items.filter(function(it) { return it.x + it.w > edge; });
    if (B.items[0]) { B.x0 = B.items[0].x; B.w = B.x1 - B.x0; }
  }
}
function resetPlan(seed) { PLAN.seed = seed; PLAN.blocks = []; PLAN.salt = 0; }
