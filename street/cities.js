/* ===== Endless Street: one ruleset per city, built from the facade kit ===== */
/* ---------- Singapore shophouse ---------- */
var SG_WALL = ["#9fd8c8", "#f4b6c2", "#f6dc8c", "#a9c8ec", "#c8b6e6", "#f7c59f", "#b9e3a8", "#f2a7a0", "#8fcfe0", "#f3e3b0"];
var SG_SHUT = ["#2f7d62", "#2f5f8f", "#7a3b3b", "#3f6b4b", "#c9a227", "#6c4a8a"];
var SG_TILE = ["#1e5f8c", "#c0392b", "#2e8b57", "#d4a017"];
var SG_SHOP = [["Kim Seng", "Trading"], ["Ah Hock", "Kopitiam"], ["Soon Huat", "Provision"], ["Teck Guan", "Medical Hall"], ["Joo Heng", "Bakery"], ["Chong Lee", "Tailor"], ["Hock Seng", "Hardware"], ["Guan Chuan", "Goldsmith"], ["Lim Brothers", "Bookstore"], ["Tan Ah Kow", "Coffeeshop"], ["Hup Lee", "Rice Dealer"], ["Swee Kee", "Chicken Rice"]];
function drawShophouse(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w, n = b.floors || 2;
  var gh = 118 * b.hmul, fh = 104 * b.hmul;
  var top = G - gh - fh * (n - 1);
  var wall = pick(r, SG_WALL), trim = "#fbf6ea", shut = pick(r, SG_SHUT), tileC = pick(r, SG_TILE);
  var pil = 9;
  // roof
  R(ctx, x - 2, top - 30, w + 4, 18, L("#b4583a"));
  ctx.strokeStyle = L("#8a3f28"); ctx.lineWidth = 1; ctx.beginPath();
  for (var tx = x; tx < x + w; tx += 6) { ctx.moveTo(tx, top - 30); ctx.lineTo(tx, top - 12); }
  ctx.stroke();
  // body
  R(ctx, x, top - 12, w, G - top + 12, L(wall));
  // gable/pediment on some houses
  var gable = r();
  if (gable < 0.35 * orn() + 0.1) {
    ctx.fillStyle = L(wall); ctx.beginPath();
    ctx.moveTo(x + w * 0.2, top - 12); ctx.quadraticCurveTo(x + w * 0.5, top - 62, x + w * 0.8, top - 12); ctx.fill();
    ctx.strokeStyle = L(trim); ctx.lineWidth = 2.2; ctx.stroke();
    R(ctx, x + w * 0.4, top - 36, w * 0.2, 14, L(trim));
    signText(ctx, String(1900 + Math.floor(r() * 39)), x + w * 0.5, top - 29, 9, L("#5b4a3a"), STYLE.fontSign);
  } else r();
  // cornice
  R(ctx, x, top - 14, w, 6, L(trim)); R(ctx, x, top - 8, w, 3, L(wall, 0.85)); R(ctx, x, top - 5, w, 5, L(trim));
  // pilasters
  R(ctx, x, top, pil, G - top, L(trim, 0.97)); R(ctx, x + w - pil, top, pil, G - top, L(trim, 0.97));
  for (var f = 0; f < n - 1; f++) {
    var fy = top + f * fh;
    // capitals
    R(ctx, x - 1, fy + 2, pil + 2, 5, L(trim)); R(ctx, x + w - pil - 1, fy + 2, pil + 2, 5, L(trim));
    // windows
    var nw = w > 118 ? 3 : 2, inner = w - pil * 2 - 12, gap = 8, ww = (inner - gap * (nw - 1)) / nw, wh = fh * 0.62;
    for (var i = 0; i < nw; i++) {
      var wx = x + pil + 6 + i * (ww + gap), wy = fy + 16;
      // fanlight / arch over the window
      ctx.fillStyle = L(trim); ctx.beginPath();
      ctx.moveTo(wx - 2, wy); ctx.arc(wx + ww / 2, wy, ww / 2 + 2, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = L("#3c4a52", 0.9); ctx.beginPath(); ctx.moveTo(wx + 2, wy); ctx.arc(wx + ww / 2, wy, ww / 2 - 2, Math.PI, 0); ctx.closePath(); ctx.fill();
      if (orn() > 0.3) { ctx.strokeStyle = L(trim); ctx.lineWidth = 1; ctx.beginPath(); for (var a = 1; a < 4; a++) { var an = Math.PI + a * Math.PI / 4; ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2 + Math.cos(an) * ww / 2, wy + Math.sin(an) * ww / 2); } ctx.stroke(); }
      var open = r();
      R(ctx, wx - 2, wy, ww + 4, wh + 2, L(trim));
      glass(ctx, r, wx, wy + 1, ww, wh - 1);
      // shutters: closed, half or open
      if (open < 0.4) { louvres(ctx, wx, wy + 1, ww / 2, wh - 1, L(shut), L(shut, 0.7)); louvres(ctx, wx + ww / 2, wy + 1, ww / 2, wh - 1, L(shut), L(shut, 0.7)); }
      else if (open < 0.75) { louvres(ctx, wx, wy + 1, ww / 2, wh - 1, L(shut), L(shut, 0.7)); }
      // balustrade
      R(ctx, wx - 3, wy + wh - 12, ww + 6, 3, L(trim));
      ctx.strokeStyle = L(trim); ctx.lineWidth = 1.6; ctx.beginPath();
      for (var bx = wx; bx <= wx + ww; bx += 5) { ctx.moveTo(bx, wy + wh - 9); ctx.lineTo(bx, wy + wh + 1); }
      ctx.stroke();
    }
    // Peranakan tile band below the windows
    var by = fy + fh - 22;
    if (orn() > 0.15) {
      var ts = 7, cnt = Math.floor((w - pil * 2 - 8) / ts), x0t = x + pil + 4 + ((w - pil * 2 - 8) - cnt * ts) / 2;
      for (var t = 0; t < cnt; t++) {
        R(ctx, x0t + t * ts, by, ts - 0.8, ts - 0.8, L("#f4efe2"));
        ctx.fillStyle = L(t % 2 ? tileC : "#c97a3a");
        ctx.beginPath(); ctx.moveTo(x0t + t * ts + ts / 2 - 0.4, by + 0.6); ctx.lineTo(x0t + t * ts + ts - 1.4, by + ts / 2 - 0.4); ctx.lineTo(x0t + t * ts + ts / 2 - 0.4, by + ts - 1.4); ctx.lineTo(x0t + t * ts + 0.6, by + ts / 2 - 0.4); ctx.fill();
      }
    }
    R(ctx, x, fy + fh - 8, w, 4, L(trim));
  }
  // five-foot way: arcade recess
  var gy = G - gh;
  R(ctx, x - 1, gy - 6, w + 2, 6, L(trim));
  var rx = x + pil, rw = w - pil * 2;
  ctx.fillStyle = L("#5a4d43", 0.55); ctx.beginPath();
  ctx.moveTo(rx, G); ctx.lineTo(rx, gy + 26); ctx.quadraticCurveTo(rx + rw / 2, gy + 4, rx + rw, gy + 26); ctx.lineTo(rx + rw, G); ctx.fill();
  // signboard
  var shop = SG_SHOP[Math.floor(r() * SG_SHOP.length)];
  var sbw = rw * 0.82, sbx = x + (w - sbw) / 2, sby = gy - 30;
  R(ctx, sbx, sby, sbw, 20, L(r() < 0.5 ? "#1f3b2c" : "#3a1f1f"));
  ctx.strokeStyle = L("#d9b44a"); ctx.lineWidth = 1.2; ctx.strokeRect(sbx + 2, sby + 2, sbw - 4, 16);
  signText(ctx, shop[0] + " " + shop[1], x + w / 2, sby + 10.5, 10, L("#f2d27a", 1.1), STYLE.fontSign, "center", sbw - 10);
  // shopfront inside the arcade
  var doorW = rw * 0.36;
  R(ctx, x + w / 2 - doorW / 2, gy + 40, doorW, G - gy - 40, L("#6b3f24", 0.8));
  ctx.strokeStyle = L("#3e2414", 0.8); ctx.lineWidth = 1; ctx.beginPath();
  for (var dx = 1; dx < 4; dx++) { ctx.moveTo(x + w / 2 - doorW / 2 + doorW * dx / 4, gy + 40); ctx.lineTo(x + w / 2 - doorW / 2 + doorW * dx / 4, G); }
  ctx.stroke();
  var sw = (rw - doorW) / 2 - 10;
  frameWindow(ctx, r, rx + 5, gy + 44, sw, 40, L("#3e2414", 0.8), 2, 2, { shop: true });
  frameWindow(ctx, r, x + w / 2 + doorW / 2 + 5, gy + 44, sw, 40, L("#3e2414", 0.8), 2, 2, { shop: true });
  // tiled pilaster dado
  R(ctx, x, G - 30, pil, 30, L(tileC, 0.9)); R(ctx, x + w - pil, G - 30, pil, 30, L(tileC, 0.9));
  // lanterns hang in the arcade (animated separately)
  if (r() < 0.6) {
    if (r() < 0.4) { emit("lantern", x + w * 0.3, gy + 6); emit("lantern", x + w * 0.7, gy + 6); }
    else emit("lantern", x + w / 2, gy + 6);
  }
}

