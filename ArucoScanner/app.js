(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = window.ArucoScanner;
  var scanner = S.create();
  var defByName = {};
  S.DEFS.forEach(function (d) { defByName[d.name] = d; });

  var video = $('video'), photo = $('photo'), overlay = $('overlay');
  var octx = overlay.getContext('2d');
  var grab = document.createElement('canvas');
  var gctx = grab.getContext('2d', { willReadFrequently: true });

  var state = {
    stream: null, running: false, paused: false, photoMode: false,
    tracks: {}, history: [], last: null, frame: 0, wake: null,
    dict: 'auto', res: 960, sound: true
  };

  // ---------- settings ----------
  function load(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  var dictSel = $('dict');
  dictSel.innerHTML = '<option value="auto">Auto-detect (recommended)</option>' +
    S.DEFS.map(function (d) { return '<option value="' + d.name + '">' + d.label + '</option>'; }).join('');
  state.dict = load('dict', 'auto'); if (!defByName[state.dict]) state.dict = 'auto';
  state.res = parseInt(load('res', '800'), 10) || 800;
  state.sound = load('sound', '1') === '1';
  dictSel.value = state.dict; $('res').value = String(state.res); $('sound').checked = state.sound;
  dictSel.onchange = function () { state.dict = dictSel.value; save('dict', state.dict); state.tracks = {}; };
  $('res').onchange = function () { state.res = parseInt($('res').value, 10); save('res', state.res); };
  $('sound').onchange = function () { state.sound = $('sound').checked; save('sound', state.sound ? '1' : '0'); };
  $('settingsBtn').onclick = function () { var s = $('settings'); s.hidden = !s.hidden; };

  // ---------- camera ----------
  function splash(msg, isErr, showStart) {
    $('splash').hidden = false;
    $('splashMsg').textContent = msg;
    $('splashMsg').className = isErr ? 'err' : '';
    $('start').hidden = showStart === false;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      splash('Camera needs a secure (https) page. Open the hosted https address of this app in Safari, or use "Scan a photo".', true);
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
    } catch (e) {
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      splash(denied ? 'Camera permission was denied. Allow it in Settings › Safari › Camera (or for this app), then tap Start.' : 'Could not open the camera: ' + (e && e.message || e), true);
      return;
    }
    var track = state.stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* unsupported */ }
    video.srcObject = state.stream;
    await video.play().catch(function () {});
    $('splash').hidden = true;
    photo.hidden = true; state.photoMode = false;
    state.running = true; state.paused = false; $('pause').textContent = 'Pause';
    try { if (navigator.wakeLock) state.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
    requestAnimationFrame(loop);
  }
  $('start').onclick = startCamera;

  document.addEventListener('visibilitychange', async function () {
    if (document.visibilityState === 'visible' && state.running) {
      try { if (navigator.wakeLock) state.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
    }
  });

  // ---------- detection loop ----------
  var lastStatsAt = 0, msAvg = 0;
  function loop() {
    if (!state.running) return;
    requestAnimationFrame(loop);
    if (state.paused || !video.videoWidth) return;
    var t0 = performance.now();
    var scale = Math.min(1, state.res / Math.max(video.videoWidth, video.videoHeight));
    var w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
    if (grab.width !== w || grab.height !== h) { grab.width = w; grab.height = h; }
    gctx.drawImage(video, 0, 0, w, h);
    var img = gctx.getImageData(0, 0, w, h);
    var found = scanner.scan(img, state.dict === 'auto' ? null : state.dict);
    update(found, false);
    draw(w, h);
    msAvg = msAvg * 0.9 + (performance.now() - t0) * 0.1;
    if (t0 - lastStatsAt > 500) { lastStatsAt = t0; $('stats').textContent = w + '×' + h + ' · ' + Math.round(msAvg) + ' ms/frame'; }
  }

  // ---------- tracking: a tag must be seen on a few frames before it counts ----------
  function need(name) {
    var d = scanner.built[name].dict;
    return d.nBits <= 16 ? 4 : 3; // tiny 4x4 grids are the most prone to false hits
  }

  function update(found, instant) {
    state.frame++;
    var now = Date.now();
    var seen = {};
    found.forEach(function (f) {
      var key = f.dict + ':' + f.id;
      seen[key] = true;
      var t = state.tracks[key];
      if (!t) t = state.tracks[key] = { key: key, dict: f.dict, id: f.id, hits: 0, miss: 0, confirmed: false };
      t.hits = instant ? 99 : t.hits + 1; t.miss = 0;
      t.corners = f.corners; t.distance = f.distance; t.seenAt = now; t.area = S.area(f.corners);
      if (!t.confirmed && t.hits >= need(f.dict)) {
        t.confirmed = true;
        if (!t.loggedAt || now - t.loggedAt > 3000) onNewTag(t);
        t.loggedAt = now;
      }
      if (t.confirmed) t.loggedAt = now;
    });
    Object.keys(state.tracks).forEach(function (k) {
      if (seen[k]) return;
      var t = state.tracks[k];
      t.miss++;
      if (!t.confirmed) t.hits = Math.max(0, t.hits - 1);
      if (t.miss > 8 && !state.photoMode) delete state.tracks[k];
    });
    render();
  }

  function onNewTag(t) {
    var def = defByName[t.dict];
    var entry = { time: new Date(), dict: t.dict, id: t.id, family: S.describe(def, t.id), label: def.label };
    state.history.unshift(entry);
    if (state.history.length > 200) state.history.pop();
    state.last = entry;
    renderHistory();
    if (state.sound) beep();
    if (navigator.vibrate) navigator.vibrate(30);
  }

  function visible() {
    return Object.keys(state.tracks).map(function (k) { return state.tracks[k]; })
      .filter(function (t) { return t.confirmed && t.miss <= 2; })
      .sort(function (a, b) { return b.area - a.area; });
  }

  function render() {
    var vis = visible();
    var big = $('bigId'), meta = $('bigMeta');
    if (vis.length) {
      var t = vis[0], def = defByName[t.dict];
      big.textContent = t.id; big.className = '';
      meta.textContent = def.label + ' · ' + S.describe(def, t.id) + (t.distance ? ' · ' + t.distance + ' bit corrected' : '');
    } else if (state.last) {
      big.textContent = state.last.id; big.className = 'dim';
      meta.textContent = 'Last: ' + state.last.label + ' · ' + state.last.family;
    } else {
      big.textContent = '—'; big.className = 'dim';
      meta.textContent = state.running || state.photoMode ? 'Looking for tags…' : 'No tag yet';
    }
    $('live').innerHTML = vis.length > 1 ? vis.map(function (t) {
      return '<span class="chip"><b>' + t.id + '</b> ' + defByName[t.dict].label + '</span>';
    }).join('') : '';
  }

  function renderHistory() {
    var ul = $('history');
    if (!state.history.length) { ul.innerHTML = '<li class="empty">Scanned tags appear here</li>'; return; }
    ul.innerHTML = state.history.map(function (e) {
      return '<li><span class="hid">' + e.id + '</span><span class="hmeta">' + e.label + '<br>' + e.family + ' · ' +
        e.time.toLocaleTimeString() + '</span></li>';
    }).join('');
  }

  // ---------- overlay ----------
  function draw(w, h) {
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    octx.clearRect(0, 0, w, h);
    var lw = Math.max(2, w / 250);
    Object.keys(state.tracks).forEach(function (k) {
      var t = state.tracks[k];
      if (t.miss > 2 || !t.corners) return;
      var ok = t.confirmed;
      octx.lineWidth = lw;
      octx.strokeStyle = ok ? '#35d07f' : 'rgba(255,179,71,.7)';
      octx.beginPath();
      t.corners.forEach(function (p, i) { if (i) octx.lineTo(p.x, p.y); else octx.moveTo(p.x, p.y); });
      octx.closePath(); octx.stroke();
      octx.fillStyle = '#ff4d6d';
      octx.beginPath(); octx.arc(t.corners[0].x, t.corners[0].y, lw * 1.8, 0, 7); octx.fill();
      if (ok) {
        var cx = 0, cy = 0; t.corners.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
        var size = Math.max(16, Math.sqrt(t.area) * 0.45);
        octx.font = '700 ' + size + 'px -apple-system, system-ui, sans-serif';
        octx.textAlign = 'center'; octx.textBaseline = 'middle';
        octx.lineWidth = size / 6; octx.strokeStyle = 'rgba(0,0,0,.75)';
        octx.strokeText(String(t.id), cx, cy);
        octx.fillStyle = '#fff'; octx.fillText(String(t.id), cx, cy);
      }
    });
  }

  // ---------- photo scan ----------
  function scanPhoto(file) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var im = new Image();
    im.onload = function () {
      var scale = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      var w = Math.round(im.naturalWidth * scale), h = Math.round(im.naturalHeight * scale);
      photo.width = w; photo.height = h;
      var pctx = photo.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(im, 0, 0, w, h);
      URL.revokeObjectURL(url);
      state.running = false; state.photoMode = true; state.tracks = {};
      if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; }
      video.srcObject = null;
      photo.hidden = false; $('splash').hidden = true;
      var found = scanner.scan(pctx.getImageData(0, 0, w, h), state.dict === 'auto' ? null : state.dict);
      update(found, true);
      draw(w, h);
      $('stats').textContent = found.length ? '' : 'No tags found in this photo';
      $('pause').textContent = 'Camera';
    };
    im.onerror = function () { splash('Could not read that image.', true); };
    im.src = url;
  }
  $('photoInput').onchange = function (e) { scanPhoto(e.target.files[0]); e.target.value = ''; };
  $('photoInput2').onchange = function (e) { scanPhoto(e.target.files[0]); e.target.value = ''; };

  // ---------- buttons ----------
  $('pause').onclick = function () {
    if (state.photoMode) { startCamera(); return; }
    if (!state.running) { startCamera(); return; }
    state.paused = !state.paused;
    $('pause').textContent = state.paused ? 'Resume' : 'Pause';
  };

  $('copy').onclick = async function () {
    var vis = visible();
    var id = vis.length ? vis[0].id : (state.last && state.last.id);
    if (id === undefined || id === null) return;
    var text = String(id);
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); } catch (e2) { /* ignore */ } ta.remove();
    }
    $('copy').textContent = 'Copied ✓'; setTimeout(function () { $('copy').textContent = 'Copy ID'; }, 1200);
  };

  $('clear').onclick = function () { state.history = []; state.last = null; state.tracks = {}; renderHistory(); render(); };

  $('export').onclick = async function () {
    if (!state.history.length) return;
    var csv = 'time,id,dictionary,opencv_name\n' + state.history.slice().reverse().map(function (e) {
      return [e.time.toISOString(), e.id, e.label, e.family].join(',');
    }).join('\n') + '\n';
    var file = new File([csv], 'aruco-scans.csv', { type: 'text/csv' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'ArUco scans' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // ---------- beep ----------
  var actx;
  function beep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.08);
    } catch (e) { /* ignore */ }
  }

  // ---------- offline support ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // exposed for automated tests
  window.__app = { state: state, scanner: scanner, scanPhoto: scanPhoto, update: update, render: render };

  renderHistory(); render();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    splash('Camera needs a secure (https) page. Open the hosted https address of this app in Safari, or use "Scan a photo".', true, false);
  }
})();
