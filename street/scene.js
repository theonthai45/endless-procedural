/* ===== Endless Street: ground, gaps, street furniture and the tile renderer ===== */
var TREES = { singapore: "#3f7a3c", paris: "#6e8f3f", brooklyn: "#557f3a", london: "#5c8046", lisbon: "#6a8a3a" };
function drawTree(ctx, r, x, base, size, leaf) {
  R(ctx, x - 3, base - size * 1.1, 6, size * 1.1, L("#5a4332"));
  var tones = [L(leaf, 0.78), L(leaf), L(leaf, 1.12)];
  for (var t = 0; t < 3; t++) {
    ctx.fillStyle = tones[t];
    for (var c = 0; c < 6; c++) {
      ctx.beginPath();
      ctx.arc(x + rr(r, -size * 0.7, size * 0.7) * (1 - t * 0.2), base - size * 1.25 + rr(r, -size * 0.5, size * 0.35) - t * 4, size * rr(r, 0.32, 0.5), 0, 6.3);
      ctx.fill();
    }
  }
}
function drawPark(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w;
  R(ctx, x, G - 6, w, 6, L("#7a9a52"));
  R(ctx, x + 4, G - 22, w - 8, 3, L("#3b3b3b"));
  ctx.strokeStyle = L("#2b2b2b"); ctx.lineWidth = 1; ctx.beginPath();
  for (var fx = x + 6; fx < x + w - 4; fx += 6) { ctx.moveTo(fx, G - 22); ctx.lineTo(fx, G - 4); }
  ctx.stroke();
  drawTree(ctx, r, x + w * 0.35, G - 4, 52, "#4f7a3a");
  if (w > 130) drawTree(ctx, r, x + w * 0.75, G - 4, 40, "#5d8a41");
  // bench
  R(ctx, x + w * 0.5, G - 16, 28, 3, L("#6b4a2b")); R(ctx, x + w * 0.5 + 2, G - 16, 2, 16, L("#2b2b2b")); R(ctx, x + w * 0.5 + 24, G - 16, 2, 16, L("#2b2b2b"));
}
function drawLamps(ctx, x0, x1) {
  var S = 300;
  for (var k = Math.floor((x0 - 60) / S); k <= Math.floor((x1 + 60) / S); k++) {
    var lx = k * S + 150, d = districtAt(lx);
    if (!d || d.city === "tokyo" || d.city === "hanoi") continue;
    var ornate = d.city !== "singapore";
    R(ctx, lx - 2, KERB - 150, 4, 150, L("#2b2f33"));
    R(ctx, lx - 6, KERB - 14, 12, 14, L("#2b2f33"));
    if (ornate) {
      ctx.fillStyle = L("#2b2f33"); ctx.beginPath(); ctx.moveTo(lx - 9, KERB - 150); ctx.lineTo(lx + 9, KERB - 150); ctx.lineTo(lx + 6, KERB - 172); ctx.lineTo(lx - 6, KERB - 172); ctx.fill();
      R(ctx, lx - 6, KERB - 170, 12, 16, EM("#f6e6bd"));
      ctx.fillStyle = L("#2b2f33"); ctx.beginPath(); ctx.moveTo(lx - 10, KERB - 172); ctx.lineTo(lx, KERB - 182); ctx.lineTo(lx + 10, KERB - 172); ctx.fill();
      nglow(ctx, lx, KERB - 162, 70, "rgb(255,214,140)", 0.55);
    } else {
      R(ctx, lx, KERB - 150, 28, 4, L("#2b2f33"));
      R(ctx, lx + 18, KERB - 147, 14, 4, EM("#f8ecd0"));
      nglow(ctx, lx + 25, KERB - 140, 80, "rgb(255,230,180)", 0.5);
    }
  }
}
function drawTrees(ctx, x0, x1) {
  var S = 420;
  for (var k = Math.floor((x0 - 120) / S); k <= Math.floor((x1 + 120) / S); k++) {
    var h = hash2(k, PLAN.seed), tx = k * S + 60 + h * 220, d = districtAt(tx);
    if (!d || !TREES[d.city] || h > 0.6) continue;
    var r = mulberry32((k * 7331) ^ PLAN.seed);
    var leaf = TREES[d.city];
    drawTree(ctx, r, tx, KERB - 2, d.city === "singapore" ? 70 : 58, leaf);
    R(ctx, tx - 12, KERB - 4, 24, 4, L("#6b5a48"));
  }
}
function polesAndWires(ctx, x0, x1) {
  var S = 230, poles = [];
  for (var k = Math.floor((x0 - S) / S); k <= Math.floor((x1 + S) / S); k++) {
    var px = k * S + 40, d = districtAt(px);
    poles.push({ x: px, ok: !!d && (d.city === "tokyo" || d.city === "hanoi") });
  }
  ctx.lineWidth = 1; ctx.strokeStyle = L("#1d1d1f");
  for (var i = 0; i < poles.length - 1; i++) {
    if (!poles[i].ok || !poles[i + 1].ok) continue;
    var a = poles[i].x, b = poles[i + 1].x;
    ctx.beginPath();
    for (var wv = 0; wv < 4; wv++) {
      var y = KERB - 228 + wv * 9 + (wv > 1 ? 18 : 0), sag = 26 + wv * 3;
      ctx.moveTo(a, y); ctx.quadraticCurveTo((a + b) / 2, y + sag * 2, b, y);
    }
    ctx.stroke();
  }
  for (var j = 0; j < poles.length; j++) {
    if (!poles[j].ok) continue;
    var x = poles[j].x;
    R(ctx, x - 4, KERB - 240, 8, 240, L("#8d8f8a"));
    R(ctx, x - 22, KERB - 230, 44, 3, L("#5d5f5a")); R(ctx, x - 18, KERB - 203, 36, 3, L("#5d5f5a"));
    R(ctx, x + 5, KERB - 190, 12, 18, L("#9a9c97"));
    for (var s = 0; s < 6; s++) R(ctx, x - 7, KERB - 120 + s * 12, 3, 1.5, L("#e8c33a"));
  }
}

