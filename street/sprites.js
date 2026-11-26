/* ===== Endless Street: people, pets, creatures and vehicles (drawn facing right, feet at y = 0) ===== */
var SKIN = ["#f1c9a5", "#e0ac83", "#c68a5e", "#9a6440", "#6e452b", "#f6d7bd"];
var HAIR = ["#1d1a17", "#3b2a1f", "#6b4a2b", "#a87a45", "#d8c08a", "#8a8a8a", "#e9e4dc", "#7a2e1f"];
var TOPS = ["#c0392b", "#2c5d8f", "#2f7d62", "#e1b12c", "#8e44ad", "#f2f2f2", "#2b2b2b", "#d35400", "#7f8c8d", "#e8a0b4", "#1f3a5f", "#a0522d", "#5d8a41"];
var BOTTOMS = ["#2b2f3a", "#1d1d1d", "#3e4b5e", "#6b5a48", "#c8b89a", "#4a3b6b", "#2d4a3a"];
var DOGS = ["#c8a165", "#2b2420", "#f2ece2", "#8a5a33", "#d9b48a", "#6b6b6b"];
function makePerson(r, city) {
  var P = {
    h: rr(r, 0.92, 1.08), skin: pick(r, SKIN), hair: pick(r, HAIR), top: pick(r, TOPS), bottom: pick(r, BOTTOMS),
    shoes: pick(r, ["#1d1d1d", "#5a3a22", "#f2f2f2", "#7a1f1f"]), dress: r() < 0.28, long: r() < 0.4,
    hat: null, item: null, kind: "walk"
  };
  var it = r();
  if (city === "paris") P.item = it < 0.25 ? "baguette" : it < 0.45 ? "bag" : null;
  else if (city === "tokyo") P.item = it < 0.3 ? "briefcase" : it < 0.45 ? "umbrella" : null;
  else if (city === "singapore") P.item = it < 0.3 ? "tote" : it < 0.4 ? "umbrella" : null;
  else if (city === "brooklyn") P.item = it < 0.3 ? "coffee" : it < 0.45 ? "bag" : null;
  else P.item = it < 0.25 ? "bag" : null;
  var ht = r();
  if (city === "paris" && ht < 0.15) P.hat = "beret";
  else if (city === "brooklyn" && ht < 0.15) P.hat = "cap";
  else if (city === "singapore" && ht < 0.1) P.hat = "cap";
  else if (ht < 0.06) P.hat = "cap";
  return P;
}
function limb(ctx, x, y, len, ang, w, col) {
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, y); var ex = x + Math.sin(ang) * len, ey = y + Math.cos(ang) * len; ctx.lineTo(ex, ey); ctx.stroke();
  return [ex, ey];
}
function drawHead(ctx, P, x, y) {
  ctx.fillStyle = L(P.skin); ctx.beginPath(); ctx.arc(x, y, 4.4, 0, 6.3); ctx.fill();
  ctx.fillStyle = L(P.hair); ctx.beginPath(); ctx.arc(x - 0.6, y - 0.8, 4.6, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
  if (P.long) { ctx.fillRect(x - 4.8, y - 1, 3.2, 8); }
  if (P.hat === "beret") { ctx.fillStyle = L("#2b2b2b"); ctx.beginPath(); ctx.ellipse(x - 0.5, y - 4, 5.5, 2.2, -0.15, 0, 6.3); ctx.fill(); }
  if (P.hat === "cap") { ctx.fillStyle = L(P.top, 0.8); ctx.beginPath(); ctx.arc(x, y - 1.5, 4.6, Math.PI, 0); ctx.fill(); ctx.fillRect(x, y - 2.5, 7, 1.6); }
}
// frame 0/1: alternate stride positions
function drawWalker(ctx, P, f, jog) {
  var s = P.h, hip = -20 * s, sh = -36 * s;
  ctx.save(); ctx.scale(1, 1);
  if (jog) { ctx.translate(0, f ? -1.5 : 0); }
  var a = jog ? 0.55 : 0.38, legs = f ? [a, -a] : [0.06, -0.06];
  var lean = jog ? 0.12 : 0.02;
  // back leg, back arm
  var p1 = limb(ctx, 0, hip, 10.5 * s, legs[1], 3.6, L(P.bottom, 0.82));
  limb(ctx, p1[0], p1[1], 10 * s, legs[1] * (jog ? 0.2 : 0.6) - (jog && !f ? 0.5 : 0), 3.4, L(P.bottom, 0.82));
  var arm = f ? 0.5 : 0.08;
  limb(ctx, sin(lean) * 16, sh + 2, 13 * s, -arm * (jog ? 0.4 : 1) + (jog ? 0.9 : 0), 3, L(P.top, 0.75));
  // front leg
  var p2 = limb(ctx, 0, hip, 10.5 * s, legs[0], 3.6, L(P.bottom));
  var foot = limb(ctx, p2[0], p2[1], 10 * s, legs[0] * (jog ? 0.3 : 0.6) - (jog && f ? 0.6 : 0), 3.4, L(P.bottom));
  ctx.fillStyle = L(P.shoes); ctx.beginPath(); ctx.ellipse(foot[0] + 1.5, foot[1] - 0.5, 3, 1.6, 0, 0, 6.3); ctx.fill();
  ctx.fillStyle = L(P.shoes, 0.8); ctx.beginPath(); ctx.ellipse(p1[0] + Math.sin(legs[1] * 0.6) * 10 * s + 1.5, p1[1] + 10 * s - 0.5, 3, 1.6, 0, 0, 6.3); ctx.fill();
  // torso
  ctx.save(); ctx.translate(0, hip); ctx.rotate(lean);
  ctx.fillStyle = L(P.top);
  ctx.beginPath();
  if (P.dress && !jog) { ctx.moveTo(-4.5, -16 * s); ctx.lineTo(4.5, -16 * s); ctx.lineTo(7, 7 * s); ctx.lineTo(-7, 7 * s); }
  else { ctx.moveTo(-4.8, -17 * s); ctx.lineTo(4.8, -17 * s); ctx.lineTo(5.4, 1); ctx.lineTo(-5.4, 1); }
  ctx.closePath(); ctx.fill();
  drawHead(ctx, P, 0.6, -21.5 * s);
  ctx.restore();
  // front arm and item
  var hx = Math.sin(lean) * 16 + 0.5, hy = sh + 2;
  var hand = limb(ctx, hx, hy, 13 * s, arm * (jog ? 0.4 : 1) + (jog ? 0.9 : 0), 3, L(P.top, 0.9));
  if (!jog) drawItem(ctx, P, hand, hx, hy);
  ctx.fillStyle = L(P.skin); ctx.beginPath(); ctx.arc(hand[0], hand[1], 1.6, 0, 6.3); ctx.fill();
  ctx.restore();
}
function sin(a) { return Math.sin(a); }
function drawItem(ctx, P, hand, sx, sy) {
  var x = hand[0], y = hand[1];
  if (P.item === "bag" || P.item === "tote") {
    ctx.strokeStyle = L("#3a2a1e"); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x - 3, y + 3); ctx.moveTo(x + 2, y); ctx.lineTo(x + 3, y + 3); ctx.stroke();
    R(ctx, x - 4, y + 3, 8, 7, L(P.item === "tote" ? "#e9dcc0" : "#7a4a2b"));
  } else if (P.item === "briefcase") {
    R(ctx, x - 4.5, y + 1, 9, 6.5, L("#2b2420"));
  } else if (P.item === "coffee") {
    R(ctx, x - 1.6, y - 4, 3.2, 4.5, L("#f2ece2")); R(ctx, x - 1.8, y - 4.6, 3.6, 1.2, L("#3a2a1e"));
  } else if (P.item === "baguette") {
    ctx.save(); ctx.translate(sx + 1, sy + 4); ctx.rotate(-0.9);
    ctx.fillStyle = L("#d9a35a"); ctx.beginPath(); ctx.ellipse(0, 0, 11, 1.8, 0, 0, 6.3); ctx.fill(); ctx.restore();
  } else if (P.item === "umbrella") {
    ctx.strokeStyle = L("#2b2b2b"); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 30); ctx.stroke();
    ctx.fillStyle = L(P.top, 0.9); ctx.beginPath(); ctx.arc(x, y - 28, 13, Math.PI, 0); ctx.fill();
  }
}
function drawDog(ctx, D, x, f) {
  var s = D.size, y = 0, c = L(D.color), c2 = L(D.color, 0.8);
  var bl = 13 * s, bh = 5.5 * s, legY = -6 * s * (D.short ? 0.6 : 1);
  var la = f ? 0.4 : -0.2, lb = f ? -0.3 : 0.35;
  [[-bl * 0.38, la, c2], [bl * 0.32, lb, c2], [-bl * 0.3, -la, c], [bl * 0.4, -lb, c]].forEach(function(l) {
    limb(ctx, x + l[0], legY + y, -legY, l[1], 2.2 * s, l[2]);
  });
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, legY - bh * 0.4, bl / 2, bh / 2 + 0.6, 0, 0, 6.3); ctx.fill();
  // head + snout + ear
  var hx = x + bl * 0.55, hy = legY - bh * 1.05;
  ctx.beginPath(); ctx.arc(hx, hy, 3.6 * s, 0, 6.3); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx + 3.4 * s, hy + 1 * s, 2.6 * s, 1.7 * s, 0, 0, 6.3); ctx.fill();
  ctx.fillStyle = L("#1d1d1d"); ctx.beginPath(); ctx.arc(hx + 5.6 * s, hy + 0.6 * s, 0.9 * s, 0, 6.3); ctx.fill();
  ctx.fillStyle = c2; ctx.beginPath(); ctx.ellipse(hx - 1 * s, hy - 0.2 * s, 1.5 * s, 3 * s, 0.3, 0, 6.3); ctx.fill();
  // tail (wags between frames)
  ctx.strokeStyle = c; ctx.lineWidth = 1.8 * s; ctx.beginPath(); ctx.moveTo(x - bl / 2, legY - bh * 0.6);
  ctx.quadraticCurveTo(x - bl / 2 - 4 * s, legY - bh - (f ? 5 : 2) * s, x - bl / 2 - (f ? 2 : 5) * s, legY - bh - 7 * s); ctx.stroke();
  return [hx, hy + 2 * s];
}
function drawCyclist(ctx, P, B, f) {
  var wr = 8.5, fx = 13, bx = -12;
  ctx.strokeStyle = L("#2b2b2b"); ctx.lineWidth = 1.2;
  [bx, fx].forEach(function(cx) {
    ctx.beginPath(); ctx.arc(cx, -wr, wr, 0, 6.3); ctx.stroke();
    ctx.lineWidth = 0.4; ctx.beginPath();
    for (var sp = 0; sp < 6; sp++) { var a = sp * Math.PI / 3 + (f ? 0.5 : 0); ctx.moveTo(cx, -wr); ctx.lineTo(cx + Math.cos(a) * wr, -wr + Math.sin(a) * wr); }
    ctx.stroke(); ctx.lineWidth = 1.2;
  });
  var crank = [0, -wr], seat = [-4, -wr - 13], bar = [9, -wr - 15];
  ctx.strokeStyle = L(B.color); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, -wr); ctx.lineTo(crank[0], crank[1]); ctx.lineTo(seat[0], seat[1]); ctx.lineTo(bx, -wr);
  ctx.moveTo(crank[0], crank[1]); ctx.lineTo(bar[0] - 1, bar[1] + 3); ctx.lineTo(seat[0] + 1, seat[1] + 1);
  ctx.moveTo(fx, -wr); ctx.lineTo(bar[0], bar[1]); ctx.stroke();
  ctx.strokeStyle = L("#2b2b2b"); ctx.beginPath(); ctx.moveTo(bar[0] - 2, bar[1] - 1); ctx.lineTo(bar[0] + 3, bar[1] - 2); ctx.moveTo(seat[0] - 3, seat[1]); ctx.lineTo(seat[0] + 3, seat[1]); ctx.stroke();
  if (B.basket) { R(ctx, fx - 1, -wr - 17, 9, 6, L("#a87a45")); ctx.fillStyle = L(pick(mulberry32(B.seed), ["#e2524a", "#f3c13a", "#e86fa5"])); ctx.beginPath(); ctx.arc(fx + 2, -wr - 18, 2, 0, 6.3); ctx.arc(fx + 5, -wr - 18.5, 2, 0, 6.3); ctx.fill(); }
  // rider
  var hip = [seat[0], seat[1] - 1], s = P.h;
  var pedA = f ? [crank[0] + 4, crank[1] - 2] : [crank[0] - 3, crank[1] + 3];
  var pedB = f ? [crank[0] - 4, crank[1] + 2] : [crank[0] + 3, crank[1] - 3];
  function leg(p, col) {
    var mx = (hip[0] + p[0]) / 2 + 5, my = (hip[1] + p[1]) / 2 - 3;
    ctx.strokeStyle = col; ctx.lineWidth = 3.4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(hip[0], hip[1]); ctx.lineTo(mx, my); ctx.lineTo(p[0], p[1]); ctx.stroke();
  }
  leg(pedB, L(P.bottom, 0.8));
  ctx.save(); ctx.translate(hip[0], hip[1]); ctx.rotate(0.35);
  ctx.fillStyle = L(P.top); ctx.beginPath(); ctx.moveTo(-4.6, -16 * s); ctx.lineTo(4.6, -16 * s); ctx.lineTo(5.2, 1); ctx.lineTo(-5.2, 1); ctx.closePath(); ctx.fill();
  drawHead(ctx, P, 0.8, -20.5 * s);
  ctx.restore();
  leg(pedA, L(P.bottom));
  ctx.strokeStyle = L(P.top, 0.9); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hip[0] + 5, hip[1] - 13 * s); ctx.lineTo(bar[0], bar[1] - 1); ctx.stroke();
}
// a full pedestrian sprite: returns the sprite box (units) and draw(ctx, frame)
function pedestrianSprite(seed, city, kind, pets) {
  var r = mulberry32(seed), P = makePerson(r, city);
  var dog = null, bike = null;
  if (kind === "dog") dog = { size: rr(r, 0.7, 1.15), color: pick(r, DOGS), short: r() < 0.3 };
  if (kind === "bike") bike = { color: pick(r, ["#1d1d1d", "#2f5f8f", "#7a1f1f", "#2f7d62", "#e8e2d4", "#c9a227"]), basket: r() < 0.45, seed: seed };
  if (kind === "child") P.h *= 0.68;
  var box = kind === "dog" ? { x0: -18, x1: 58, h: 64 } : kind === "bike" ? { x0: -24, x1: 26, h: 62 } : { x0: -18, x1: 20, h: 64 };
  if (P.item === "umbrella") box.h = 80;
  return {
    box: box, kind: kind, person: P,
    draw: function(ctx, f) {
      if (kind === "bike") { drawCyclist(ctx, P, bike, f); return; }
      if (kind === "dog") {
        var dx = 34 + dog.size * 4, collar = drawDog(ctx, dog, dx, f);
        drawWalker(ctx, P, f, false);
        ctx.strokeStyle = L("#c0392b", 0.9); ctx.lineWidth = 0.8; ctx.beginPath();
        var hx = 6, hy = -24 * P.h; ctx.moveTo(hx, hy); ctx.quadraticCurveTo((hx + collar[0]) / 2, Math.max(hy, collar[1]) + 6, collar[0], collar[1]); ctx.stroke();
        return;
      }
      drawWalker(ctx, P, f, kind === "jog");
    }
  };
}
function catSprite(seed) {
  var r = mulberry32(seed), col = pick(r, ["#2b2420", "#e08a3c", "#f2ece2", "#7a7a7a", "#c8a165"]), eye = r() < 0.5;
  return {
    box: { x0: -10, x1: 12, h: 22 }, color: col,
    draw: function(ctx) {
      var c = L(col);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(0, -6, 6.5, 6, 0, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.arc(3, -14, 4, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0.2, -16.5); ctx.lineTo(1, -20.5); ctx.lineTo(3, -17.5); ctx.moveTo(3.5, -17.6); ctx.lineTo(5.5, -20.5); ctx.lineTo(6.6, -16); ctx.fill();
      if (night() > 0.4 || eye) { ctx.fillStyle = night() > 0.4 ? "#d9f07a" : L("#2a2a2a"); ctx.fillRect(4, -15, 1.1, 1.1); ctx.fillRect(6, -15, 1.1, 1.1); }
    },
    drawTail: function(ctx) { ctx.strokeStyle = L(col); ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-6, -2, -7, -10); ctx.stroke(); }
  };
}
function pigeonSprite(seed) {
  var r = mulberry32(seed), grey = pick(r, ["#8d939b", "#7b8189", "#a0a4aa", "#6c6f75"]);
  return {
    box: { x0: -7, x1: 8, h: 10 },
    draw: function(ctx) {
      ctx.fillStyle = L(grey); ctx.beginPath(); ctx.ellipse(0, -4, 5, 3, -0.1, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-7.5, -2.5); ctx.lineTo(-4, -2.2); ctx.fill();
      ctx.fillStyle = L(grey, 0.75); ctx.beginPath(); ctx.ellipse(-0.5, -4.6, 3.2, 1.6, -0.2, 0, 6.3); ctx.fill();
      ctx.fillStyle = L("#5f6b6a"); ctx.beginPath(); ctx.arc(4.2, -6.8, 1.9, 0, 6.3); ctx.fill();
      ctx.fillStyle = L("#d98a4a"); ctx.fillRect(5.8, -7, 1.6, 0.8); ctx.fillRect(-0.5, -1.2, 0.8, 1.2); ctx.fillRect(1, -1.2, 0.8, 1.2);
    }
  };
}
function boatSprite(seed) {
  var r = mulberry32(seed), hull = pick(r, ["#24533a", "#1f3a5f", "#7a1f1f", "#5a3a22", "#2b2b2b"]), P = makePerson(r, "amsterdam");
  var cabin = r() < 0.5;
  return {
    box: { x0: -46, x1: 50, h: 40 },
    draw: function(ctx) {
      if (cabin) { R(ctx, -22, -24, 34, 12, L("#e8e2d4")); for (var i = 0; i < 3; i++) glass(ctx, mulberry32(seed + i), -19 + i * 11, -21, 7, 6); R(ctx, -24, -26, 38, 2.5, L(hull, 0.8)); }
      else {
        ctx.save(); ctx.translate(-12, -12);
        ctx.fillStyle = L(P.top); ctx.beginPath(); ctx.moveTo(-4.5, -15); ctx.lineTo(4.5, -15); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.fill();
        drawHead(ctx, P, 0.5, -19.5); ctx.restore();
        R(ctx, 8, -18, 12, 6, L("#e9dcc0"));
      }
      ctx.fillStyle = L(hull); ctx.beginPath(); ctx.moveTo(-44, -12); ctx.lineTo(44, -12); ctx.quadraticCurveTo(50, -12, 48, -6); ctx.lineTo(40, 0); ctx.lineTo(-40, 0); ctx.lineTo(-46, -8); ctx.closePath(); ctx.fill();
      R(ctx, -44, -12, 90, 2, L("#e8e2d4", 0.9));
    }
  };
}

