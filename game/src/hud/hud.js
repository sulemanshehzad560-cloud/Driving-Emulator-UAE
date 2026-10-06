// In-game HUD: location sign, turn-by-turn navigation, speed-camera
// warnings, digital cluster, live minimap, full UAE map with GPS, radio and
// climate panels, toasts.
import { RADIO_GENRES } from '../audio/audio.js';
import { icon } from '../ui/icons.js';

const ROAD_COLORS = {
  motorway: '#ff9f43', trunk: '#ffc36b', primary: '#ffe28a', secondary: '#f5f5f5', tertiary: '#e9e9e9',
  motorway_link: '#ff9f43', trunk_link: '#ffc36b', primary_link: '#ffe28a',
};

export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.innerHTML = `
      <div class="hud-loc">
        <div class="loc-sign"><b class="loc-road">—</b><small class="loc-type"></small></div>
        <div class="loc-area">${icon('pin')} <span class="loc-place">UAE</span></div>
      </div>
      <div class="hud-top">
        <div class="nav-card hidden">
          <div class="nav-icon"></div>
          <div class="nav-text"><b class="nav-dist">—</b><span class="nav-street"></span></div>
          <div class="nav-eta"></div>
        </div>
        <div class="cam-warn hidden">${icon('speedcam')} <b class="cw-dist"></b><span class="cw-limit"></span></div>
      </div>
      <div class="hud-right">
        <div class="wallet-chip">${icon('coins')} <b class="w-balance">0</b><small>AED</small></div>
        <div class="fine-chip"><span>Fines</span> <b class="w-fines">0</b> · <span class="w-points">0</span> pts</div>
        <div class="clock-chip"><span class="clock"></span></div>
        <button class="round-btn" data-a="pause" aria-label="Pause">${icon('pause')}</button>
      </div>
      <canvas class="minimap" width="300" height="300"></canvas>
      <div class="toolbar">
        <button data-a="lights" class="tb" aria-label="Headlights">${icon('lights')}</button>
        <button data-a="hazard" class="tb" aria-label="Hazards">${icon('hazard')}</button>
        <button data-a="horn" class="tb" aria-label="Horn">${icon('horn')}</button>
        <button data-a="camera" class="tb" aria-label="Camera">${icon('camera')}</button>
        <button data-a="mirrors" class="tb" aria-label="Mirrors">${icon('mirror')}</button>
        <button data-a="radio" class="tb" aria-label="Radio">${icon('radio')}</button>
        <button data-a="ac" class="tb" aria-label="Climate">${icon('ac')}</button>
        <button data-a="map" class="tb" aria-label="Map">${icon('map')}</button>
      </div>
      <div class="ind-buttons">
        <button data-a="indLeft" class="ind-btn l" aria-label="Left indicator">${icon('indLeft')}</button>
        <button data-a="indRight" class="ind-btn r" aria-label="Right indicator">${icon('indRight')}</button>
      </div>
      <div class="toasts"></div>
      <div class="mission-bar hidden">${icon('flag')} <span class="m-title"></span><b class="m-dist"></b></div>
      <div class="flash"></div>
      <div class="cluster">
        <div class="cl-left">
          <span class="tell tl-left">${icon('indLeft')}</span>
          <span class="tell tl-lights">${icon('lights')}</span>
          <span class="tell tl-high">${icon('highBeam')}</span>
        </div>
        <div class="cl-gauge">
          <canvas class="speedo" width="320" height="320"></canvas>
        </div>
        <div class="cl-right">
          <div class="limit-sign"><span>60</span></div>
          <span class="tell tl-right">${icon('indRight')}</span>
          <span class="tell tl-hazard">${icon('hazard')}</span>
        </div>
        <div class="cl-bottom">
          <span class="cl-ac">${icon('ac')} <b class="ac-temp">22°</b></span>
          <span class="cl-fuel">${icon('fuel')}<i class="fuel-bar"><i></i></i></span>
          <span class="cl-hand">P</span>
        </div>
      </div>
      <div class="signal-ahead hidden"><i class="sa-r"></i><i class="sa-a"></i><i class="sa-g"></i><b class="sa-dist"></b></div>
      <div class="panel radio-panel hidden">
        <div class="panel-head"><b>${icon('radio')} Radio & Music</b><button class="x" data-a="radio">${icon('close')}</button></div>
        <div class="radio-display"><div class="rd-now">Choose a genre</div><div class="rd-status">Off</div><div class="rd-eq"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
        <div class="seg radio-src"><button data-src="radio" class="on">Online radio</button><button data-src="music">My music</button></div>
        <div class="chips radio-genres">${RADIO_GENRES.map((g) => `<button data-genre="${g.id}">${g.name}</button>`).join('')}</div>
        <div class="radio-music hidden">
          <label class="file-btn">${icon('music')} Add songs from your phone<input type="file" accept="audio/*" multiple></label>
          <div class="track-list"></div>
        </div>
        <div class="radio-ctl">
          <button data-r="prev">${icon('prev')}</button><button data-r="toggle" class="big">${icon('playPause')}</button><button data-r="next">${icon('next')}</button>
          <input type="range" class="r-vol" min="0" max="1" step="0.05" value="0.7">
        </div>
        <div class="station-list"></div>
      </div>
      <div class="panel ac-panel hidden">
        <div class="panel-head"><b>${icon('ac')} Climate control</b><button class="x" data-a="ac">${icon('close')}</button></div>
        <div class="ac-grid">
          <div class="ac-dial"><button data-ac="t-">${icon('minus')}</button><div><b class="ac-target">22.0°</b><small>Set temperature</small></div><button data-ac="t+">${icon('plus')}</button></div>
          <div class="ac-dial"><button data-ac="f-">${icon('minus')}</button><div><b class="ac-fanv">AUTO</b><small>Fan speed</small></div><button data-ac="f+">${icon('plus')}</button></div>
          <div class="seg ac-toggles"><button data-ac="power" class="on">A/C</button><button data-ac="auto" class="on">AUTO</button><button data-ac="recirc">Recirculate</button></div>
          <div class="ac-read"><span>Cabin <b class="ac-cabin">—</b></span><span>Outside <b class="ac-out">—</b></span></div>
        </div>
      </div>
      <div class="bigmap hidden">
        <canvas></canvas>
        <div class="bm-search">
          <input type="search" placeholder="Search a place in the UAE…" class="bm-q">
          <div class="bm-results"></div>
        </div>
        <div class="bm-bar">
          <span class="bm-hint">Tap the map to set a destination · pinch to zoom · drag to pan</span>
          <button data-a="zoomIn" aria-label="Zoom in">${icon('plus')}</button>
          <button data-a="zoomOut" aria-label="Zoom out">${icon('minus')}</button>
          <button data-a="recenter" aria-label="Recentre">${icon('location')}</button>
          <button data-a="clearRoute">Clear route</button>
          <button data-a="map" class="primary">Close</button>
        </div>
      </div>`;
    this.$ = (s) => root.querySelector(s);
    this.speedo = this.$('.speedo').getContext('2d');
    this.mini = this.$('.minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.toasts = this.$('.toasts');
    this.mapZoom = 1;
    this.mapCenter = [0, 0];

    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (a && a.dataset.a !== 'horn') {
        game.action(a.dataset.a);
        game.haptic && game.haptic(12);
      }
    });
    const horn = root.querySelector('[data-a="horn"]');
    const hornOff = () => game.audio.horn(false);
    horn.addEventListener('pointerdown', () => game.audio.horn(true));
    horn.addEventListener('pointerup', hornOff);
    horn.addEventListener('pointerleave', hornOff);
    this.mini.addEventListener('click', () => game.action('map'));
    this.bindRadio();
    this.bindAc();
    this.bindBigMap();
  }

  // ------------------------------------------------ radio / AC
  bindRadio() {
    const radio = this.game.radio;
    const p = this.$('.radio-panel');
    p.addEventListener('click', (e) => {
      const g = e.target.closest('[data-genre]');
      if (g) {
        p.querySelectorAll('[data-genre]').forEach((b) => b.classList.toggle('on', b === g));
        radio.loadGenre(g.dataset.genre);
      }
      const r = e.target.closest('[data-r]');
      if (r) radio[r.dataset.r]();
      const s = e.target.closest('[data-src]');
      if (s) {
        radio.setSource(s.dataset.src);
        p.querySelectorAll('[data-src]').forEach((b) => b.classList.toggle('on', b === s));
      }
      const st = e.target.closest('[data-station]');
      if (st) radio.play(+st.dataset.station);
    });
    p.querySelector('input[type=file]').addEventListener('change', (e) => radio.addFiles(e.target.files));
    p.querySelector('.r-vol').addEventListener('input', (e) => radio.setVolume(+e.target.value));
    radio.onchange = () => this.renderRadio();
  }

  renderRadio() {
    const radio = this.game.radio;
    const p = this.$('.radio-panel');
    p.querySelector('.rd-now').textContent = radio.nowPlaying;
    p.querySelector('.rd-status').textContent = radio.status + (radio.source === 'radio' && radio.genre ? ` · ${radio.genre.name}` : '');
    p.querySelector('.rd-eq').classList.toggle('playing', radio.status === 'Playing');
    const music = radio.source === 'music';
    p.querySelector('.radio-genres').classList.toggle('hidden', music);
    p.querySelector('.radio-music').classList.toggle('hidden', !music);
    p.querySelector('.station-list').classList.toggle('hidden', music);
    p.querySelector('.station-list').innerHTML = radio.stations
      .map((s, i) => `<button data-station="${i}" class="${i === radio.index ? 'on' : ''}"><span>${escapeHtml(s.name)}</span><small>${s.country || ''}</small></button>`)
      .join('');
    p.querySelector('.track-list').innerHTML = radio.tracks.length
      ? radio.tracks.map((t, i) => `<div class="${i === radio.trackIndex ? 'on' : ''}">${i + 1}. ${escapeHtml(t.name)}</div>`).join('')
      : '<small>Add MP3 / M4A songs you own — Hollywood, Bollywood, Arabic, anything.</small>';
  }

  bindAc() {
    const p = this.$('.ac-panel');
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ac]');
      if (!b) return;
      const ac = this.game.climate;
      const k = b.dataset.ac;
      if (k === 't-') ac.target = Math.max(16, ac.target - 0.5);
      if (k === 't+') ac.target = Math.min(30, ac.target + 0.5);
      if (k === 'f-') { ac.auto = false; ac.fan = Math.max(0, ac.fan - 1); }
      if (k === 'f+') { ac.auto = false; ac.fan = Math.min(7, ac.fan + 1); }
      if (k === 'power') ac.on = !ac.on;
      if (k === 'auto') ac.auto = !ac.auto;
      if (k === 'recirc') ac.recirc = !ac.recirc;
      this.game.audio.beep(1200, 0.04, 'sine', 0.05);
    });
  }

  togglePanel(name) {
    const el = this.$(`.${name}`);
    const show = el.classList.contains('hidden');
    for (const p of ['radio-panel', 'ac-panel']) this.$(`.${p}`).classList.add('hidden');
    el.classList.toggle('hidden', !show);
    if (name === 'radio-panel' && show) this.renderRadio();
    return show;
  }

  // ------------------------------------------------ big map
  bindBigMap() {
    const wrap = this.$('.bigmap');
    const cv = wrap.querySelector('canvas');
    this.bigCanvas = cv;
    let drag = null, pinch = null;
    const pointers = new Map();
    cv.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: false, cx: this.mapCenter[0], cz: this.mapCenter[1] };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: this.mapZoom };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.mapZoom = Math.max(0.005, Math.min(8, pinch.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)));
        drag = null;
      } else if (drag) {
        const s = this.bigScale();
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
        this.mapCenter = [drag.cx - (e.clientX - drag.x) / s, drag.cz - (e.clientY - drag.y) / s];
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && !drag.moved && pointers.size === 0) {
        const r = cv.getBoundingClientRect();
        const s = this.bigScale();
        this.game.setDestination(this.mapCenter[0] + (e.clientX - r.left - r.width / 2) / s, this.mapCenter[1] + (e.clientY - r.top - r.height / 2) / s);
      }
      if (pointers.size === 0) drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      this.mapZoom = Math.max(0.005, Math.min(8, this.mapZoom * (e.deltaY > 0 ? 0.85 : 1.18)));
    }, { passive: true });
    const q = this.$('.bm-q');
    const res = this.$('.bm-results');
    q.addEventListener('input', () => {
      const text = q.value.trim().toLowerCase();
      const ov = this.game.overview;
      if (!text || !ov) {
        res.innerHTML = '';
        return;
      }
      const hits = ov.places.filter((p) => p.name.toLowerCase().includes(text)).slice(0, 8);
      res.innerHTML = hits.map((p, i) => `<button data-place="${i}">${icon('pin')} ${escapeHtml(p.name)} <small>${p.kind}</small></button>`).join('') || '<small>No places found</small>';
      res.onclick = (e) => {
        const b = e.target.closest('[data-place]');
        if (!b) return;
        const p = hits[+b.dataset.place];
        this.mapCenter = [p.X, p.Z];
        this.mapZoom = Math.max(this.mapZoom, 0.08);
        this.game.setDestination(p.X, p.Z, p.name);
        q.value = '';
        res.innerHTML = '';
      };
    });
  }

  bigScale() {
    const cv = this.bigCanvas;
    return (Math.min(cv.width, cv.height) / 3000) * this.mapZoom * 2;
  }

  toggleBigMap() {
    const el = this.$('.bigmap');
    const show = el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
    if (show) {
      const cv = this.bigCanvas;
      cv.width = cv.clientWidth * Math.min(2, devicePixelRatio);
      cv.height = cv.clientHeight * Math.min(2, devicePixelRatio);
      this.mapCenter = [this.game.player.x, this.game.player.z];
      this.mapZoom = 1;
    }
    return show;
  }

  recenter() {
    this.mapCenter = [this.game.player.x, this.game.player.z];
  }

  // ------------------------------------------------ drawing
  drawRoads(ctx, graph, cx, cz, radius, s, rotate) {
    const cells = new Set();
    const C = 40;
    const r = Math.ceil(radius / C);
    const ci = Math.floor(cx / C), cj = Math.floor(cz / C);
    const segs = [];
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const list = graph.grid.get(i * 1000003 + j);
        if (!list) continue;
        for (const sg of list) {
          if (cells.has(sg)) continue;
          cells.add(sg);
          segs.push(sg);
        }
      }
    }
    segs.sort((a, b) => a.road.rank - b.road.rank);
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (const sg of segs) {
        const a = graph.pt(sg.a), b = graph.pt(sg.b);
        if (!a || !b) continue;
        const w = Math.max(1.5, sg.road.width * s * (pass ? 1 : 1.5));
        ctx.strokeStyle = pass ? ROAD_COLORS[sg.road.type] || '#b9c2cc' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo((a.x - cx) * s, (a.z - cz) * s);
        ctx.lineTo((b.x - cx) * s, (b.z - cz) * s);
        ctx.stroke();
      }
    }
    void rotate;
  }

  drawBuildings(ctx, streamer, cx, cz, radius, s) {
    ctx.fillStyle = 'rgba(92,104,122,0.55)';
    for (const t of streamer.tiles.values()) {
      const [ox, oy] = t.origin;
      if (Math.abs(ox + 500 - cx) > radius + 800 || Math.abs(-oy - 500 - cz) > radius + 800) continue;
      for (const p of t.collision.polys) {
        const [x0, z0] = p[0];
        if (Math.abs(x0 - cx) > radius || Math.abs(z0 - cz) > radius) continue;
        ctx.beginPath();
        p.forEach(([x, z], i) => (i ? ctx.lineTo((x - cx) * s, (z - cz) * s) : ctx.moveTo((x - cx) * s, (z - cz) * s)));
        ctx.fill();
      }
    }
  }

  drawMinimap(player, route) {
    const ctx = this.miniCtx;
    const W = this.mini.width;
    const g = this.game;
    const zoom = 1.4 - Math.min(0.75, player.kmh / 220);
    const s = zoom * 0.5; // px per metre
    const radius = (W / 2) / s;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 3, 0, Math.PI * 2);
    ctx.clip();
    const bg = ctx.createRadialGradient(W / 2, W / 2, 10, W / 2, W / 2, W / 2);
    bg.addColorStop(0, '#26303d');
    bg.addColorStop(1, '#161c25');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W * 0.62);
    ctx.rotate(player.heading);
    this.drawBuildings(ctx, g.streamer, player.x, player.z, radius, s);
    this.drawRoads(ctx, g.graph, player.x, player.z, radius, s);
    if (route && route.length > 1) {
      ctx.strokeStyle = '#2f9bff';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach(([x, z], i) => (i ? ctx.lineTo((x - player.x) * s, (z - player.z) * s) : ctx.moveTo((x - player.x) * s, (z - player.z) * s)));
      ctx.stroke();
    }
    // traffic, cameras
    ctx.fillStyle = '#ffd24a';
    for (const c of g.traffic.cars) {
      if (!c.active) continue;
      const px = (c.x - player.x) * s, pz = (c.z - player.z) * s;
      if (px * px + pz * pz > W * W) continue;
      ctx.fillRect(px - 2.5, pz - 2.5, 5, 5);
    }
    for (const cam of g.enforcement.cameras) {
      const px = (cam.x - player.x) * s, pz = (cam.z - player.z) * s;
      if (px * px + pz * pz > W * W) continue;
      ctx.fillStyle = '#ff375f';
      ctx.beginPath();
      ctx.arc(px, pz, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // player arrow
    ctx.save();
    ctx.translate(W / 2, W * 0.62);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#0a84ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(10,132,255,0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // bezel + compass
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(player.heading);
    ctx.fillStyle = '#ff453a';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -W / 2 + 26);
    ctx.restore();
  }

  drawBigMap(player, route, dest) {
    const cv = this.bigCanvas;
    if (!cv || this.$('.bigmap').classList.contains('hidden')) return;
    const ctx = cv.getContext('2d');
    const s = this.bigScale();
    const [cx, cz] = this.mapCenter;
    const tp = (x, z) => [cv.width / 2 + (x - cx) * s, cv.height / 2 + (z - cz) * s];
    ctx.fillStyle = '#0d3b4f'; // sea
    ctx.fillRect(0, 0, cv.width, cv.height);
    const ov = this.game.overview;
    if (ov) {
      // land (country outline), emirate borders, major roads
      ctx.fillStyle = '#e9dcc2';
      for (const poly of ov.data.outline || []) {
        ctx.beginPath();
        for (let i = 0; i < poly.length; i += 2) {
          const [x, y] = tp(poly[i], -poly[i + 1]);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.fill();
      }
      if (!(ov.data.outline || []).length) {
        ctx.fillStyle = '#e9dcc2';
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
      ctx.strokeStyle = 'rgba(140,110,70,0.6)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.5;
      for (const e of ov.emirates) {
        for (const poly of e.polys) {
          ctx.beginPath();
          for (let i = 0; i < poly.length; i += 2) {
            const [x, y] = tp(poly[i], -poly[i + 1]);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      const detail = s > 0.25;
      if (!detail) {
        for (const w of ov.data.ways) {
          ctx.strokeStyle = w.type.startsWith('motorway') ? '#e8702a' : w.type.startsWith('trunk') ? '#f0a040' : '#c8b48a';
          ctx.lineWidth = w.type.startsWith('motorway') ? 2.2 : 1.2;
          ctx.beginPath();
          w.n.forEach((n, i) => {
            const [x, y] = tp(ov.x[n], ov.z[n]);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#3b2f1d';
      ctx.font = `${Math.round(13 * Math.min(2, devicePixelRatio))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const e of ov.emirates) {
        const [x, y] = tp(e.X, e.Z);
        ctx.fillText(e.name.toUpperCase(), x, y);
      }
      const minKind = s > 0.1 ? ['suburb', 'town', 'city', 'island'] : ['city', 'town'];
      for (const p of ov.places) {
        if (!minKind.includes(p.kind)) continue;
        const [x, y] = tp(p.X, p.Z);
        if (x < 0 || y < 0 || x > cv.width || y > cv.height) continue;
        ctx.fillStyle = p.kind === 'city' ? '#1d1d1d' : '#4a4a4a';
        ctx.fillText(p.name, x, y - 4);
      }
    }
    if (s > 0.08) {
      ctx.save();
      ctx.translate(cv.width / 2, cv.height / 2);
      const radius = Math.max(cv.width, cv.height) / s;
      this.drawBuildings(ctx, this.game.streamer, cx, cz, radius, s);
      this.drawRoads(ctx, this.game.graph, cx, cz, radius, s);
      ctx.restore();
    }
    if (route && route.length > 1) {
      ctx.strokeStyle = '#2f9bff';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach(([x, z], i) => {
        const [a, b] = tp(x, z);
        i ? ctx.lineTo(a, b) : ctx.moveTo(a, b);
      });
      ctx.stroke();
    }
    if (dest) {
      const [a, b] = tp(dest[0], dest[1]);
      ctx.fillStyle = '#ff375f';
      ctx.beginPath();
      ctx.arc(a, b - 16, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(a - 8, b - 12);
      ctx.lineTo(a + 8, b - 12);
      ctx.lineTo(a, b);
      ctx.fill();
    }
    const [px, pz] = tp(player.x, player.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-player.heading);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#0a84ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(11, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-11, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Racing speedometer: segmented arc that lights up gold -> red, a thin
   * rpm arc, big italic digital speed and the gear. Redrawn only when what
   * it shows changes (saves a canvas repaint and texture upload per frame).
   */
  drawSpeedo(v, limit) {
    const kmh = Math.round(v.kmh);
    const rpmN = Math.min(1, v.rpm / 7500);
    const gear = v.gear === -1 ? 'R' : v.kmh < 1 ? 'N' : String(v.gear);
    const key = `${kmh}|${Math.round(rpmN * 40)}|${gear}|${limit}`;
    if (key === this.speedoKey) return;
    this.speedoKey = key;
    const ctx = this.speedo;
    const W = 320, cx = 160, cy = 168, R = 138;
    const max = Math.max(260, Math.ceil(v.spec.topSpeed / 20) * 20);
    ctx.clearRect(0, 0, W, W);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const over = v.kmh > limit + 5;
    // soft dark backing so it reads over a bright sky or road
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, R + 16);
    g.addColorStop(0, 'rgba(6,7,10,0.78)');
    g.addColorStop(0.75, 'rgba(6,7,10,0.55)');
    g.addColorStop(1, 'rgba(6,7,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 16, 0, Math.PI * 2);
    ctx.fill();
    // segmented speed arc
    const N = 36, gap = 0.022;
    const lit = Math.round(Math.min(1, v.kmh / max) * N);
    const limitSeg = Math.round(Math.min(1, limit / max) * N);
    for (let i = 0; i < N; i++) {
      const s0 = a0 + ((a1 - a0) * i) / N + gap, s1 = a0 + ((a1 - a0) * (i + 1)) / N - gap;
      let col = 'rgba(255,255,255,0.1)';
      if (i < lit) {
        const t = i / N;
        col = over && i >= limitSeg ? '#ff2d46' : t < 0.55 ? '#ffb800' : t < 0.8 ? '#ff7a1a' : '#ff2d46';
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = i < lit ? 16 : 12;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 10, s0, s1);
      ctx.stroke();
    }
    // speed-limit tick
    const la = a0 + (a1 - a0) * Math.min(1, limit / max);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(la) * (R + 4), cy + Math.sin(la) * (R + 4));
    ctx.lineTo(cx + Math.cos(la) * (R - 26), cy + Math.sin(la) * (R - 26));
    ctx.stroke();
    // rpm arc
    ctx.lineCap = 'butt';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(cx, cy, R - 34, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = rpmN > 0.86 ? '#ff2d46' : '#18d2ff';
    ctx.beginPath();
    ctx.arc(cx, cy, R - 34, a0, a0 + (a1 - a0) * rpmN);
    ctx.stroke();
    // digits
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = over ? '#ff5468' : '#ffffff';
    ctx.font = 'italic 800 92px "Saira Condensed", "Arial Narrow", sans-serif';
    ctx.fillText(kmh, cx - 4, cy - 6);
    ctx.fillStyle = '#8e98a8';
    ctx.font = '700 26px "Saira Condensed", sans-serif';
    ctx.fillText('KM/H', cx, cy + 44);
    // gear badge
    ctx.fillStyle = gear === 'R' ? '#ff2d46' : '#ffb800';
    ctx.beginPath();
    const gx = cx, gy = cy + 92, gw = 28;
    ctx.moveTo(gx - gw * 0.5, gy - 18);
    ctx.lineTo(gx + gw * 0.5, gy - 18);
    ctx.lineTo(gx + gw, gy);
    ctx.lineTo(gx + gw * 0.5, gy + 18);
    ctx.lineTo(gx - gw * 0.5, gy + 18);
    ctx.lineTo(gx - gw, gy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1b1300';
    ctx.font = 'italic 800 32px "Saira Condensed", sans-serif';
    ctx.fillText(gear, gx, gy + 1);
  }

  update(st) {
    const { player, limit, roadName, roadSub, place, profile, lights, indicators, climate, fuel, handbrake, clock, nav, camWarn, signalAhead } = st;
    this.drawSpeedo(player, limit);
    if (limit !== this.lastLimit) {
      const el = this.$('.limit-sign');
      el.querySelector('span').textContent = limit;
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
      this.lastLimit = limit;
    }
    this.$('.limit-sign').classList.toggle('over', player.kmh > limit + 5);
    if (roadName !== this.lastRoad) {
      this.$('.loc-road').textContent = roadName || 'Off road';
      this.lastRoad = roadName;
    }
    this.$('.loc-type').textContent = roadSub || '';
    this.$('.loc-place').textContent = place || 'UAE';
    this.$('.w-balance').textContent = Math.round(profile.balance).toLocaleString('en-US');
    this.$('.w-fines').textContent = `AED ${profile.sessionFines.toLocaleString('en-US')}`;
    this.$('.w-points').textContent = profile.blackPoints;
    this.$('.clock').textContent = clock;
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    this.$('.tl-left').classList.toggle('on', (indicators.left || indicators.hazard) && blink);
    this.$('.tl-right').classList.toggle('on', (indicators.right || indicators.hazard) && blink);
    this.$('.tl-hazard').classList.toggle('on', indicators.hazard);
    this.$('.tl-lights').classList.toggle('on', lights >= 1);
    this.$('.tl-high').classList.toggle('on', lights === 2);
    this.$('.cl-hand').classList.toggle('on', handbrake);
    this.$('.ind-btn.l').classList.toggle('on', indicators.left || indicators.hazard);
    this.$('.ind-btn.r').classList.toggle('on', indicators.right || indicators.hazard);
    this.$('[data-a="lights"]').classList.toggle('on', lights > 0);
    this.$('[data-a="hazard"]').classList.toggle('on', indicators.hazard);
    this.$('.ac-temp').textContent = climate.on ? `${climate.cabin.toFixed(0)}°` : 'OFF';
    this.$('.ac-target').textContent = `${climate.target.toFixed(1)}°`;
    this.$('.ac-fanv').textContent = climate.auto ? 'AUTO' : climate.fan;
    this.$('.ac-cabin').textContent = `${climate.cabin.toFixed(1)}°C`;
    this.$('.ac-out').textContent = `${climate.outside}°C`;
    this.$('[data-ac="power"]').classList.toggle('on', climate.on);
    this.$('[data-ac="auto"]').classList.toggle('on', climate.auto);
    this.$('[data-ac="recirc"]').classList.toggle('on', climate.recirc);
    const fb = this.$('.fuel-bar i');
    fb.style.width = `${Math.max(0, fuel) * 100}%`;
    fb.classList.toggle('low', fuel < 0.15);
    // navigation card
    const card = this.$('.nav-card');
    card.classList.toggle('hidden', !nav);
    if (nav) {
      this.$('.nav-icon').innerHTML = icon(nav.icon);
      this.$('.nav-dist').textContent = nav.dist;
      this.$('.nav-street').textContent = nav.street;
      this.$('.nav-eta').textContent = nav.eta || '';
    }
    const cw = this.$('.cam-warn');
    cw.classList.toggle('hidden', !camWarn);
    if (camWarn) {
      this.$('.cw-dist').textContent = `${Math.round(camWarn.dist / 10) * 10} m`;
      this.$('.cw-limit').textContent = `Speed camera · ${camWarn.limit}`;
      cw.classList.toggle('danger', player.kmh > camWarn.limit + 5);
    }
    const sa = this.$('.signal-ahead');
    sa.classList.toggle('hidden', !signalAhead);
    if (signalAhead) {
      sa.dataset.state = signalAhead.state;
      this.$('.sa-dist').textContent = `${Math.round(signalAhead.dist)} m`;
    }
  }

  toast(html, kind = 'info', ms = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = html;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 500);
  }

  flash() {
    const f = this.$('.flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  mission(title, dist) {
    const bar = this.$('.mission-bar');
    bar.classList.toggle('hidden', !title);
    if (!title) return;
    this.$('.m-title').textContent = title;
    this.$('.m-dist').textContent = dist;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
