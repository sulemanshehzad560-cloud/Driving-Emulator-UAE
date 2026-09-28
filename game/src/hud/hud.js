// In-game HUD: instrument cluster, speed-limit sign, road name, minimap,
// full-screen map with GPS routing, radio and climate (AC) panels.
import { RADIO_GENRES } from '../audio/audio.js';

const ROAD_COLORS = {
  motorway: '#f0a24a', trunk: '#f3c35a', primary: '#f6dc84', secondary: '#ffffff', tertiary: '#f2f2f2',
};

export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.innerHTML = `
      <div class="hud-top-left">
        <div class="road-name"><span class="rn-name">—</span><span class="rn-sub"></span></div>
      </div>
      <div class="hud-top-right">
        <div class="wallet"><span class="coin">AED</span> <b class="w-balance">0</b></div>
        <div class="fines">Fines <b class="w-fines">0</b> · Black pts <b class="w-points">0</b></div>
        <div class="clock"></div>
        <button class="hud-btn pause-btn" data-a="pause">❚❚</button>
      </div>
      <canvas class="minimap" width="260" height="260"></canvas>
      <div class="toasts"></div>
      <div class="mission-bar hidden"><span class="m-title"></span><span class="m-dist"></span></div>
      <div class="flash"></div>
      <div class="cluster">
        <canvas class="speedo" width="300" height="300"></canvas>
        <div class="cluster-mid">
          <div class="ind-row">
            <span class="ind ind-left">⬅</span>
            <span class="ind ind-lights" title="Headlights">◐</span>
            <span class="ind ind-high" title="High beam">≣</span>
            <span class="ind ind-hazard">⚠</span>
            <span class="ind ind-hand">(P)</span>
            <span class="ind ind-right">➡</span>
          </div>
          <div class="limit-sign"><span>60</span></div>
          <div class="ac-read"><span class="ac-icon">❄</span> <b class="ac-temp">22.0°</b> <small class="ac-fan">AUTO</small></div>
          <div class="fuel"><span>⛽</span><div class="fuel-bar"><div></div></div></div>
        </div>
      </div>
      <div class="quick">
        <button class="q" data-a="indLeft">⬅</button>
        <button class="q" data-a="hazard">⚠</button>
        <button class="q" data-a="indRight">➡</button>
        <button class="q" data-a="lights">💡</button>
        <button class="q" data-a="horn">📯</button>
        <button class="q" data-a="camera">🎥</button>
        <button class="q" data-a="mirrors">🪞</button>
        <button class="q" data-a="map">🗺</button>
        <button class="q" data-a="radio">📻</button>
        <button class="q" data-a="ac">❄</button>
      </div>
      <div class="panel radio-panel hidden">
        <div class="panel-head"><b>📻 Radio & Music</b><button class="x" data-a="radio">✕</button></div>
        <div class="radio-display"><div class="rd-now">Choose a genre</div><div class="rd-status">Off</div></div>
        <div class="radio-src">
          <button data-src="radio" class="on">Online radio</button>
          <button data-src="music">My music</button>
        </div>
        <div class="radio-genres">${RADIO_GENRES.map((g) => `<button data-genre="${g.id}">${g.name}</button>`).join('')}</div>
        <div class="radio-music hidden">
          <label class="file-btn">＋ Add songs from phone<input type="file" accept="audio/*" multiple></label>
          <div class="track-list"></div>
        </div>
        <div class="radio-ctl">
          <button data-r="prev">⏮</button><button data-r="toggle">⏯</button><button data-r="next">⏭</button>
          <input type="range" class="r-vol" min="0" max="1" step="0.05" value="0.7">
        </div>
        <div class="station-list"></div>
      </div>
      <div class="panel ac-panel hidden">
        <div class="panel-head"><b>❄ Climate control</b><button class="x" data-a="ac">✕</button></div>
        <div class="ac-grid">
          <div class="ac-box"><small>Set temperature</small><div class="ac-set"><button data-ac="t-">−</button><b class="ac-target">22.0°C</b><button data-ac="t+">＋</button></div></div>
          <div class="ac-box"><small>Fan speed</small><div class="ac-set"><button data-ac="f-">−</button><b class="ac-fanv">AUTO</b><button data-ac="f+">＋</button></div></div>
          <div class="ac-box toggles">
            <button data-ac="power" class="on">A/C</button>
            <button data-ac="auto" class="on">AUTO</button>
            <button data-ac="recirc">⟲ Recirc</button>
          </div>
          <div class="ac-box"><small>Cabin</small><b class="ac-cabin">—</b><small>Outside</small><b class="ac-out">—</b></div>
        </div>
      </div>
      <div class="bigmap hidden">
        <canvas></canvas>
        <div class="bigmap-bar"><span>Tap the map to set a GPS destination · pinch or use ＋/− to zoom</span>
          <button data-a="zoomIn">＋</button><button data-a="zoomOut">−</button><button data-a="clearRoute">Clear route</button><button data-a="map">Close ✕</button></div>
      </div>`;
    this.$ = (s) => root.querySelector(s);
    this.speedo = this.$('.speedo').getContext('2d');
    this.mini = this.$('.minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.toasts = this.$('.toasts');
    this.lastLimit = null;
    this.mapZoom = 1;

    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (a) game.action(a.dataset.a);
    });
    const horn = root.querySelector('[data-a="horn"]');
    horn.addEventListener('pointerdown', () => game.audio.horn(true));
    horn.addEventListener('pointerup', () => game.audio.horn(false));
    horn.addEventListener('pointerleave', () => game.audio.horn(false));
    this.mini.addEventListener('click', () => game.action('map'));
    this.bindRadio();
    this.bindAc();
    this.bindBigMap();
  }

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
    const music = radio.source === 'music';
    p.querySelector('.radio-genres').classList.toggle('hidden', music);
    p.querySelector('.radio-music').classList.toggle('hidden', !music);
    p.querySelector('.station-list').classList.toggle('hidden', music);
    p.querySelector('.station-list').innerHTML = radio.stations
      .map((s, i) => `<button data-station="${i}" class="${i === radio.index ? 'on' : ''}">${escapeHtml(s.name)}<small>${s.country || ''}</small></button>`)
      .join('');
    p.querySelector('.track-list').innerHTML = radio.tracks.length
      ? radio.tracks.map((t, i) => `<div class="${i === radio.trackIndex ? 'on' : ''}">${i + 1}. ${escapeHtml(t.name)}</div>`).join('')
      : '<small>Add MP3 / M4A files from your phone (Hollywood, Bollywood, anything you own).</small>';
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

  bindBigMap() {
    const wrap = this.$('.bigmap');
    const cv = wrap.querySelector('canvas');
    this.bigCanvas = cv;
    let drag = null;
    const pointers = new Map();
    let pinch = null;
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
        this.mapZoom = Math.max(0.3, Math.min(8, pinch.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)));
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
        const x = this.mapCenter[0] + (e.clientX - r.left - r.width / 2) / s;
        const z = this.mapCenter[1] + (e.clientY - r.top - r.height / 2) / s;
        this.game.setDestination(x, z);
      }
      if (pointers.size === 0) drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  bigScale() {
    const cv = this.bigCanvas;
    const R = this.game.graph.map.radius || 1500;
    return (Math.min(cv.width, cv.height) / (R * 2.1)) * this.mapZoom;
  }

  togglePanel(name) {
    const el = this.$(`.${name}`);
    const show = el.classList.contains('hidden');
    for (const p of ['radio-panel', 'ac-panel']) this.$(`.${p}`).classList.add('hidden');
    el.classList.toggle('hidden', !show);
    if (name === 'radio-panel' && show) this.renderRadio();
    return show;
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
      this.mapZoom = 2.5;
    }
    return show;
  }

  /** Pre-render the road network once for the minimap / big map. */
  prepareMap(graph, enforcement) {
    const R = graph.map.radius || 1500;
    const scale = 0.7; // px per metre
    const size = Math.ceil(R * 2.2 * scale);
    const c = document.createElement('canvas');
    c.width = c.height = Math.min(size, 4096);
    const s = c.width / (R * 2.2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1b2029';
    ctx.fillRect(0, 0, c.width, c.height);
    const tx = (x) => c.width / 2 + x * s;
    for (const a of graph.map.areas || []) {
      ctx.fillStyle = a.kind === 'water' ? '#1d4e6e' : '#244a2c';
      ctx.beginPath();
      a.p.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), tx(-y)) : ctx.moveTo(tx(x), tx(-y))));
      ctx.fill();
    }
    ctx.fillStyle = '#2c333e';
    for (const b of graph.map.buildings.slice(0, 6000)) {
      ctx.beginPath();
      b.p.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), tx(-y)) : ctx.moveTo(tx(x), tx(-y))));
      ctx.fill();
    }
    ctx.lineCap = ctx.lineJoin = 'round';
    const sorted = [...graph.roads].sort((a, b) => a.rank - b.rank);
    for (const road of sorted) {
      ctx.strokeStyle = ROAD_COLORS[road.type.replace('_link', '')] || '#9aa3ad';
      ctx.lineWidth = Math.max(1.2, road.width * s * 1.2);
      ctx.beginPath();
      road.n.forEach((n, i) => {
        const p = graph.pts[n];
        i ? ctx.lineTo(tx(p[0]), tx(p[1])) : ctx.moveTo(tx(p[0]), tx(p[1]));
      });
      ctx.stroke();
    }
    const dot = (x, z, color, r = 4) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(tx(x), tx(z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const ap of this.game.signals.approaches) dot(ap.x, ap.z, '#ff4d4d', 1.6);
    for (const cam of enforcement.cameras) dot(cam.x, cam.z, '#ff2d55', 3.5);
    for (const t of enforcement.tolls) dot(t.x, t.z, '#2d7bff', 4.5);
    for (const r of enforcement.rest) dot(r.x, r.z, '#35c759', 4.5);
    this.mapCanvas = c;
    this.mapScale = s;
  }

  drawMinimap(player, route) {
    const ctx = this.miniCtx;
    const W = this.mini.width;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1b2029';
    ctx.fillRect(0, 0, W, W);
    const zoom = 1.6 - Math.min(0.8, player.kmh / 200); // zoom out at speed
    const s = this.mapScale * zoom;
    ctx.translate(W / 2, W * 0.62);
    ctx.rotate(player.heading);
    ctx.scale(zoom, zoom);
    const m = this.mapCanvas;
    ctx.drawImage(m, -m.width / 2 - player.x * this.mapScale, -m.height / 2 - player.z * this.mapScale);
    if (route && route.length > 1) {
      ctx.strokeStyle = '#3aa0ff';
      ctx.lineWidth = 5 / zoom;
      ctx.beginPath();
      route.forEach(([x, z], i) => {
        const px = (x - player.x) * this.mapScale, pz = (z - player.z) * this.mapScale;
        i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz);
      });
      ctx.stroke();
    }
    ctx.restore();
    // traffic dots
    ctx.save();
    ctx.translate(W / 2, W * 0.62);
    ctx.rotate(player.heading);
    ctx.fillStyle = '#ffd24a';
    for (const c of this.game.traffic.cars) {
      if (!c.active) continue;
      const px = (c.x - player.x) * s, pz = (c.z - player.z) * s;
      if (px * px + pz * pz > (W / 2) ** 2) continue;
      ctx.fillRect(px - 2, pz - 2, 4, 4);
    }
    ctx.restore();
    // player arrow
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#0a84ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, W * 0.62 - 11);
    ctx.lineTo(W / 2 + 8, W * 0.62 + 8);
    ctx.lineTo(W / 2, W * 0.62 + 4);
    ctx.lineTo(W / 2 - 8, W * 0.62 + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(212,175,55,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    // north marker
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(player.heading);
    ctx.fillStyle = '#ff453a';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -W / 2 + 22);
    ctx.restore();
  }

  drawBigMap(player, route, dest) {
    const cv = this.bigCanvas;
    if (!cv || this.$('.bigmap').classList.contains('hidden')) return;
    const ctx = cv.getContext('2d');
    const s = this.bigScale();
    const k = s / this.mapScale;
    ctx.fillStyle = '#12161d';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.scale(k, k);
    const m = this.mapCanvas;
    ctx.drawImage(m, -m.width / 2 - this.mapCenter[0] * this.mapScale, -m.height / 2 - this.mapCenter[1] * this.mapScale);
    ctx.restore();
    const tp = (x, z) => [cv.width / 2 + (x - this.mapCenter[0]) * s, cv.height / 2 + (z - this.mapCenter[1]) * s];
    if (route && route.length > 1) {
      ctx.strokeStyle = '#3aa0ff';
      ctx.lineWidth = 5;
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
      ctx.arc(a, b - 14, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(a - 7, b - 10);
      ctx.lineTo(a + 7, b - 10);
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
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // legend
    ctx.font = `${14 * Math.min(2, devicePixelRatio)}px sans-serif`;
    const legend = [['#ff2d55', 'Speed camera'], ['#2d7bff', 'Toll gate (Salik/Darb)'], ['#35c759', 'Fuel / rest area'], ['#ff4d4d', 'Traffic light']];
    legend.forEach(([c, t], i) => {
      const y = 30 + i * 26 * Math.min(2, devicePixelRatio);
      ctx.fillStyle = c;
      ctx.fillRect(20, y - 10, 14, 14);
      ctx.fillStyle = '#fff';
      ctx.fillText(t, 42, y + 2);
    });
  }

  drawSpeedo(v, limit) {
    const ctx = this.speedo;
    const W = 300, cx = 150, cy = 150, R = 132;
    const max = Math.max(260, Math.ceil(v.spec.topSpeed / 20) * 20);
    ctx.clearRect(0, 0, W, W);
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, R + 12);
    g.addColorStop(0, 'rgba(20,24,32,0.95)');
    g.addColorStop(1, 'rgba(6,8,12,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (kmh) => a0 + (a1 - a0) * Math.min(1, kmh / max);
    // rev arc
    const rpmN = Math.min(1, v.rpm / 7500);
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(cx, cy, R - 4, a0, a1);
    ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#d4af37');
    grad.addColorStop(1, rpmN > 0.85 ? '#ff3b30' : '#ffe08a');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 4, a0, a0 + (a1 - a0) * rpmN);
    ctx.stroke();
    // ticks and numbers
    ctx.fillStyle = '#cfd6e0';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= max; k += 10) {
      const a = ang(k);
      const major = k % 20 === 0;
      ctx.strokeStyle = k > limit ? '#ff6961' : '#cfd6e0';
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16));
      ctx.lineTo(cx + Math.cos(a) * (R - (major ? 30 : 24)), cy + Math.sin(a) * (R - (major ? 30 : 24)));
      ctx.stroke();
      if (major && (max <= 300 || k % 40 === 0)) ctx.fillText(k, cx + Math.cos(a) * (R - 46), cy + Math.sin(a) * (R - 46));
    }
    // limit marker
    const la = ang(limit);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 16, la - 0.02, la + 0.02);
    ctx.stroke();
    // needle
    const na = ang(v.kmh);
    ctx.strokeStyle = '#ff453a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(na) * 14, cy - Math.sin(na) * 14);
    ctx.lineTo(cx + Math.cos(na) * (R - 22), cy + Math.sin(na) * (R - 22));
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = v.kmh > limit + 5 ? '#ff453a' : '#fff';
    ctx.font = 'bold 30px Arial';
    ctx.fillText(Math.round(v.kmh), cx, cy - 2);
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '11px Arial';
    ctx.fillText('km/h', cx, cy + 20);
    ctx.fillStyle = '#d4af37';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(v.gear === -1 ? 'R' : v.kmh < 1 && !v.gear ? 'N' : 'D' + v.gear, cx, cy + 70);
  }

  update(state) {
    const { player, limit, roadName, roadSub, profile, lights, indicators, climate, fuel, handbrake, clock } = state;
    this.drawSpeedo(player, limit);
    if (limit !== this.lastLimit) {
      this.$('.limit-sign span').textContent = limit;
      this.lastLimit = limit;
    }
    if (roadName !== this.lastRoad) {
      this.$('.rn-name').textContent = roadName || 'Off road';
      this.lastRoad = roadName;
    }
    this.$('.rn-sub').textContent = roadSub || '';
    this.$('.w-balance').textContent = Math.round(profile.balance).toLocaleString();
    this.$('.w-fines').textContent = `AED ${profile.sessionFines.toLocaleString()}`;
    this.$('.w-points').textContent = profile.blackPoints;
    this.$('.clock').textContent = clock;
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    this.$('.ind-left').classList.toggle('on', (indicators.left || indicators.hazard) && blink);
    this.$('.ind-right').classList.toggle('on', (indicators.right || indicators.hazard) && blink);
    this.$('.ind-hazard').classList.toggle('on', indicators.hazard);
    this.$('.ind-lights').classList.toggle('on', lights >= 1);
    this.$('.ind-high').classList.toggle('on', lights === 2);
    this.$('.ind-hand').classList.toggle('on', handbrake);
    this.$('.ac-temp').textContent = `${climate.cabin.toFixed(1)}°`;
    this.$('.ac-fan').textContent = climate.on ? (climate.auto ? 'AUTO' : `FAN ${climate.fan}`) : 'OFF';
    this.$('.ac-icon').classList.toggle('on', climate.on);
    this.$('.ac-target').textContent = `${climate.target.toFixed(1)}°C`;
    this.$('.ac-fanv').textContent = climate.auto ? 'AUTO' : climate.fan;
    this.$('.ac-cabin').textContent = `${climate.cabin.toFixed(1)}°C`;
    this.$('.ac-out').textContent = `${climate.outside}°C`;
    this.$('[data-ac="power"]').classList.toggle('on', climate.on);
    this.$('[data-ac="auto"]').classList.toggle('on', climate.auto);
    this.$('[data-ac="recirc"]').classList.toggle('on', climate.recirc);
    this.$('.fuel-bar div').style.width = `${Math.max(0, fuel) * 100}%`;
    this.$('.fuel-bar div').classList.toggle('low', fuel < 0.15);
  }

  toast(html, kind = 'info', ms = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = html;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
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