/* ---------- Paris Haussmann ---------- */
var PA_STONE = ["#eadfc8", "#e3d6bb", "#efe4cf", "#e6d9c0", "#dccfb4"];
var PA_SHOP = ["Boulangerie", "Fromagerie", "Café", "Librairie", "Pharmacie", "Bistrot", "Pâtisserie", "Fleuriste", "Brasserie", "Caviste", "Épicerie"];
var PA_AWN = [["#7a1f2b", "#f2e6d0"], ["#1f3a5f", "#f2e6d0"], ["#24533a", "#f2e6d0"], ["#2b2b2b", "#e9d9b8"], ["#b5462f", "#f2e6d0"]];
function drawParis(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w;
  var floors = r() < 0.6 ? 5 : 4, gh = 112 * b.hmul, fh = 84 * b.hmul, mans = 70 * b.hmul;
  var stone = pick(r, PA_STONE), dark = "#3a3a3e", zinc = "#7d8a97";
  var top = G - gh - fh * floors;
  // chimneys
  for (var c = 0; c < 2; c++) {
    var cx = x + w * (0.18 + 0.64 * c) + rr(r, -8, 8);
    R(ctx, cx, top - mans - 26, 18, 30, L("#c2a58a"));
    R(ctx, cx - 2, top - mans - 28, 22, 4, L("#a88c72"));
    for (var p = 0; p < 3; p++) R(ctx, cx + 2 + p * 5.5, top - mans - 36, 3.5, 8, L("#b5633f"));
    if (hash2(b.seed, c) < 0.45) emit("smoke", cx + 9, top - mans - 36);
  }
  // mansard roof
  ctx.fillStyle = L(zinc); ctx.beginPath();
  ctx.moveTo(x, top); ctx.lineTo(x + 10, top - mans); ctx.lineTo(x + w - 10, top - mans); ctx.lineTo(x + w, top); ctx.fill();
  ctx.strokeStyle = L("#5d6873"); ctx.lineWidth = 0.7; ctx.beginPath();
  for (var zx = x + 8; zx < x + w - 6; zx += 7) { ctx.moveTo(zx, top); ctx.lineTo(zx + (zx - x - w / 2) * -0.02, top - mans); }
  ctx.stroke();
  var cols = Math.max(3, Math.round(w / 46)), cw = w / cols;
  for (var i = 0; i < cols; i++) {
    var dx = x + i * cw + cw / 2 - 9;
    R(ctx, dx - 3, top - mans + 16, 24, 44, L("#efe7d8", 0.95));
    ctx.fillStyle = L("#efe7d8", 0.95); ctx.beginPath(); ctx.arc(dx + 9, top - mans + 16, 12, Math.PI, 0); ctx.fill();
    glass(ctx, r, dx, top - mans + 18, 18, 38);
  }
  // body
  R(ctx, x, top, w, G - top, L(stone));
  // rusticated ground floor
  ctx.strokeStyle = L(stone, 0.86); ctx.lineWidth = 1; ctx.beginPath();
  for (var ry = G - gh + 12; ry < G; ry += 12) { ctx.moveTo(x, ry); ctx.lineTo(x + w, ry); }
  ctx.stroke();
  // floors
  for (var f = 0; f < floors; f++) {
    var fy = top + f * fh, fromTop = f;
    for (var i = 0; i < cols; i++) {
      var wx = x + i * cw + cw * 0.24, ww = cw * 0.52, wh = fh * 0.64, wy = fy + fh * 0.2;
      R(ctx, wx - 3, wy - 3, ww + 6, wh + 3, L(stone, 0.9));
      frameWindow(ctx, r, wx, wy, ww, wh, L("#f3eee4"), 2, 3);
      // pediments on the noble floor
      if (f === floors - 2 && orn() > 0.2) {
        ctx.fillStyle = L(stone, 1.04); ctx.beginPath();
        ctx.moveTo(wx - 6, wy - 4); ctx.lineTo(wx + ww / 2, wy - 16); ctx.lineTo(wx + ww + 6, wy - 4); ctx.fill();
        ctx.strokeStyle = L(stone, 0.8); ctx.lineWidth = 1; ctx.stroke();
      } else if (orn() > 0.5) { R(ctx, wx - 5, wy - 7, ww + 10, 4, L(stone, 1.04)); }
      // individual balconies
      if (f !== floors - 2 && f !== 0) railing(ctx, wx - 3, wy + wh - 14, ww + 6, 13, L(dark));
    }
    // continuous balconies on 2nd and top floors
    if (f === floors - 2 || f === 0) {
      R(ctx, x + 2, fy + fh * 0.84 - 1, w - 4, 4, L(stone, 0.8));
      railing(ctx, x + 4, fy + fh * 0.84 - 15, w - 8, 14, L(dark));
    }
    R(ctx, x, fy + fh - 3, w, 3, L(stone, 0.92));
  }
  // cornice
  R(ctx, x - 3, top - 4, w + 6, 8, L(stone, 1.05));
  if (orn() > 0.3) { ctx.fillStyle = L(stone, 0.78); for (var dxx = x; dxx < x + w; dxx += 6) ctx.fillRect(dxx, top + 4, 3, 4); }
  // shops
  var nshop = w > 205 ? 2 : 1, sw = w / nshop;
  for (var s = 0; s < nshop; s++) {
    var sx = x + s * sw + 10, sww = sw - 20, sy = G - gh + 22;
    var aw = pick(r, PA_AWN);
    R(ctx, sx - 2, sy - 6, sww + 4, gh - 16, L("#2a2a2c", 0.9));
    frameWindow(ctx, r, sx + 4, sy + 26, sww - 8, gh - 52, L("#1d1d1f"), 3, 1, { shop: true });
    // name band
    R(ctx, sx - 2, sy - 6, sww + 4, 20, L(aw[0], 0.9));
    signText(ctx, pick(r, PA_SHOP), sx + sww / 2, sy + 4.5, 12, L("#f2d993", 1.1), STYLE.fontSign, "center", sww - 12);
    // striped awning
    var ay = sy + 14, ah = 18;
    for (var st = 0; st < sww + 4; st += 10) {
      R(ctx, sx - 2 + st, ay, Math.min(5, sww + 4 - st), ah, L(aw[0]));
      R(ctx, sx - 2 + st + 5, ay, Math.min(5, Math.max(0, sww + 4 - st - 5)), ah, L(aw[1]));
    }
    ctx.fillStyle = L("#000000", 1); ctx.globalAlpha = 0.12; ctx.fillRect(sx - 2, ay + ah, sww + 4, 6); ctx.globalAlpha = 1;
    // scalloped edge
    ctx.fillStyle = L(aw[0]); ctx.beginPath();
    for (var sc = sx - 2; sc < sx + sww + 2; sc += 10) { ctx.moveTo(sc, ay + ah); ctx.arc(sc + 5, ay + ah, 5, 0, Math.PI); }
    ctx.fill();
    nglow(ctx, sx + sww / 2, G - 30, sww * 0.6, "rgb(255,200,120)", 0.35);
  }
  // café tables
  if (r() < 0.5) for (var t = 0; t < 2; t++) {
    var tx = x + 26 + t * 34 + rr(r, -4, 4);
    ctx.fillStyle = L("#2c2c2e"); ctx.beginPath(); ctx.ellipse(tx, G - 24, 9, 2.5, 0, 0, 6.3); ctx.fill();
    R(ctx, tx - 0.8, G - 24, 1.6, 24, L("#2c2c2e"));
    R(ctx, tx - 14, G - 16, 8, 1.6, L("#8a5a2b")); R(ctx, tx - 13, G - 16, 1.2, 16, L("#5a3a1b")); R(ctx, tx - 7, G - 28, 1.2, 28, L("#5a3a1b"));
  }
}

