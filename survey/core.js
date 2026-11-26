/* ===== Endless Survey: core =====
 * Terrain, hydrology, settlements, roads and the tile renderer.
 * Self-contained on purpose: shared/engine.js rebuilds this function inside a worker
 * from its own source, and calls it directly on the main thread for labels and names. */
function SurveyCore(scope) {
  "use strict";
  var WH = 1000;            // world height (units)
  var GRID = 3;             // raster sampling cell
  var HC = 8;               // hydrology cell
  var CW = 96, MX = 80;     // hydrology chunk: core width and margin (cells)
  var GJ0 = -30, NYW = 186, NXW = CW + 2 * MX;
  var CWU = CW * HC;        // chunk width in units
  var BLEND = 900;          // distance over which a terrain change blends in
  var RT = 44;              // catchment (cells) at which a stream becomes a mapped river

  /* ---------- seeded simplex noise ---------- */
  function mulberry32(a) {
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(a, b, c) {
    var h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  var G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  function makeNoise(seed) {
    var rnd = mulberry32(seed), p = new Uint8Array(256), i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
    var perm = new Uint8Array(512), gx = new Float32Array(512), gy = new Float32Array(512);
    for (i = 0; i < 512; i++) { perm[i] = p[i & 255]; var g = G2[perm[i] & 7]; gx[i] = g[0]; gy[i] = g[1]; }
    var F2 = 0.5 * (Math.sqrt(3) - 1), G = (3 - Math.sqrt(3)) / 6;
    function s2(xin, yin) {
      var s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
      var t = (i + j) * G, x0 = xin - (i - t), y0 = yin - (j - t);
      var i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
      var x1 = x0 - i1 + G, y1 = y0 - j1 + G, x2 = x0 - 1 + 2 * G, y2 = y0 - 1 + 2 * G;
      var ii = i & 255, jj = j & 255, n = 0, tt, gi;
      tt = 0.5 - x0 * x0 - y0 * y0;
      if (tt > 0) { gi = ii + perm[jj]; tt *= tt; n += tt * tt * (gx[gi] * x0 + gy[gi] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1;
      if (tt > 0) { gi = ii + i1 + perm[jj + j1]; tt *= tt; n += tt * tt * (gx[gi] * x1 + gy[gi] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2;
      if (tt > 0) { gi = ii + 1 + perm[jj + 1]; tt *= tt; n += tt * tt * (gx[gi] * x2 + gy[gi] * y2); }
      return 70 * n;
    }
    function fbm(x, y, oct) {
      var a = 0.5, f = 1, s = 0, n = 0;
      for (var o = 0; o < oct; o++) { s += a * s2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
      return s / n;
    }
    function ridged(x, y, oct) {
      var a = 0.5, f = 1, s = 0, n = 0, w = 1;
      for (var o = 0; o < oct; o++) {
        var r = 1 - Math.abs(s2(x * f, y * f)); r *= r; r *= w; w = Math.min(1, r * 1.6);
        s += a * r; n += a; a *= 0.5; f *= 2.1;
      }
      return s / n;
    }
    return { s2: s2, fbm: fbm, ridged: ridged };
  }
  var NOISE = {};
  function noiseFor(seed) { return NOISE[seed] || (NOISE[seed] = makeNoise(seed)); }

  /* ---------- terrain settings along the journey ----------
   * PARAMS[i] applies from BOUNDS[i-1] onward, blending in over BLEND units. */
  var PARAMS = [{ seed: 1, sea: 0, rug: 1, size: 1 }], BOUNDS = [];
  var chunks = {}, clock = 0, minX = Infinity, maxX = -Infinity;
  function setTerrain(params, bounds, reset) {
    PARAMS = params; BOUNDS = bounds;
    if (reset) { chunks = {}; minX = Infinity; maxX = -Infinity; }
  }
  function columnParams(x) {
    var i = 0;
    while (i < BOUNDS.length && BOUNDS[i] <= x) i++;
    var B = PARAMS[i];
    if (i === 0) return { A: B, B: B, t: 1 };
    var t = (x - BOUNDS[i - 1]) / BLEND;
    if (t >= 1) return { A: B, B: B, t: 1 };
    return { A: PARAMS[i - 1], B: B, t: t * t * (3 - 2 * t) };
  }
  // regional character drifts on its own so the journey keeps changing
  function region(K, x) {
    var N = noiseFor(K.seed);
    var a = N.s2(x * 0.00021, 3.3), b = N.s2(x * 0.00017, 8.1), c = N.s2(x * 0.0003, 13.7);
    return {
      seaOff: a * 0.16,                                // archipelagos vs continents
      rug: Math.max(0, Math.min(1, 0.5 + b * 0.85)),   // plains vs high fells
      lakes: Math.max(0, c)                            // lake districts
    };
  }
  function colOf(x) {
    var cp = columnParams(x);
    cp.rB = region(cp.B, x);
    cp.rA = cp.t >= 1 ? cp.rB : region(cp.A, x);
    return cp;
  }
  // height above sea level, before rivers cut their valleys
  function elevOne(K, R, x, y) {
    var N = noiseFor(K.seed), f = 0.0013 / K.size;
    var wx = N.fbm(x * f * 0.5 + 31.7, y * f * 0.5 - 12.1, 3) * 85;
    var wy = N.fbm(x * f * 0.5 - 51.3, y * f * 0.5 + 77.9, 3) * 85;
    var X = (x + wx) * f, Y = (y + wy) * f;
    var base = N.fbm(X, Y, 5) * 0.5 + 0.5;
    var rug = K.rug * (0.25 + R.rug * 0.95);
    var rid = N.ridged(X * 1.6 + 9.1, Y * 1.6 - 3.7, 4);
    // ridges bite harder on high ground, so lowlands stay gentle
    var h = base * 0.78 + rid * rid * rug * 0.62 * (0.45 + base * 1.1) - 0.12 * rug + 0.08;
    h -= R.lakes * Math.max(0, N.s2(X * 3.1 + 40, Y * 3.1)) * 0.16;
    return h - (0.36 + K.sea + R.seaOff);
  }
  function elev(col, x, y) {
    if (col.t >= 1) return elevOne(col.B, col.rB, x, y);
    return elevOne(col.A, col.rA, x, y) * (1 - col.t) + elevOne(col.B, col.rB, x, y) * col.t;
  }
  function elevAt(x, y) { return elev(colOf(x), x, y); }
  function paramsAt(x) { var cp = columnParams(x); return cp.t >= 0.5 ? cp.B : cp.A; }
  function seedAt(x) { return paramsAt(x).seed; }

  /* ---------- names ---------- */
  var SYL_A = ["Ash", "Bel", "Brack", "Cor", "Dun", "Elder", "Fen", "Glen", "Hal", "Iver", "Kel", "Lin", "Mor", "Nether", "Oak", "Pen", "Rav", "Stan", "Thorn", "Ul", "Ver", "Wex", "Yar", "Hollin", "Brin", "Calder", "Wren", "Marl", "Esk", "Tarn", "Gry", "Sel", "Ald", "Rook", "Fal", "Kes", "Had", "Lang", "Mel", "Nor", "Orm", "Rath", "Skel", "Tor", "Wyn", "Arn", "Dor", "Hex"];
  var SYL_B = ["ford", "bury", "wick", "ton", "mere", "dale", "holm", "stead", "by", "more", "haven", "field", "gate", "moor", "combe", "ley", "thwaite", "burn", "stow", "well", "cross", "hope", "ness", "wold", "mouth", "bridge", "ham", "worth", "garth", "beck"];
  var SYL_R = ["a", "e", "en", "er", "le", "ow", "y", "an", "el", "ick"];
  function placeName(r1, r2) { return SYL_A[Math.floor(r1 * SYL_A.length)] + SYL_B[Math.floor(r2 * SYL_B.length)]; }
  function shortName(r1, r2) { var a = SYL_A[Math.floor(r1 * SYL_A.length)]; return a.length > 4 ? a : a + SYL_R[Math.floor(r2 * SYL_R.length)]; }
  function regionName(x) {
    var K = paramsAt(x), R = region(K, x);
    var ci = Math.floor(x / 2600), nm = placeName(hash3(ci, 1, K.seed + 31), hash3(ci, 2, K.seed + 32));
    var r = hash3(ci, 3, K.seed);
    if (R.seaOff + K.sea > 0.06) return r < 0.5 ? "The " + nm + " Isles" : nm + " Archipelago";
    if (R.lakes > 0.35) return "The " + nm + " Lakes";
    if (R.rug * K.rug > 0.68) return r < 0.5 ? "The " + nm + " Fells" : nm + " Highlands";
    if (R.rug * K.rug < 0.3) return r < 0.5 ? "The " + nm + " Levels" : nm + " Vale";
    return r < 0.5 ? "The " + nm + " Downs" : nm + " Country";
  }

  /* ---------- binary heap of (index, key) ---------- */
  function Heap(cap) { this.i = new Int32Array(cap); this.k = new Float32Array(cap); this.n = 0; this.cap = cap; }
  Heap.prototype.push = function(idx, key) {
    if (this.n >= this.cap) return;
    var i = this.n++, I = this.i, K = this.k;
    while (i > 0) { var p = (i - 1) >> 1; if (K[p] <= key) break; I[i] = I[p]; K[i] = K[p]; i = p; }
    I[i] = idx; K[i] = key;
  };
  Heap.prototype.pop = function() {
    var I = this.i, K = this.k, top = I[0], n = --this.n;
    if (n > 0) {
      var idx = I[n], key = K[n], i = 0;
      for (;;) {
        var l = 2 * i + 1; if (l >= n) break;
        var r = l + 1, m = (r < n && K[r] < K[l]) ? r : l;
        if (K[m] >= key) break;
        I[i] = I[m]; K[i] = K[m]; i = m;
      }
      I[i] = idx; K[i] = key;
    }
    return top;
  };

  /* ---------- hydrology, one chunk at a time ----------
   * Each chunk floods a window wider than itself (priority-flood), so every cell knows
   * where its water goes; flow accumulation then says which cells are rivers and the
   * filled hollows become lakes. Features are kept only for the chunk's own core. */
  var NB_I = [1, 1, 0, -1, -1, -1, 0, 1], NB_J = [0, 1, 1, 1, 0, -1, -1, -1], NB_D = [1, 1.4142, 1, 1.4142, 1, 1.4142, 1, 1.4142];
  function jx(gi, gj) { return gi * HC + (hash3(gi, gj, 11) - 0.5) * HC * 0.72; }
  function jy(gi, gj) { return gj * HC + (hash3(gi, gj, 12) - 0.5) * HC * 0.72; }

  function stage1(c) {
    var ch = chunks[c];
    if (ch) { ch.used = ++clock; return ch; }
    var gi0 = c * CW - MX, nx = NXW, ny = NYW, n = nx * ny, i, j, a, b, k, gi, gj;
    var OFF = [], Z = new Float32Array(n), W = new Float32Array(n), DOWN = new Int32Array(n), ACC = new Float32Array(n);
    var LK = new Float32Array(n), MD = new Int32Array(n);
    for (k = 0; k < 8; k++) OFF.push(NB_J[k] * nx + NB_I[k]);
    minX = Math.min(minX, gi0 * HC); maxX = Math.max(maxX, (gi0 + nx) * HC);
    for (i = 0; i < nx; i++) {
      gi = gi0 + i;
      var col = colOf(gi * HC);
      for (j = 0; j < ny; j++) Z[j * nx + i] = elev(col, gi * HC, (GJ0 + j) * HC) + (hash3(gi, GJ0 + j, 5) - 0.5) * 0.0008;
    }
    // priority flood from the sea and the window edge
    var closed = new Uint8Array(n), order = new Int32Array(n), no = 0, heap = new Heap(n + 8);
    for (a = 0; a < n; a++) if (Z[a] < 0) { closed[a] = 1; W[a] = Z[a]; }
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      a = j * nx + i;
      var edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      if (Z[a] < 0) {
        if (edge) continue;
        if (Z[a + 1] >= 0 || Z[a - 1] >= 0 || Z[a + nx] >= 0 || Z[a - nx] >= 0) heap.push(a, W[a]);
      } else if (edge) { closed[a] = 1; W[a] = Z[a]; heap.push(a, W[a]); }
    }
    while (heap.n) {
      a = heap.pop(); order[no++] = a;
      i = a % nx; j = (a / nx) | 0;
      for (k = 0; k < 8; k++) {
        var bi = i + NB_I[k], bj = j + NB_J[k];
        if (bi < 0 || bj < 0 || bi >= nx || bj >= ny) continue;
        b = bj * nx + bi;
        if (closed[b]) continue;
        closed[b] = 1;
        W[b] = Math.max(Z[b], W[a] + 1e-5);
        heap.push(b, W[b]);
      }
    }
    // steepest descent over the filled surface
    for (a = 0; a < n; a++) {
      DOWN[a] = -1; MD[a] = -1; LK[a] = -1;
      if (Z[a] < 0) continue;
      i = a % nx; j = (a / nx) | 0;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) continue;
      var best = 0;
      for (k = 0; k < 8; k++) { b = a + OFF[k]; var s = (W[a] - W[b]) / NB_D[k]; if (s > best) { best = s; DOWN[a] = b; } }
    }
    for (k = no - 1; k >= 0; k--) {
      a = order[k];
      if (Z[a] < 0) continue;
      ACC[a] += 1;
      if (DOWN[a] >= 0) ACC[DOWN[a]] += ACC[a];
    }
    // lakes: connected hollows that the flood had to fill
    var lakes = [], seen = new Uint8Array(n), stack = new Int32Array(n);
    for (a = 0; a < n; a++) {
      if (seen[a] || Z[a] < 0 || W[a] - Z[a] < 0.0002) continue;
      var sp = 0, cnt = 0, lvl = Infinity, deep = 0, sx = 0, sy = 0;
      stack[sp++] = a; seen[a] = 1;
      var first = cnt;
      var members = [];
      while (sp) {
        var q = stack[--sp]; members.push(q);
        if (W[q] < lvl) lvl = W[q];
        if (W[q] - Z[q] > deep) deep = W[q] - Z[q];
        i = q % nx; j = (q / nx) | 0; sx += i; sy += j;
        for (k = 0; k < 8; k++) {
          var qi = i + NB_I[k], qj = j + NB_J[k];
          if (qi < 0 || qj < 0 || qi >= nx || qj >= ny) continue;
          b = qj * nx + qi;
          if (seen[b] || Z[b] < 0 || W[b] - Z[b] < 0.0002) continue;
          seen[b] = 1; stack[sp++] = b;
        }
      }
      cnt = members.length;
      if (cnt < 14 || deep < 0.006) continue;
      for (k = 0; k < cnt; k++) LK[members[k]] = W[members[k]];
      var lgi = gi0 + sx / cnt, lgj = GJ0 + sy / cnt;
      if (lgi >= c * CW && lgi < (c + 1) * CW) lakes.push({ x: lgi * HC, y: lgj * HC, n: cnt, lvl: lvl });
    }
    // main donor of each river cell: the larger stream carries on, the other joins it
    for (a = 0; a < n; a++) {
      if (Z[a] < 0 || ACC[a] < RT) continue;
      b = DOWN[a];
      if (b >= 0 && (MD[b] < 0 || ACC[a] > ACC[MD[b]])) MD[b] = a;
    }
    function PX(q) { return jx(gi0 + q % nx, GJ0 + ((q / nx) | 0)); }
    function PY(q) { return jy(gi0 + q % nx, GJ0 + ((q / nx) | 0)); }
    var segs = [];
    for (j = 1; j < ny - 1; j++) for (i = MX; i < MX + CW; i++) {
      a = j * nx + i;
      if (Z[a] < 0 || ACC[a] < RT) continue;
      b = DOWN[a];
      if (b < 0 || (LK[a] > 0 && LK[b] > 0)) continue;
      var p0 = MD[a] >= 0 ? MD[a] : a, p3 = (Z[b] >= 0 && DOWN[b] >= 0) ? DOWN[b] : b;
      var ax = PX(a), ay = PY(a), ex = PX(b), ey = PY(b), tt = 1;
      if (Z[b] < 0) tt = Math.min(1, Z[a] / (Z[a] - Z[b]) + 0.08);
      else if (LK[b] > 0 && LK[a] <= 0) tt = Math.max(0.25, Math.min(1, (Z[a] - LK[b]) / Math.max(1e-6, Z[a] - Z[b]) + 0.08));
      else if (LK[a] > 0) { ax += (ex - ax) * 0.55; ay += (ey - ay) * 0.55; p0 = a; }   // a lake's outlet starts at its shore
      segs.push(p0 === a ? ax : PX(p0), p0 === a ? ay : PY(p0), ax, ay, ax + (ex - ax) * tt, ay + (ey - ay) * tt, PX(p3), PY(p3), ACC[a], Z[a]);
    }
    function wet(q) { return Z[q] < 0 || LK[q] > 0; }
    var sd = seedAt((c + 0.5) * CWU);
    // settlements: scored sites, the best taken first
    var cand = [];
    for (j = 0; j < ny; j++) {
      gj = GJ0 + j;
      if (gj * HC < 56 || gj * HC > WH - 48) continue;
      for (i = MX + 6; i < MX + CW - 6; i++) {
        a = j * nx + i; gi = gi0 + i;
        if (Z[a] < 0.004 || Z[a] > 0.24 || LK[a] > 0) continue;
        var sl = Math.max(Math.abs(Z[a + 1] - Z[a - 1]), Math.abs(Z[a + nx] - Z[a - nx]));
        if (sl > 0.035) continue;
        var sc = hash3(gi, gj, sd + 41) * 0.55 + (1 - sl / 0.035) * 0.35 + (0.24 - Z[a]) * 0.8;
        var riv = ACC[a] >= RT;
        if (riv) {
          sc += 0.45 + 0.1 * Math.log(ACC[a] / RT);
          if (DOWN[a] >= 0 && wet(DOWN[a])) sc += 0.9;                   // river mouth
        }
        var don = 0, wc = 0;
        for (k = 0; k < 8; k++) { b = a + OFF[k]; if (Z[b] >= 0 && ACC[b] >= RT && DOWN[b] === a) don++; }
        if (don >= 2) sc += 0.55;                                         // confluence
        for (var dj = -2; dj <= 2; dj++) for (var di = -2; di <= 2; di++) if (wet(a + dj * nx + di)) wc++;
        if (wc >= 3 && wc <= 13) sc += 0.5;                               // sheltered shore
        if (sc > 1.16) cand.push({ a: a, sc: sc, gi: gi, gj: gj });
      }
    }
    cand.sort(function(p, q) { return q.sc - p.sc || p.a - q.a; });
    var towns = [];
    for (k = 0; k < cand.length; k++) {
      var cd = cand[k], tx = cd.gi * HC, ty = cd.gj * HC, ok = true, cls = cd.sc > 2.25 ? 2 : cd.sc > 1.65 ? 1 : 0;
      var gap = cls === 0 ? 132 : 160;
      for (var m = 0; m < towns.length; m++) {
        var dd = Math.hypot(towns[m].x - tx, towns[m].y - ty);
        if (dd < gap) { ok = false; break; }
        if (cls === 2 && towns[m].cls === 2 && dd < 460) cls = 1;
      }
      if (!ok) continue;
      towns.push({
        x: tx, y: ty, cls: cls, i: cd.a, gi: cd.gi, gj: cd.gj, river: ACC[cd.a] >= RT,
        name: placeName(hash3(cd.gi, cd.gj, sd + 14), hash3(cd.gj, cd.gi, sd + 15)), ang: hash3(cd.gi, cd.gj, 16) * Math.PI
      });
    }
    // summits: local maxima of the high ground
    var peaks = [];
    for (j = 4; j < ny - 4; j++) {
      gj = GJ0 + j;
      if (gj * HC < 54 || gj * HC > WH - 54) continue;
      for (i = MX; i < MX + CW; i++) {
        a = j * nx + i;
        if (Z[a] < 0.2) continue;
        var top = true;
        for (var pj = -4; pj <= 4 && top; pj++) for (var pi = -4; pi <= 4; pi++) {
          b = a + pj * nx + pi;
          if (b !== a && (Z[b] > Z[a] || (Z[b] === Z[a] && b < a))) { top = false; break; }
        }
        if (!top) continue;
        gi = gi0 + i;
        var named = Z[a] > 0.34 || hash3(gi, gj, sd + 51) < 0.22;
        var kinds = ["Pike", "Fell", "Crag", "Tor", "Law", "Knott", "Beacon", "Edge"];
        peaks.push({
          x: gi * HC, y: gj * HC, z: Z[a], i: a,
          name: named ? shortName(hash3(gi, gj, sd + 52), hash3(gj, gi, sd + 53)) + " " + kinds[Math.floor(hash3(gi, gj, sd + 54) * kinds.length)] : null
        });
      }
    }
    // lighthouses on exposed capes
    var lights = [];
    for (j = 5; j < ny - 5; j++) {
      gj = GJ0 + j;
      if (gj * HC < 60 || gj * HC > WH - 60) continue;
      for (i = MX; i < MX + CW; i++) {
        a = j * nx + i; gi = gi0 + i;
        if (Z[a] < 0.001 || Z[a] > 0.05 || LK[a] > 0 || hash3(gi, gj, sd + 61) > 0.5) continue;
        var seaN = 0;
        for (var lj = -4; lj <= 4; lj++) for (var li = -4; li <= 4; li++) if (Z[a + lj * nx + li] < 0) seaN++;
        if (seaN < 56) continue;
        var lx = gi * HC, ly = gj * HC, far = true;
        for (m = 0; m < lights.length; m++) if (Math.hypot(lights[m].x - lx, lights[m].y - ly) < 230) far = false;
        for (m = 0; m < towns.length; m++) if (Math.hypot(towns[m].x - lx, towns[m].y - ly) < 46) far = false;
        if (far) lights.push({ x: lx, y: ly });
      }
    }
    // stretches of big river that get a name written along them
    var rlab = [];
    for (j = 8; j < ny - 8; j++) {
      gj = GJ0 + j;
      if (gj * HC < 70 || gj * HC > WH - 70) continue;
      for (i = MX; i < MX + CW; i++) {
        a = j * nx + i; gi = gi0 + i;
        if (Z[a] < 0 || ACC[a] < RT * 5 || LK[a] > 0 || hash3(gi, gj, sd + 71) > 0.09) continue;
        var up = [], dn = [], q2 = a, okr = true;
        for (k = 0; k < 5; k++) { q2 = MD[q2]; if (q2 < 0 || LK[q2] > 0) { okr = false; break; } up.push(q2); }
        q2 = a;
        for (k = 0; k < 5 && okr; k++) { q2 = DOWN[q2]; if (q2 < 0 || Z[q2] < 0 || LK[q2] > 0) { okr = false; break; } dn.push(q2); }
        if (!okr) continue;
        var rx = gi * HC, ry = gj * HC, sep = true;
        for (m = 0; m < rlab.length; m++) if (Math.hypot(rlab[m].x - rx, rlab[m].y - ry) < 330) sep = false;
        if (!sep) continue;
        var end = a, guard = 0;
        while (DOWN[end] >= 0 && Z[DOWN[end]] >= 0 && guard++ < 600) end = DOWN[end];
        var egi = gi0 + end % nx, egj = GJ0 + ((end / nx) | 0), pts = [];
        for (k = up.length - 1; k >= 0; k--) pts.push(PX(up[k]), PY(up[k]));
        pts.push(PX(a), PY(a));
        for (k = 0; k < dn.length; k++) pts.push(PX(dn[k]), PY(dn[k]));
        var rn = shortName(hash3(egi, egj, sd + 72), hash3(egj, egi, sd + 73));
        rlab.push({ x: rx, y: ry, pts: pts, s: ACC[a] > RT * 14 ? "River " + rn : rn + (hash3(egi, egj, 74) < 0.5 ? " Water" : " Beck") });
      }
    }
    ch = chunks[c] = {
      c: c, gi0: gi0, Z: Z, W: W, ACC: ACC, LK: LK, segs: new Float32Array(segs), lakes: lakes, towns: towns,
      peaks: peaks, lights: lights, rlab: rlab, seed: sd, s2: null, used: ++clock
    };
    return ch;
  }

  /* ---------- roads and label placement (needs the neighbouring chunks' towns) ---------- */
  var A_G = null, A_FROM = null, A_HEAP = null, A_TOUCH = null;
  function route(ch, src, dst, mask, steep) {
    var nx = NXW, ny = NYW, n = nx * ny, Z = ch.Z, ACC = ch.ACC, LK = ch.LK, k, a, b;
    if (!A_G) { A_G = new Float32Array(n); A_FROM = new Int32Array(n); A_HEAP = new Heap(n * 8); A_TOUCH = new Int32Array(n); for (k = 0; k < n; k++) A_G[k] = Infinity; }
    var g = A_G, from = A_FROM, heap = A_HEAP, nt = 0, di = dst % nx, dj = (dst / nx) | 0, found = false, steps = 0;
    heap.n = 0;
    g[src] = 0; from[src] = -1; A_TOUCH[nt++] = src; heap.push(src, 0);
    while (heap.n && steps++ < 60000) {
      var key = heap.k[0];
      a = heap.pop();
      if (a === dst) { found = true; break; }
      var ai = a % nx, aj = (a / nx) | 0;
      if (key > g[a] + 0.36 * Math.hypot(ai - di, aj - dj) + 1e-3) continue;      // stale entry
      for (k = 0; k < 8; k++) {
        var bi = ai + NB_I[k], bj = aj + NB_J[k];
        if (bi < 1 || bj < 1 || bi >= nx - 1 || bj >= ny - 1) continue;
        b = bj * nx + bi;
        if (b !== dst && (Z[b] < 0.002 || LK[b] > 0)) continue;
        var sl = Math.abs(Z[b] - Z[a]) / (NB_D[k] * HC) / steep, cost = 1 + Math.min(40, sl * sl) + Z[b] * 2.5;
        if (ACC[b] >= RT) cost += 7 + Math.log(ACC[b] / RT) * 3;              // a bridge
        if (mask[b]) cost *= 0.4;                                              // follow an existing road
        cost *= NB_D[k] * (0.93 + 0.14 * hash3(ch.gi0 + bi, GJ0 + bj, 91));
        var ng = g[a] + cost;
        if (ng < g[b]) {
          if (g[b] === Infinity) A_TOUCH[nt++] = b;
          g[b] = ng; from[b] = a;
          heap.push(b, ng + 0.36 * Math.hypot(bi - di, bj - dj));
        }
      }
    }
    var path = null;
    if (found) { path = []; for (a = dst; a >= 0; a = from[a]) path.push(a); path.reverse(); }
    for (k = 0; k < nt; k++) g[A_TOUCH[k]] = Infinity;
    return path;
  }
  function stage2(c) {
    var ch = stage1(c);
    if (ch.s2) return ch;
    var L = stage1(c - 1), Rt = stage1(c + 1), nx = NXW, all = L.towns.concat(ch.towns, Rt.towns), k, m, a;
    function idxOf(t) { return (t.gj - GJ0) * nx + (t.gi - ch.gi0); }
    var edges = [];
    ch.towns.forEach(function(A) {
      ch.towns.concat(Rt.towns).forEach(function(B) {
        if (B === A || B.x < A.x || (B.x === A.x && B.y <= A.y)) return;
        var d = Math.hypot(A.x - B.x, A.y - B.y);
        if (d > 600 || B.gi - ch.gi0 >= nx - 2) return;
        for (var q = 0; q < all.length; q++) {
          var C = all[q];
          if (C !== A && C !== B && Math.max(Math.hypot(A.x - C.x, A.y - C.y), Math.hypot(B.x - C.x, B.y - C.y)) < d * 0.97) return;
        }
        edges.push({ A: A, B: B, d: d, cls: (A.cls > 0 && B.cls > 0) ? 0 : 1 });
      });
    });
    edges.sort(function(p, q) { return p.cls - q.cls || p.d - q.d; });
    var mask = new Uint8Array(nx * NYW), roads = [];
    function build(path, cls) {
      var n = path.length, xs = new Float32Array(n), ys = new Float32Array(n), bridges = [], i, pass;
      for (i = 0; i < n; i++) { xs[i] = (ch.gi0 + path[i] % nx) * HC; ys[i] = (GJ0 + ((path[i] / nx) | 0)) * HC; mask[path[i]] = 1; }
      for (pass = 0; pass < 2; pass++) {
        var px = xs[0], py = ys[0];
        for (i = 1; i < n - 1; i++) {
          var cx = xs[i], cy = ys[i];
          xs[i] = (px + 2 * cx + xs[i + 1]) / 4; ys[i] = (py + 2 * cy + ys[i + 1]) / 4;
          px = cx; py = cy;
        }
      }
      for (i = 1; i < n - 1; i++) if (ch.ACC[path[i]] >= RT && ch.LK[path[i]] <= 0 && ch.ACC[path[i - 1]] < ch.ACC[path[i]] * 0.999) {
        bridges.push(xs[i], ys[i], Math.atan2(ys[i + 1] - ys[i - 1], xs[i + 1] - xs[i - 1]));
      }
      var x0 = Infinity, x1 = -Infinity;
      for (i = 0; i < n; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; }
      roads.push({ cls: cls, xs: xs, ys: ys, bridges: bridges, x0: x0, x1: x1 });
    }
    for (k = 0; k < edges.length; k++) {
      var e = edges[k], path = route(ch, idxOf(e.A), idxOf(e.B), mask, 0.0007);
      if (path) build(path, e.cls);
    }
    // footpaths up the named summits
    ch.peaks.forEach(function(p) {
      if (!p.name) return;
      var bestT = null, bd = 360;
      for (var q = 0; q < all.length; q++) {
        var d = Math.hypot(all[q].x - p.x, all[q].y - p.y), ti = all[q].gi - ch.gi0;
        if (d < bd && ti > 1 && ti < nx - 2) { bd = d; bestT = all[q]; }
      }
      if (!bestT) return;
      var path = route(ch, idxOf(bestT), p.i, mask, 0.0022);
      if (path) build(path, 2);
    });
    // labels: best sites first, each trying a few positions around its symbol
    var boxes = [], labels = [];
    ch.towns.forEach(function(t) { var r = t.cls === 2 ? 5 : t.cls === 1 ? 4 : 3; boxes.push([t.x - r, t.y - r, t.x + r, t.y + r]); });
    ch.peaks.forEach(function(p) { boxes.push([p.x - 4, p.y - 5, p.x + 4, p.y + 3]); });
    function free(bx, self) {
      if (bx[1] < 24 || bx[3] > WH - 22) return false;
      for (var q = 0; q < boxes.length; q++) {
        var o = boxes[q];
        if (o !== self && bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1]) return false;
      }
      return true;
    }
    function place(x, y, w, h, r, mk, must) {
      var tries = [[r + 3, h * 0.36, "left"], [-r - 3, h * 0.36, "right"], [0, -r - 3, "center"], [0, r + h * 0.92, "center"], [r + 2, -r, "left"], [r + 2, r + h * 0.8, "left"], [-r - 2, -r, "right"], [-r - 2, r + h * 0.8, "right"]];
      for (var q = 0; q < tries.length; q++) {
        var t = tries[q], lx = x + t[0], ly = y + t[1];
        var bx0 = t[2] === "left" ? lx : t[2] === "right" ? lx - w : lx - w / 2, bx = [bx0 - 1, ly - h * 0.8, bx0 + w + 1, ly + h * 0.25];
        if (free(bx, mk) || (must && q === tries.length - 1)) {
          if (must && q === tries.length - 1) { lx = x + r + 3; ly = y + h * 0.36; bx = [lx - 1, ly - h * 0.8, lx + w + 1, ly + h * 0.25]; t = tries[0]; }
          boxes.push(bx); return { dx: lx - x, dy: ly - y, al: t[2], box: bx };
        }
      }
      return null;
    }
    ch.towns.slice().sort(function(p, q) { return q.cls - p.cls; }).forEach(function(t, n) {
      var size = t.cls === 2 ? 15 : t.cls === 1 ? 12.5 : 10.5, s = t.cls === 2 ? t.name.toUpperCase() : t.name;
      var w = s.length * size * (t.cls === 2 ? 0.74 : 0.57), r = t.cls === 2 ? 12 : t.cls === 1 ? 8 : 4;
      var p = place(t.x, t.y, w, size, r, null, t.cls > 0);
      if (p) labels.push({ t: "town", x: t.x, y: t.y, s: s, c: t.cls, dx: p.dx, dy: p.dy, al: p.al, box: p.box });
    });
    ch.lakes.forEach(function(lk) {
      if (lk.n < 26 || lk.y < 60 || lk.y > WH - 50) return;
      var gi = Math.round(lk.x / HC), gj = Math.round(lk.y / HC);
      var nm = shortName(hash3(gi, gj, ch.seed + 23), hash3(gj, gi, ch.seed + 24)), r = hash3(gi, gj, ch.seed + 25);
      var s = lk.n < 60 ? nm + " Tarn" : r < 0.4 ? "Lake " + nm : r < 0.75 ? nm + " Water" : "Loch " + nm;
      var w = s.length * 9.2, bx = [lk.x - w / 2, lk.y - 11, lk.x + w / 2, lk.y + 4];
      boxes.push(bx);
      labels.push({ t: "lake", x: lk.x, y: lk.y, s: s, box: bx, size: lk.n > 160 ? 14 : 11.5 });
    });
    ch.peaks.forEach(function(p) {
      var hs = Math.round(p.z * 3600).toLocaleString("en-US");
      var w = Math.max(hs.length * 5.4, p.name ? p.name.length * 5.6 : 0), h = p.name ? 20 : 10;
      var q = place(p.x, p.y, w, h, 5, null, false);
      if (q) labels.push({ t: "peak", x: p.x, y: p.y, s: hs, n: p.name, dx: q.dx, dy: q.dy - (p.name ? 9 : 0), al: q.al, box: q.box });
    });
    ch.rlab.forEach(function(r) { labels.push({ t: "river", x: r.x, y: r.y, pts: r.pts, s: r.s, box: [r.x - 40, r.y - 30, r.x + 40, r.y + 30] }); });
    ch.s2 = { roads: roads, labels: labels };
    return ch;
  }
  function evict() {
    var ks = Object.keys(chunks);
    if (ks.length <= 10) return;
    ks.sort(function(a, b) { return chunks[a].used - chunks[b].used; });
    for (var i = 0; i < ks.length - 10; i++) delete chunks[ks[i]];
  }

  /* ---------- themes ---------- */
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function rampLUT(stops) {
    var lut = new Uint8ClampedArray(256 * 3), cs = stops.map(function(s) { return [s[0], hex(s[1])]; });
    for (var i = 0; i < 256; i++) {
      var t = i / 255, k = 0;
      while (k < cs.length - 2 && t > cs[k + 1][0]) k++;
      var a = cs[k], b = cs[k + 1], u = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
      for (var c = 0; c < 3; c++) lut[i * 3 + c] = a[1][c] + (b[1][c] - a[1][c]) * u;
    }
    return lut;
  }
  var THEMES = {
    survey: {
      paper: "#efe8d5",
      land: [[0, "#cbd9ae"], [0.18, "#dfe2b4"], [0.38, "#e9d9a8"], [0.6, "#d8b48a"], [0.82, "#c49a7c"], [1, "#f2eee8"]],
      water: [[0, "#cfe3e6"], [0.35, "#a9cdd8"], [1, "#7fadc4"]],
      shadow: "#4b4a6a", shadeMix: 0.15, forest: "#b4cf98", forestMix: 0.6, sand: "#f3e7bd", wood: "rgba(62,104,58,.6)",
      contour: "rgba(128,82,50,.5)", index: "rgba(110,66,38,.85)", depth: "rgba(60,120,155,.35)",
      shore: "rgba(40,98,132,.95)", waterline: "rgba(52,112,148,.5)", river: "#3d7ea8",
      road: "#b23a2a", lane: "#8c4a34", track: "rgba(100,58,40,.85)", grid: "rgba(70,55,40,.2)", frame: "#3b3127",
      text: "#2f2820", halo: "rgba(239,232,213,.85)", waterText: "#2b6a8c", regionText: "rgba(70,52,36,.5)",
      peak: "#4a3326", town: "#2f2820", build: "rgba(60,44,34,.85)", glow: false
    },
    relief: {
      paper: "#ece9e1",
      land: [[0, "#b9cba0"], [0.2, "#ccd3a5"], [0.45, "#dacfa6"], [0.7, "#cdb79a"], [0.9, "#e3ddd7"], [1, "#fbfaf8"]],
      water: [[0, "#cddfe4"], [1, "#93b8cc"]],
      shadow: "#3d4a78", shadeMix: 0.34, forest: "#9dbd8c", forestMix: 0.7, sand: "#efe6c8", wood: "rgba(60,95,60,.38)",
      contour: "rgba(110,90,70,.26)", index: "rgba(100,78,58,.5)", depth: "rgba(70,120,150,.25)",
      shore: "rgba(50,100,135,.85)", waterline: "rgba(60,110,140,.35)", river: "#4b86aa",
      road: "#a8402f", lane: "#8a5642", track: "rgba(110,70,50,.7)", grid: "rgba(60,60,70,.16)", frame: "#3a3833",
      text: "#2c2a26", halo: "rgba(236,233,225,.85)", waterText: "#2f6688", regionText: "rgba(60,55,50,.45)",
      peak: "#3e3530", town: "#2c2a26", build: "rgba(50,44,40,.8)", glow: false
    },
    antique: {
      paper: "#eadfc3",
      land: [[0, "#e6dcbd"], [0.5, "#eadfc3"], [1, "#efe6cf"]],
      water: [[0, "#dcd9c2"], [1, "#c4cabb"]],
      shadow: "#5a4630", shadeMix: 0.1, forest: "#d6d6ad", forestMix: 0.55, sand: "#efe3c0", wood: "rgba(70,84,50,.7)",
      contour: "rgba(120,88,56,.0)", index: "rgba(110,80,50,.34)", depth: "rgba(80,90,90,.22)",
      shore: "rgba(58,42,30,.95)", waterline: "rgba(70,70,70,.42)", river: "#4d6672",
      road: "#8a2f1f", lane: "#6b4630", track: "rgba(80,56,40,.85)", grid: "rgba(90,66,40,.18)", frame: "#3a2a1c",
      text: "#33241a", halo: "rgba(234,223,195,.88)", waterText: "#3d5560", regionText: "rgba(90,60,36,.5)",
      peak: "#33241a", town: "#33241a", build: "rgba(60,36,26,.9)", glow: false, hachure: "rgba(74,52,34,.62)", lines: 5
    },
    blueprint: {
      paper: "#163f63",
      land: [[0, "#1a4a72"], [1, "#2a6292"]],
      water: [[0, "#123757"], [1, "#0d2b47"]],
      shadow: "#061a2e", shadeMix: 0.35, forest: "#1c5a7c", forestMix: 0.5, sand: "#24577f", wood: "rgba(170,215,255,.3)",
      contour: "rgba(205,228,255,.4)", index: "rgba(225,240,255,.8)", depth: "rgba(150,200,255,.2)",
      shore: "rgba(240,248,255,.95)", waterline: "rgba(190,220,255,.4)", river: "#bfe0ff",
      road: "#ffd27a", lane: "#e9c98f", track: "rgba(255,220,150,.6)", grid: "rgba(200,225,255,.16)", frame: "#d8ebff",
      text: "#e8f3ff", halo: "rgba(22,63,99,.8)", waterText: "#a9d3ff", regionText: "rgba(220,238,255,.42)",
      peak: "#e8f3ff", town: "#e8f3ff", build: "rgba(232,243,255,.85)", glow: false
    },
    nocturne: {
      paper: "#0e1117",
      land: [[0, "#10151d"], [1, "#1c2230"]],
      water: [[0, "#0a0f17"], [1, "#05080d"]],
      shadow: "#000000", shadeMix: 0.4, forest: "#0f1f1b", forestMix: 0.7, sand: "#161b25", wood: "rgba(90,210,160,.3)",
      contour: "ramp", index: "ramp", depth: "rgba(70,150,190,.22)",
      shore: "rgba(110,225,235,.95)", waterline: "rgba(90,200,220,.35)", river: "#5fd4e6",
      road: "#ff8f6b", lane: "#d98a70", track: "rgba(255,160,120,.55)", grid: "rgba(150,170,210,.1)", frame: "#8e9ab8",
      text: "#e7ecf7", halo: "rgba(14,17,23,.85)", waterText: "#7fd8e8", regionText: "rgba(200,210,240,.32)",
      peak: "#ffd28a", town: "#e7ecf7", build: "rgba(255,214,150,.9)", glow: true,
      ramp: [[0, "#34c7b5"], [0.35, "#6b8cff"], [0.65, "#d16bff"], [1, "#ffbf6b"]]
    },
    ink: {
      paper: "#f5f2ea",
      land: [[0, "#f5f2ea"], [1, "#f5f2ea"]],
      water: [[0, "#e9eef0"], [1, "#dfe7ea"]],
      shadow: "#2a2a2a", shadeMix: 0.0, forest: "#eeede2", forestMix: 0.6, sand: "#f5f2ea", wood: "rgba(20,20,20,.42)",
      contour: "rgba(30,30,30,.5)", index: "rgba(20,20,20,.88)", depth: "rgba(30,30,30,.18)",
      shore: "rgba(20,20,20,.95)", waterline: "rgba(20,20,20,.35)", river: "#1d1d1d",
      road: "#1d1d1d", lane: "#333333", track: "rgba(30,30,30,.7)", grid: "rgba(20,20,20,.14)", frame: "#1d1d1d",
      text: "#1d1d1d", halo: "rgba(245,242,234,.9)", waterText: "#1d1d1d", regionText: "rgba(20,20,20,.38)",
      peak: "#1d1d1d", town: "#1d1d1d", build: "rgba(20,20,20,.9)", glow: false
    }
  };
  function prepTheme(t) {
    if (t._land) return t;
    t._land = rampLUT(t.land); t._water = rampLUT(t.water); t._shadow = hex(t.shadow); t._forest = hex(t.forest); t._sand = hex(t.sand);
    if (t.ramp) {
      var l = rampLUT(t.ramp); t._ramp = [];
      for (var i = 0; i < 8; i++) { var k = Math.round(i / 7 * 255) * 3; t._ramp.push([l[k], l[k + 1], l[k + 2]]); }
    }
    return t;
  }

  /* ---------- the tile renderer ---------- */
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    var c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  function renderTile(q) {
    var STYLE = q.style, T = prepTheme(THEMES[STYLE.theme] || THEMES.survey);
    var x0 = q.x0, x1 = q.x1, k = q.k, c = GRID, i, j, n, m, idx;
    var cA = Math.floor((x0 - 320) / CWU), cB = Math.floor((x1 + 320) / CWU), CH = [], ROADCH = [];
    for (i = cA - 1; i <= cB; i++) { var chk = stage2(i); ROADCH.push(chk); if (i >= cA) CH.push(chk); }

    var gx0 = Math.floor(x0 / c) * c - 2 * c, gy0 = -2 * c;
    var nx = Math.ceil((x1 - gx0) / c) + 3, ny = Math.ceil((WH - gy0) / c) + 3, nn = nx * ny;
    var H = new Float32Array(nn), S = new Float32Array(nn), FF = new Float32Array(nn), CV = new Float32Array(nn), FO = new Uint8Array(nn);
    var gxe = gx0 + nx * c;

    // rivers cut their valleys into the land
    var RIV = [];
    for (m = 0; m < CH.length; m++) {
      var sg = CH[m].segs;
      for (n = 0; n < sg.length; n += 10) {
        var ax = sg[n + 2], ay = sg[n + 3], bx = sg[n + 4], by = sg[n + 5];
        if (Math.max(ax, bx) < gx0 - 60 || Math.min(ax, bx) > gxe + 60) continue;
        RIV.push(n, m);
        var lm = Math.log(sg[n + 8] / RT) * 1.4427, rad = Math.min(36, 13 + 4 * lm);
        var dep = Math.min(0.05, 0.011 + 0.007 * lm) * Math.min(1, sg[n + 9] / 0.045);
        if (dep <= 0) continue;
        var i0 = Math.max(0, Math.floor((Math.min(ax, bx) - rad - gx0) / c)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + rad - gx0) / c));
        var j0 = Math.max(0, Math.floor((Math.min(ay, by) - rad - gy0) / c)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + rad - gy0) / c));
        var vx = bx - ax, vy = by - ay, vv = vx * vx + vy * vy || 1;
        for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) {
          var qx = gx0 + i * c - ax, qy = gy0 + j * c - ay, tt = Math.max(0, Math.min(1, (qx * vx + qy * vy) / vv));
          var d = Math.hypot(qx - vx * tt, qy - vy * tt);
          if (d < rad) { var v = 1 - d / rad; v = dep * v * v; idx = j * nx + i; if (v > CV[idx]) CV[idx] = v; }
        }
      }
    }
    // lake levels, gathered from the chunks that own them
    var lg0 = Math.floor(gx0 / HC) - 2, lw = Math.ceil(nx * c / HC) + 6, LKT = new Float32Array(lw * NYW), LKF = new Uint8Array(lw * NYW);
    for (i = 0; i < lw; i++) {
      var gi = lg0 + i, cc = Math.floor(gi / CW), own = chunks[cc] || stage1(cc);
      for (j = 0; j < NYW; j++) {
        var oq = j * NXW + (gi - own.gi0);
        LKT[j * lw + i] = Math.max(0, own.W[oq]);
        if (own.LK[oq] > 0) for (var ej = Math.max(0, j - 1); ej <= Math.min(NYW - 1, j + 1); ej++) for (var ei = Math.max(0, i - 1); ei <= Math.min(lw - 1, i + 1); ei++) LKF[ej * lw + ei] = 1;
      }
    }
    var cover = STYLE.cover !== false;
    for (i = 0; i < nx; i++) {
      var x = gx0 + i * c, col = colOf(x), li = Math.floor(x / HC) - lg0;
      var FN = noiseFor(col.t >= 0.5 ? col.B.seed : col.A.seed);
      for (j = 0; j < ny; j++) {
        var y = gy0 + j * c; idx = j * nx + i;
        var hu = elev(col, x, y), h = hu - CV[idx], lj = Math.floor(y / HC) - GJ0, lv = 0;
        if (lj >= 0 && lj < NYW - 1) {
          var lb = lj * lw + li;
          if (LKF[lb] | LKF[lb + 1] | LKF[lb + lw] | LKF[lb + lw + 1]) {
            // the water surface, interpolated so shores follow the land rather than the grid
            var fx = x / HC - Math.floor(x / HC), fy = y / HC - Math.floor(y / HC);
            lv = Math.max(0, (LKT[lb] * (1 - fx) + LKT[lb + 1] * fx) * (1 - fy) + (LKT[lb + lw] * (1 - fx) + LKT[lb + lw + 1] * fx) * fy - 0.0022);
          }
        }
        // lakes are judged on the uncut land, so a river's valley cannot leak the lake along it
        if (lv > 0 && hu < lv) { H[idx] = hu; FF[idx] = hu - lv; S[idx] = lv; continue; }
        H[idx] = h; FF[idx] = lv > 0 ? Math.min(h, hu - lv) : h; S[idx] = lv;
        if (cover && FF[idx] > 0.008 && h < 0.33) {
          var fv = FN.fbm(x * 0.0042 + 90, y * 0.0042 - 40, 3) + FN.s2(x * 0.03, y * 0.03) * 0.05 - Math.max(0, h - 0.2) * 1.2;
          if (fv > 0.17) FO[idx] = Math.min(255, (fv - 0.17) * 2600);
        }
      }
    }

    // --- tint + hillshade image ---
    var img = makeCanvas(nx, ny), ic = img.getContext("2d"), id = ic.createImageData(nx, ny), dt = id.data;
    var st = STYLE.shade / 100, ZS = 190, L0 = -0.55, L1 = -0.62, L2 = 0.56;
    var sh = T._shadow, mix = T.shadeMix, fc = T._forest, fm = T.forestMix, sc = T._sand;
    for (j = 0; j < ny; j++) {
      var ja = Math.max(0, j - 1), jb = Math.min(ny - 1, j + 1);
      for (i = 0; i < nx; i++) {
        idx = j * nx + i;
        var hh = H[idx], sv = S[idx], F = FF[idx], p = idx * 4, r, g, b, lut, ll;
        if (F < 0) {
          ll = Math.min(255, Math.max(0, (-F / 0.28) * 255)) | 0;
          lut = T._water; r = lut[ll * 3]; g = lut[ll * 3 + 1]; b = lut[ll * 3 + 2];
        } else {
          ll = Math.min(255, Math.max(0, (hh / 0.46) * 255)) | 0;
          lut = T._land; r = lut[ll * 3]; g = lut[ll * 3 + 1]; b = lut[ll * 3 + 2];
          if (FO[idx]) { var fa = FO[idx] / 255 * fm; r += (fc[0] - r) * fa; g += (fc[1] - g) * fa; b += (fc[2] - b) * fa; }
          else if (sv === 0 && F < 0.006) { var sa = (1 - F / 0.006) * 0.7; r += (sc[0] - r) * sa; g += (sc[1] - g) * sa; b += (sc[2] - b) * sa; }
          var ia = Math.max(0, i - 1), ib = Math.min(nx - 1, i + 1);
          var e1 = j * nx + ib, e0 = j * nx + ia, s1 = jb * nx + i, s0 = ja * nx + i;
          var dx = ((FF[e1] < 0 ? S[e1] : H[e1]) - (FF[e0] < 0 ? S[e0] : H[e0])) * ZS / ((ib - ia) * c);
          var dy = ((FF[s1] < 0 ? S[s1] : H[s1]) - (FF[s0] < 0 ? S[s0] : H[s0])) * ZS / ((jb - ja) * c);
          var inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
          var lam = Math.max(0, (-dx * L0 - dy * L1 + L2) * inv) / 0.84; // 1 = flat
          var f = 1 + st * (lam - 1) * 0.85;
          var mm = Math.max(0, 1 - lam) * st * mix;
          r = r * f * (1 - mm) + sh[0] * mm; g = g * f * (1 - mm) + sh[1] * mm; b = b * f * (1 - mm) + sh[2] * mm;
        }
        dt[p] = r; dt[p + 1] = g; dt[p + 2] = b; dt[p + 3] = 255;
      }
    }
    ic.putImageData(id, 0, 0);
    var cv = makeCanvas(Math.ceil((x1 - x0) * k), Math.ceil(WH * k)), ctx = cv.getContext("2d");
    ctx.setTransform(k, 0, 0, k, -x0 * k, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(x0, 0, x1 - x0, WH);
    ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, gx0 - c / 2, gy0 - c / 2, nx * c, ny * c);

    // --- isolines (marching squares, batched into paths) ---
    var iv = STYLE.interval;
    var P = { contour: [], index: [], depth: [], shore: [], wl: [] }, CL = [];
    for (n = 0; n < 8; n++) { P.contour[n] = []; P.index[n] = []; }
    function iso(a, b, cc2, dd, lv, X, Y, arr) {
      // corners: a=(X,Y) b=(X+c,Y) cc2=(X+c,Y+c) dd=(X,Y+c)
      var code = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (cc2 > lv ? 2 : 0) | (dd > lv ? 1 : 0);
      if (code === 0 || code === 15) return;
      var tx = X + c * (lv - a) / (b - a), ty = Y;
      var rx = X + c, ry = Y + c * (lv - b) / (cc2 - b);
      var ux = X + c * (lv - dd) / (cc2 - dd), uy = Y + c;
      var lx = X, ly = Y + c * (lv - a) / (dd - a);
      switch (code) {
        case 1: case 14: arr.push(lx, ly, ux, uy); break;
        case 2: case 13: arr.push(ux, uy, rx, ry); break;
        case 3: case 12: arr.push(lx, ly, rx, ry); break;
        case 4: case 11: arr.push(tx, ty, rx, ry); break;
        case 6: case 9: arr.push(tx, ty, ux, uy); break;
        case 7: case 8: arr.push(lx, ly, tx, ty); break;
        case 5: arr.push(lx, ly, tx, ty, ux, uy, rx, ry); break;
        case 10: arr.push(tx, ty, rx, ry, lx, ly, ux, uy); break;
      }
    }
    var ix0 = Math.max(0, Math.floor((x0 - gx0) / c) - 1), ix1 = Math.min(nx - 1, Math.ceil((x1 - gx0) / c) + 1);
    for (j = 0; j < ny - 1; j++) {
      var Y = gy0 + j * c;
      for (i = ix0; i < ix1; i++) {
        var X = gx0 + i * c, i00 = j * nx + i, i10 = i00 + 1, i11 = i00 + nx + 1, i01 = i00 + nx;
        var A = H[i00], B = H[i10], C = H[i11], D = H[i01];
        var FA = FF[i00], FB = FF[i10], FC = FF[i11], FD = FF[i01];
        var flo = Math.min(FA, FB, FC, FD), fhi = Math.max(FA, FB, FC, FD);
        if (flo < 0) {
          if (fhi > 0) iso(FA, FB, FC, FD, 0, X, Y, P.shore);
          if (flo < -0.012 && fhi > -0.03) { iso(FA, FB, FC, FD, -0.012, X, Y, P.wl); iso(FA, FB, FC, FD, -0.028, X, Y, P.wl); if (T.lines) { iso(FA, FB, FC, FD, -0.05, X, Y, P.wl); iso(FA, FB, FC, FD, -0.078, X, Y, P.wl); } }
          for (var l = Math.ceil(flo / iv); l <= Math.min(-1, Math.floor(fhi / iv)); l++) if ((l & 1) === 0) iso(FA, FB, FC, FD, l * iv, X, Y, P.depth);
        }
        if (fhi <= 0) continue;
        var lo = Math.min(A, B, C, D), hi = Math.max(A, B, C, D);
        var wet = flo < 0 ? Math.max(S[i00], S[i10], S[i11], S[i01]) : 0;
        for (var l2 = Math.max(1, Math.ceil(lo / iv)); l2 <= Math.floor(hi / iv); l2++) {
          var lv2 = l2 * iv;
          if (lv2 <= wet) continue;
          var band = Math.min(7, Math.floor(lv2 / 0.46 * 8));
          if (l2 % 5 === 0) {
            var arr = P.index[band], before = arr.length;
            iso(A, B, C, D, lv2, X, Y, arr);
            // an index contour crossing a label line may carry its height
            for (n = before; n < arr.length; n += 4) {
              var ph = 70 + ((l2 * 53) % 60), sa2 = arr[n], sb2 = arr[n + 2];
              var ka = Math.floor((sa2 - ph) / 130), kb = Math.floor((sb2 - ph) / 130);
              if (ka !== kb) CL.push((sa2 + sb2) / 2, (arr[n + 1] + arr[n + 3]) / 2, Math.atan2(arr[n + 3] - arr[n + 1], sb2 - sa2), l2, Math.max(ka, kb));
            }
          } else iso(A, B, C, D, lv2, X, Y, P.contour[band]);
        }
      }
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    var px = 1 / q.scale;
    function strokeSegs(arr, style, w) {
      if (!arr.length) return;
      ctx.beginPath();
      for (var n = 0; n < arr.length; n += 4) { ctx.moveTo(arr[n], arr[n + 1]); ctx.lineTo(arr[n + 2], arr[n + 3]); }
      ctx.strokeStyle = style; ctx.lineWidth = w * px; ctx.stroke();
    }
    function bandStyle(base, n, a) { if (base !== "ramp") return base; var cq = T._ramp[n]; return "rgba(" + cq[0] + "," + cq[1] + "," + cq[2] + "," + a + ")"; }
    strokeSegs(P.depth, T.depth, 0.6);
    for (n = 0; n < 8; n++) {
      if (T.glow) strokeSegs(P.contour[n], bandStyle(T.contour, n, 0.16), 2.6);
      strokeSegs(P.contour[n], bandStyle(T.contour, n, 0.55), 0.6);
    }
    for (n = 0; n < 8; n++) {
      if (T.glow) strokeSegs(P.index[n], bandStyle(T.index, n, 0.22), 4);
      strokeSegs(P.index[n], bandStyle(T.index, n, 1), 1.1);
    }
    function at(xx, yy) { var ii = Math.round((xx - gx0) / c), jj = Math.round((yy - gy0) / c); return (ii < 1 || jj < 1 || ii >= nx - 1 || jj >= ny - 1) ? -1 : jj * nx + ii; }

    // --- hachures: short strokes down the slope, heavier on the shaded side ---
    if (T.hachure) {
      var hs = 6.5;
      for (var pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (var hi2 = Math.floor(x0 / hs); hi2 <= Math.ceil(x1 / hs); hi2++) for (var hj = 3; hj < WH / hs - 3; hj++) {
          var hx = (hi2 + hash3(hi2, hj, 201)) * hs, hy = (hj + hash3(hj, hi2, 202)) * hs, a0 = at(hx, hy);
          if (a0 < 0 || FF[a0] <= 0.004) continue;
          var gxx = (H[a0 + 1] - H[a0 - 1]) / (2 * c), gyy = (H[a0 + nx] - H[a0 - nx]) / (2 * c), gl = Math.hypot(gxx, gyy);
          if (gl < 0.0007) continue;
          var shade = (gxx * 0.66 + gyy * 0.75) / gl < 0 ? 1 : 0;      // facing away from the north-west light
          if (shade !== pass) continue;
          var len = Math.min(8, 2 + gl * 2200), ux2 = -gxx / gl, uy2 = -gyy / gl;
          ctx.moveTo(hx - ux2 * len / 2, hy - uy2 * len / 2); ctx.lineTo(hx + ux2 * len / 2, hy + uy2 * len / 2);
        }
        ctx.strokeStyle = T.hachure; ctx.lineWidth = (pass ? 1.15 : 0.55) * px; ctx.stroke();
      }
    }

    // --- land cover symbols ---
    if (cover) {
      var ts = 11;
      ctx.beginPath();
      for (var ti = Math.floor(x0 / ts) - 1; ti <= Math.ceil(x1 / ts); ti++) for (var tj = 3; tj < WH / ts - 2; tj++) {
        var tx = (ti + hash3(ti, tj, 301)) * ts, ty = (tj + hash3(tj, ti, 302)) * ts, a1 = at(tx, ty);
        if (a1 < 0 || FO[a1] < 120) continue;
        if (H[a1] > 0.15 + hash3(ti, tj, 303) * 0.05) {              // conifers on the higher ground
          ctx.moveTo(tx - 1.7, ty + 1.6); ctx.lineTo(tx, ty - 2.4); ctx.lineTo(tx + 1.7, ty + 1.6);
        } else { ctx.moveTo(tx + 1.4, ty); ctx.arc(tx, ty, 1.4, 0.6, 5.6); }
      }
      ctx.strokeStyle = T.wood; ctx.lineWidth = 0.7 * px; ctx.stroke();
      var ms = 13;
      ctx.beginPath();
      for (var mi = Math.floor(x0 / ms) - 1; mi <= Math.ceil(x1 / ms); mi++) for (var mj = 3; mj < WH / ms - 2; mj++) {
        var mx2 = (mi + hash3(mi, mj, 311)) * ms, my = (mj + hash3(mj, mi, 312)) * ms, a2 = at(mx2, my);
        if (a2 < 0 || FO[a2]) continue;
        var fz = FF[a2];
        if (fz < 0.0006 || fz > 0.011 || hash3(mi, mj, 313) > 0.75) continue;
        if (Math.abs(H[a2 + 2] - H[a2 - 2]) + Math.abs(H[a2 + 2 * nx] - H[a2 - 2 * nx]) > 0.012) continue;
        ctx.moveTo(mx2 - 3, my); ctx.lineTo(mx2 + 3, my);
        ctx.moveTo(mx2 - 1.4, my); ctx.lineTo(mx2 - 2, my - 2.2); ctx.moveTo(mx2, my); ctx.lineTo(mx2, my - 2.8); ctx.moveTo(mx2 + 1.4, my); ctx.lineTo(mx2 + 2, my - 2.2);
      }
      ctx.strokeStyle = T.waterline; ctx.lineWidth = 0.7 * px; ctx.stroke();
    }

    // --- water lines ---
    strokeSegs(P.wl, T.waterline, 0.6);
    if (T.glow) strokeSegs(P.shore, "rgba(110,225,235,.18)", 4.5);
    strokeSegs(P.shore, T.shore, 1.25);
    if (STYLE.rivers) {
      var RW = [[], [], [], [], [], []];
      for (n = 0; n < RIV.length; n += 2) {
        var o = RIV[n], g2 = CH[RIV[n + 1]].segs, wcl = Math.max(0, Math.min(5, Math.floor(Math.log(g2[o + 8] / RT) * 1.4427 * 0.8)));
        RW[wcl].push(o, RIV[n + 1]);
      }
      for (m = 0; m < 6; m++) {
        if (!RW[m].length) continue;
        ctx.beginPath();
        for (n = 0; n < RW[m].length; n += 2) {
          var o2 = RW[m][n], s = CH[RW[m][n + 1]].segs;
          ctx.moveTo(s[o2 + 2], s[o2 + 3]);
          ctx.bezierCurveTo(s[o2 + 2] + (s[o2 + 4] - s[o2]) / 6, s[o2 + 3] + (s[o2 + 5] - s[o2 + 1]) / 6,
            s[o2 + 4] - (s[o2 + 6] - s[o2 + 2]) / 6, s[o2 + 5] - (s[o2 + 7] - s[o2 + 3]) / 6, s[o2 + 4], s[o2 + 5]);
        }
        ctx.strokeStyle = T.river; ctx.lineWidth = (0.75 + m * 0.5) * px; ctx.stroke();
      }
    }

    // --- settlements and roads ---
    var towns = [], peaks = [], lights = [];
    for (m = 0; m < CH.length; m++) {
      CH[m].towns.forEach(function(t) { if (t.x > x0 - 60 && t.x < x1 + 60) towns.push(t); });
      CH[m].peaks.forEach(function(t) { if (t.x > x0 - 20 && t.x < x1 + 20) peaks.push(t); });
      CH[m].lights.forEach(function(t) { if (t.x > x0 - 20 && t.x < x1 + 20) lights.push(t); });
    }
    if (STYLE.towns) {
      ctx.fillStyle = T.build;
      towns.forEach(function(t) {
        var R = t.cls === 2 ? 30 : t.cls === 1 ? 17 : 9, sp = 4.4, ca = Math.cos(t.ang), sa3 = Math.sin(t.ang), nn2 = Math.ceil(R / sp);
        for (var u = -nn2; u <= nn2; u++) for (var w = -nn2; w <= nn2; w++) {
          var gi2 = Math.round(t.x) + u * 7, gj2 = Math.round(t.y) + w * 13;
          var lx = (u + (hash3(gi2, gj2, 401) - 0.5) * 0.5) * sp, ly = (w + (hash3(gj2, gi2, 402) - 0.5) * 0.5) * sp;
          var dd = Math.hypot(lx, ly * 1.25) / R;
          if (dd > 1 || hash3(gi2, gj2, 403) > (1 - dd) * 1.15 + 0.08) continue;
          if (t.cls === 2 && (u % 4 === 0 || w % 3 === 0) && dd > 0.12) continue;       // streets
          var bx2 = t.x + lx * ca - ly * sa3, by2 = t.y + lx * sa3 + ly * ca, a3 = at(bx2, by2);
          if (a3 < 0 || FF[a3] < 0.002) continue;
          var bw = 2.3 + hash3(gi2, gj2, 404) * 1.6, bh = 1.9 + hash3(gi2, gj2, 405);
          ctx.setTransform(k, 0, 0, k, -x0 * k, 0); ctx.translate(bx2, by2); ctx.rotate(t.ang);
          ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        }
      });
      ctx.setTransform(k, 0, 0, k, -x0 * k, 0);
    }
    if (STYLE.roads) {
      var RD = [[], [], []], bridges = [];
      ROADCH.forEach(function(chq) {
        chq.s2.roads.forEach(function(rd) { if (rd.x1 > x0 - 20 && rd.x0 < x1 + 20) { RD[rd.cls].push(rd); for (var u = 0; u < rd.bridges.length; u += 3) bridges.push(rd.bridges[u], rd.bridges[u + 1], rd.bridges[u + 2], rd.cls); } });
      });
      var trace = function(list) {
        ctx.beginPath();
        list.forEach(function(rd) { ctx.moveTo(rd.xs[0], rd.ys[0]); for (var u = 1; u < rd.xs.length; u++) ctx.lineTo(rd.xs[u], rd.ys[u]); });
      };
      ctx.lineCap = "butt";
      trace(RD[2]); ctx.setLineDash([3.2 * px, 2.6 * px]); ctx.strokeStyle = T.track; ctx.lineWidth = 0.9 * px; ctx.stroke(); ctx.setLineDash([]);
      ctx.lineCap = "round";
      trace(RD[1]); ctx.strokeStyle = T.halo; ctx.lineWidth = 2.4 * px; ctx.stroke(); ctx.strokeStyle = T.lane; ctx.lineWidth = 1.0 * px; ctx.stroke();
      trace(RD[0]); ctx.strokeStyle = T.frame; ctx.lineWidth = 2.9 * px; ctx.stroke(); ctx.strokeStyle = T.road; ctx.lineWidth = 1.7 * px; ctx.stroke();
      ctx.lineCap = "butt";
      for (n = 0; n < bridges.length; n += 4) {
        if (bridges[n + 3] === 2) continue;
        var ca2 = Math.cos(bridges[n + 2]), sa4 = Math.sin(bridges[n + 2]), bl = 3.4 * px, off = 2.3 * px;
        ctx.beginPath();
        for (var sd2 = -1; sd2 <= 1; sd2 += 2) {
          var ox = bridges[n] - sa4 * off * sd2, oy = bridges[n + 1] + ca2 * off * sd2;
          ctx.moveTo(ox - ca2 * bl - sa4 * sd2 * px, oy - sa4 * bl + ca2 * sd2 * px); ctx.lineTo(ox - ca2 * bl * 0.7, oy - sa4 * bl * 0.7);
          ctx.lineTo(ox + ca2 * bl * 0.7, oy + sa4 * bl * 0.7); ctx.lineTo(ox + ca2 * bl - sa4 * sd2 * px, oy + sa4 * bl + ca2 * sd2 * px);
        }
        ctx.strokeStyle = T.frame; ctx.lineWidth = 0.9 * px; ctx.stroke();
      }
    }
    if (STYLE.towns) {
      towns.forEach(function(t) {
        if (t.cls !== 0) return;
        ctx.beginPath(); ctx.arc(t.x, t.y, 2.3, 0, 6.2832); ctx.fillStyle = T.halo; ctx.fill();
        ctx.strokeStyle = T.town; ctx.lineWidth = 1 * px; ctx.stroke();
      });
      lights.forEach(function(t) {
        ctx.beginPath();
        for (var u = 0; u < 8; u++) { var an = u * Math.PI / 4; ctx.moveTo(t.x + Math.cos(an) * 3.2, t.y + Math.sin(an) * 3.2); ctx.lineTo(t.x + Math.cos(an) * 6, t.y + Math.sin(an) * 6); }
        ctx.strokeStyle = T.road; ctx.lineWidth = 0.8 * px; ctx.stroke();
        ctx.beginPath(); ctx.arc(t.x, t.y, 2, 0, 6.2832); ctx.fillStyle = T.road; ctx.fill();
      });
    }
    if (STYLE.peaks) {
      ctx.fillStyle = T.peak;
      peaks.forEach(function(t) { ctx.beginPath(); ctx.moveTo(t.x, t.y - 4.5); ctx.lineTo(t.x + 4, t.y + 2.5); ctx.lineTo(t.x - 4, t.y + 2.5); ctx.closePath(); ctx.fill(); });
    }

    // --- graticule and neatline ---
    ctx.lineCap = "butt";
    if (STYLE.grid) {
      ctx.beginPath();
      for (var gx = Math.ceil(x0 / 250) * 250; gx <= x1; gx += 250) { ctx.moveTo(gx, 20); ctx.lineTo(gx, WH - 20); }
      for (var gy = 250; gy < WH; gy += 250) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
      ctx.strokeStyle = T.grid; ctx.lineWidth = 0.6 * px; ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x0, 14); ctx.lineTo(x1, 14); ctx.moveTo(x0, WH - 14); ctx.lineTo(x1, WH - 14);
    ctx.strokeStyle = T.frame; ctx.lineWidth = 1.2 * px; ctx.stroke();
    ctx.beginPath();
    for (var tk = Math.ceil(x0 / 50) * 50; tk <= x1; tk += 50) {
      var tl = tk % 250 === 0 ? 9 : 5;
      ctx.moveTo(tk, 14); ctx.lineTo(tk, 14 + tl); ctx.moveTo(tk, WH - 14); ctx.lineTo(tk, WH - 14 - tl);
    }
    ctx.lineWidth = 0.8 * px; ctx.stroke();

    // --- labels: placed here, lettered on the main thread where the map fonts live ---
    var LB = [], boxes = [];
    function hit(bx) { for (var u = 0; u < boxes.length; u++) { var o3 = boxes[u]; if (bx[0] < o3[2] && bx[2] > o3[0] && bx[1] < o3[3] && bx[3] > o3[1]) return true; } return false; }
    CH.forEach(function(chq) {
      chq.s2.labels.forEach(function(lb) {
        if (lb.box[2] < x0 - 40 || lb.box[0] > x1 + 40) return;
        if (lb.t === "town" && !STYLE.towns) return;
        if (lb.t === "peak" && !STYLE.peaks) return;
        if ((lb.t === "river" && !STYLE.rivers) || ((lb.t === "lake" || lb.t === "river") && !STYLE.towns)) return;
        LB.push(lb); boxes.push(lb.box);
      });
    });
    if (STYLE.towns) {
      var WC = 520;
      for (var ci = Math.floor((x0 - 420) / WC); ci <= Math.floor((x1 + 420) / WC); ci++) for (var cj = 0; cj < 2; cj++) {
        var sd3 = seedAt(ci * WC);
        var wx = (ci + 0.2 + 0.6 * hash3(ci, cj, sd3 + 21)) * WC, wy = 180 + cj * 420 + hash3(ci, cj, sd3 + 22) * 200;
        var depth = -elevAt(wx, wy);
        if (depth < 0.07) continue;
        var nm = placeName(hash3(ci, cj, sd3 + 23), hash3(cj, ci, sd3 + 24)), kind = hash3(ci, cj, sd3 + 25);
        var text = depth > 0.17 ? (kind < 0.5 ? "Gulf of " + nm : nm + " Deep") : (kind < 0.35 ? nm + " Sound" : kind < 0.7 ? nm + " Bay" : nm + " Roads");
        var wb = [wx - text.length * 5.6, wy - 13, wx + text.length * 5.6, wy + 5];
        if (hit(wb)) continue;
        LB.push({ t: "sea", x: wx, y: wy, s: text }); boxes.push(wb);
      }
      // soundings, as on a chart
      var SS = 104;
      for (var si = Math.floor((x0 - 30) / SS); si <= Math.floor((x1 + 30) / SS); si++) for (var sj = 0; sj < WH / SS; sj++) {
        if (hash3(si, sj, 501) > 0.55) continue;
        var sx = (si + 0.15 + 0.7 * hash3(si, sj, 502)) * SS, sy = (sj + 0.15 + 0.7 * hash3(sj, si, 503)) * SS;
        if (sy < 40 || sy > WH - 40) continue;
        var dp = -elevAt(sx, sy);
        if (dp < 0.035) continue;
        var sbx = [sx - 9, sy - 8, sx + 9, sy + 3];
        if (!hit(sbx)) LB.push({ t: "snd", x: sx, y: sy, s: String(Math.round(dp * 420)) });
      }
      for (var rc = Math.floor((x0 - 900) / 2600); rc <= Math.floor((x1 + 900) / 2600); rc++) {
        var rx2 = (rc + 0.5) * 2600;
        LB.push({ t: "region", x: rx2, y: 66, s: regionName(rx2).toUpperCase() });
      }
    }
    // contour heights
    if (STYLE.peaks) {
      var lastK = {}, cands = [];
      for (n = 0; n < CL.length; n += 5) cands.push(n);
      cands.sort(function(a, b) { return CL[a + 1] - CL[b + 1]; });
      cands.forEach(function(o4) {
        var cx = CL[o4], cy = CL[o4 + 1], an = CL[o4 + 2], lvl = CL[o4 + 3], kk = CL[o4 + 4];
        if (an > Math.PI / 2) an -= Math.PI; else if (an < -Math.PI / 2) an += Math.PI;
        var ph = 70 + ((lvl * 53) % 60), lineX = ph + kk * 130, md = ((lineX % 400) + 400) % 400;
        if (md < 26 || md > 374 || Math.abs(an) > 1.05 || cy < 60 || cy > WH - 50) return;
        if (hash3(kk, Math.floor(cy / 40), lvl + 601) > 0.42) return;
        var key = kk + ":" + lvl;
        if (lastK[kk] !== undefined && cy - lastK[kk] < 70) return;
        var cb = [cx - 12, cy - 9, cx + 12, cy + 9];
        if (hit(cb)) return;
        lastK[kk] = cy; boxes.push(cb);
        LB.push({ t: "cont", x: cx, y: cy, a: an, s: String(Math.round(lvl * iv * 3600 / 10) * 10), band: Math.min(7, Math.floor(lvl * iv / 0.46 * 8)) });
      });
    }
    for (var tx3 = Math.ceil((x0 - 60) / 500) * 500; tx3 <= x1 + 60; tx3 += 500) {
      var deg = tx3 / 6000, Dg = Math.floor(deg), Mn = Math.floor((deg - Dg) * 60);
      LB.push({ t: "coord", x: tx3, y: WH - 3, s: (12 + Dg) + "°" + (Mn < 10 ? "0" : "") + Mn + "′ E" });
    }
    evict();
    var out = { img: cv.transferToImageBitmap ? cv.transferToImageBitmap() : cv, labels: LB, minX: minX, maxX: maxX };
    return scope ? { result: out, transfer: [out.img] } : out;
  }

  /* ---------- lettering (main thread) ---------- */
  function drawLabels(ctx, LB, STYLE, scale) {
    var T = prepTheme(THEMES[STYLE.theme] || THEMES.survey), px = 1 / scale, halo = T.halo;
    function put(text, x, y, font, color, align, spacing) {
      ctx.font = font; ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3 * px; ctx.strokeStyle = halo; ctx.lineJoin = "round";
      if (spacing) {
        var total = 0, ws = [], n;
        for (n = 0; n < text.length; n++) { ws.push(ctx.measureText(text[n]).width); total += ws[n] + (n ? spacing : 0); }
        var cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
        ctx.textAlign = "left";
        for (n = 0; n < text.length; n++) { ctx.strokeText(text[n], cx, y); ctx.fillStyle = color; ctx.fillText(text[n], cx, y); cx += ws[n] + spacing; }
        return;
      }
      ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
    }
    function along(text, pts, font, color, spacing, lift) {
      ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      var n = pts.length / 2, i, P = [];
      if (pts[pts.length - 2] < pts[0]) { for (i = n - 1; i >= 0; i--) P.push(pts[i * 2], pts[i * 2 + 1]); } else P = pts;
      // soften the polyline, then walk it by arc length
      var Q = [P[0], P[1]];
      for (i = 1; i < n - 1; i++) Q.push((P[i * 2 - 2] + 2 * P[i * 2] + P[i * 2 + 2]) / 4, (P[i * 2 - 1] + 2 * P[i * 2 + 1] + P[i * 2 + 3]) / 4);
      Q.push(P[n * 2 - 2], P[n * 2 - 1]);
      var cum = [0];
      for (i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(Q[i * 2] - Q[i * 2 - 2], Q[i * 2 + 1] - Q[i * 2 - 1]));
      var ws = [], total = 0;
      for (i = 0; i < text.length; i++) { ws.push(ctx.measureText(text[i]).width); total += ws[i] + spacing; }
      var len = cum[n - 1];
      if (total > len * 0.96) return;
      var s = (len - total) / 2, seg = 1;
      ctx.lineWidth = 3 * px; ctx.strokeStyle = halo; ctx.lineJoin = "round";
      for (i = 0; i < text.length; i++) {
        var mid = s + ws[i] / 2;
        while (seg < n - 1 && cum[seg] < mid) seg++;
        var u = (mid - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
        var ax = Q[seg * 2 - 2], ay = Q[seg * 2 - 1], bx = Q[seg * 2], by = Q[seg * 2 + 1];
        ctx.save();
        ctx.translate(ax + (bx - ax) * u, ay + (by - ay) * u); ctx.rotate(Math.atan2(by - ay, bx - ax));
        ctx.strokeText(text[i], 0, -lift); ctx.fillStyle = color; ctx.fillText(text[i], 0, -lift);
        ctx.restore();
        s += ws[i] + spacing;
      }
    }
    var serif = STYLE.fontSerif, sc = STYLE.fontSerifSC, sans = STYLE.fontSans, order = ["region", "snd", "cont", "sea", "lake", "river", "peak", "town", "coord"];
    order.forEach(function(kind) {
      LB.forEach(function(l) {
        if (l.t !== kind) return;
        if (kind === "town") {
          if (l.c === 2) put(l.s, l.x + l.dx, l.y + l.dy, "600 13.5px " + sans, T.text, l.al, 1.6);
          else if (l.c === 1) put(l.s, l.x + l.dx, l.y + l.dy, "600 12.5px " + sans, T.text, l.al);
          else put(l.s, l.x + l.dx, l.y + l.dy, "10.5px " + sans, T.text, l.al);
        } else if (kind === "peak") {
          if (l.n) put(l.n, l.x + l.dx, l.y + l.dy, "italic 11px " + serif, T.peak, l.al);
          put(l.s, l.x + l.dx, l.y + l.dy + (l.n ? 10 : 0), "italic 10px " + serif, T.peak, l.al);
        } else if (kind === "lake") put(l.s, l.x, l.y, "italic " + (l.size || 12) + "px " + serif, T.waterText, "center", 1.2);
        else if (kind === "sea") put(l.s, l.x, l.y, "italic 15px " + serif, T.waterText, "center", 2.2);
        else if (kind === "river") along(l.s, l.pts, "italic 11px " + serif, T.waterText, 1.6, 3.2);
        else if (kind === "snd") { ctx.font = "italic 8.5px " + serif; ctx.textAlign = "center"; ctx.fillStyle = T.waterText; ctx.globalAlpha = 0.6; ctx.fillText(l.s, l.x, l.y); ctx.globalAlpha = 1; }
        else if (kind === "cont") {
          ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.a);
          var col = T.index === "ramp" ? "rgb(" + T._ramp[l.band].join(",") + ")" : T.index;
          ctx.font = "8.5px " + sans; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.lineWidth = 3.5 * px; ctx.strokeStyle = STYLE.theme === "antique" ? T.paper : halo; ctx.lineJoin = "round";
          ctx.strokeText(l.s, 0, 0); ctx.fillStyle = col; ctx.fillText(l.s, 0, 0);
          ctx.restore();
        } else if (kind === "region") put(l.s, l.x, l.y, "24px " + sc, T.regionText, "center", 9);
        else if (kind === "coord") { ctx.font = "10px " + sans; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = T.frame; ctx.fillText(l.s, l.x, l.y); }
      });
    });
  }

  return {
    setTerrain: setTerrain, renderTile: renderTile, drawLabels: drawLabels, regionName: regionName,
    paper: function(theme) { return (THEMES[theme] || THEMES.survey).paper; },
    BLEND: BLEND, WH: WH
  };
}
