/* ===== Endless Survey: browser runtime ===== */
(function() {
  "use strict";
  var E = window.Endless, $ = function(id) { return document.getElementById(id); };
  var core = SurveyCore(null);                 // names and lettering stay on this thread
  var remote = E.spawn(SurveyCore, true);      // terrain, hydrology and drawing run in a worker
  var loading = $("loading");

  var STYLE = {
    theme: "survey", shade: 70, interval: 0.02,
    rivers: true, roads: true, towns: true, peaks: true, grid: true, cover: true,
    fontSerif: "Georgia, serif", fontSerifSC: "Georgia, serif", fontSans: "Helvetica, Arial, sans-serif"
  };
  function snapshot() { var o = {}; for (var k in STYLE) o[k] = STYLE[k]; return o; }

  /* ---------- terrain settings along the journey ---------- */
  var PARAMS = [{ seed: 1, sea: 0, rug: 1, size: 1 }], BOUNDS = [], far = { min: Infinity, max: -Infinity }, changeAt = null;
  function sync(reset) {
    if (reset) far = { min: Infinity, max: -Infinity };
    core.setTerrain(PARAMS, BOUNDS, reset);
    remote.call("setTerrain", [PARAMS, BOUNDS, reset]);
  }

  var S = E.strip({
    stage: $("stage"), strip: $("strip"), layers: [{ el: $("inner"), y0: 0, h: 1000 }],
    worldH: 1000, tileW: 400, over: 2,
    render: function(job) {
      job.style = snapshot();
      return remote.call("renderTile", [{ x0: job.x0, x1: job.x1, k: job.k, scale: job.scale, style: job.style }]);
    },
    paint: function(ctx, layer, job, p) {
      ctx.drawImage(p.img, 0, 0);
      if (p.img.close) p.img.close();
      ctx.setTransform(job.k, 0, 0, job.k, -job.x0 * job.k, 0);
      core.drawLabels(ctx, p.labels, job.style, job.scale);
    },
    onTile: function(job, p) { far.min = Math.min(far.min, p.minX); far.max = Math.max(far.max, p.maxX); },
    onReady: function() { loading.classList.add("done"); },
    onTap: function() { ui.tap(); },
    onTick: tick
  });
  var ui = E.chrome(S, {});

  /* ---------- HUD ---------- */
  var hudRegion = $("hudRegion"), hudSheet = $("hudSheet"), hudCoord = $("hudCoord"), scaleBar = $("scaleBar"), statusEl = $("status"), noteEl = $("terrainNote");
  var lastRegion = "", lastStatus = "", n = 0;
  function dms(v) {
    var d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), s = Math.floor((mf - m) * 60);
    return d + "°" + (m < 10 ? "0" : "") + m + "′" + (s < 10 ? "0" : "") + s + "″";
  }
  function tick(S, f, buffered) {
    if ((n++ & 3) !== 0 || !S.started) return;
    var vl = S.viewLeft(), vr = S.viewRight(), cx = (vl + vr) / 2;
    var reg = core.regionName(cx);
    if (reg !== lastRegion) { hudRegion.textContent = reg; lastRegion = reg; }
    hudSheet.textContent = "Sheet " + (Math.floor(cx / 2000) + 1);
    hudCoord.textContent = dms(51.4) + " N   " + dms(12 + cx / 6000) + " E";
    scaleBar.style.width = Math.round(200 * S.scale) + "px";
    var txt = !S.ready ? "Surveying the first sheet…" : S.paused ? "Paused." : f < 0.98 ? "Slowing while the survey catches up." : (buffered * S.scale / S.W).toFixed(1) + " screens surveyed ahead.";
    if (txt !== lastStatus) { statusEl.textContent = txt; lastStatus = txt; }
    if (changeAt !== null) {
      var d = changeAt.dir > 0 ? changeAt.x - vr : vl - changeAt.x - core.BLEND;
      if (d <= 0) { changeAt = null; noteEl.hidden = true; }
      else { noteEl.hidden = false; noteEl.textContent = "The new terrain begins about " + Math.max(1, Math.round(d * S.scale / S.W)) + (Math.round(d * S.scale / S.W) > 1 ? " screens" : " screen") + " ahead."; }
    }
  }

  /* ---------- controls ---------- */
  E.bindRange("speed", "speedOut", function(v) { return v + " px/s"; }, function(v) { S.speed = v; });

  // the key in the controls card follows the edition
  var keyCv = $("key");
  function drawKey() {
    if (keyCard.hidden) return;
    var w = keyCv.clientWidth || 278, dpr = Math.min(window.devicePixelRatio || 1, 2), probe = document.createElement("canvas").getContext("2d");
    var h = core.drawKey(probe, STYLE, w);
    keyCv.width = Math.round(w * dpr); keyCv.height = Math.round(h * dpr); keyCv.style.height = h + "px";
    var g = keyCv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    core.drawKey(g, STYLE, w);
  }
  var keyBtn = $("keyBtn"), keyCard = $("keyCard");
  keyBtn.addEventListener("click", function() {
    keyCard.hidden = !keyCard.hidden;
    keyBtn.setAttribute("aria-expanded", keyCard.hidden ? "false" : "true");
    if (!keyCard.hidden) drawKey();
  });
  function setTheme(name) {
    STYLE.theme = name;
    document.body.dataset.map = name;
    var r = document.querySelector("input[name=theme][value=" + name + "]"); if (r) r.checked = true;
    var meta = document.querySelector("meta[name=theme-color]"); if (meta) meta.content = core.paper(name);
    S.restyle(); drawKey();
  }
  document.querySelectorAll("input[name=theme]").forEach(function(r) { r.addEventListener("change", function() { if (r.checked) setTheme(r.value); }); });
  document.querySelectorAll("input[name=interval]").forEach(function(r) { r.addEventListener("change", function() { if (r.checked) { STYLE.interval = +r.value; S.restyle(); } }); });
  var shadeT = 0;
  E.bindRange("shade", "shadeOut", function(v) { return v + "%"; }, function(v) { STYLE.shade = v; clearTimeout(shadeT); shadeT = setTimeout(S.restyle, 200); });
  ["rivers", "roads", "towns", "peaks", "grid", "cover"].forEach(function(k) {
    $(k).addEventListener("change", function(e) { STYLE[k] = e.target.checked; S.restyle(); });
  });
  $("cloudsOn").addEventListener("change", function(e) { $("clouds").classList.toggle("off", !e.target.checked); });
  $("grainOn").addEventListener("change", function(e) { $("grain").classList.toggle("off", !e.target.checked); });

  // wander: drift to a new edition every couple of minutes
  var wanderT = 0, ORDER = ["survey", "relief", "antique", "nocturne", "blueprint", "ink"];
  $("wander").addEventListener("change", function(e) {
    clearInterval(wanderT);
    if (e.target.checked) wanderT = setInterval(function() {
      if (!S.paused) setTheme(ORDER[(ORDER.indexOf(STYLE.theme) + 1) % ORDER.length]);
    }, 120000);
  });

  // terrain changes join beyond everything the hydrology has already worked out,
  // so no river, lake or road that is on the map can be contradicted
  var terrainT = 0, pending = {}, want = { sea: 0, rug: 1, size: 1 };
  function terrain(patch) {
    for (var p in patch) { pending[p] = patch[p]; want[p] = patch[p]; }
    clearTimeout(terrainT);
    terrainT = setTimeout(function() {
      var patchNow = pending; pending = {};
      if (!S.started) { for (var q in patchNow) PARAMS[0][q] = patchNow[q]; return; }
      var right = S.dir > 0, end = right ? PARAMS[PARAMS.length - 1] : PARAMS[0], same = true, k;
      for (k in patchNow) if (end[k] !== patchNow[k]) same = false;
      if (same) return;
      var next = { seed: end.seed, sea: end.sea, rug: end.rug, size: end.size };
      for (k in patchNow) next[k] = patchNow[k];
      if (right) {
        var x = Math.max(isFinite(far.max) ? far.max : S.viewRight() + 4000, S.edgeRight()) + 8;
        if (BOUNDS.length) x = Math.max(x, BOUNDS[BOUNDS.length - 1] + core.BLEND);
        PARAMS.push(next); BOUNDS.push(x); changeAt = { x: x, dir: 1 };
      } else {
        var xl = Math.min(isFinite(far.min) ? far.min : S.viewLeft() - 4000, S.edgeLeft()) - core.BLEND - 8;
        if (BOUNDS.length) xl = Math.min(xl, BOUNDS[0] - core.BLEND);
        PARAMS.unshift(next); BOUNDS.unshift(xl); changeAt = { x: xl, dir: -1 };
      }
      sync(false);
    }, 300);
  }
  E.bindRange("sea", "seaOut", function(v) { return (v > 0 ? "+" : "") + v; }, function(v) { terrain({ sea: v / 100 * 0.15 }); });
  E.bindRange("rug", "rugOut", function(v) { return v + "%"; }, function(v) { terrain({ rug: v / 100 }); });
  E.bindRange("size", "sizeOut", function(v) { return v + "%"; }, function(v) { terrain({ size: v / 100 }); });

  var seedEl = $("seed");
  function newLand(seed) {
    clearTimeout(terrainT); pending = {}; changeAt = null; noteEl.hidden = true;
    PARAMS = [{ seed: seed, sea: want.sea, rug: want.rug, size: want.size }]; BOUNDS = [];
    sync(true);
    loading.textContent = "Surveying new land…"; loading.classList.remove("done");
    S.reset();
  }
  $("newLand").addEventListener("click", function() { var s = E.newSeed(); seedEl.value = s; store.save(); newLand(s); });
  $("seedForm").addEventListener("submit", function(e) {
    e.preventDefault();
    if (seedEl.value.trim()) { store.save(); newLand(E.parseSeed(seedEl.value)); }
  });

  // cloud shadow texture (tileable, drifts on the compositor)
  (function() {
    var n = 768, c = document.createElement("canvas"); c.width = c.height = n;
    var g = c.getContext("2d"), rnd = E.mulberry32(99);
    for (var i = 0; i < 26; i++) {
      var x = rnd() * n, y = rnd() * n, r = 60 + rnd() * 140;
      for (var ox = -n; ox <= n; ox += n) for (var oy = -n; oy <= n; oy += n) {
        var gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, "rgba(40,50,70,.22)"); gr.addColorStop(1, "rgba(40,50,70,0)");
        g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    $("cloudLayer").style.backgroundImage = "url(" + c.toDataURL() + ")";
  })();

  /* ---------- boot: settings from the address, then wait briefly for the map fonts ---------- */
  var store = E.persist($("panel"));
  if (!seedEl.value.trim()) seedEl.value = E.newSeed();
  clearTimeout(terrainT); pending = {};
  PARAMS[0] = { seed: E.parseSeed(seedEl.value), sea: want.sea, rug: want.rug, size: want.size };
  sync(true);
  document.body.dataset.map = STYLE.theme;
  E.fonts(['italic 15px "IM Fell English"', '24px "IM Fell English SC"', '10px "Libre Franklin"', '600 13px "Libre Franklin"'], 2500).then(function(ok) {
    if (ok) {
      STYLE.fontSerif = '"IM Fell English", Georgia, serif';
      STYLE.fontSerifSC = '"IM Fell English SC", Georgia, serif';
      STYLE.fontSans = '"Libre Franklin", "Helvetica Neue", Arial, sans-serif';
    }
    S.start(); drawKey();
  });
})();
