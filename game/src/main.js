// UAE Drive app shell: splash -> disclaimer -> sign-in -> home (drive,
// garage, map, profile, settings) -> loading -> driving session -> results.
import * as THREE from 'three';
import { loadProfile, saveProfile, resetProfile, level } from './storage.js';
import { CARS, carById } from './cars/catalog.js';
import { CITIES } from './world/cities.js';
import { QUALITY, RESOLUTIONS, SEASONS, TIMES, autoQuality, pixelRatioFor } from './render/env.js';
import { installGradedToneMapping } from './render/cinematic.js';
import { WorldMaterials, loadArtManifest } from './render/materials.js';
import { Overview } from './world/overview.js';
import { toWorld } from './world/projection.js';
import { Garage } from './ui/garage.js';
import { Game } from './game.js';
import { CarAudio, Radio } from './audio/audio.js';
import { providers, signIn, signOut, hasNative, nativeCall } from './auth.js';
import { loadPhysicsCore } from './sim/physicsCore.js';
import { icon } from './ui/icons.js';
import { skylineSVG, drawUaeMap } from './ui/art.js';
import { ACHIEVEMENTS } from './ui/achievements.js';

const canvas = document.getElementById('gl');
const screens = document.getElementById('screens');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.body.innerHTML = '<div class="fatal">Your device does not support WebGL 2, which UAE Drive needs. Please update "Android System WebView" and Chrome from the Play Store.</div>';
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
installGradedToneMapping(renderer); // ACES + colour grade inside every material
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // hardware-filtered; the soft variant costs many more texture taps per pixel

const profile = loadProfile();
const audio = new CarAudio();
const radio = new Radio();
const detectedQuality = autoQuality(renderer);
let garage = null;
let game = null;
let mode = 'menu';
const world = { overview: null, base: 'world' };
let art = null;
let landmask = null;
const materialCache = new Map();

function qualityKey() {
  return profile.settings.quality === 'auto' ? detectedQuality : profile.settings.quality;
}

function applyRenderSettings() {
  renderer.setPixelRatio(pixelRatioFor(profile.settings.resolution, qualityKey()));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = QUALITY[qualityKey()].shadows;
  audio.setMaster(profile.settings.volume);
}
applyRenderSettings();
window.addEventListener('resize', () => {
  applyRenderSettings();
  garage && garage.resize();
  if (screens.querySelector('.uae-map')) drawPicker();
});

