/* ===== Endless Street: browser runtime ===== */
(function() {
  "use strict";
  var E = window.Endless, $ = function(id) { return document.getElementById(id); };
  var T = 512, PAR = 0.28, PAR2 = 0.5;
  var stage = $("stage"), fxEl = $("fx"), fx2El = $("fx2"), loading = $("loading"), body = document.body;
  var S = null;
  var LIGHT = { hour: 17.4, n: 0 };
  var WX = { kind: "clear", wet: 0, over: 0 };

  /* ---------- tiles are drawn here on the main thread, a few milliseconds at a time ---------- */
  var cur = null, mc = new MessageChannel();
  mc.port1.onmessage = function() {
    if (!cur) return;
    var end = performance.now() + 7, c;
    try {
      while (performance.now() < end) {
        var r = cur.gen.next();
        if (r.done) { c = cur; cur = null; c.res(r.value); return; }
      }
    } catch (err) { c = cur; cur = null; c.rej(err); return; }
    mc.port2.postMessage(0);
  };
  function render(job) {
    return new Promise(function(res, rej) { cur = { gen: renderTile(job, LIGHT), res: res, rej: rej }; mc.port2.postMessage(0); });
  }

  S = E.strip({
    stage: stage, strip: $("strip"),
    layers: [
      { el: $("inner"), y0: VY, h: WH - VY }, { el: $("innerU"), y0: VY, h: WH - VY }, { el: $("innerN"), y0: VY, h: WH - VY },
      { el: $("fore"), y0: FY, h: WH - FY }, { el: $("foreN"), y0: FY, h: WH - FY }
    ],
    extra: [fxEl, fx2El], ownCanvases: true, pixelBudget: 0.75,
    worldH: WH, viewTop: VY, tileW: T, over: 2,
    render: render,
    onTile: function(job, p, tile) { tile.wins = p.wins; tile.uk = p.uk; flushEmitters(); },
    onReady: function() { loading.classList.add("done"); },
    onTap: function() { ui.tap(); },
    onRate: function(r) { skyAnims.forEach(function(a) { if (a.updatePlaybackRate) a.updatePlaybackRate(r); else a.playbackRate = r; }); },
    onScrub: syncSky,
    onHidden: function(h) { skyAnims.forEach(function(a) { if (h) a.pause(); else a.play(); }); },
    onMeasure: function() { if (S) { buildSkyline(); if (S.started) redrawSprites(); sizeWeather(); } },
    onTick: tick
  });
  S.speed = 45;
  var ui = E.chrome(S, {});

  /* ---------- time of day: one clock drives the sky, the night copy and every lamp ---------- */
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function nightness(h) {
    if (h >= 6.9 && h <= 17.8) return 0;
    if (h > 17.8 && h < 20.3) return smooth((h - 17.8) / 2.5);
    if (h < 6.9 && h > 4.9) return 1 - smooth((h - 4.9) / 2.0);
    return 1;
  }
  var SKY = [
    [0, "#03050f", "#0b1129", "#19214a"], [4.8, "#03050f", "#0b1129", "#19214a"], [6.1, "#27356b", "#b98093", "#f3bf98"],
    [7.6, "#7fb0de", "#c6dbea", "#f8dfc6"], [9.5, "#5d9fdb", "#a8cfee", "#dcedf8"], [12.5, "#3f8fd6", "#8cc0ea", "#d4eaf8"],
    [15.8, "#5a9cd9", "#a5cbea", "#e3eef2"], [17.5, "#7d8cc4", "#e59a6a", "#fdd9a0"], [18.6, "#3d3c78", "#b8607a", "#f09a6a"],
    [19.5, "#141a43", "#4d3a72", "#b8607a"], [20.6, "#03050f", "#0b1129", "#19214a"], [24, "#03050f", "#0b1129", "#19214a"]
  ];
  function mixHex(a, b, t) {
    var A = hexRGB(a), B = hexRGB(b);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  function phaseOf(h) { return h < 5 || h >= 20.3 ? "night" : h < 10.5 ? "morning" : h < 16 ? "noon" : h < 18.4 ? "golden" : "dusk"; }
  var skyEl = $("sky"), starsEl = $("stars"), sunEl = $("sun"), moonEl = $("moon"), cloudsEl = $("clouds");
  var nightMain = $("nightMain"), nightFore = $("nightFore"), hourEl = $("hour"), hourOut = $("hourOut"), lastSky = "";
  function applyLight() {
    var h = LIGHT.hour, n = nightness(h), i = 0, ov = WX.over;
    LIGHT.n = n;
    while (i < SKY.length - 2 && SKY[i + 1][0] <= h) i++;
    var a = SKY[i], b = SKY[i + 1], t = (h - a[0]) / (b[0] - a[0]), stops = [];
    var grey = [150 - 110 * n, 158 - 114 * n, 168 - 112 * n];
    for (var q = 1; q <= 3; q++) {
      var c = mixHex(a[q], b[q], t);
      stops.push("rgb(" + Math.round(c[0] + (grey[0] - c[0]) * ov) + "," + Math.round(c[1] + (grey[1] - c[1]) * ov) + "," + Math.round(c[2] + (grey[2] - c[2]) * ov) + ")");
    }
    var sky = "linear-gradient(" + stops[0] + " 0%," + stops[1] + " 55%," + stops[2] + " 100%)";
    if (sky !== lastSky) { skyEl.style.background = sky; lastSky = sky; }
    nightMain.style.opacity = nightFore.style.opacity = n.toFixed(3);
    $("skyB").style.opacity = $("midB").style.opacity = n.toFixed(3);
    body.style.setProperty("--night", n.toFixed(3));
    // warm light near sunrise and sunset, flat light under cloud
    var warm = Math.max(0, 1 - Math.abs(h - 17.7) / 1.7, 1 - Math.abs(h - 6.6) / 1.2) * (1 - ov);
    var bright = (1 - 0.06 * warm) * (1 - 0.16 * ov);
    var tint = warm < 0.02 && ov < 0.02 ? "none" : "sepia(" + (0.3 * warm).toFixed(3) + ") saturate(" + (1 + 0.3 * warm - 0.25 * ov).toFixed(3) + ") brightness(" + bright.toFixed(3) + ")";
    body.style.setProperty("--tint", tint);
    body.style.setProperty("--life", "brightness(" + ((1 - 0.52 * n) * bright).toFixed(3) + ") saturate(" + (1 - 0.3 * n + 0.2 * warm).toFixed(3) + ")");
    starsEl.style.opacity = (Math.max(0, n - 0.45) / 0.55 * (1 - ov)).toFixed(3);
    cloudsEl.style.opacity = cloudsEl.classList.contains("off") ? 0 : Math.min(0.95, 0.7 - 0.55 * n + ov * 0.5).toFixed(3);
    // sun and moon ride an arc across the sky
    var sd = (h - 5.8) / 13.4, md = ((h + 24 - 18.6) % 24) / 12.2;
    sunEl.style.opacity = (sd > 0 && sd < 1 ? Math.min(1, Math.min(sd, 1 - sd) * 14) * (1 - ov) : 0).toFixed(3);
    sunEl.style.transform = "translate(" + (6 + sd * 86).toFixed(2) + "vw," + (62 - Math.sin(Math.PI * sd) * 54).toFixed(2) + "vh) scale(" + (0.75 + 0.8 * Math.pow(1 - Math.sin(Math.PI * Math.max(0, Math.min(1, sd))), 2)).toFixed(3) + ")";
    moonEl.style.opacity = (md > 0 && md < 1 ? Math.min(1, Math.min(md, 1 - md) * 10) * (1 - ov * 0.9) : 0).toFixed(3);
    moonEl.style.transform = "translate(" + (10 + md * 80).toFixed(2) + "vw," + (52 - Math.sin(Math.PI * md) * 42).toFixed(2) + "vh)";
    var ph = phaseOf(h);
    if (body.dataset.tod !== ph) {
      body.dataset.tod = ph;
      var r = document.querySelector("input[name=tod][value=" + ph + "]"); if (r) r.checked = true;
    }
    var hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
    hourOut.textContent = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
    var note = hourOut.textContent + (WX.kind === "clear" ? "" : " \u00b7 " + WX.kind.charAt(0).toUpperCase() + WX.kind.slice(1));
    if ($("signTime").textContent !== note) $("signTime").textContent = note;
    if (document.activeElement !== hourEl) hourEl.value = (Math.round(h * 4) / 4) % 24;
  }
  // switch lights on and off behind the windows of every drawn tile
  function updateWindows() {
    for (var i = 0; i < S.tiles.length; i++) {
      var t = S.tiles[i], wins = t.wins, u = null;
      if (!wins) continue;
      for (var j = 0; j < wins.length; j++) {
        var w = wins[j], on = windowLit(w, LIGHT.n, LIGHT.hour);
        if (on === w.on) continue;
        if (!u) { u = t.els[1].getContext("2d"); u.setTransform(t.uk, 0, 0, t.uk, -t.x0 * t.uk, -VY * t.uk); }
        w.on = on; paintWin(u, w, on);
      }
    }
  }
  var hourTarget = null, dayPass = false, DAY_SECONDS = 480, lastT = performance.now();
  function advanceClock() {
    var now = performance.now(), dt = Math.min(0.5, (now - lastT) / 1000);
    lastT = now;
    if (hourTarget !== null) {
      var d = ((hourTarget - LIGHT.hour + 36) % 24) - 12;
      if (Math.abs(d) < 0.35) { LIGHT.hour = hourTarget; hourTarget = null; }
      else LIGHT.hour = (LIGHT.hour + (d > 0 ? 1 : -1) * Math.min(Math.abs(d), 7 * dt + Math.abs(d) * 1.6 * dt) + 24) % 24;
      applyLight();
    } else if (dayPass && !S.paused && !S.hidden) {
      // dusk and dawn are the show: the clock lingers there and hurries through the small hours
      var rate = LIGHT.hour > 22.5 || LIGHT.hour < 4.5 ? 2.2 : (LIGHT.hour > 17 && LIGHT.hour < 20.6) || (LIGHT.hour > 4.9 && LIGHT.hour < 7.2) ? 0.55 : 1;
      LIGHT.hour = (LIGHT.hour + dt * 24 / DAY_SECONDS * rate) % 24;
      applyLight();
    }
  }

  /* ---------- skyline and back streets: two parallax layers, each with a day and a night face ---------- */
  var skyAnims = [], skyTW = 0;
  function farTexture(nightMode, w, h) {
    var c = document.createElement("canvas"), dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext("2d"); g.scale(dpr, dpr);
    var rnd = mulberry32(4242);
    for (var layer = 1; layer >= 0; layer--) {
      var x = 0, col = nightMode ? (layer ? "#141a36" : "#0c1126") : (layer ? "rgba(146,160,184,.62)" : "rgba(112,124,150,.72)");
      while (x < w) {
        var bw = 24 + rnd() * 90, bh = h * (0.18 + rnd() * (layer ? 0.42 : 0.62)), kind = rnd();
        for (var wrap = -w; wrap <= w; wrap += w) {
          var bx = x + wrap;
          if (bx > w || bx + bw < 0) continue;
          g.fillStyle = col;
          g.fillRect(bx, h - bh, bw, bh);
          if (kind < 0.12) { g.beginPath(); g.moveTo(bx + bw / 2 - 2, h - bh); g.lineTo(bx + bw / 2, h - bh - 40); g.lineTo(bx + bw / 2 + 2, h - bh); g.fill(); }
          else if (kind < 0.2) { g.beginPath(); g.arc(bx + bw / 2, h - bh, bw / 2.4, Math.PI, 0); g.fill(); }
          else if (kind < 0.3) { g.fillRect(bx + bw * 0.25, h - bh - 14, bw * 0.5, 14); }
          if (nightMode && layer === 0) {
            for (var wy = h - bh + 6; wy < h - 4; wy += 7) for (var wx = bx + 4; wx < bx + bw - 4; wx += 6) {
              if (hash2(Math.round(wx - wrap), Math.round(wy)) < 0.16) { g.fillStyle = "rgba(255,214,140,.8)"; g.fillRect(wx, wy, 2, 3); }
            }
            g.fillStyle = col;
          }
        }
        x += bw + (rnd() < 0.3 ? rnd() * 30 : 0);
      }
    }
    return c.toDataURL();
  }
  // the next street back: roofs, chimneys and lit rooms, close enough to read
  function midTexture(nightMode, w, h) {
    var c = document.createElement("canvas"), dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext("2d"); g.scale(dpr, dpr);
    var rnd = mulberry32(977), x = 0;
    var walls = ["#b9b0a2", "#c9bda9", "#a9a69d", "#bba88f", "#9fa7ae", "#c2a88e", "#aab5a4"], roofs = ["#8a5a48", "#6f7783", "#7a6a5c", "#94604a"];
    function shade(hexc, f) { var p = hexRGB(hexc); return nightMode ? "rgb(" + Math.round(p[0] * 0.13 * f) + "," + Math.round(p[1] * 0.15 * f) + "," + Math.round(p[2] * 0.27 * f) + ")" : "rgb(" + Math.round(p[0] * f * 0.8 + 44) + "," + Math.round(p[1] * f * 0.8 + 48) + "," + Math.round(p[2] * f * 0.8 + 56) + ")"; }
    while (x < w) {
      var bw = 46 + rnd() * 80, bh = h * (0.34 + rnd() * 0.5), wall = walls[Math.floor(rnd() * walls.length)], roof = roofs[Math.floor(rnd() * roofs.length)], kind = rnd(), seedx = Math.round(x);
      for (var wrap = -w; wrap <= w; wrap += w) {
        var bx = x + wrap, top = h - bh;
        if (bx > w || bx + bw < 0) continue;
        g.fillStyle = shade(wall, 1); g.fillRect(bx, top, bw + 0.6, bh);
        g.fillStyle = shade(roof, 1);
        if (kind < 0.4) { g.beginPath(); g.moveTo(bx - 2, top); g.lineTo(bx + bw / 2, top - bw * 0.28); g.lineTo(bx + bw + 2, top); g.fill(); }
        else if (kind < 0.65) { g.beginPath(); g.moveTo(bx, top); g.lineTo(bx + 6, top - 20); g.lineTo(bx + bw - 6, top - 20); g.lineTo(bx + bw, top); g.fill(); }
        else g.fillRect(bx, top - 5, bw, 5);
        if (kind > 0.2 && kind < 0.5) { g.fillStyle = shade("#8a6a58", 1); g.fillRect(bx + bw * 0.7, top - 34, 9, 30); }
        if (kind > 0.9) { g.fillStyle = shade("#8f979c", 1); g.fillRect(bx + bw * 0.25, top - 26, 20, 18); g.fillRect(bx + bw * 0.25 + 3, top - 8, 2, 8); g.fillRect(bx + bw * 0.25 + 15, top - 8, 2, 8); }
        var nx = Math.max(2, Math.floor(bw / 16)), cw = bw / nx;
        for (var wy = top + 10; wy < h - 14; wy += 20) for (var i = 0; i < nx; i++) {
          var lit = nightMode && hash2(seedx + i * 7, Math.round(wy - top)) < 0.24;
          g.fillStyle = lit ? "rgba(255,208,130,.9)" : shade("#56626c", 0.9);
          g.fillRect(bx + i * cw + cw * 0.3, wy, cw * 0.4, 10);
        }
      }
      x += bw;
    }
    // distance softens it
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = nightMode ? "rgba(8,12,28,.25)" : "rgba(196,210,228,.36)"; g.fillRect(0, 0, w, h);
    return c.toDataURL();
  }
  function syncSky() {
    if (!S || !skyAnims.length) return;
    var t = S.absPx() / S.BASE;
    skyAnims.forEach(function(a) { a.currentTime = t + a.effect.getComputedTiming().duration * 4000; });
  }
  function buildSkyline() {
    var groundY = (G - VY) * S.scale, tw = Math.max(1200, Math.round(S.W * 1.2));
    var sets = [[$("skyline"), $("skyA"), $("skyB"), Math.round(S.H * 0.58), PAR, farTexture], [$("mid"), $("midA"), $("midB"), Math.round(S.H * 0.52), PAR2, midTexture]];
    var rebuild = tw !== skyTW;
    if (rebuild) { skyAnims.forEach(function(a) { a.cancel(); }); skyAnims = []; skyTW = tw; }
    sets.forEach(function(s) {
      var box = s[0], h = s[3];
      box.style.height = h + "px"; box.style.top = (groundY - h) + "px"; box.style.right = (-tw) + "px";
      [s[1], s[2]].forEach(function(el, night) {
        el.style.backgroundSize = tw + "px " + h + "px";
        el.style.backgroundImage = "url(" + s[5](!!night, tw, h) + ")";
      });
      if (rebuild) {
        var a = box.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(" + (-tw) + "px,0,0)" }], { duration: tw / (S.BASE * s[4]), iterations: Infinity });
        a.playbackRate = S.rate; skyAnims.push(a);
      }
    });
    syncSky();
  }

  /* ---------- weather ---------- */
  var wxCv = $("wx"), wxCtx = wxCv.getContext("2d"), wxRAF = 0, drops = [], wxRnd = mulberry32(555);
  function sizeWeather() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    wxCv.width = Math.round(S.W * dpr); wxCv.height = Math.round(S.H * dpr);
    wxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    $("wet").style.top = ((KERB + 6 - VY) * S.scale) + "px";
  }
  function wxFrame() {
    wxRAF = 0;
    var W = S.W, H = S.H, g = wxCtx, i, d, snow = WX.kind === "snow", want = snow ? 260 : 340, ground = (G - VY) * S.scale;
    g.clearRect(0, 0, W, H);
    if (WX.kind !== "rain" && !snow) { drops = []; return; }
    while (drops.length < want) drops.push({ x: wxRnd() * (W + 200) - 100, y: wxRnd() * H, v: snow ? 40 + wxRnd() * 50 : 900 + wxRnd() * 500, z: wxRnd(), p: wxRnd() * 6.3 });
    drops.length = want;
    var slant = (snow ? 0.15 : 0.22) - S.rate * 0.6, dt = 1 / 60;
    g.lineCap = "round";
    if (snow) {
      g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath();
      for (i = 0; i < drops.length; i++) {
        d = drops[i]; d.y += d.v * dt; d.p += dt * 1.6; d.x += (Math.sin(d.p) * 14 + slant * d.v) * dt;
        if (d.y > H) { d.y = -6; d.x = wxRnd() * (W + 200) - 100; }
        g.moveTo(d.x + 2, d.y); g.arc(d.x, d.y, 1 + d.z * 1.6, 0, 6.3);
      }
      g.fill();
    } else {
      g.strokeStyle = "rgba(205,220,240," + (0.3 + 0.2 * (1 - LIGHT.n)) + ")"; g.lineWidth = 1; g.beginPath();
      for (i = 0; i < drops.length; i++) {
        d = drops[i]; d.y += d.v * dt; d.x += slant * d.v * dt;
        var floor = ground + (H - ground) * d.z;
        if (d.y > floor) {
          g.moveTo(d.x - 4, floor); g.ellipse(d.x, floor, 4 + d.z * 3, 1.2, 0, Math.PI, 0);      // a splash where it lands
          d.y = -20 - wxRnd() * 200; d.x = wxRnd() * (W + 200) - 100; d.z = wxRnd(); continue;
        }
        g.moveTo(d.x, d.y); g.lineTo(d.x - slant * (10 + d.z * 10), d.y - 10 - d.z * 10);
      }
      g.stroke();
    }
    if (!S.hidden) wxRAF = requestAnimationFrame(wxFrame);
  }
  function setWeather(k) {
    WX.kind = k;
    WX.over = k === "rain" ? 0.72 : k === "fog" ? 0.55 : k === "snow" ? 0.6 : 0;
    body.dataset.wx = k;
    applyLight();
    if ((k === "rain" || k === "snow") && !wxRAF) wxRAF = requestAnimationFrame(wxFrame);
  }
  var changeable = false, wxNext = 0;
  function weatherTick(now) {
    if (!changeable || now < wxNext || S.paused) return;
    wxNext = now + 70000 + lifeRnd() * 80000;
    var r = lifeRnd();
    setWeather(r < 0.45 ? "clear" : r < 0.75 ? "rain" : r < 0.9 ? "fog" : "snow");
  }

  /* ---------- governor hook: plan, life, sign ---------- */
  var sign = $("sign"), signStreet = $("signStreet"), signCity = $("signCity"), statusEl = $("status");
  var lastStreet = "", lastStatus = "", n = 0;
  function tick(S, f, buffered) {
    advanceClock();
    if (!S.started) return;
    var vl = S.viewLeft(), vr = S.viewRight();
    planCover(vl - 1400, vr + 1400);
    spawnLife(vl, vr); flushEmitters();
    if ((n & 3) === 1) { cullFx(vl, vr); prunePlan(Math.min(vl, S.lo * T) - 5600, Math.max(vr, S.hi * T) + 5600); }
    if ((n & 3) === 2) updateWindows();
    if ((n++ & 3) !== 0) return;
    weatherTick(performance.now());
    var d = blockAt(vl + (vr - vl) * 0.35);
    if (d && d.street + d.city !== lastStreet) {
      lastStreet = d.street + d.city;
      sign.classList.add("swap");
      setTimeout(function() {
        signStreet.textContent = d.street; signCity.textContent = CITIES[d.city].label;
        sign.dataset.city = d.city; sign.classList.remove("swap");
      }, 260);
    }
    var txt = !S.ready ? "Laying out the first block…" : S.paused ? "Paused." : f < 0.98 ? "Slowing while the street is drawn." : (buffered * S.scale / S.W).toFixed(1) + " screens drawn ahead.";
    if (txt !== lastStatus) { statusEl.textContent = txt; lastStatus = txt; }
  }

  /* ================= life on the street ================= */
  var LIFE = { people: 60, pets: 40, traffic: 50, wildlife: true };
  var peds = [], statics = [], spawnLo = null, spawnHi = null;
  var lifeRnd = mulberry32(12345);
  function spriteCanvas(box, draw) {
    var c = document.createElement("canvas"), k = S.k;
    c.width = Math.max(1, Math.ceil((box.x1 - box.x0) * k)); c.height = Math.max(1, Math.ceil(box.h * k));
    c.style.width = (box.x1 - box.x0) + "px"; c.style.height = box.h + "px";
    var g = c.getContext("2d"); g.setTransform(k, 0, 0, k, -box.x0 * k, box.h * k); draw(g);
    return c;
  }
  function paintPed(p) {
    var a = spriteCanvas(p.sprite.box, function(g) { p.sprite.draw(g, 0); });
    var b = spriteCanvas(p.sprite.box, function(g) { p.sprite.draw(g, 1); });
    a.className = "fa"; b.className = "fb";
    p.flip.textContent = ""; p.flip.appendChild(a); p.flip.appendChild(b);
  }
  function place(el, x, y, box) {
    el.style.left = S.lx(x + box.x0) + "px"; el.style.top = (y - box.h) + "px";
    el.style.width = (box.x1 - box.x0) + "px"; el.style.height = box.h + "px"; el.style.zIndex = Math.round(y);
    // where its shadow falls, and how wide
    el.style.setProperty("--ox", (-box.x0) + "px"); el.style.setProperty("--sw", Math.max(11, (box.x1 - box.x0) * 0.42).toFixed(1) + "px");
  }
  var KIND = {
    walk: { sp: [24, 34], d: 0.56 }, child: { sp: [20, 26], d: 0.44 }, dog: { sp: [22, 28], d: 0.5 },
    jog: { sp: [58, 74], d: 0.36 }, bike: { sp: [85, 115], d: 0.5 }
  };
  function addPed(x, y, kind, city) {
    var seed = (lifeRnd() * 1e9) | 0, sp = pedestrianSprite(seed, city, kind), K = KIND[kind];
    if ((WX.kind === "rain" || WX.kind === "snow") && (kind === "walk" || kind === "child") && lifeRnd() < 0.7) { sp.person.item = "umbrella"; sp.box.h = 80; }
    var dir = lifeRnd() < 0.5 ? -1 : 1, speed = rr(lifeRnd, K.sp[0], K.sp[1]);
    var el = document.createElement("div"); el.className = "ped";
    place(el, x, y, sp.box);
    el.style.setProperty("--d", K.d + "s"); el.style.setProperty("--o", (-lifeRnd() * K.d).toFixed(2) + "s");
    if (kind === "bike") el.classList.add("nobob");
    var bob = document.createElement("div"); bob.className = "bob";
    var flip = document.createElement("div"); flip.className = "flip";
    if (dir < 0) { flip.style.transformOrigin = (-sp.box.x0) + "px 50%"; flip.style.transform = "scaleX(-1)"; }
    bob.appendChild(flip); el.appendChild(bob); (y > KERB ? fx2El : fxEl).appendChild(el);
    var p = { el: el, flip: flip, sprite: sp, x: x, dir: dir, speed: speed, t0: performance.now() };
    p.paint = function() { paintPed(p); };
    p.paint();
    var dist = 5000;
    p.anim = el.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(" + (dir * dist) + "px,0,0)" }], { duration: dist / speed * 1000, fill: "forwards" });
    peds.push(p);
  }
  // something that travels a fixed stretch and fades out at the end of it: boats and road traffic
  function addMover(sp, x, y, dir, speed, room, cls, fade) {
    var el = document.createElement("div"); el.className = "ped " + cls;
    place(el, x, y, sp.box);
    var bob = document.createElement("div"); bob.className = "rock";
    var flip = document.createElement("div"); flip.className = "flip";
    if (dir < 0) { flip.style.transformOrigin = (-sp.box.x0) + "px 50%"; flip.style.transform = "scaleX(-1)"; }
    bob.appendChild(flip); el.appendChild(bob); fx2El.appendChild(el);
    var p = { el: el, flip: flip, sprite: sp, x: x, dir: dir, speed: speed, t0: performance.now(), ends: fade };
    p.paint = function() {
      flip.textContent = ""; flip.appendChild(spriteCanvas(sp.box, function(g) { sp.draw(g); }));
      if (sp.front) {
        var beam = document.createElement("i"); beam.className = "beam" + (sp.big ? " big" : "");
        beam.style.left = (sp.front - sp.box.x0 - 4) + "px"; beam.style.top = (sp.box.h + sp.lampY - 17) + "px";
        flip.appendChild(beam);
      }
    };
    p.paint();
    var kf = fade ? [{ transform: "translate3d(0,0,0)", opacity: 1 }, { transform: "translate3d(" + (dir * room * 0.94) + "px,0,0)", opacity: 1, offset: 0.94 }, { transform: "translate3d(" + (dir * room) + "px,0,0)", opacity: 0 }]
      : [{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(" + (dir * room) + "px,0,0)" }];
    p.anim = el.animate(kf, { duration: room / speed * 1000, fill: "forwards" });
    peds.push(p);
  }
  // how far the same kind of roadway (canal or tarmac) runs either side of x
  function stretch(x, canal) {
    var Bs = PLAN.blocks, i = 0, a, b, j;
    while (i < Bs.length - 1 && Bs[i].x1 <= x) i++;
    for (j = i; j >= 0 && (Bs[j].city === "amsterdam") === canal; j--) a = Bs[j].x0;
    for (j = i; j < Bs.length && (Bs[j].city === "amsterdam") === canal; j++) b = Bs[j].x1;
    return a === undefined ? null : { a: a, b: b, openA: a === Bs[0].x0, openB: b === Bs[Bs.length - 1].x1 };
  }
  function addBoat(x) {
    var st = stretch(x, true); if (!st) return;
    var sp = boatSprite((lifeRnd() * 1e9) | 0), y = rr(lifeRnd, 905, 950), dir = lifeRnd() < 0.5 ? -1 : 1;
    var room = dir > 0 ? st.b - x - 70 : x - st.a - 70;
    if (room > 120) addMover(sp, x, y, dir, rr(lifeRnd, 9, 14), room, "boat", true);
  }
  function addVehicle(x, city) {
    planCover(x - 4400, x + 4400);            // look far enough ahead that nothing drives into a canal
    var st = stretch(x, false); if (!st) return;
    var r = lifeRnd(), scoot = city === "hanoi" ? 0.6 : city === "paris" || city === "lisbon" ? 0.18 : 0.07;
    var kind = r < scoot ? "scooter" : r < scoot + 0.09 ? "bus" : r < scoot + 0.2 ? "taxi" : "car";
    var sp = vehicleSprite((lifeRnd() * 1e9) | 0, city, kind), dir = lifeRnd() < 0.5 ? -1 : 1;
    var room = dir > 0 ? st.b - x - 80 : x - st.a - 80, open = room > 4200;
    if (open) room = 4200;
    if (room < 300) return;
    var y = dir > 0 ? rr(lifeRnd, 962, 984) : rr(lifeRnd, 902, 922);
    addMover(sp, x, y, dir, kind === "bus" ? rr(lifeRnd, 70, 95) : kind === "scooter" ? rr(lifeRnd, 95, 135) : rr(lifeRnd, 105, 160), room, "veh", !open);
  }
  function addStatic(el, x, kind, redraw) { fxEl.appendChild(el); statics.push({ el: el, x: x, kind: kind, redraw: redraw }); }
  function addCat(x, y) {
    var sp = catSprite((lifeRnd() * 1e9) | 0);
    var el = document.createElement("div"); el.className = "critter";
    el.style.left = S.lx(x + sp.box.x0) + "px"; el.style.top = (y - sp.box.h) + "px"; el.style.zIndex = Math.round(y);
    var tail = document.createElement("div"); tail.className = "tail";
    tail.style.left = (-sp.box.x0 - 5 - 9) + "px"; tail.style.top = (sp.box.h - 3 - 12) + "px";
    tail.style.animationDelay = (-lifeRnd() * 4).toFixed(2) + "s";
    function draw() {
      el.textContent = "";
      el.appendChild(spriteCanvas(sp.box, function(g) { sp.draw(g); }));
      tail.textContent = ""; tail.appendChild(spriteCanvas({ x0: -9, x1: 2, h: 12 }, function(g) { sp.drawTail(g); }));
      el.appendChild(tail);
    }
    draw(); addStatic(el, x, "cat", draw);
  }
  function addPigeons(x, y) {
    var cnt = 2 + Math.floor(lifeRnd() * 3);
    for (var i = 0; i < cnt; i++) (function(px, py) {
      var sp = pigeonSprite((lifeRnd() * 1e9) | 0);
      var el = document.createElement("div"); el.className = "critter pigeon";
      el.style.left = S.lx(px + sp.box.x0) + "px"; el.style.top = (py - sp.box.h) + "px"; el.style.zIndex = Math.round(py);
      el.style.transformOrigin = (-sp.box.x0) + "px 100%";
      el.style.animationDelay = (-lifeRnd() * 3).toFixed(2) + "s"; el.style.animationDuration = (2.2 + lifeRnd() * 2).toFixed(2) + "s";
      var flipped = lifeRnd() < 0.5;
      el.style.setProperty("--pk", flipped ? "-28deg" : "28deg");
      function draw() { el.textContent = ""; var c = spriteCanvas(sp.box, function(g) { sp.draw(g); }); if (flipped) c.style.transform = "scaleX(-1)"; el.appendChild(c); }
      draw(); addStatic(el, px, "pigeon", draw);
    })(x + i * rr(lifeRnd, 7, 16), y + rr(lifeRnd, -3, 3));
  }
  function spawnSegment(x0, w) {
    var d = blockAt(x0 + w / 2);
    if (!d) return;
    var quiet = LIGHT.n > 0.9 && (LIGHT.hour > 23.5 || LIGHT.hour < 5) ? 0.35 : WX.kind === "rain" ? 0.6 : 1;   // fewer people in the small hours and the rain
    var count = Math.floor(LIFE.people / 100 * w / 95 * quiet + lifeRnd());
    for (var i = 0; i < count; i++) {
      var x = x0 + lifeRnd() * w, rk = lifeRnd(), kind = "walk";
      var cityAt = (blockAt(x) || d).city;
      var bikeP = cityAt === "amsterdam" ? 0.33 : cityAt === "tokyo" || cityAt === "hanoi" ? 0.14 : 0.05;
      if (rk < bikeP) kind = "bike";
      else if (rk < bikeP + 0.07) kind = "jog";
      else if (rk < bikeP + 0.13) kind = "child";
      else if (lifeRnd() < LIFE.pets / 100 * 0.5) kind = "dog";
      var y = kind === "bike" && cityAt !== "amsterdam" ? rr(lifeRnd, 868, 886) : rr(lifeRnd, 812, 842);
      addPed(x, y, kind, cityAt);
    }
    if (LIFE.wildlife) {
      if (lifeRnd() < 0.14 * (0.4 + LIFE.pets / 100)) addCat(x0 + lifeRnd() * w, rr(lifeRnd, 806, 812));
      if (lifeRnd() < 0.16) addPigeons(x0 + lifeRnd() * w, rr(lifeRnd, 816, 840));
    }
    if (d.city === "amsterdam") { if (lifeRnd() < 0.3) addBoat(x0 + lifeRnd() * w); }
    else if (lifeRnd() < LIFE.traffic / 100 * w / 330 * (quiet < 1 ? 0.6 : 1)) addVehicle(x0 + lifeRnd() * w, d.city);
  }
  function spawnLife(vl, vr) {
    if (spawnLo === null || spawnHi < vl - 2500 || spawnLo > vr + 2500) spawnLo = spawnHi = Math.floor((vl - 200) / 200) * 200;
    var guard = 0;
    while (spawnHi < vr + 700 && guard++ < 20) { spawnSegment(spawnHi, 200); spawnHi += 200; }
    while (spawnLo > vl - 700 && guard++ < 40) { spawnLo -= 200; spawnSegment(spawnLo, 200); }
    spawnLo = Math.max(spawnLo, Math.floor((vl - 1800) / 200) * 200); spawnHi = Math.min(spawnHi, Math.ceil((vr + 1800) / 200) * 200);
  }
  function cullFx(vl, vr) {
    var now = performance.now(), lo = S.lo * T - 120, hi = S.hi * T + 120;
    peds = peds.filter(function(p) {
      var cx = p.x + p.dir * p.speed * (now - p.t0) / 1000;
      if (cx < vl - 1700 || cx > vr + 1700 || (p.ends && p.anim.playState === "finished")) { p.anim.cancel(); p.el.remove(); return false; }
      return true;
    });
    statics = statics.filter(function(s) {
      if (s.key ? (s.x < lo || s.x > hi) : (s.x < vl - 1700 || s.x > vr + 1700)) { s.el.remove(); if (s.key) delete EMIT[s.key]; return false; }
      return true;
    });
  }
  function clearLife() {
    peds.forEach(function(p) { p.anim.cancel(); p.el.remove(); }); peds = [];
    statics.forEach(function(s) { s.el.remove(); }); statics = [];
    EMIT = {}; EMIT_NEW = []; spawnLo = spawnHi = null;
  }
  var spriteT = 0;
  function redrawSprites() {
    peds.forEach(function(p) { p.paint(); });
    statics.forEach(function(s) { if (s.redraw) s.redraw(); });
  }
  function flushEmitters() {
    while (EMIT_NEW.length) {
      var e = EMIT_NEW.shift(), el = document.createElement("div");
      el.style.left = S.lx(e.x) + "px"; el.style.top = e.y + "px";
      if (e.kind === "lantern") {
        el.className = "lantern detail"; el.innerHTML = "<i></i>";
        el.style.animationDelay = (-lifeRnd() * 4).toFixed(2) + "s"; el.style.animationDuration = (2.8 + lifeRnd() * 1.6).toFixed(2) + "s";
      } else if (e.kind === "smoke") {
        el.className = "smoke detail"; el.innerHTML = "<b></b><b></b><b></b>";
        el.style.setProperty("--sd", (4.5 + lifeRnd() * 2).toFixed(2) + "s");
      } else if (e.kind === "neon") {
        el.className = "neon detail"; el.innerHTML = "<i></i>";
        el.style.width = e.extra.w + "px"; el.style.height = e.extra.h + "px"; el.style.setProperty("--c", e.extra.c);
        el.firstChild.style.animationDelay = (-lifeRnd() * 9).toFixed(2) + "s";
      } else if (e.kind === "tree") { addTree(e); continue; }
      else continue;
      fxEl.appendChild(el); statics.push({ el: el, x: e.x, kind: e.kind, key: e.key });
    }
  }
  // a tree: the trunk stands still, the crown sways on it
  function addTree(e) {
    var sp = treeSprite(e.extra), el = document.createElement("div"), crown = document.createElement("div");
    el.className = "tree"; crown.className = "sway";
    el.style.left = S.lx(e.x + sp.box.x0) + "px"; el.style.top = (e.y - sp.box.h) + "px";
    el.style.width = (sp.box.x1 - sp.box.x0) + "px"; el.style.height = sp.box.h + "px"; el.style.zIndex = Math.round(e.y);
    crown.style.transformOrigin = "50% " + (sp.box.h - sp.pivot * 0.55) + "px";
    crown.style.animationDuration = (3.4 + lifeRnd() * 2.4).toFixed(2) + "s"; crown.style.animationDelay = (-lifeRnd() * 6).toFixed(2) + "s";
    function draw() {
      el.textContent = ""; crown.textContent = "";
      el.appendChild(spriteCanvas(sp.box, sp.trunk)); crown.appendChild(spriteCanvas(sp.box, sp.crown)); el.appendChild(crown);
    }
    draw();
    (e.extra.front ? fx2El : fxEl).appendChild(el);
    statics.push({ el: el, x: e.x, kind: "tree", key: e.key, redraw: draw, front: e.extra.front });
  }
  // birds cross the sky now and then
  var birdsEl = $("birds");
  function flock() {
    setTimeout(flock, 12000 + lifeRnd() * 18000);
    if (!LIFE.wildlife || S.hidden || LIGHT.n > 0.7 || WX.kind === "rain") return;
    var f = document.createElement("div"); f.className = "flock";
    var cnt = 4 + Math.floor(lifeRnd() * 6), dir = lifeRnd() < 0.5 ? 1 : -1, y = 8 + lifeRnd() * 22;
    f.style.top = y + "%";
    var html = "";
    for (var i = 0; i < cnt; i++) {
      var bx = i * 14 + lifeRnd() * 8, by = Math.abs(i - cnt / 2) * 6 + lifeRnd() * 5;
      html += '<svg style="left:' + bx + 'px;top:' + by + 'px;animation-delay:-' + (lifeRnd() * 0.5).toFixed(2) + 's" viewBox="0 0 16 8"><path d="M0 5 Q4 0 8 5 Q12 0 16 5"/></svg>';
    }
    f.innerHTML = html; birdsEl.appendChild(f);
    var W = S.W, dur = 16000 + lifeRnd() * 12000;
    var a = f.animate([{ transform: "translate3d(" + (dir > 0 ? -200 : W + 40) + "px,0,0)" }, { transform: "translate3d(" + (dir > 0 ? W + 40 : -200) + "px," + (lifeRnd() * 60 - 30) + "px,0)" }], { duration: dur });
    a.onfinish = function() { f.remove(); };
  }
  setTimeout(flock, 5000);

  /* ---------- controls ---------- */
  function restyle() { S.restyle(); clearTimeout(spriteT); spriteT = setTimeout(redrawSprites, 120); }
  E.bindRange("speed", "speedOut", function(v) { return v + " px/s"; }, function(v) { S.speed = v; });

  var TOD = { morning: 8.4, noon: 12.5, golden: 17.4, dusk: 19.0, night: 22.3 };
  document.querySelectorAll("input[name=tod]").forEach(function(r) { r.addEventListener("change", function() { if (r.checked) hourTarget = TOD[r.value]; }); });
  hourEl.addEventListener("input", function() { hourTarget = null; LIGHT.hour = +hourEl.value % 24; applyLight(); });
  $("dayPass").addEventListener("change", function(e) { dayPass = e.target.checked; lastT = performance.now(); });
  document.querySelectorAll("input[name=wx]").forEach(function(r) {
    r.addEventListener("change", function() {
      if (!r.checked) return;
      changeable = r.value === "auto";
      if (changeable) wxNext = 0; else setWeather(r.value);
    });
  });
  document.querySelectorAll("input[name=palette]").forEach(function(r) { r.addEventListener("change", function() { if (r.checked) { STYLE.palette = r.value; restyle(); } }); });
  var ornT = 0;
  E.bindRange("ornament", "ornamentOut", function(v) { return v + "%"; }, function(v) { STYLE.ornament = v; clearTimeout(ornT); ornT = setTimeout(restyle, 200); });
  ["trees", "lamps"].forEach(function(k) { $(k).addEventListener("change", function(e) { STYLE[k] = e.target.checked; restyle(); }); });
  $("trees").addEventListener("change", function(e) {
    if (e.target.checked) return;
    statics = statics.filter(function(s) { if (s.kind !== "tree" || !s.front) return true; s.el.remove(); delete EMIT[s.key]; return false; });
  });
  $("skylineOn").addEventListener("change", function(e) { $("skyline").classList.toggle("off", !e.target.checked); $("mid").classList.toggle("off", !e.target.checked); });
  $("cloudsOn").addEventListener("change", function(e) { cloudsEl.classList.toggle("off", !e.target.checked); applyLight(); });

  // city and height changes take effect beyond what has been drawn
  function replanAhead() { if (S.started) replan(S.dir > 0 ? S.edgeRight() + 4 : S.edgeLeft() - 4, S.dir); }
  document.querySelectorAll("input[name=city]").forEach(function(r) { r.addEventListener("change", function() { if (r.checked) { PLAN.lock = r.value; replanAhead(); } }); });
  var hT = 0;
  E.bindRange("height", "heightOut", function(v) { return v + "%"; }, function(v) { PLAN.hmul = v / 100; clearTimeout(hT); hT = setTimeout(replanAhead, 300); });
  var seedEl = $("seed");
  function newStreet(seed) {
    resetPlan(seed); clearLife();
    loading.textContent = "Laying out a new street…"; loading.classList.remove("done");
    S.reset();
  }
  $("newStreet").addEventListener("click", function() { var s = E.newSeed(); seedEl.value = s; store.save(); newStreet(s); });
  $("seedForm").addEventListener("submit", function(e) {
    e.preventDefault();
    if (seedEl.value.trim()) { store.save(); newStreet(E.parseSeed(seedEl.value)); }
  });
  E.bindRange("people", "peopleOut", function(v) { return v + "%"; }, function(v) { LIFE.people = v; });
  E.bindRange("pets", "petsOut", function(v) { return v + "%"; }, function(v) { LIFE.pets = v; });
  E.bindRange("traffic", "trafficOut", function(v) { return v + "%"; }, function(v) { LIFE.traffic = v; });
  $("wildlife").addEventListener("change", function(e) { LIFE.wildlife = e.target.checked; body.classList.toggle("nowild", !e.target.checked); });
  $("details").addEventListener("change", function(e) { body.classList.toggle("nodetail", !e.target.checked); });

  // stars and clouds
  (function() {
    var c = document.createElement("canvas"); c.width = c.height = 400; var g = c.getContext("2d"), rnd = mulberry32(7);
    for (var i = 0; i < 90; i++) { g.fillStyle = "rgba(255,255,255," + (0.3 + rnd() * 0.7) + ")"; g.beginPath(); g.arc(rnd() * 400, rnd() * 400, rnd() * 1.1 + 0.3, 0, 6.3); g.fill(); }
    starsEl.style.backgroundImage = "url(" + c.toDataURL() + ")";
    var cc = document.createElement("canvas"); cc.width = 900; cc.height = 300; var cg = cc.getContext("2d"), r2 = mulberry32(31);
    for (var j = 0; j < 9; j++) {
      var cx = r2() * 900, cy = 60 + r2() * 160, w = 120 + r2() * 160;
      for (var ox = -900; ox <= 900; ox += 900) for (var p = 0; p < 7; p++) {
        var px = cx + ox + (r2() - 0.5) * w, py = cy + (r2() - 0.5) * 24, rad = 22 + r2() * 30;
        var gr = cg.createRadialGradient(px, py, 0, px, py, rad); gr.addColorStop(0, "rgba(255,255,255,.7)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        cg.fillStyle = gr; cg.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      }
    }
    $("cloudLayer").style.backgroundImage = "url(" + cc.toDataURL() + ")";
  })();

  /* ---------- boot ---------- */
  var store = E.persist($("panel"), ["tod"]);
  if (!seedEl.value.trim()) seedEl.value = E.newSeed();
  resetPlan(E.parseSeed(seedEl.value));
  hourTarget = null; LIGHT.hour = +hourEl.value % 24;
  buildSkyline(); sizeWeather(); applyLight();
  E.fonts(['12px "Young Serif"', '12px "Figtree"'], 2500).then(function(ok) {
    if (ok) { STYLE.fontSign = '"Young Serif", Georgia, serif'; STYLE.fontSans = '"Figtree", "Helvetica Neue", Arial, sans-serif'; }
    STYLE.fontJP = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", "Noto Sans CJK JP", Meiryo, sans-serif';
    S.start();
  });
})();