/* ---------- vehicles (wheels on y = 0, nose to the right) ---------- */
var CAR_COL = ["#c0392b", "#2c5d8f", "#e8e4dc", "#2b2b2b", "#7f8c8d", "#2f7d62", "#d9a514", "#8e9aa6", "#5a2a3a", "#f2f2f2"];
var TAXI = { brooklyn: "#f2c230", london: "#1d1d1f", tokyo: "#2f6b4f", singapore: "#2c6fb8", paris: "#2b2b2b", lisbon: "#1d1d1f", hanoi: "#2e9a5a" };
var BUS = { london: ["#c8202a", "#c8202a", 2], paris: ["#3f8f6a", "#f2f0e8", 1], singapore: ["#d8232a", "#f4f1ea", 1], tokyo: ["#3a7a4a", "#efe9d8", 1], brooklyn: ["#2a5fa8", "#f2f2f2", 1], hanoi: ["#e8c02a", "#c0392b", 1], lisbon: ["#f2c230", "#f6f1e2", 0] };
function wheel(ctx, x, rad) {
  ctx.fillStyle = L("#1a1a1c"); ctx.beginPath(); ctx.arc(x, -rad, rad, 0, 6.3); ctx.fill();
  ctx.fillStyle = L("#9a9ea3"); ctx.beginPath(); ctx.arc(x, -rad, rad * 0.45, 0, 6.3); ctx.fill();
}
function vehicleSprite(seed, city, kind) {
  var r = mulberry32(seed), col = pick(r, CAR_COL), P = makePerson(r, city);
  if (kind === "taxi") col = TAXI[city] || "#f2c230";
  if (kind === "scooter") return {
    box: { x0: -24, x1: 26, h: 62 }, front: 22, lampY: -24,
    draw: function(ctx) {
      wheel(ctx, -15, 6.5); wheel(ctx, 15, 6.5);
      ctx.fillStyle = L(col); ctx.beginPath(); ctx.moveTo(-22, -10); ctx.lineTo(-20, -20); ctx.lineTo(-2, -20); ctx.lineTo(2, -9); ctx.lineTo(10, -9); ctx.lineTo(14, -28); ctx.lineTo(18, -28); ctx.lineTo(19, -8); ctx.lineTo(-22, -8); ctx.fill();
      R(ctx, -19, -23, 18, 4, L("#2b2420"));
      ctx.strokeStyle = L("#2b2b2b"); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(15, -27); ctx.lineTo(12, -33); ctx.lineTo(17, -34); ctx.stroke();
      // rider
      ctx.strokeStyle = L(P.bottom); ctx.lineWidth = 3.6; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-9, -24); ctx.lineTo(2, -21); ctx.lineTo(4, -10); ctx.stroke();
      ctx.save(); ctx.translate(-9, -24); ctx.rotate(0.14);
      ctx.fillStyle = L(P.top); ctx.beginPath(); ctx.moveTo(-4.6, -17); ctx.lineTo(4.6, -17); ctx.lineTo(5.2, 1); ctx.lineTo(-5.2, 1); ctx.closePath(); ctx.fill();
      drawHead(ctx, P, 0.8, -21.5);
      ctx.fillStyle = L(pick(mulberry32(seed + 5), ["#f2f2f2", "#c0392b", "#2b2b2b", "#e1b12c"])); ctx.beginPath(); ctx.arc(0.6, -22.6, 5, Math.PI, 0); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = L(P.top, 0.9); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-6, -38); ctx.lineTo(13, -33); ctx.stroke(); ctx.lineCap = "butt";
      if (r() < 0.4) R(ctx, -24, -32, 12, 11, L("#a87a45"));
    }
  };
  if (kind === "bus") {
    var B = BUS[city] || ["#2a5fa8", "#f2f2f2", 1], tram = B[2] === 0, dd = B[2] === 2, len = tram ? 190 : 240, hgt = dd ? 104 : tram ? 78 : 74;
    return {
      box: { x0: -len / 2 - 4, x1: len / 2 + 6, h: hgt + (tram ? 26 : 6) }, front: len / 2, lampY: -16, big: true,
      draw: function(ctx) {
        var x0 = -len / 2, i;
        if (tram) { ctx.strokeStyle = L("#2b2b2b"); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-10, -hgt); ctx.lineTo(8, -hgt - 22); ctx.lineTo(26, -hgt); ctx.moveTo(-6, -hgt - 22); ctx.lineTo(22, -hgt - 22); ctx.stroke(); }
        wheel(ctx, x0 + 40, tram ? 7 : 11); wheel(ctx, x0 + len - 44, tram ? 7 : 11);
        ctx.fillStyle = L(B[0]); ctx.beginPath();
        ctx.moveTo(x0, -8); ctx.lineTo(x0, -hgt + 6); ctx.quadraticCurveTo(x0, -hgt, x0 + 6, -hgt); ctx.lineTo(x0 + len - 12, -hgt); ctx.quadraticCurveTo(x0 + len, -hgt, x0 + len, -hgt + 14); ctx.lineTo(x0 + len, -8); ctx.closePath(); ctx.fill();
        if (!dd) R(ctx, x0, -hgt, len - 8, 12, L(B[1]));
        R(ctx, x0, -20, len, 4, L(B[1], 0.9));
        for (var deck = 0; deck < (dd ? 2 : 1); deck++) {
          var wy = dd ? (deck ? -hgt + 8 : -hgt + 52) : -hgt + 18, wh = dd ? 24 : 26, n = Math.floor((len - 30) / 30);
          for (i = 0; i < n; i++) glass(ctx, mulberry32(seed + i + deck * 31), x0 + 8 + i * 30, wy, 25, wh);
          ctx.fillStyle = L("#2c3a46"); ctx.beginPath(); ctx.moveTo(x0 + len - 20, wy); ctx.lineTo(x0 + len - 4, wy + 2); ctx.lineTo(x0 + len - 2, wy + wh); ctx.lineTo(x0 + len - 20, wy + wh); ctx.fill();
        }
        R(ctx, x0 + len - 62, -hgt + (dd ? 52 : 18), 20, hgt - (dd ? 62 : 28), L("#27323c"));
        R(ctx, x0 + len - 3, -22, 3, 6, "#fff3c4"); R(ctx, x0, -24, 2.5, 7, "#c0392b");
        if (dd || !tram) { R(ctx, x0 + len - 60, -hgt + (dd ? 40 : 4), 44, 9, L("#1d1d1f")); R(ctx, x0 + len - 56, -hgt + (dd ? 42 : 6), 20, 5, "#f3c13a"); }
      }
    };
  }
  return {
    box: { x0: -56, x1: 58, h: 50 }, front: 52, lampY: -21,
    draw: function(ctx) {
      wheel(ctx, -31, 8.5); wheel(ctx, 32, 8.5);
      ctx.fillStyle = L(col); ctx.beginPath();
      ctx.moveTo(-52, -8); ctx.lineTo(-52, -22); ctx.quadraticCurveTo(-50, -28, -40, -28); ctx.lineTo(-27, -29); ctx.lineTo(-15, -42); ctx.lineTo(17, -42); ctx.lineTo(31, -29); ctx.lineTo(46, -27);
      ctx.quadraticCurveTo(53, -25, 53, -16); ctx.lineTo(53, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = L("#2c3a46"); ctx.beginPath(); ctx.moveTo(-23, -30); ctx.lineTo(-13, -39.5); ctx.lineTo(0, -39.5); ctx.lineTo(0, -30); ctx.moveTo(3, -30); ctx.lineTo(3, -39.5); ctx.lineTo(15.5, -39.5); ctx.lineTo(26, -30); ctx.fill();
      R(ctx, -52, -14, 105, 2, L(col, 0.78));
      R(ctx, 50, -24, 3, 5, "#fff3c4"); R(ctx, -52, -24, 2.5, 5, "#c0392b");
      if (kind === "taxi") R(ctx, -7, -46.5, 14, 4.5, "#f6d04a");
    }
  };
}