/* ---------- ground ---------- */
function drawGround(ctx, x0, x1) {
  PLAN.blocks.forEach(function(B) {
    var a = Math.max(x0, B.x0), bb = Math.min(x1, B.x1 + 1);   // a unit of overlap hides the join between districts
    if (a >= bb) return;
    R(ctx, a, G, bb - a, KERB - G, L("#c9c3b6"));
    ctx.strokeStyle = L("#aaa396"); ctx.lineWidth = 0.8; ctx.beginPath();
    for (var px = Math.ceil(a / 24) * 24; px < bb; px += 24) { ctx.moveTo(px, G); ctx.lineTo(px, KERB); }
    ctx.moveTo(a, G + 22); ctx.lineTo(bb, G + 22); ctx.stroke();
    R(ctx, a, KERB, bb - a, 6, L("#8f8a80"));
    if (B.city === "amsterdam") {
      var g = ctx.createLinearGradient(0, KERB + 6, 0, WH);
      g.addColorStop(0, L("#4d6a73")); g.addColorStop(1, L("#22343b"));
      ctx.fillStyle = g; ctx.fillRect(a, KERB + 6, bb - a, WH - KERB - 6);
      // the canal basin ends in a stone quay
      if (B.x0 >= x0 - 12 && B.x0 <= x1) R(ctx, B.x0, KERB + 6, 10, WH - KERB - 6, L("#77726a"));
      if (B.x1 >= x0 && B.x1 <= x1 + 12) R(ctx, B.x1 - 10, KERB + 6, 10, WH - KERB - 6, L("#77726a"));
    } else {
      R(ctx, a, KERB + 6, bb - a, WH - KERB - 6, L("#3d3f43"));
      R(ctx, a, KERB + 6, bb - a, 3, L("#2c2e31"));
      ctx.fillStyle = L("#e9e3d0", 0.95);
      for (var lx = Math.ceil(a / 60) * 60; lx < bb; lx += 60) ctx.fillRect(lx, 930, 30, 4);
      // tram rails in Lisbon
      if (B.city === "lisbon") { R(ctx, a, 902, bb - a, 1.6, L("#8d9196")); R(ctx, a, 916, bb - a, 1.6, L("#8d9196")); }
    }
  });
}
function canalClip(ctx, x0, x1) {
  var any = false;
  ctx.beginPath();
  PLAN.blocks.forEach(function(B) {
    if (B.city !== "amsterdam") return;
    var a = Math.max(x0, B.x0 + 10), bb = Math.min(x1, B.x1 - 10);
    if (a < bb) { ctx.rect(a, KERB + 6, bb - a, WH - KERB - 6); any = true; }
  });
  return any;
}
function reflections(ctx, x0, x1, items) {
  ctx.save();
  if (!canalClip(ctx, x0, x1)) { ctx.restore(); return; }
  ctx.clip();
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.translate(0, 2 * (KERB + 6)); ctx.scale(1, -1);
  var keepW = WINS; WINS = null; EMIT_ON = false;
  for (var k = 0; k < items.length; k++) if (items[k].type === "amsterdam") DRAW.amsterdam(ctx, items[k]);
  EMIT_ON = true; WINS = keepW;
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 1.2; ctx.beginPath();
  for (var yy = KERB + 14; yy < WH; yy += 9) for (var xx = Math.floor(x0 / 40) * 40; xx < x1; xx += 40) {
    var h = hash2(xx, yy);
    if (h < 0.55) { ctx.moveTo(xx + h * 30, yy); ctx.lineTo(xx + h * 30 + 8 + h * 14, yy); }
  }
  ctx.stroke();
  ctx.restore();
}

