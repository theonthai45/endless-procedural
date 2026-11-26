/* ===== Endless: shared strip engine =====
 * One endless, horizontally scrolling world drawn as canvas tiles.
 * The scroll itself is a compositor animation, so slow tile work never stalls it;
 * a governor eases the speed down whenever drawing falls behind.
 * Plain script, no build step: exposes window.Endless. */
(function() {
  "use strict";
  var E = window.Endless = {};

  E.mulberry32 = function(a) {
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  E.hashStr = function(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  E.newSeed = function() { return (Date.now() % 1000000) + Math.floor(Math.random() * 1000); };
  E.parseSeed = function(v) { v = String(v).trim(); return /^\d+$/.test(v) ? +v : E.hashStr(v); };
  E.coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  /* ---------- run a self-contained core function in a worker ----------
   * coreFn(scope) must return an object of methods. In a worker it is rebuilt from its
   * own source (a Blob URL, so the page still works from file://). A method may return
   * { result, transfer } to hand buffers or bitmaps across without copying.
   * Falls back to calling the core on the main thread. */
  E.spawn = function(coreFn, needOffscreen) {
    var local = null, worker = null, seq = 0, waiting = {};
    function useLocal() { if (!local) local = coreFn(null); worker = null; }
    function boot() {
      function shim(scope, core) {
        var api = core(scope);
        scope.onmessage = function(e) {
          var m = e.data, out;
          try { out = api[m.m].apply(api, m.a || []); }
          catch (err) { scope.postMessage({ id: m.id, err: String(err && err.stack || err) }); return; }
          if (out && out.transfer) scope.postMessage({ id: m.id, r: out.result }, out.transfer);
          else scope.postMessage({ id: m.id, r: out });
        };
      }
      var src = "(" + shim.toString() + ")(self," + coreFn.toString() + ");";
      var w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      w.onmessage = function(e) {
        var p = waiting[e.data.id]; if (!p) return;
        delete waiting[e.data.id];
        if (e.data.err) p[1](new Error(e.data.err)); else p[0](e.data.r);
      };
      w.onerror = function(e) {
        // the worker could not start: carry on without it
        if (e && e.preventDefault) e.preventDefault();
        var pend = waiting; waiting = {}; useLocal();
        for (var id in pend) pend[id][1](new Error("worker failed"));
      };
      return w;
    }
    try {
      if (!window.Worker || (needOffscreen && !window.OffscreenCanvas)) throw 0;
      worker = boot();
    } catch (e) { useLocal(); }
    return {
      threaded: function() { return !!worker; },
      call: function(method, args) {
        if (!worker) {
          return new Promise(function(res, rej) {
            setTimeout(function() {
              try { var out = local[method].apply(local, args || []); res(out && out.transfer ? out.result : out); }
              catch (err) { rej(err); }
            }, 0);
          });
        }
        return new Promise(function(res, rej) {
          var id = ++seq; waiting[id] = [res, rej];
          worker.postMessage({ id: id, m: method, a: args || [] });
        });
      }
    };
  };

  /* ---------- the scrolling strip ----------
   * o: { stage, strip, layers:[{el, y0, h}], worldH, viewTop, tileW, over,
   *      render(job) -> Promise(payload), paint(ctx, layerIndex, job, payload),
   *      onTile, onDrop, onTick, onReady, onTap, onMeasure, onRebase } */
  E.strip = function(o) {
    var T = o.tileW, OVER = o.over == null ? 2 : o.over, WH = o.worldH, VT = o.viewTop || 0, VH = WH - VT;
    var BASE = 0.1, BACK = 3e5, DIST = 2e7, stage = o.stage, layers = o.layers;
    var S = {
      scale: 1, k: 1, W: 0, H: 0, org: 0, tiles: [], pool: [], job: null, lo: 0, hi: 0,
      epoch: 1, gen: 1, speed: 35, dir: 1, paused: false, hidden: false, dragging: false,
      eff: 0, rate: 0, ready: false, started: false, tileW: T
    };
    var anim = o.strip.animate(
      [{ transform: "translate3d(" + BACK + "px,0,0)" }, { transform: "translate3d(" + (-DIST) + "px,0,0)" }],
      { duration: (DIST + BACK) / BASE, easing: "linear", fill: "both" }
    );
    anim.playbackRate = 0;
    anim.currentTime = BACK / BASE;
    function posPx() { return (anim.currentTime || 0) * BASE - BACK; }
    function viewLeft() { return S.org + posPx() / S.scale; }
    function viewRight() { return S.org + (posPx() + S.W) / S.scale; }
    function setPos(vl) { anim.currentTime = ((vl - S.org) * S.scale + BACK) / BASE; }
    function setRate(r) {
      if (Math.abs(r - S.rate) < 0.003 && !(r === 0 && S.rate !== 0)) return;
      S.rate = r;
      if (anim.updatePlaybackRate) anim.updatePlaybackRate(r); else anim.playbackRate = r;
    }
    S.viewLeft = viewLeft; S.viewRight = viewRight; S.lx = function(x) { return x - S.org; };

    function measure(force) {
      var W = stage.clientWidth, H = stage.clientHeight;
      if (!W || !H) return;
      // ignore the small height changes of a mobile URL bar
      if (!force && S.W && W === S.W && Math.abs(H - S.H) / S.H < 0.15) { S.H = H; return; }
      var vl = S.W ? viewLeft() : S.org;
      S.W = W; S.H = H; S.scale = H / VH;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var maxPx = (E.coarse ? 2.2e6 : 3.2e6) * (o.pixelBudget || 1), px = (T + 2 * OVER) * WH * Math.pow(S.scale * dpr, 2);
      if (px > maxPx) dpr *= Math.sqrt(maxPx / px);
      S.k = S.scale * dpr;
      for (var i = 0; i < layers.length; i++) layers[i].el.style.transform = "translate(0," + (-VT * S.scale) + "px) scale(" + S.scale + ")";
      setPos(vl);
      S.epoch++;
      if (o.onMeasure) o.onMeasure(S);
    }

    // keep compositor offsets small on very long runs: slide the origin under the view
    function rebase() {
      var p = posPx();
      if (Math.abs(p) < 2e5 || S.dragging) return;
      var u = Math.round(p / S.scale);
      S.org += u;
      for (var i = 0; i < layers.length; i++) {
        var kids = layers[i].el.children;
        for (var n = 0; n < kids.length; n++) {
          var l = parseFloat(kids[n].style.left);
          if (l === l) kids[n].style.left = (l - u) + "px";
        }
      }
      setPos(S.org + (p / S.scale - u) + 0);
      if (o.onRebase) o.onRebase(u);
    }

    // ---------- tiles ----------
    function release(el) { if (S.pool.length < 4) S.pool.push(el); else { el.width = 0; el.height = 0; } }
    function dropTile(t) {
      for (var i = 0; i < t.els.length; i++) { t.els[i].remove(); release(t.els[i]); }
      if (o.onDrop) o.onDrop(t);
    }
    function staleTile() {
      var vl = viewLeft(), vr = viewRight(), i, t, best = null;
      for (i = 0; i < S.tiles.length; i++) { t = S.tiles[i]; if (t.epoch !== S.epoch && t.x1 > vl && t.x0 < vr) return t; }
      for (i = 0; i < S.tiles.length; i++) if (S.tiles[i].epoch !== S.epoch) { best = S.tiles[i]; break; }
      return best;
    }
    function speedUnits() { return Math.abs(S.speed) / S.scale; }
    function pump() {
      if (!S.started || S.job || !S.W) return;
      var vl = viewLeft(), vr = viewRight(), idx = null, rep = null, st;
      var ahead = T + Math.max(T, speedUnits() * 5);
      if (S.hi === S.lo) { S.lo = S.hi = Math.floor(vl / T); idx = S.hi; }
      else if (S.hi * T < vr + 60) idx = S.hi;
      else if (S.lo * T > vl - 60) idx = S.lo - 1;
      else if ((st = staleTile())) { idx = st.idx; rep = st; }
      else if (S.dir > 0 && S.hi * T < vr + ahead) idx = S.hi;
      else if (S.dir < 0 && S.lo * T > vl - ahead) idx = S.lo - 1;
      if (idx === null) return;
      var job = { idx: idx, x0: idx * T - OVER, x1: idx * T + T + OVER, k: S.k, scale: S.scale, epoch: S.epoch, gen: S.gen, replace: rep };
      S.job = job;
      Promise.resolve().then(function() { return o.render(job); }).then(function(p) { finish(job, p); }, function(err) {
        if (window.console) console.error(err);
        setTimeout(function() { if (S.job === job) S.job = null; }, 1000);
      });
    }
    function finish(job, payload) {
      if (S.job === job) S.job = null;
      if (job.gen !== S.gen) { pump(); return; }
      var els = [], i;
      for (i = 0; i < layers.length; i++) {
        var L = layers[i], cv = S.pool.pop() || document.createElement("canvas");
        cv.width = Math.ceil((job.x1 - job.x0) * job.k); cv.height = Math.ceil(L.h * job.k);
        var ctx = cv.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        o.paint(ctx, i, job, payload);
        cv.className = "tile";
        cv.style.left = (job.x0 - S.org) + "px"; cv.style.top = L.y0 + "px";
        cv.style.width = (job.x1 - job.x0) + "px"; cv.style.height = L.h + "px";
        cv.style.opacity = "";
        els.push(cv);
      }
      var rep = job.replace;
      if (rep) {
        if (S.tiles.indexOf(rep) < 0) { els.forEach(release); pump(); return; }
        var old = rep.els;
        for (i = 0; i < els.length; i++) { els[i].style.opacity = "0"; layers[i].el.insertBefore(els[i], old[i].nextSibling); }
        rep.els = els; rep.epoch = job.epoch;
        requestAnimationFrame(function() {
          els.forEach(function(e) { e.style.opacity = "1"; });
          setTimeout(function() { old.forEach(function(e) { e.remove(); release(e); }); }, 800);
        });
      } else {
        var t = { idx: job.idx, x0: job.x0, x1: job.x1, els: els, epoch: job.epoch };
        for (i = 0; i < els.length; i++) layers[i].el.appendChild(els[i]);
        if (job.idx >= S.hi) { S.tiles.push(t); S.hi = job.idx + 1; }
        else { S.tiles.unshift(t); S.lo = job.idx; }
      }
      if (o.onTile) o.onTile(job, payload, !!rep);
      pump();
    }
    function recycle() {
      var vl = viewLeft(), vr = viewRight();
      var keep = Math.max(S.W / S.scale, 2 * T + speedUnits() * 5) + T;
      while (S.tiles.length > 1 && S.tiles[0].x1 < vl - keep) { dropTile(S.tiles.shift()); S.lo++; }
      while (S.tiles.length > 1 && S.tiles[S.tiles.length - 1].x0 > vr + keep) { dropTile(S.tiles.pop()); S.hi--; }
    }

    // ---------- governor ----------
    function governor() {
      if (!S.W) return;
      recycle(); rebase();
      var vl = viewLeft(), vr = viewRight();
      var buffered = S.dir > 0 ? S.hi * T - vr : vl - S.lo * T;
      var need = Math.max(120, speedUnits() * 3);
      var f = S.ready ? Math.max(0, Math.min(1, (buffered - 20) / need)) : 0;
      S.eff = f < S.eff ? f : S.eff + (f - S.eff) * 0.12;
      setRate((S.paused || S.hidden || S.dragging) ? 0 : S.dir * (S.speed / 100) * S.eff);
      if (!S.ready && S.started && S.hi > S.lo && S.lo * T <= vl && S.hi * T >= vr) { S.ready = true; if (o.onReady) o.onReady(); }
      if (o.onTick) o.onTick(S, f, buffered);
      pump();
    }

    // ---------- drag and wheel scrub ----------
    function clampView(vl) { return Math.max(S.lo * T, Math.min(S.hi * T - S.W / S.scale, vl)); }
    var drag = null;
    stage.addEventListener("pointerdown", function(e) {
      if (e.button || !S.ready) return;
      drag = { x: e.clientX, vl: viewLeft(), moved: false, id: e.pointerId };
    });
    stage.addEventListener("pointermove", function(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 5) return;
      if (!drag.moved) { drag.moved = true; S.dragging = true; setRate(0); stage.style.cursor = "grabbing"; try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
      setPos(clampView(drag.vl - dx / S.scale));
      pump();
    });
    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var moved = drag.moved; drag = null; S.dragging = false; stage.style.cursor = "";
      if (moved) { S.eff = Math.min(S.eff, 0.25); S.justDragged = true; setTimeout(function() { S.justDragged = false; }, 60); }
    }
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("click", function() { if (!S.justDragged && o.onTap) o.onTap(); });
    stage.addEventListener("wheel", function(e) {
      if (!S.ready) return;
      e.preventDefault();
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) d *= 30;
      setPos(clampView(viewLeft() + d / S.scale));
      S.eff = Math.min(S.eff, 0.3);
      pump();
    }, { passive: false });

    document.addEventListener("visibilitychange", function() {
      S.hidden = document.hidden;
      if (S.hidden) anim.pause(); else { anim.play(); S.eff = Math.min(S.eff, 0.3); }
      governor();
    });
    var rT = 0;
    window.addEventListener("resize", function() { clearTimeout(rT); rT = setTimeout(function() { measure(false); governor(); }, 150); });
    window.addEventListener("orientationchange", function() { setTimeout(function() { measure(true); governor(); }, 300); });

    S.restyle = function() { S.epoch++; pump(); };
    S.setPaused = function(p) { S.paused = p; governor(); };
    S.setDir = function(d) { S.dir = d < 0 ? -1 : 1; S.eff = Math.min(S.eff, 0.2); governor(); };
    // throw every tile away and start again from the current position
    S.reset = function() {
      S.gen++; S.job = null;
      while (S.tiles.length) dropTile(S.tiles.pop());
      S.lo = S.hi = 0; S.ready = false; S.eff = 0; setRate(0);
      governor();
    };
    S.edgeRight = function() { return Math.max(S.hi * T, S.job && !S.job.replace ? S.job.x1 : -Infinity); };
    S.edgeLeft = function() { return Math.min(S.lo * T, S.job && !S.job.replace ? S.job.x0 : Infinity); };
    S.start = function() { S.started = true; S.epoch++; governor(); };
    S.measure = measure; S.governor = governor;
    measure(true);
    setInterval(governor, 100);
    return S;
  };

  /* ---------- controls ---------- */
  E.bindRange = function(id, outId, fmt, fn) {
    var el = document.getElementById(id), out = document.getElementById(outId);
    var f = function() { out.textContent = fmt(+el.value); fn(+el.value); };
    el.addEventListener("input", f); f();
    return el;
  };

  // panel, menu button, hide-all, pause, keyboard: the furniture every piece shares
  E.chrome = function(S, ids) {
    var $ = function(id) { return document.getElementById(id); };
    var panel = $(ids.panel || "panel"), menuBtn = $(ids.menu || "menu"), playBtn = $(ids.play || "play"), dirBtn = $(ids.dir || "reverse");
    function setPanel(open) { panel.hidden = !open; menuBtn.setAttribute("aria-expanded", open ? "true" : "false"); }
    function setPaused(p) { playBtn.textContent = p ? "Resume" : "Pause"; playBtn.setAttribute("aria-pressed", p ? "true" : "false"); S.setPaused(p); }
    function setDir(d) { S.setDir(d); if (dirBtn) { dirBtn.setAttribute("aria-pressed", d < 0 ? "true" : "false"); dirBtn.textContent = d < 0 ? "Heading west" : "Heading east"; } if (ids.onDir) ids.onDir(d); }
    menuBtn.addEventListener("click", function() { setPanel(panel.hidden); });
    $(ids.close || "closePanel").addEventListener("click", function() { setPanel(false); menuBtn.focus(); });
    $(ids.hide || "hideAll").addEventListener("click", function() { setPanel(false); document.body.classList.add("bare"); });
    playBtn.addEventListener("click", function() { setPaused(!S.paused); });
    if (dirBtn) dirBtn.addEventListener("click", function() { setDir(-S.dir); });
    document.addEventListener("keydown", function(e) {
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" && e.target.type === "text") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space" && tag !== "button") { e.preventDefault(); setPaused(!S.paused); }
      else if (e.key === "h" || e.key === "H") document.body.classList.toggle("bare");
      else if (e.key === "ArrowLeft" && tag !== "input") setDir(-1);
      else if (e.key === "ArrowRight" && tag !== "input") setDir(1);
      else if (e.key === "Escape" && !panel.hidden) { setPanel(false); menuBtn.focus(); }
    });
    return {
      setPanel: setPanel, setPaused: setPaused, setDir: setDir,
      tap: function() {
        if (document.body.classList.contains("bare")) document.body.classList.remove("bare");
        else if (!panel.hidden) setPanel(false);
      }
    };
  };

  /* ---------- settings kept in the URL (#speed=35&theme=relief) ---------- */
  E.persist = function(root, skip) {
    var params = {}, t = 0;
    (location.hash || "").replace(/^#/, "").split("&").forEach(function(kv) {
      var i = kv.indexOf("="); if (i > 0) { try { params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} }
    });
    var els = [].slice.call(root.querySelectorAll("input")).filter(function(el) { return !(skip && skip.indexOf(el.id || el.name) >= 0); });
    function key(el) { return el.type === "radio" ? el.name : el.id; }
    var defaults = {};
    function val(el) { return el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value; }
    els.forEach(function(el) { if (el.type !== "radio" || el.checked) defaults[key(el)] = val(el); });
    els.forEach(function(el) {
      var k = key(el); if (!k || !(k in params)) return;
      var v = params[k];
      if (el.type === "radio") { if (el.value === v && !el.checked) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); } }
      else if (el.type === "checkbox") { var c = v === "1"; if (el.checked !== c) { el.checked = c; el.dispatchEvent(new Event("change", { bubbles: true })); } }
      else if (el.type === "range") { if (el.value !== v) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } }
      else el.value = v;
    });
    function save() {
      clearTimeout(t);
      t = setTimeout(function() {
        var out = [];
        els.forEach(function(el) {
          if (el.type === "radio" && !el.checked) return;
          var k = key(el), v = val(el);
          if (k && (v !== defaults[k] || el.type === "text") && v !== "") out.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
        });
        try { history.replaceState(null, "", out.length ? "#" + out.join("&") : location.pathname + location.search); } catch (e) {}
      }, 400);
    }
    root.addEventListener("input", save); root.addEventListener("change", save);
    return { params: params, save: save };
  };

  // resolve true once the listed web fonts are usable (or false after the timeout)
  E.fonts = function(list, ms) {
    return new Promise(function(res) {
      var done = false;
      function end(ok) { if (!done) { done = true; res(ok); } }
      if (!document.fonts || !document.fonts.load) return end(false);
      Promise.all(list.map(function(f) { return document.fonts.load(f); })).then(function() {
        end(list.every(function(f) { return document.fonts.check(f); }));
      }, function() { end(false); });
      setTimeout(function() { end(false); }, ms || 2500);
    });
  };
})();