/* ---------- Amsterdam canal house ---------- */
var AM_BRICK = ["#8b3a2e", "#6e3326", "#9c4a34", "#5b2c22", "#2e2b2a", "#7a4a33", "#a35a3e", "#3b4a3e", "#efe9dc"];
function drawAmsterdam(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w;
  var floors = r() < 0.5 ? 4 : 5, gh = 92 * b.hmul, fh = 78 * b.hmul;
  var brick = pick(r, AM_BRICK), white = "#f4f1ea", top = G - gh - fh * (floors - 1);
  var lean = rr(r, -0.012, 0.012);
  ctx.save();
  ctx.translate(x + w / 2, G); ctx.rotate(lean); ctx.translate(-(x + w / 2), -G);
  LEAN = { x: x + w / 2, y: G, a: lean };
  R(ctx, x, top, w, G - top, L(brick));
  // brick texture
  if (orn() > 0.35 && brick !== "#efe9dc") {
    ctx.strokeStyle = L(brick, 0.82); ctx.lineWidth = 0.5; ctx.beginPath();
    for (var by = top + 4; by < G; by += 4) { ctx.moveTo(x, by); ctx.lineTo(x + w, by); }
    ctx.stroke();
  }
  // gable
  var gt = r(), gtop = top - 70 * b.hmul;
  ctx.fillStyle = L(brick); ctx.strokeStyle = L(white); ctx.lineWidth = 2.4; ctx.beginPath();
  if (gt < 0.33) {
    // step gable
    var steps = 4, sw = w / (steps * 2), sh = (top - gtop) / steps;
    ctx.moveTo(x, top);
    for (var s = 0; s < steps; s++) { ctx.lineTo(x + s * sw, top - (s + 1) * sh); ctx.lineTo(x + (s + 1) * sw, top - (s + 1) * sh); }
    for (var s2 = steps - 1; s2 >= 0; s2--) { ctx.lineTo(x + w - (s2 + 1) * sw, top - (s2 + 1) * sh); ctx.lineTo(x + w - s2 * sw, top - (s2 + 1) * sh); }
    ctx.lineTo(x + w, top);
  } else if (gt < 0.66) {
    // bell gable
    ctx.moveTo(x, top);
    ctx.bezierCurveTo(x + w * 0.05, top - 30, x + w * 0.32, top - 25, x + w * 0.3, gtop + 12);
    ctx.quadraticCurveTo(x + w * 0.5, gtop - 16, x + w * 0.7, gtop + 12);
    ctx.bezierCurveTo(x + w * 0.68, top - 25, x + w * 0.95, top - 30, x + w, top);
  } else {
    // neck gable with scrolls
    ctx.moveTo(x, top);
    ctx.quadraticCurveTo(x + w * 0.22, top - 4, x + w * 0.26, top - 34);
    ctx.lineTo(x + w * 0.26, gtop + 4); ctx.lineTo(x + w * 0.4, gtop); ctx.lineTo(x + w * 0.5, gtop - 10); ctx.lineTo(x + w * 0.6, gtop); ctx.lineTo(x + w * 0.74, gtop + 4);
    ctx.lineTo(x + w * 0.74, top - 34);
    ctx.quadraticCurveTo(x + w * 0.78, top - 4, x + w, top);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // hoist beam and attic window
  R(ctx, x + w / 2 - 2, gtop + 6, 4, 14, L("#3a2a1e"));
  R(ctx, x + w / 2 - 2, gtop + 6, 16, 3, L("#3a2a1e"));
  frameWindow(ctx, r, x + w / 2 - 9, top - 36, 18, 26, L(white), 2, 2);
  // floors
  for (var f = 0; f < floors - 1; f++) {
    var fy = top + f * fh, nw = w > 76 ? 3 : 2, ww = (w - 16 - (nw - 1) * 7) / nw, wh = fh * 0.66;
    for (var i = 0; i < nw; i++) {
      var wx = x + 8 + i * (ww + 7);
      frameWindow(ctx, r, wx, fy + 12, ww, wh, L(white), 2, 3);
      if (orn() > 0.25) R(ctx, wx - 2, fy + 8, ww + 4, 4, L(white, 0.95));
      if (r() < 0.25 * orn()) { R(ctx, wx, fy + 12 + wh - 4, ww, 6, L("#5b3a1e")); for (var fl = 0; fl < 4; fl++) { ctx.fillStyle = L(pick(r, ["#e2524a", "#f3c13a", "#e86fa5", "#ffffff"])); ctx.beginPath(); ctx.arc(wx + 3 + fl * (ww - 6) / 3, fy + 12 + wh - 5, 2.4, 0, 6.3); ctx.fill(); } }
    }
  }
  // ground floor: door at the top of a short stoop + big window
  var gy = G - gh;
  var dx = r() < 0.5 ? x + 6 : x + w - 30;
  R(ctx, dx, gy + 20, 24, gh - 34, L(pick(r, ["#1f3d2b", "#2a2a2a", "#5a1f1f", "#1d3354"])));
  R(ctx, dx + 3, gy + 12, 18, 8, L(white)); glass(ctx, r, dx + 5, gy + 13, 14, 6);
  R(ctx, dx - 4, G - 14, 32, 5, L("#9a948a")); R(ctx, dx - 8, G - 9, 40, 9, L("#a9a399"));
  var bx = dx === x + 6 ? x + 36 : x + 6;
  frameWindow(ctx, r, bx, gy + 18, w - 42, gh - 44, L(white), 3, 2);
  ctx.restore();
}

/* ---------- Tokyo ---------- */
var TK_WALL = ["#d9d3c7", "#bfbab0", "#e8e4dc", "#c9b9a2", "#a7a9ab", "#efe9df", "#d8c7b0", "#8c8f93", "#c4cfd4"];
var TK_SIGNS = ["喫茶", "居酒屋", "ラーメン", "寿司", "古本", "焼鳥", "カフェ", "酒", "うどん", "銭湯", "花", "定食", "薬", "そば", "パン", "珈琲"];
var TK_SIGNC = [["#c0392b", "#ffffff"], ["#f4d03f", "#1d1d1d"], ["#1f4e79", "#ffffff"], ["#ffffff", "#c0392b"], ["#2e7d32", "#ffffff"], ["#1d1d1d", "#f4d03f"]];
function drawTokyo(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w;
  var floors = Math.floor(rr(r, 3, 7.99)), gh = 92 * b.hmul, fh = 66 * b.hmul;
  var top = G - gh - fh * (floors - 1), wall = pick(r, TK_WALL), kind = r();
  R(ctx, x, top, w, G - top, L(wall));
  // tile grid on some facades
  if (kind < 0.4 && orn() > 0.2) {
    ctx.strokeStyle = L(wall, 0.9); ctx.lineWidth = 0.5; ctx.beginPath();
    for (var ty = top; ty < G - gh; ty += 5) { ctx.moveTo(x, ty); ctx.lineTo(x + w, ty); }
    ctx.stroke();
  }
  R(ctx, x, top - 6, w, 6, L(wall, 0.8));
  // rooftop water tank or sign frame
  if (r() < 0.5) { R(ctx, x + w * 0.6, top - 30, 22, 22, L("#9aa3a8")); R(ctx, x + w * 0.6 + 3, top - 8, 2, 8, L("#5d6266")); R(ctx, x + w * 0.6 + 17, top - 8, 2, 8, L("#5d6266")); }
  for (var f = 0; f < floors - 1; f++) {
    var fy = top + f * fh;
    if (kind < 0.55) {
      // strip windows with balcony + AC unit
      var ww = w - 18;
      frameWindow(ctx, r, x + 9, fy + 12, ww, fh * 0.55, L("#c6ccd0"), Math.max(2, Math.round(ww / 30)), 1);
      R(ctx, x + 6, fy + fh * 0.62, w - 12, 3, L("#7d8488"));
      ctx.strokeStyle = L("#7d8488"); ctx.lineWidth = 1; ctx.beginPath();
      for (var rx = x + 6; rx <= x + w - 6; rx += 5) { ctx.moveTo(rx, fy + fh * 0.62); ctx.lineTo(rx, fy + fh * 0.9); }
      ctx.moveTo(x + 6, fy + fh * 0.9); ctx.lineTo(x + w - 6, fy + fh * 0.9); ctx.stroke();
      if (r() < 0.7) { var ax = x + 12 + r() * (w - 44); R(ctx, ax, fy + fh * 0.68, 22, 15, L("#e9e9e4")); ctx.strokeStyle = L("#b8b8b2"); ctx.beginPath(); ctx.arc(ax + 14, fy + fh * 0.68 + 7.5, 5, 0, 6.3); ctx.stroke(); }
      if (r() < 0.3) { ctx.strokeStyle = L(pick(r, ["#e74c3c", "#3498db", "#f1c40f", "#ffffff"])); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 10, fy + fh * 0.66); ctx.lineTo(x + w - 10, fy + fh * 0.66); ctx.stroke(); }
    } else {
      var nw = Math.max(2, Math.round(w / 34)), cw = (w - 12) / nw;
      for (var i = 0; i < nw; i++) frameWindow(ctx, r, x + 6 + i * cw + 4, fy + 12, cw - 8, fh * 0.6, L("#b9c0c4"), 1, 1);
    }
  }
  // vertical sign
  if (r() < 0.75) {
    var sc = pick(r, TK_SIGNC), word = pick(r, TK_SIGNS), sx = r() < 0.5 ? x + 3 : x + w - 19, sh = Math.min(G - gh - top - 10, 26 + word.length * 22);
    var sy = G - gh - sh - 6;
    nglow(ctx, sx + 8, sy + sh / 2, sh * 0.7, sc[0] === "#ffffff" ? "rgb(255,240,220)" : "rgb(" + hexRGB(sc[0]).join(",") + ")", 0.5);
    R(ctx, sx, sy, 16, sh, EM(sc[0]));
    emit("neon", sx, sy, { w: 16, h: sh, c: sc[0] === "#ffffff" ? "#fff2dc" : sc[0] });
    ctx.font = "13px " + STYLE.fontJP; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = EM(sc[1]);
    var sp = word.length > 1 ? (sh - 26) / (word.length - 1) : 0;
    for (var ch = 0; ch < word.length; ch++) ctx.fillText(word[ch], sx + 8, word.length > 1 ? sy + 13 + ch * sp : sy + sh / 2);
  }
  // ground floor shop
  var gy = G - gh;
  R(ctx, x, gy, w, 18, L(pick(r, ["#7a1f1f", "#1f3a5f", "#2f2f2f", "#e8e2d4", "#2b4d34"])));
  var sname = pick(r, TK_SIGNS);
  ctx.font = "12px " + STYLE.fontJP; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = L("#f6f0e2", 1.1); ctx.fillText(sname, x + w / 2, gy + 9.5);
  var shop = r();
  if (shop < 0.35) {
    // roller shutter
    R(ctx, x + 4, gy + 22, w - 8, gh - 22, L("#a8adb0"));
    ctx.strokeStyle = L("#8c9194"); ctx.lineWidth = 0.8; ctx.beginPath();
    for (var sy2 = gy + 25; sy2 < G; sy2 += 3) { ctx.moveTo(x + 4, sy2); ctx.lineTo(x + w - 4, sy2); }
    ctx.stroke();
  } else {
    frameWindow(ctx, r, x + 4, gy + 22, w - 8, gh - 22, L("#555a5e"), 3, 1, { shop: true });
    // noren curtain
    var nc = L(pick(r, ["#1f3a5f", "#7a1f1f", "#2f2f2f", "#e8e2d4"]));
    var nx = x + w * 0.3, nw2 = w * 0.4;
    for (var k = 0; k < 3; k++) R(ctx, nx + k * nw2 / 3 + 0.5, gy + 22, nw2 / 3 - 1, 26, nc);
    nglow(ctx, x + w / 2, gy + 50, w * 0.6, "rgb(255,214,150)", 0.4);
  }
  // vending machine
  if (r() < 0.35) {
    var vx = x + w - 26;
    R(ctx, vx, G - 50, 22, 50, L(pick(r, ["#d83a2e", "#1f5fa8", "#eeeeee"])));
    R(ctx, vx + 3, G - 46, 16, 20, EM("#e6f0f6"));
    for (var cnt = 0; cnt < 8; cnt++) R(ctx, vx + 4 + (cnt % 4) * 3.8, G - 44 + Math.floor(cnt / 4) * 9, 2.4, 6, L(pick(r, ["#e74c3c", "#27ae60", "#f39c12", "#2980b9", "#8e44ad"])));
    nglow(ctx, vx + 11, G - 36, 34, "rgb(220,240,255)", 0.45);
  }
}