/* ---------- what you see down a gap: a far row of fronts, softened by distance ---------- */
var BACK = {
  singapore: ["#bfe0d4", "#f2c8cf", "#f3e3ad", "#c3d6ee"], paris: ["#e6dcc6", "#ddd2ba", "#ece2ce"], amsterdam: ["#9a5546", "#84483a", "#6f5a4c", "#b06a50"],
  tokyo: ["#d5d0c5", "#c4c0b8", "#b3b6b8", "#e2ded6"], brooklyn: ["#8a5a48", "#7a5446", "#9a6a52"], london: ["#b3916a", "#a5845e", "#c4a67c"],
  lisbon: ["#f1cfa8", "#f3dd9a", "#e7b0a8", "#cfe0ea"], hanoi: ["#f0d58a", "#ead9b0", "#d5e3cf", "#f0bfa8"]
};
function backdrop(ctx, r, x, w, base, city) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, VY, w, base - VY + 1); ctx.clip();
  var px = x - rr(r, 0, 20), cols = BACK[city] || BACK.paris;
  while (px < x + w) {
    var bw = rr(r, 34, 64), bh = rr(r, 130, 250), c = pick(r, cols), top = base - bh, kind = r();
    R(ctx, px, top, bw + 0.5, bh, L(c, 0.96));
    if (kind < 0.35) { ctx.fillStyle = L("#8a6a58"); ctx.beginPath(); ctx.moveTo(px - 1, top); ctx.lineTo(px + bw / 2, top - bw * 0.3); ctx.lineTo(px + bw + 1, top); ctx.fill(); }
    else if (kind < 0.6) R(ctx, px, top - 4, bw, 4, L(c, 0.8));
    else { R(ctx, px, top - 14, bw, 14, L("#7d8a97")); }
    var nx = Math.max(2, Math.floor(bw / 13)), cw = bw / nx;
    for (var wy = top + 12; wy < base - 20; wy += 22) for (var i = 0; i < nx; i++) {
      var lit = hash2(Math.round(px + i * cw), Math.round(wy)) < 0.3;
      ctx.fillStyle = lit ? EM("#55626e") : L("#55626e");
      if (lit && ctx.n) { ctx.a.fillStyle = L("#55626e"); ctx.n.fillStyle = "#f3c877"; ctx.a.fillRect(px + i * cw + cw * 0.28, wy, cw * 0.44, 11); ctx.n.fillRect(px + i * cw + cw * 0.28, wy, cw * 0.44, 11); }
      else ctx.fillRect(px + i * cw + cw * 0.28, wy, cw * 0.44, 11);
    }
    R(ctx, px + bw * 0.2, base - 16, bw * 0.6, 16, L("#3a3a3c"));
    // aerial haze, over the building only
    var A = ctx.a || ctx, hz = kind < 0.35 ? bw * 0.3 : 14;
    A.fillStyle = "rgba(214,224,236,.34)"; A.fillRect(px, top, bw + 0.5, bh);
    if (ctx.n) { ctx.n.fillStyle = "rgba(10,14,30,.4)"; ctx.n.fillRect(px, top - hz, bw + 0.5, bh + hz); }
    px += bw;
  }
  ctx.restore();
}