// ---------- data loading (in the background while the splash shows) ----------
const ready = (async () => {
  const [ov, a, lm] = await Promise.all([
    fetch('world/overview.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    loadArtManifest('art'),
    fetch('world/landmask.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    loadPhysicsCore(),
  ]);
  if (ov) world.overview = new Overview(ov);
  art = a;
  if (lm) {
    const tex = await new THREE.TextureLoader().loadAsync('world/landmask.png').catch(() => null);
    if (tex) {
      tex.colorSpace = THREE.NoColorSpace;
      landmask = { tex, info: lm };
    }
  }
})();

async function materialsFor(qk) {
  if (!materialCache.has(qk)) materialCache.set(qk, new WorldMaterials(QUALITY[qk], art).init());
  return materialCache.get(qk);
}

// ---------- render loop ----------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 1) {
    const el = document.getElementById('fps');
    if (el) el.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS`;
    fpsAcc = 0;
    fpsFrames = 0;
  }
  try {
    if (mode === 'game' && game) {
      game.update(dt);
      game.render(dt);
    } else if (garage && mode === 'menu') {
      garage.update(dt);
      garage.render();
    }
  } catch (e) {
    console.error(e);
    showError(e);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function showError(e) {
  if (document.querySelector('.error-box')) return;
  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = `Something went wrong: ${e.message}`;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}

// ---------- helpers ----------
const h = (html) => {
  screens.innerHTML = html;
  return screens;
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const $ = (s) => screens.querySelector(s);
function click(sel, fn) {
  screens.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => {
    audio.start();
    audio.beep(900, 0.03, 'sine', 0.04);
    fn(el, e);
  }));
}
function toast(text) {
  const t = document.createElement('div');
  t.className = 'menu-toast';
  t.innerHTML = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- splash ----------
function splash() {
  h(`
    <div class="splash">
      <div class="splash-sky">${skylineSVG()}</div>
      <div class="streaks">${'<i></i>'.repeat(12)}</div>
      <div class="logo">
        <div class="logo-mark">UAE<span>DRIVE</span></div>
        <div class="logo-ar">درايف الإمارات</div>
        <div class="logo-sub">ROADS OF THE SEVEN EMIRATES</div>
      </div>
      <div class="tap"><span>Tap to start</span></div>
      <div class="splash-foot">Map data © OpenStreetMap contributors</div>
    </div>`);
  const go = async () => {
    audio.start();
    screens.removeEventListener('click', go);
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch (e) { /* ignore */ }
    await ready;
    if (!profile.disclaimerAccepted) disclaimer();
    else if (!profile.signedInOnce) login();
    else home();
  };
  setTimeout(() => screens.addEventListener('click', go), 500);
}

function disclaimer() {
  const items = [
    ['info', 'Entertainment only', 'UAE Drive is a game. It does not replace RTA / ITC driving lessons or real traffic rules. Never play while driving.'],
    ['map', 'Real maps', 'Roads, limits, signals, radars and toll gates come from © OpenStreetMap contributors. Where data is missing the game estimates it — always obey real signs.'],
    ['garage', 'Fictional cars', 'Vehicles are original designs, not affiliated with or licensed by Mercedes-Benz or any other manufacturer.'],
    ['warning', 'Simulated fines', 'Fines and black points follow published UAE fine tables and have no real-world effect.'],
    ['music', 'Your music', 'The radio streams public internet stations or plays songs from your own phone. No music is bundled.'],
    ['lock', 'Privacy', 'Sign-in only reads your public name and picture. Progress is stored on this device.'],
  ];
  h(`
    <div class="modal-screen sunset-bg">
      <div class="card disclaimer">
        <h1>Before you drive</h1>
        <div class="disc-list">${items.map(([ic, t, d]) => `<div class="disc-item"><div class="disc-ic">${icon(ic)}</div><div><b>${t}</b><p>${d}</p></div></div>`).join('')}</div>
        <button class="btn primary big" data-go>I understand — let's go</button>
      </div>
    </div>`);
  click('[data-go]', () => {
    profile.disclaimerAccepted = true;
    saveProfile();
    login();
  });
}

function login() {
  const p = providers();
  const native = hasNative();
  h(`
    <div class="modal-screen sunset-bg">
      <div class="card login">
        <div class="logo-mark small">UAE<span>DRIVE</span></div>
        <p class="login-sub">Save your cars, money and progress</p>
        <button class="btn social google" data-p="google" ${!native || !p.google ? 'data-off' : ''}>${icon('google')} Continue with Google Play Games</button>
        <button class="btn social facebook" data-p="facebook" ${!native || !p.facebook ? 'data-off' : ''}>${icon('facebook')} Continue with Facebook</button>
        <button class="btn social instagram" data-p="instagram">${icon('instagram')} Instagram</button>
        <div class="or"><span>or</span></div>
        <button class="btn ghost big" data-p="guest">${icon('guest')} Play as guest</button>
        <p class="msg"></p>
      </div>
    </div>`);
  click('[data-p]', async (el) => {
    const prov = el.dataset.p;
    const msg = $('.msg');
    if (prov === 'guest') {
      profile.provider = 'guest';
      profile.signedInOnce = true;
      saveProfile();
      return home();
    }
    if (prov === 'instagram') {
      msg.textContent = 'Instagram no longer offers sign-in for apps (Meta closed that API in December 2024). Instagram users can sign in with Facebook.';
      return;
    }
    if (el.hasAttribute('data-off')) {
      msg.textContent = `${prov === 'google' ? 'Google Play Games' : 'Facebook'} sign-in is ${native ? 'not enabled in this build yet' : 'available in the Android app'} — play as a guest; your progress is saved on this device.`;
      return;
    }
    msg.textContent = 'Opening sign-in…';
    try {
      const r = await signIn(prov);
      Object.assign(profile, { provider: prov, name: r.name || profile.name, avatar: r.avatar || '', playerId: r.id, signedInOnce: true });
      saveProfile();
      home();
    } catch (e) {
      msg.textContent = e.message;
    }
  });
}

// ---------- home shell ----------
let tab = 'home';
let driveMode = 'free';

function ensureGarage() {
  if (!garage) garage = window.__garage = new Garage(renderer);
  garage.hd = QUALITY[qualityKey()].hdCars; // full-resolution car models in the showroom on High/Ultra
  const spec = carById(garage.previewId || profile.selected);
  garage.show(spec, profile.paints[spec.id] ?? spec.paints[0]);
}

function dailyReward() {
  const today = new Date().toISOString().slice(0, 10);
  return profile.lastDaily === today ? null : 250;
}

function home(t = tab) {
  tab = t;
  mode = 'menu';
  if (t !== 'garage' && garage) garage.previewId = null;
  ensureGarage();
  garage.setMode(tab === 'garage' ? 'showroom' : tab === 'map' ? 'hidden' : 'home');
  const lv = level(profile);
  const daily = dailyReward();
  h(`
    <div class="app tab-${tab}">
      <header class="topbar">
        <div class="brand">UAE<span>DRIVE</span></div>
        <div class="chips">
          ${daily ? `<button class="chip-btn daily" data-daily>${icon('star')} Daily reward +${daily}</button>` : ''}
          <div class="coin-chip">${icon('coins')}<b>${fmt(profile.balance)}</b><small>AED</small></div>
          <button class="player" data-tab="profile">
            <div class="avatar" style="--p:${Math.round(lv.progress * 100)}">${profile.avatar ? `<img src="${profile.avatar}" alt="">` : `<span>${escapeHtml(profile.name[0])}</span>`}</div>
            <div class="pl-txt"><b>${escapeHtml(profile.name)}</b><small>Level ${lv.lvl}</small></div>
          </button>
        </div>
      </header>
      <main class="content">${renderTab(tab)}</main>
      <nav class="bottom-nav">
        ${[['home', 'drive', 'Drive'], ['map', 'map', 'Map'], ['garage', 'garage', 'Garage'], ['profile', 'profile', 'Profile'], ['settings', 'settings', 'Settings']]
          .map(([k, ic, label]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${icon(ic)}<span>${label}</span></button>`).join('')}
      </nav>
      <div id="fps" class="${profile.settings.showFps ? '' : 'hidden'}"></div>
    </div>`);
  click('[data-tab]', (el) => home(el.dataset.tab));
  click('[data-daily]', () => {
    profile.balance += daily;
    profile.lastDaily = new Date().toISOString().slice(0, 10);
    saveProfile();
    toast(`${icon('star')} +AED ${daily} daily reward!`);
    home();
  });
  bindTab(tab);
}

const MODES = [
  ['free', 'Free roam', 'Drive anywhere in the UAE with GPS, radio and traffic.', 'map', 'm-free'],
  ['taxi', 'Chauffeur run', 'Pick up a VIP and drop them off. Fast and clean pays best.', 'flag', 'm-taxi'],
  ['test', 'Driving test', 'RTA-style checkpoints. One violation and you fail.', 'trophy', 'm-test'],
];

function renderTab(t) {
  if (t === 'home') {
    const spec = carById(profile.selected);
    const last = CITIES.find((c) => c.id === profile.lastCity) || CITIES[0];
    return `
      <section class="home-left">
        <div class="hello"><small>Marhaba, ${escapeHtml(profile.name.split(' ')[0])}!</small><h2>Where are we driving today?</h2></div>
        <div class="modes">${MODES.map(([k, n, d, ic, cls]) => `<button class="mode ${cls} ${driveMode === k ? 'on' : ''}" data-mode="${k}"><span class="mode-ic">${icon(ic)}</span><b>${n}</b><small>${d}</small></button>`).join('')}</div>
        <button class="drive-cta" data-drive="${last.id}">${icon('play')}<span><b>DRIVE</b><small>${escapeHtml(last.name)} · ${escapeHtml(last.emirate)}</small></span></button>
        <button class="link-btn" data-tab="map">${icon('pin')} Choose another place on the UAE map</button>
      </section>
      <aside class="car-card-home" data-tab="garage">
        <small>${spec.brand} · ${spec.cls}</small><h3>${spec.name}</h3>${statBars(spec)}
        <span class="link-btn">${icon('garage')} Open garage</span>
      </aside>`;
  }
  if (t === 'map') {
    return `
      <section class="map-tab">
        <div class="uae-map"><canvas></canvas><div class="map-tip">${icon('pin')} Tap a city pin — or anywhere on a road — to start driving there</div></div>
        <div class="city-list">
          <button class="city gps" data-gps>${icon('location')}<span><b>My location</b><small>Start where you are now</small></span></button>
          ${CITIES.map((c) => `<button class="city" data-drive="${c.id}" style="--c:${c.color}"><i></i><span><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.emirate)} · ${escapeHtml(c.blurb)}</small></span></button>`).join('')}
        </div>
      </section>`;
  }
  if (t === 'garage') {
    const i = CARS.findIndex((c) => c.id === (garage.previewId || profile.selected));
    const c = CARS[Math.max(0, i)];
    const owned = profile.owned.includes(c.id);
    const sel = profile.selected === c.id;
    return `
      <section class="showroom">
        <button class="nav-arrow l" data-car-step="-1" aria-label="Previous car">${icon('left')}</button>
        <button class="nav-arrow r" data-car-step="1" aria-label="Next car">${icon('right')}</button>
        <div class="show-info">
          <small>${c.brand} · ${c.cls}</small>
          <h2>${c.name}</h2>
          ${statBars(c)}
          <div class="paints">${c.paints.map((p) => `<button class="paint ${(profile.paints[c.id] ?? c.paints[0]) === p ? 'on' : ''}" data-paint="${p}" style="--p:#${p.toString(16).padStart(6, '0')}"></button>`).join('')}</div>
          <div class="show-cta">
            ${owned ? (sel ? `<span class="owned">${icon('check')} Your current car</span>` : '<button class="btn primary big" data-select>Drive this car</button>') : `<button class="btn gold big" data-buy>${icon('coins')} Buy · AED ${fmt(c.price)}</button>`}
          </div>
          <div class="dots">${CARS.map((x) => `<i class="${x.id === c.id ? 'on' : ''}"></i>`).join('')}</div>
        </div>
      </section>`;
  }
  if (t === 'profile') {
    const s = profile.stats;
    const got = ACHIEVEMENTS.filter((a) => a.test(profile));
    return `
      <section class="profile-tab">
        <div class="stat-cards">
          ${[['drive', `${s.km.toFixed(1)} km`, 'Distance driven', 'c1'], ['signal', `${s.topSpeed} km/h`, 'Top speed', 'c2'], ['flag', s.missions, 'Missions', 'c3'], ['trophy', s.tests, 'Tests passed', 'c4'], ['warning', `${s.finesCount}`, `Fines · AED ${fmt(s.fines)}`, 'c5'], ['info', `${profile.blackPoints}/24`, 'Black points', 'c6']]
            .map(([ic, v, l, c]) => `<div class="stat-card ${c}">${icon(ic)}<b>${v}</b><small>${l}</small></div>`).join('')}
        </div>
        <h4>Achievements · ${got.length}/${ACHIEVEMENTS.length}</h4>
        <div class="badges">${ACHIEVEMENTS.map((a) => `<div class="badge ${a.test(profile) ? 'on' : ''}"><span>${icon(a.icon)}</span><b>${a.name}</b><small>${a.desc}</small></div>`).join('')}</div>
        <div class="btn-row">
          <button class="btn" data-clear-points ${profile.blackPoints ? '' : 'disabled'}>Road-safety course · −8 pts · AED 800</button>
          <button class="btn ghost" data-signout>${profile.provider === 'guest' ? 'Sign in' : 'Sign out'}</button>
          <button class="btn danger" data-reset>Reset progress</button>
        </div>
      </section>`;
  }
  const s = profile.settings;
  const seg = (key, options) => `<div class="seg wrap" data-set="${key}">${options.map(([v, n]) => `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  return `
    <section class="settings-tab">
      <div class="set-group g1"><h4>${icon('sun')} Graphics</h4>
        <label>Quality</label>${seg('quality', [['auto', `Auto (${QUALITY[detectedQuality].name})`], ...Object.entries(QUALITY).map(([k, v]) => [k, v.name])])}
        <label>Resolution</label>${seg('resolution', Object.entries(RESOLUTIONS).map(([k, v]) => [k, v.name]))}
        <label>Mirrors</label>${seg('mirrors', [['all', 'Rear + side'], ['rear', 'Rear only'], ['off', 'Off']])}
      </div>
      <div class="set-group g2"><h4>${icon('drive')} Controls</h4>
        <label>Steering</label>${seg('controls', [['arrows', 'Arrows'], ['wheel', 'Steering wheel'], ['tilt', 'Tilt (gyroscope)']])}
        <label>Sensitivity <output>${s.sensitivity}</output></label><input type="range" min="0.5" max="1.8" step="0.1" data-range="sensitivity" value="${s.sensitivity}">
        <label>Default camera</label>${seg('camera', [['chase', 'Chase'], ['far', 'Far'], ['cockpit', 'Cockpit'], ['hood', 'Bonnet'], ['cinematic', 'Cinematic']])}
      </div>
      <div class="set-group g3"><h4>${icon('moon')} World</h4>
        <label>Time of day</label>${seg('time', Object.entries(TIMES).map(([k, v]) => [k, v.name]))}
        <label>Season & weather</label>${seg('season', Object.entries(SEASONS).map(([k, v]) => [k, v.name]))}
        <label>Traffic</label>${seg('trafficDensity', [[0.5, 'Light'], [1, 'Normal'], [1.5, 'Rush hour']])}
      </div>
      <div class="set-group g4"><h4>${icon('radio')} Sound & more</h4>
        <label>Master volume</label><input type="range" min="0" max="1" step="0.05" data-range="volume" value="${s.volume}">
        <label class="row"><input type="checkbox" data-check="dynamicTime" ${s.dynamicTime ? 'checked' : ''}> Day/night cycle while driving</label>
        <label class="row"><input type="checkbox" data-check="showFps" ${s.showFps ? 'checked' : ''}> Show FPS counter</label>
      </div>
      <div class="set-group credits"><h4>${icon('info')} About & credits</h4>
        <p>Map data © <b>OpenStreetMap</b> contributors, ODbL 1.0.</p>
        <p>Skies and surface textures: <b>Poly Haven</b> and <b>ambientCG</b> (CC0).</p>
        <p>Aurora Vision GT model: “Car Concept” by Eric Chadwick / Darmstadt Graphics Group, CC BY 4.0 — logos removed, materials adapted for mobile.</p>
        <p>Nova GT, Meridian GT-S, Corsa 40, Atlas R, Orion RS, Vortex S and Zenith X: concept-car models by <b>Unity Fan</b> (Sketchfab; Concept Car 037 under CC BY 4.0, the others under Sketchfab's free licence), optimised for phones.</p>
        <p>Traffic cars: “Cars Bundle” by <b>Quaternius</b> (CC0).</p>
        <p>All other vehicles are original designs, not affiliated with any manufacturer.</p>
      </div>
      <p class="note">Tip: 1080p and Ultra look best on flagship phones. Auto resolution adapts to keep driving smooth.</p>
    </section>`;
}

function statBars(spec) {
  const bars = [
    ['Top speed', spec.topSpeed / 400, `${spec.topSpeed} km/h`, 'sp'],
    ['0-100', (6 - spec.accel) / 4, `${spec.accel}s`, 'ac'],
    ['Handling', spec.handling, '', 'hd'],
    ['Braking', spec.braking, '', 'br'],
  ];
  return `<div class="stats">${bars.map(([n, v, t, cls]) => `<div class="stat ${cls}"><span>${n}</span><div class="bar"><div style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></div></div><em>${t}</em></div>`).join('')}</div>`;
}

function bindTab(t) {
  if (t === 'home') {
    click('[data-mode]', (el) => {
      driveMode = el.dataset.mode;
      screens.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b === el));
    });
    click('[data-drive]', (el) => startCity(el.dataset.drive));
  } else if (t === 'map') {
    drawPicker();
    click('[data-drive]', (el) => startCity(el.dataset.drive));
    click('[data-gps]', () => {
      if (!navigator.geolocation) return toast('Location is not available');
      toast('Finding your location…');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const [X, Z] = toWorld(pos.coords.longitude, pos.coords.latitude);
          startDrive({ X, Z, name: 'My location' });
        },
        () => toast('Could not get your location — check the permission'),
        { enableHighAccuracy: false, timeout: 15000 },
      );
    });
  } else if (t === 'garage') {
    const cur = () => Math.max(0, CARS.findIndex((c) => c.id === (garage.previewId || profile.selected)));
    const show = (idx) => {
      const c = CARS[(idx + CARS.length) % CARS.length];
      garage.previewId = c.id;
      home('garage');
    };
    click('[data-car-step]', (el) => show(cur() + +el.dataset.carStep));
    let sx = null;
    const area = $('.showroom');
    area.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    area.addEventListener('pointerup', (e) => {
      if (sx !== null && Math.abs(e.clientX - sx) > 60 && !e.target.closest('button')) show(cur() + (e.clientX < sx ? 1 : -1));
      sx = null;
    });
    click('[data-paint]', (el) => {
      const c = CARS[cur()];
      profile.paints[c.id] = +el.dataset.paint;
      saveProfile();
      garage.show(c, +el.dataset.paint);
      screens.querySelectorAll('[data-paint]').forEach((b) => b.classList.toggle('on', b === el));
    });
    click('[data-buy]', () => {
      const c = CARS[cur()];
      if (profile.balance < c.price) return toast(`You need AED ${fmt(c.price - profile.balance)} more — drive, finish missions and pass tests to earn.`);
      profile.balance -= c.price;
      profile.owned.push(c.id);
      profile.selected = c.id;
      saveProfile();
      audio.chime();
      toast(`${icon('check')} ${c.name} is yours!`);
      home('garage');
    });
    click('[data-select]', () => {
      profile.selected = CARS[cur()].id;
      saveProfile();
      home('garage');
    });
  } else if (t === 'profile') {
    click('[data-reset]', () => {
      if (confirm('Reset all progress, cars and money?')) {
        resetProfile();
        location.reload();
      }
    });
    click('[data-signout]', () => {
      signOut(profile.provider);
      Object.assign(profile, { provider: 'guest', signedInOnce: false });
      saveProfile();
      login();
    });
    click('[data-clear-points]', () => {
      if (profile.balance < 800) return toast('Not enough money for the course');
      profile.balance -= 800;
      profile.blackPoints = Math.max(0, profile.blackPoints - 8);
      saveProfile();
      home('profile');
    });
  } else if (t === 'settings') {
    click('[data-set] [data-v]', (el) => {
      const k = el.parentElement.dataset.set;
      let v = el.dataset.v;
      if (k === 'trafficDensity') v = +v;
      profile.settings[k] = v;
      saveProfile();
      applyRenderSettings();
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
    });
    screens.querySelectorAll('[data-range]').forEach((el) => el.addEventListener('input', () => {
      profile.settings[el.dataset.range] = +el.value;
      const out = el.previousElementSibling?.querySelector('output');
      if (out) out.textContent = el.value;
      saveProfile();
      applyRenderSettings();
    }));
    screens.querySelectorAll('[data-check]').forEach((el) => el.addEventListener('change', () => {
      profile.settings[el.dataset.check] = el.checked;
      saveProfile();
      if (el.dataset.check === 'showFps') document.getElementById('fps').classList.toggle('hidden', !el.checked);
    }));
  }
}