/* ---------- Brooklyn ---------- */
function drawBrooklyn(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w, tenement = r() < 0.4;
  var floors = tenement ? 5 : 4, gh = 96 * b.hmul, fh = 80 * b.hmul, top = G - gh - fh * (floors - 1);
  var wall = tenement ? pick(r, ["#8e3b2c", "#a14a33", "#7a3a2b", "#b0644a"]) : pick(r, ["#6b4a3a", "#5e4033", "#7a5644", "#6f5040"]);
  var trim = tenement ? "#e8dfcf" : "#4e3428";
  R(ctx, x, top, w, G - top, L(wall));
  // heavy cornice with brackets
  R(ctx, x - 4, top - 14, w + 8, 12, L(tenement ? "#3a3a3a" : "#3d2a20"));
  R(ctx, x - 4, top - 2, w + 8, 4, L(tenement ? "#2a2a2a" : "#2f2018"));
  if (orn() > 0.2) for (var bx = x + 2; bx < x + w - 4; bx += Math.max(12, w / 8)) R(ctx, bx, top + 2, 5, 9, L(tenement ? "#3a3a3a" : "#3d2a20"));
  var nw = w > 104 ? 3 : 2, ww = (w - 24 - (nw - 1) * 12) / nw;
  for (var f = 0; f < floors - 1; f++) {
    var fy = top + f * fh + 14;
    for (var i = 0; i < nw; i++) {
      var wx = x + 12 + i * (ww + 12), wh = fh * 0.62;
      R(ctx, wx - 3, fy - 6, ww + 6, 6, L(trim, tenement ? 1 : 0.85));
      frameWindow(ctx, r, wx, fy, ww, wh, L(tenement ? "#f2ede4" : "#2d1e16"), 1, 2);
      R(ctx, wx - 2, fy + wh, ww + 4, 3, L(trim, tenement ? 1 : 0.85));
    }
  }
  if (tenement) {
    // fire escape
    var fx = x + 8, fw = w - 16;
    ctx.strokeStyle = L("#1e1e1e"); ctx.lineWidth = 1.2;
    for (var f2 = 0; f2 < floors - 1; f2++) {
      var py = top + (f2 + 1) * fh - 4;
      ctx.beginPath(); ctx.moveTo(fx, py); ctx.lineTo(fx + fw, py); ctx.moveTo(fx, py - 16); ctx.lineTo(fx + fw, py - 16);
      for (var rx = fx; rx <= fx + fw; rx += 4) { ctx.moveTo(rx, py); ctx.lineTo(rx, py - 16); }
      ctx.stroke();
      R(ctx, fx, py, fw, 2.5, L("#1e1e1e"));
      if (f2 < floors - 2) { ctx.beginPath(); var lr = f2 % 2 ? fx + 6 : fx + fw - 6; ctx.moveTo(lr, py); ctx.lineTo(f2 % 2 ? fx + fw - 6 : fx + 6, py + fh - 2); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1.2; }
    }
    // shopfront
    var gy = G - gh;
    R(ctx, x + 2, gy + 6, w - 4, 20, L(pick(r, ["#1d3b2a", "#7a1f1f", "#1f2f4f", "#e1b12c"])));
    signText(ctx, pick(r, ["Deli", "Bodega", "Books", "Coffee", "Bagels", "Laundromat", "Pizza", "Hardware", "Records", "Bakery"]), x + w / 2, gy + 16.5, 12, L("#f8f1e1", 1.1), STYLE.fontSign, "center", w - 16);
    frameWindow(ctx, r, x + 6, gy + 30, w - 40, gh - 34, L("#222222"), 2, 1, { shop: true });
    R(ctx, x + w - 30, gy + 30, 22, gh - 30, L("#3a2a20"));
    nglow(ctx, x + w / 2, gy + 50, w * 0.6, "rgb(255,214,150)", 0.4);
  } else {
    // stoop to the parlour floor
    var gy2 = G - gh, side = r() < 0.5, dx = side ? x + 10 : x + w - 36;
    R(ctx, dx, gy2 - 52, 26, 52, L("#2a1a12")); R(ctx, dx - 4, gy2 - 58, 34, 6, L(trim));
    glass(ctx, r, dx + 4, gy2 - 48, 18, 10);
    var stx = side ? dx - 2 : dx - 40, steps = 7;
    ctx.fillStyle = L(wall, 0.9);
    ctx.beginPath(); ctx.moveTo(dx - 2, gy2); ctx.lineTo(dx + 28, gy2);
    ctx.lineTo(side ? dx + 28 + 40 : dx + 28, G); ctx.lineTo(side ? dx - 2 : dx - 2 - 40, G); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = L(wall, 0.7); ctx.lineWidth = 1; ctx.beginPath();
    for (var s = 1; s < steps; s++) { var yy = gy2 + s * gh / steps, off = s * 40 / steps; ctx.moveTo(side ? dx - 2 : dx - 2 - off, yy); ctx.lineTo(side ? dx + 28 + off : dx + 28, yy); }
    ctx.stroke();
    ctx.strokeStyle = L("#151515"); ctx.lineWidth = 1.4; ctx.beginPath();
    ctx.moveTo(side ? dx + 28 : dx - 2, gy2 - 16); ctx.lineTo(side ? dx + 72 : dx - 46, G - 16); ctx.lineTo(side ? dx + 72 : dx - 46, G);
    ctx.stroke();
    // garden-level windows
    var gwx = side ? x + w - 40 : x + 12;
    frameWindow(ctx, r, gwx, gy2 + 26, 28, 36, L("#2d1e16"), 1, 2);
    nglow(ctx, dx + 13, gy2 - 60, 26, "rgb(255,214,150)", 0.5);
  }
}