/* ---------- gaps between districts ---------- */
function drawCross(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w, canal = b.city === "amsterdam", far = G - 44, m = x + w / 2;
  backdrop(ctx, r, x, w, far, b.city);
  // the ground between the far row and the pavement
  R(ctx, x, far, w, G - far, L("#b9b3a6"));
  var e0 = x + 20, e1 = x + w - 20;
  // side street (or side canal) running away from us
  ctx.fillStyle = L(canal ? "#44606a" : "#46484c"); ctx.beginPath();
  ctx.moveTo(e0, canal ? G : KERB + 6); ctx.lineTo(m - 20, far); ctx.lineTo(m + 20, far); ctx.lineTo(e1, canal ? G : KERB + 6); ctx.fill();
  if (canal) {
    // a humpback bridge carries the pavement over the side canal
    R(ctx, x + 6, KERB, w - 12, 30, L("#8a8378"));
    ctx.fillStyle = L("#22343b"); ctx.beginPath(); ctx.ellipse(m, KERB + 31, (e1 - e0) / 2 - 8, 24, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = L("#a39c90"); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(m, KERB + 31, (e1 - e0) / 2 - 6, 26, 0, Math.PI, 0); ctx.stroke();
    R(ctx, x + 6, KERB - 2, w - 12, 4, L("#a39c90"));
  } else {
    // kerb returns and a zebra crossing
    ctx.strokeStyle = L("#8f8a80"); ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(e0, KERB + 4); ctx.lineTo(e0 + (m - 20 - e0) * 0.5, (KERB + far) / 2); ctx.moveTo(e1, KERB + 4); ctx.lineTo(e1 + (m + 20 - e1) * 0.5, (KERB + far) / 2); ctx.stroke();
    ctx.fillStyle = L("#ece6d6");
    for (var zx = e0 + 6; zx < e1 - 10; zx += 14) ctx.fillRect(zx, G + 6, 8, KERB - G - 10);
    ctx.fillStyle = L("#e9e3d0", 0.9);
    for (var q = 0; q < 4; q++) { var t = 0.2 + q * 0.2, yy = KERB + (far - KERB) * t; ctx.fillRect(m - 1.5 * (1 - t * 0.6), yy, 3 * (1 - t * 0.6), 9 * (1 - t * 0.5)); }
    // a corner lamp and street-name plate
    R(ctx, x + 9, G - 96, 3, 96, L("#3a3f44")); R(ctx, x + 2, G - 100, 32, 12, L("#1b4f9c")); R(ctx, x + 4, G - 98, 28, 8, L("#e8eef6", 0.9));
    R(ctx, x + w - 12, G - 84, 3, 84, L("#3a3f44")); R(ctx, x + w - 16, G - 108, 11, 26, L("#22262a"));
    R(ctx, x + w - 14, G - 105, 7, 6, EM("#e2524a")); R(ctx, x + w - 14, G - 89, 7, 6, L("#2c5a34"));
  }
}
function stall(ctx, r, x, w) {
  var aw = pick(r, [["#b5462f", "#f2e6d0"], ["#1f3a5f", "#f2e6d0"], ["#24533a", "#f2e6d0"], ["#e1b12c", "#f6f1e2"]]);
  R(ctx, x + 2, G - 62, 2, 62, L("#5a4332")); R(ctx, x + w - 4, G - 62, 2, 62, L("#5a4332"));
  R(ctx, x, G - 26, w, 6, L("#7a5a3a")); R(ctx, x + 2, G - 20, w - 4, 20, L("#6b4a2b", 0.9));
  for (var q = 0; q < 4; q++) {
    var cx = x + 4 + q * (w - 8) / 4, cw = (w - 8) / 4 - 2;
    R(ctx, cx, G - 34, cw, 9, L("#a87a45"));
    ctx.fillStyle = L(pick(r, ["#e2524a", "#f3c13a", "#6aa84f", "#e8862a", "#8e44ad", "#f2ece2"]));
    for (var p = 0; p < 4; p++) { ctx.beginPath(); ctx.arc(cx + 2 + p * (cw - 4) / 3, G - 35, 2.4, 0, 6.3); ctx.fill(); }
  }
  awning(ctx, x - 5, G - 78, w + 10, 15, aw[0], aw[1]);
  nglow(ctx, x + w / 2, G - 40, w * 0.6, "rgb(255,214,150)", 0.4);
}
function drawSquare(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w, far = G - 60, m = x + w / 2, kind = r();
  backdrop(ctx, r, x, w, far, b.city);
  // paved square
  R(ctx, x, far, w, G - far, L("#d2ccbe"));
  ctx.strokeStyle = L("#bdb6a6"); ctx.lineWidth = 0.7; ctx.beginPath();
  for (var py = far + 10; py < G; py += 12) { ctx.moveTo(x, py); ctx.lineTo(x + w, py); }
  for (var px = -6; px <= 6; px++) { ctx.moveTo(m + px * 20, far); ctx.lineTo(m + px * 34, G); }
  ctx.stroke();
  if (b.city === "tokyo" && kind < 0.6) {
    // a neighbourhood shrine behind its torii
    R(ctx, m - 36, G - 110, 7, 110, L("#c0392b")); R(ctx, m + 29, G - 110, 7, 110, L("#c0392b"));
    R(ctx, m - 50, G - 122, 100, 8, L("#c0392b")); R(ctx, m - 44, G - 100, 88, 5, L("#c0392b")); R(ctx, m - 54, G - 127, 108, 5, L("#2b2b2b"));
    R(ctx, m - 22, G - 58, 44, 44, L("#8a5a3a")); ctx.fillStyle = L("#3a4a44"); ctx.beginPath(); ctx.moveTo(m - 34, G - 58); ctx.lineTo(m, G - 80); ctx.lineTo(m + 34, G - 58); ctx.fill();
    emit("lantern", m - 16, G - 56); emit("lantern", m + 16, G - 56);
  } else if (kind < 0.36) {
    // fountain
    ctx.fillStyle = L("#b7b0a2"); ctx.beginPath(); ctx.ellipse(m, G - 16, 62, 13, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = L("#6f98a8"); ctx.beginPath(); ctx.ellipse(m, G - 19, 54, 9, 0, 0, 6.3); ctx.fill();
    R(ctx, m - 5, G - 66, 10, 48, L("#a9a294")); ctx.fillStyle = L("#b7b0a2"); ctx.beginPath(); ctx.ellipse(m, G - 62, 22, 5, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = "rgba(235,246,252,.75)"; ctx.lineWidth = 1.4; ctx.beginPath();
    for (var j = -2; j <= 2; j++) { ctx.moveTo(m, G - 70); ctx.quadraticCurveTo(m + j * 9, G - 96, m + j * 18, G - 62); }
    ctx.stroke();
  } else if (kind < 0.62) {
    // statue on a plinth
    R(ctx, m - 20, G - 50, 40, 50, L("#b7b0a2")); R(ctx, m - 24, G - 54, 48, 6, L("#a39c8e")); R(ctx, m - 24, G - 6, 48, 6, L("#a39c8e"));
    ctx.fillStyle = L("#5f7a6c"); ctx.beginPath(); ctx.arc(m, G - 104, 7, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(m - 9, G - 96); ctx.lineTo(m + 9, G - 96); ctx.lineTo(m + 12, G - 54); ctx.lineTo(m - 12, G - 54); ctx.fill();
    ctx.strokeStyle = L("#5f7a6c"); ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(m + 8, G - 92); ctx.lineTo(m + 24, G - 108); ctx.stroke(); ctx.lineCap = "butt";
  }
  // market stalls and trees fill the rest
  var market = r() < 0.6, sx = x + 22;
  while (sx < x + w - 70) {
    if (Math.abs(sx + 30 - m) < 92) { sx += 40; continue; }
    if (market && r() < 0.75) { var sw = rr(r, 52, 68); stall(ctx, r, sx, sw); sx += sw + rr(r, 14, 30); }
    else { drawTree(ctx, r, sx + 20, G - 2, rr(r, 40, 54), TREES[b.city] || "#5d8a41"); sx += rr(r, 62, 90); }
  }
  // bench
  var bx = m + (r() < 0.5 ? -96 : 70);
  R(ctx, bx, G - 16, 28, 3, L("#6b4a2b")); R(ctx, bx + 2, G - 16, 2, 16, L("#2b2b2b")); R(ctx, bx + 24, G - 16, 2, 16, L("#2b2b2b")); R(ctx, bx, G - 26, 28, 3, L("#6b4a2b"));
}
function drawParkGap(ctx, b) {
  backdrop(ctx, mulberry32(b.seed ^ 77), b.x, b.w, G - 30, b.city);
  R(ctx, b.x, G - 30, b.w, 30, L("#86a35c"));
  drawPark(ctx, b);
}

var DRAW = {
  singapore: drawShophouse, paris: drawParis, amsterdam: drawAmsterdam, tokyo: drawTokyo, brooklyn: drawBrooklyn,
  london: drawLondon, lisbon: drawLisbon, hanoi: drawHanoi, park: drawParkGap, cross: drawCross, square: drawSquare
};

/* ---------- window lights ----------
 * U is a small canvas that sits behind the night copy and shows through its window holes. */
function paintWin(u, w, on) {
  var g;
  if (w.lean) { u.save(); u.translate(w.lean.x, w.lean.y); u.rotate(w.lean.a); u.translate(-w.lean.x, -w.lean.y); }
  if (!on) { u.fillStyle = "#0b101c"; u.fillRect(w.x - 1, w.y - 1, w.w + 2, w.h + 2); }
  else {
    g = u.createLinearGradient(0, w.y, 0, w.y + w.h);
    if (w.shop) { g.addColorStop(0, "#fff3cf"); g.addColorStop(1, "#f6c877"); }
    else if (w.c < 0.6) { g.addColorStop(0, "#ffd27d"); g.addColorStop(1, "#e79a45"); }
    else if (w.c < 0.82) { g.addColorStop(0, "#fff1c9"); g.addColorStop(1, "#d9c08a"); }
    else if (w.c < 0.93) { g.addColorStop(0, "#e3ecff"); g.addColorStop(1, "#a9bce0"); }
    else { g.addColorStop(0, "#9fd3ff"); g.addColorStop(1, "#5f8fd0"); }
    u.fillStyle = g; u.fillRect(w.x - 1, w.y - 1, w.w + 2, w.h + 2);
    if (!w.shop && w.c > 0.45 && w.c < 0.8) { u.fillStyle = "rgba(120,60,30,.35)"; u.fillRect(w.x, w.y, w.w * 0.3, w.h); }
    if (w.shop) { u.fillStyle = "rgba(90,50,20,.3)"; u.fillRect(w.x, w.y + w.h * 0.55, w.w, 2); u.fillRect(w.x, w.y + w.h * 0.78, w.w, 2); }
  }
  if (w.lean) u.restore();
}
// should this window be lit? n: how dark it is (0..1), hour: clock time
function windowLit(w, n, hour) {
  if (n < 0.12) return false;
  var late = hour < 12 ? hour + 24 : hour;                 // hours past midday, so 02:00 is 26
  if (w.shop) return n > 0.2 && (w.s < 0.25 || late < 23.2 + w.c * 1.5);
  if (w.s > 0.8) return false;                             // some rooms stay dark
  if (n < 0.15 + w.s * 1.0) return false;                  // lights come on a few at a time as it darkens
  if (w.s < 0.08) return true;                             // night owls
  if (late > 21.5 + w.c * 5 && late < 29 + w.s * 2.2) return false;   // bedtime, then early risers
  return true;
}

/* ---------- tile renderer (a generator, so the work can be sliced) ---------- */
function* renderTile(job, light) {
  var x0 = job.x0, x1 = job.x1, k = job.k, W = Math.ceil((x1 - x0) * k), VH = WH - VY, UK = k * 0.5;
  planCover(x0 - 900, x1 + 900);
  function cv(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  var A = cv(W, Math.ceil(VH * k)), N = cv(W, Math.ceil(VH * k)), U = cv(Math.ceil((x1 - x0) * UK), Math.ceil(VH * UK));
  var FA = cv(W, Math.ceil((WH - FY) * k)), FN = cv(W, Math.ceil((WH - FY) * k));
  var a = A.getContext("2d"), n = N.getContext("2d");
  a.setTransform(k, 0, 0, k, -x0 * k, -VY * k); n.setTransform(k, 0, 0, k, -x0 * k, -VY * k);
  var ctx = new Tee(a, n), items = itemsIn(x0 - 80, x1 + 80), wins = [];
  WINS = null;
  drawGround(ctx, x0, x1);
  reflections(ctx, x0, x1, items);
  yield;
  for (var j = 0; j < items.length; j++) {
    ctx.save();
    WINS = wins; LEAN = null;
    DRAW[items[j].type](ctx, items[j]);
    WINS = null;
    ctx.restore();
    yield;
  }
  // after dark: pools of lamplight on the pavement, and the gutter falls into shadow
  var S = 300;
  if (STYLE.lamps) for (var q = Math.floor((x0 - 120) / S); q <= Math.floor((x1 + 120) / S); q++) {
    var lx = q * S + 150, d = districtAt(lx);
    if (!d || d.city === "tokyo" || d.city === "hanoi") continue;
    n.save(); n.translate(lx, G + 34); n.scale(1, 0.3); glowAt(n, 0, 0, 120, "rgb(255,206,130)", 0.34); n.restore();
  }
  n.globalAlpha = 0.3; n.fillStyle = "#05070f"; n.fillRect(x0, KERB + 6, x1 - x0, WH - KERB - 6); n.globalAlpha = 1;
  yield;
  // kerbside furniture goes on its own layer, in front of people on the pavement
  var fa = FA.getContext("2d"), fn = FN.getContext("2d");
  fa.setTransform(k, 0, 0, k, -x0 * k, -FY * k); fn.setTransform(k, 0, 0, k, -x0 * k, -FY * k);
  var f = new Tee(fa, fn);
  if (STYLE.trees) drawTrees(f, x0, x1);
  polesAndWires(f, x0, x1);
  if (STYLE.lamps) drawLamps(f, x0, x1);
  for (j = 0; j < items.length; j++) if (items[j].type === "cross" && items[j].city === "amsterdam") railing(f, items[j].x + 6, KERB - 20, items[j].w - 12, 18, L("#22262a"));
  // the light behind the windows
  var u = U.getContext("2d");
  u.fillStyle = "#0b101c"; u.fillRect(0, 0, U.width, U.height);
  u.setTransform(UK, 0, 0, UK, -x0 * UK, -VY * UK);
  for (j = 0; j < wins.length; j++) { var w = wins[j]; w.on = windowLit(w, light.n, light.hour); if (w.on) paintWin(u, w, true); }
  return { canvases: [A, U, N, FA, FN], wins: wins, uk: UK };
}