// interactive UAE map picker
let pickerView = null;
function drawPicker() {
  const wrap = $('.uae-map');
  if (!wrap) return;
  const cv = wrap.querySelector('canvas');
  pickerView = drawUaeMap(cv, world.overview, CITIES, profile.lastCity);
  if (cv.dataset.bound) return;
  cv.dataset.bound = '1';
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const hit = pickerView.hit(e.clientX - r.left, e.clientY - r.top);
    if (hit.city) startCity(hit.city.id);
    else if (hit.X !== undefined && hit.onLand) {
      const place = world.overview ? world.overview.nearestPlace(hit.X, hit.Z, ['city', 'town', 'suburb', 'village']) : null;
      startDrive({ X: hit.X, Z: hit.Z, name: place ? place.name : 'Custom location' });
    }
  });
}

// ---------- loading & driving ----------
function startCity(id) {
  const c = CITIES.find((x) => x.id === id) || CITIES[0];
  profile.lastCity = c.id;
  saveProfile();
  const [X, Z] = toWorld(c.lon, c.lat);
  startDrive({ X, Z, name: `${c.name}, ${c.emirate}`, heading: c.heading });
}

async function startDrive(start) {
  audio.start();
  const tips = [
    'Radars flash at 20 km/h over the posted limit — a red banner warns you before each one.',
    'Jumping a red light costs AED 1,000 and 12 black points.',
    'Indicate before turning — forgetting costs AED 400.',
    'Tap the minimap to open the UAE map and search any place.',
    'Salik gates in Dubai and Darb gates in Abu Dhabi charge a toll each time you pass.',
    'Switch to the cockpit view to use the live side and rear-view mirrors.',
    'Stop at a fuel station and tap "Fill up" to refuel.',
  ];
  h(`
    <div class="loading sunset-bg">
      <div class="logo-mark small">UAE<span>DRIVE</span></div>
      <div class="load-dest">${icon('pin')} ${escapeHtml(start.name || 'UAE')}</div>
      <div class="load-road"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="load-bar"><div></div></div>
      <div class="load-text">Preparing…</div>
      <div class="tip">${icon('info')} ${tips[Math.floor(Math.random() * tips.length)]}</div>
    </div>`);
  const progress = (text) => {
    const el = $('.load-text');
    if (el) el.textContent = text;
    const m = /(\d+)\/(\d+)/.exec(text);
    const bar = $('.load-bar div');
    if (bar && m) bar.style.width = `${Math.round((+m[1] / +m[2]) * 100)}%`;
  };
  await new Promise((r) => setTimeout(r, 40));
  try {
    await ready;
    applyRenderSettings();
    progress('Preparing materials…');
    const qk = qualityKey();
    const mats = await materialsFor(qk);
    game = await Game.create({
      renderer, world, start, profile, qualityKey: qk, audio, radio, mode: driveMode, materials: mats, art, landmask,
      onExit: (stats) => {
        game = null;
        mode = 'menu';
        nativeCall('setKeepScreenOn', false);
        home('home');
        if (stats && stats.km > 0.05) toast(`${icon('drive')} ${stats.km.toFixed(1)} km driven · +AED ${stats.earned} · fines AED ${stats.fines}`);
      },
    }, progress);
    screens.innerHTML = '';
    mode = 'game';
    nativeCall('setKeepScreenOn', true);
    window.__game = game;
  } catch (e) {
    console.error(e);
    toast(`Could not start: ${escapeHtml(e.message)}`);
    home('map');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game) game.setPaused(true);
    audio.suspend();
  } else audio.start();
});
window.__onBackPressed = () => {
  if (game) {
    game.setPaused(!game.paused);
    return true;
  }
  if (tab !== 'home' && screens.querySelector('.app')) {
    home('home');
    return true;
  }
  return false;
};

splash();