/* ---------- London: Georgian terrace ---------- */
var LD_BRICK = ["#b08a5e", "#a67c52", "#8f6a48", "#c2a070", "#7d5a40"];
function drawLondon(ctx, b) {
  var r = mulberry32(b.seed), tr = mulberry32(b.tone || b.seed), x = b.x, w = b.w, n = (b.floors || 2) + 1;
  var gh = 108 * b.hmul, fh = 92 * b.hmul, top = G - gh - fh * (n - 1);
  var brick = pick(tr, LD_BRICK), stucco = "#f2efe6", door = pick(r, ["#1f3d2b", "#1d2c4f", "#7a1f1f", "#1d1d1d", "#d9a514", "#3b5a7a"]);
  // slate roof behind the parapet, chimney stack on the party wall
  R(ctx, x, top - 26, w, 26, L("#5a606b"));
  chimney(ctx, x + w - 24, top - 58, 22, 40, "#9a7450", "#c9764a", hash2(b.seed, 3) < 0.4);
  R(ctx, x, top, w, G - top, L(brick));
  if (orn() > 0.3) brickCourses(ctx, x, top, w, G - gh - top, L(brick, 0.88), 4);
  R(ctx, x, top - 8, w, 8, L(stucco)); R(ctx, x, top, w, 3, L(stucco, 0.85));
  R(ctx, x + w - 1, top, 1, G - top, L(brick, 0.7));
  var nw = w > 96 ? 3 : 2, gap = 12, ww = (w - 24 - (nw - 1) * gap) / nw;
  for (var f = 0; f < n - 1; f++) {
    var fy = top + f * fh, tall = f === n - 2;        // the first floor carries the tallest sashes
    var wh = fh * (tall ? 0.74 : f === 0 ? 0.5 : 0.62), wy = fy + fh - wh - 12;
    for (var i = 0; i < nw; i++) {
      var wx = x + 12 + i * (ww + gap);
      ctx.fillStyle = L("#c2573a"); ctx.beginPath(); ctx.moveTo(wx - 3, wy); ctx.lineTo(wx + ww + 3, wy); ctx.lineTo(wx + ww + 5, wy - 8); ctx.lineTo(wx - 5, wy - 8); ctx.fill();
      frameWindow(ctx, r, wx, wy, ww, wh, L(stucco), 3, tall ? 4 : 3);
      R(ctx, wx - 3, wy + wh, ww + 6, 3, L(stucco, 0.92));
      if (tall && orn() > 0.25) railing(ctx, wx - 3, wy + wh - 16, ww + 6, 15, L("#1b1b1d"));
      else if (r() < 0.2 * orn()) flowerBox(ctx, r, wx, wy + wh - 5, ww);
    }
  }
  // stucco ground floor with channelled joints
  var gy = G - gh;
  R(ctx, x, gy, w, gh, L(stucco)); R(ctx, x, gy, w, 5, L(stucco, 0.88));
  ctx.strokeStyle = L(stucco, 0.86); ctx.lineWidth = 1; ctx.beginPath();
  for (var ry = gy + 16; ry < G - 4; ry += 13) { ctx.moveTo(x, ry); ctx.lineTo(x + w, ry); }
  ctx.stroke();
  // front door under a fanlight
  var side = r() < 0.5, dw = 26, dx = side ? x + 12 : x + w - 12 - dw, dy = gy + 38;
  ctx.fillStyle = L(stucco, 0.8); ctx.beginPath(); ctx.arc(dx + dw / 2, dy, dw / 2 + 4, Math.PI, 0); ctx.fill(); R(ctx, dx - 4, dy, dw + 8, G - dy, L(stucco, 0.8));
  ctx.fillStyle = EM("#3a4652"); ctx.beginPath(); ctx.arc(dx + dw / 2, dy, dw / 2, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = L(stucco); ctx.lineWidth = 1; ctx.beginPath();
  for (var a = 1; a < 5; a++) { var an = Math.PI + a * Math.PI / 5; ctx.moveTo(dx + dw / 2, dy); ctx.lineTo(dx + dw / 2 + Math.cos(an) * dw / 2, dy + Math.sin(an) * dw / 2); }
  ctx.stroke();
  R(ctx, dx, dy, dw, G - dy, L(door));
  ctx.strokeStyle = L(door, 0.7); ctx.lineWidth = 1;
  ctx.strokeRect(dx + 4, dy + 5, dw / 2 - 6, 22); ctx.strokeRect(dx + dw / 2 + 2, dy + 5, dw / 2 - 6, 22); ctx.strokeRect(dx + 4, dy + 34, dw - 8, G - dy - 40);
  R(ctx, dx + dw / 2 - 4, dy + 30, 8, 2, L("#d9b44a"));
  R(ctx, dx - 6, G - 5, dw + 12, 5, L("#b9b3a6"));
  nglow(ctx, dx + dw / 2, dy - 4, 32, "rgb(255,214,150)", 0.45);
  var gx = side ? dx + dw + 14 : x + 12, gw = w - dw - 38;
  frameWindow(ctx, r, gx, gy + 26, gw, gh - 52, L(stucco, 1.02), gw > 44 ? 4 : 3, 3);
  // area railings
  var rx0 = side ? dx + dw + 7 : x + 2, rx1 = side ? x + w - 2 : dx - 7;
  ctx.strokeStyle = L("#17171a"); ctx.lineWidth = 1.2; ctx.beginPath();
  for (var px = rx0; px <= rx1; px += 5) { ctx.moveTo(px, G); ctx.lineTo(px, G - 27); }
  ctx.moveTo(rx0, G - 23); ctx.lineTo(rx1, G - 23); ctx.moveTo(rx0, G - 4); ctx.lineTo(rx1, G - 4); ctx.stroke();
  if (r() < 0.12) { ctx.fillStyle = L("#2a56a5"); ctx.beginPath(); ctx.arc(x + w / 2, gy - 20, 7, 0, 6.3); ctx.fill(); ctx.strokeStyle = L("#f2efe6"); ctx.lineWidth = 0.8; ctx.stroke(); }
}

/* ---------- Lisbon: azulejo fronts ---------- */
var LS_TILE = [["#3f6fa8", "#e8eef4"], ["#2f7d6a", "#eef2e6"], ["#c9a227", "#f6efd8"], ["#8a4a6b", "#f1e6ec"], ["#5a8fb8", "#f4f1e6"]];
var LS_WALL = ["#f1c8a0", "#f6dc8c", "#e9a9a0", "#f3ead8", "#c8dce8", "#e8b673"];
var LS_SHOP = ["Pastelaria", "Mercearia", "Livraria", "Tasca", "Ginjinha", "Padaria", "Retrosaria", "Barbearia", "Café", "Conservas"];
function drawLisbon(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w, floors = r() < 0.5 ? 3 : 4, i, f, tx, ty;
  var gh = 104 * b.hmul, fh = 82 * b.hmul, top = G - gh - fh * floors;
  var tiled = r() < 0.62, tc = pick(r, LS_TILE), wall = pick(r, LS_WALL), stone = "#e6ddc8";
  // terracotta roof, sometimes with a dormer
  ctx.fillStyle = L("#c2603a"); ctx.beginPath(); ctx.moveTo(x - 3, top); ctx.lineTo(x + 8, top - 34); ctx.lineTo(x + w - 8, top - 34); ctx.lineTo(x + w + 3, top); ctx.fill();
  ctx.strokeStyle = L("#9a4526"); ctx.lineWidth = 0.8; ctx.beginPath();
  for (tx = x + 4; tx < x + w; tx += 5) { ctx.moveTo(tx, top); ctx.lineTo(tx + (x + w / 2 - tx) * 0.06, top - 34); }
  ctx.stroke();
  if (r() < 0.6) {
    var dx = x + w * rr(r, 0.25, 0.6);
    R(ctx, dx, top - 30, 24, 28, L(stone)); frameWindow(ctx, r, dx + 4, top - 26, 16, 18, L("#f6f3ea"), 2, 2);
    ctx.fillStyle = L("#c2603a"); ctx.beginPath(); ctx.moveTo(dx - 3, top - 30); ctx.lineTo(dx + 12, top - 41); ctx.lineTo(dx + 27, top - 30); ctx.fill();
  }
  R(ctx, x, top, w, G - top, L(tiled ? tc[1] : wall));
  if (tiled && orn() > 0.1) {
    ctx.fillStyle = L(tc[0]); ctx.globalAlpha = 0.5; ctx.beginPath();
    for (ty = top + 4; ty < G - gh - 4; ty += 6) for (tx = x + 8; tx < x + w - 10; tx += 6) {
      ctx.moveTo(tx + 3, ty + 0.6); ctx.lineTo(tx + 5.2, ty + 2.8); ctx.lineTo(tx + 3, ty + 5); ctx.lineTo(tx + 0.8, ty + 2.8);
    }
    ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = L(tc[0]); ctx.globalAlpha = 0.16; ctx.lineWidth = 0.5; ctx.beginPath();
    for (ty = top + 4; ty < G - gh - 4; ty += 6) { ctx.moveTo(x + 6, ty); ctx.lineTo(x + w - 6, ty); }
    for (tx = x + 8; tx < x + w - 6; tx += 6) { ctx.moveTo(tx, top); ctx.lineTo(tx, G - gh); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  R(ctx, x, top, 6, G - top, L(stone)); R(ctx, x + w - 6, top, 6, G - top, L(stone)); R(ctx, x - 2, top - 5, w + 4, 8, L(stone, 1.03));
  var cols = Math.max(2, Math.round(w / 44)), cw = (w - 12) / cols;
  for (f = 0; f < floors; f++) {
    var fy = top + f * fh;
    for (i = 0; i < cols; i++) {
      var wx = x + 6 + i * cw + cw * 0.22, ww = cw * 0.56, wh = fh * 0.7, wy = fy + fh * 0.14;
      R(ctx, wx - 3, wy - 3, ww + 6, wh + 5, L(stone));
      frameWindow(ctx, r, wx, wy, ww, wh, L("#f6f3ea"), 2, 3);
      R(ctx, wx - 6, wy + wh + 1, ww + 12, 3, L(stone, 0.9));
      railing(ctx, wx - 5, wy + wh - 15, ww + 10, 16, L("#1f2a24"));
      var extra = r();
      if (extra < 0.2) for (var q = 0; q < 3; q++) R(ctx, wx - 3 + q * (ww + 6) / 3, wy + wh - 13, (ww + 6) / 3 - 2, 12 + r() * 9, L(pick(r, ["#f2f2f2", "#e2524a", "#3f6fa8", "#f3c13a", "#e8a0b4"])));
      else if (extra < 0.4 * orn()) flowerBox(ctx, r, wx - 2, wy + wh - 4, ww + 4);
    }
    R(ctx, x + 6, fy + fh - 2, w - 12, 2, L(stone, 0.92));
  }
  // stone ground floor: arched doorway and shop
  var gy = G - gh;
  R(ctx, x, gy, w, gh, L(stone)); R(ctx, x, gy, w, 4, L(stone, 0.88));
  var nb = Math.max(2, Math.round(w / 52)), bw = (w - 12) / nb, doorAt = Math.floor(r() * nb);
  for (i = 0; i < nb; i++) {
    var ax = x + 6 + i * bw + 5, aw = bw - 10, ay = gy + 30;
    ctx.fillStyle = L("#2e2a26"); ctx.beginPath(); ctx.moveTo(ax, G); ctx.lineTo(ax, ay + aw / 2); ctx.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(ax + aw, G); ctx.fill();
    if (i === doorAt) R(ctx, ax + 3, ay + aw / 2 + 2, aw - 6, G - ay - aw / 2 - 2, L(pick(r, ["#1f4a3a", "#5a1f1f", "#1d3354"])));
    else frameWindow(ctx, r, ax + 3, ay + aw / 2 - 2, aw - 6, G - ay - aw / 2 - 12, L("#3a2a1e"), 2, 1, { shop: true });
  }
  R(ctx, x + 10, gy + 8, w - 20, 16, L(tc[0], 0.8));
  signText(ctx, pick(r, LS_SHOP), x + w / 2, gy + 16.5, 11, L("#f6efd8", 1.05), STYLE.fontSign, "center", w - 30);
  nglow(ctx, x + w / 2, G - 40, w * 0.5, "rgb(255,210,140)", 0.35);
}

/* ---------- Hanoi: tube houses ---------- */
var HN_WALL = ["#f1d27a", "#e9c46a", "#f3e2b0", "#d9e6d0", "#f2b8a0", "#cfe0ea", "#e8d8c0", "#b9d8c8"];
var HN_SHOP = ["Phở", "Cà Phê", "Bánh Mì", "Bún Chả", "Trà Đá", "Tạp Hóa", "May Đo", "Sửa Xe", "Hoa Tươi", "Kem"];
var HN_SIGN = [["#c0392b", "#ffe9a8"], ["#1f5fa8", "#ffffff"], ["#f1c40f", "#a11d1d"], ["#2e7d32", "#ffffff"], ["#f4f1e6", "#c0392b"]];
function drawHanoi(ctx, b) {
  var r = mulberry32(b.seed), x = b.x, w = b.w, floors = Math.floor(rr(r, 3, 6.99)), q;
  var gh = 88 * b.hmul, fh = 70 * b.hmul, top = G - gh - fh * (floors - 1), wall = pick(r, HN_WALL), green = "#2f6b4f";
  R(ctx, x, top, w, G - top, L(wall));
  ctx.fillStyle = "rgba(90,80,60,.10)";
  for (q = 0; q < 4; q++) ctx.fillRect(x + r() * (w - 6), top, 2 + r() * 5, (G - gh - top) * r());
  var rt = r();
  if (rt < 0.4) {
    R(ctx, x, top - 14, w, 14, L(wall, 0.9));
    for (q = 0; q < 4; q++) { ctx.fillStyle = L(pick(r, ["#3f7a3c", "#5d8a41", "#2f6b4f"])); ctx.beginPath(); ctx.arc(x + 8 + r() * (w - 16), top - 16, 5 + r() * 5, 0, 6.3); ctx.fill(); }
  } else if (rt < 0.75) {
    ctx.fillStyle = L("#b5583a"); ctx.beginPath(); ctx.moveTo(x - 2, top); ctx.lineTo(x + w / 2, top - 30); ctx.lineTo(x + w + 2, top); ctx.fill();
  } else {
    R(ctx, x + w * 0.2 + 4, top - 8, 2, 8, L("#5d6266")); R(ctx, x + w * 0.2 + 22, top - 8, 2, 8, L("#5d6266"));
    ctx.fillStyle = L("#c4cbd0"); ctx.beginPath(); ctx.ellipse(x + w * 0.2 + 14, top - 17, 17, 10, 0, 0, 6.3); ctx.fill();
  }
  for (var f = 0; f < floors - 1; f++) {
    var fy = top + f * fh, ww = w - 24, wh = fh * 0.64, wx = x + 12, wy = fy + 8;
    frameWindow(ctx, r, wx, wy, ww, wh, L("#efe7d2"), ww > 44 ? 3 : 2, 2);
    if (r() < 0.55) { louvres(ctx, wx - 8, wy, 8, wh, L(green), L(green, 0.7)); louvres(ctx, wx + ww, wy, 8, wh, L(green), L(green, 0.7)); }
    R(ctx, x + 2, fy + fh - 8, w - 4, 4, L(wall, 0.8));
    railing(ctx, x + 4, fy + fh - 24, w - 8, 16, L("#2a2a2a"));
    if (r() < 0.5) for (q = 0; q < 3; q++) { ctx.fillStyle = L(pick(r, ["#3f7a3c", "#5d8a41", "#2f6b4f"])); ctx.beginPath(); ctx.arc(x + 9 + r() * (w - 18), fy + fh - 27, 4 + r() * 4, 0, 6.3); ctx.fill(); }
    if (r() < 0.25) acUnit(ctx, x + w - 28, fy + fh - 42);
    if (r() < 0.2) for (q = 0; q < 4; q++) R(ctx, x + 8 + q * (w - 16) / 4, fy + fh - 22, (w - 16) / 4 - 3, 9 + r() * 7, L(pick(r, ["#f2f2f2", "#e2524a", "#3f6fa8", "#f3c13a", "#7fb8a0"])));
  }
  // open shopfront under a pulled-out awning
  var gy = G - gh, sc = pick(r, HN_SIGN);
  R(ctx, x + 3, gy + 6, w - 6, gh - 6, L("#2b2622"));
  frameWindow(ctx, r, x + 6, gy + 34, w - 12, gh - 38, L("#4a3a2a"), 2, 1, { shop: true });
  R(ctx, x + 2, gy - 2, w - 4, 20, EM(sc[0]));
  signText(ctx, pick(r, HN_SHOP), x + w / 2, gy + 8.5, 11, EM(sc[1]), STYLE.fontSans, "center", w - 12);
  ctx.fillStyle = L(pick(r, ["#2f5f8f", "#2f7d62", "#c0392b", "#e1b12c", "#7f8c8d"])); ctx.beginPath();
  ctx.moveTo(x, gy + 18); ctx.lineTo(x + w, gy + 18); ctx.lineTo(x + w + 4, gy + 34); ctx.lineTo(x - 4, gy + 34); ctx.fill();
  for (q = 0; q < 3; q++) if (r() < 0.6) R(ctx, x + 8 + q * (w - 16) / 3, G - 9, 8, 9, L(q % 2 ? "#c0392b" : "#1f5fa8"));
  if (r() < 0.25) emit("lantern", x + w / 2, gy + 36);
  nglow(ctx, x + w / 2, gy + 52, w * 0.7, "rgb(255,214,150)", 0.4);
}
