// App entry: splash -> disclaimer -> sign-in -> dashboard (garage, cities,
// settings, profile) -> loading -> driving session.
import * as THREE from 'three';
import { loadProfile, saveProfile, resetProfile, level } from './storage.js';
import { CARS, carById } from './cars/catalog.js';
import { REGIONS, LANDMARKS } from './world/regions.js';
import { loadRegion, loadAnywhere, bundledIndex, guessEmirate } from './world/maps.js';
import { QUALITY, RESOLUTIONS, SEASONS, TIMES, autoQuality, pixelRatioFor } from './render/env.js';
import { Garage } from './ui/garage.js';
import { Game } from './game.js';
import { CarAudio, Radio } from './audio/audio.js';
import { providers, signIn, signOut, hasNative, nativeCall } from './auth.js';
import { loadPhysicsCore } from './sim/physicsCore.js';

const canvas = document.getElementById('gl');
const screens = document.getElementById('screens');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.body.innerHTML = '<div class="fatal">Your device does not support WebGL 2, which UAE Drive needs. Please update Android System WebView / Chrome from the Play Store.</div>';
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const profile = loadProfile();
const audio = new CarAudio();
const radio = new Radio();
const detectedQuality = autoQuality(renderer);
let garage = null;
let game = null;
let mode = 'menu';
let bundled = {};

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
});

// ---------- render loop ----------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fps = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 1) {
    fps = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0;
    fpsFrames = 0;
    const el = document.getElementById('fps');
    if (el) el.textContent = `${fps} FPS`;
  }
  try {
    if (mode === 'game' && game) {
      game.update(dt);
      game.render();
    } else if (garage) {
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
window.addEventListener('error', (e) => console.error('[uaedrive]', e.message));

// ---------- helpers ----------
const h = (html) => {
  screens.innerHTML = html;
  return screens;
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function click(sel, fn) {
  screens.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => {
    audio.start();
    fn(el, e);
  }));
}

// ---------- splash ----------
function splash() {
  h(`
    <div class="splash">
      <div class="streaks">${'<i></i>'.repeat(14)}</div>
      <div class="logo">
        <div class="logo-mark">UAE<span>DRIVE</span></div>
        <div class="logo-ar">درايف الإمارات</div>
        <div class="logo-sub">ROADS OF THE SEVEN EMIRATES</div>
      </div>
      <div class="tap">Tap to start</div>
    </div>`);
  const go = () => {
    audio.start();
    screens.removeEventListener('click', go);
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch (e) { /* ignore */ }
    if (!profile.disclaimerAccepted) disclaimer();
    else if (profile.provider === 'none' || !profile.signedInOnce) login();
    else menu();
  };
  setTimeout(() => screens.addEventListener('click', go), 600);
}

function disclaimer() {
  h(`
    <div class="modal-screen">
      <div class="card disclaimer">
        <h1>Before you drive</h1>
        <ul>
          <li><b>Entertainment only.</b> UAE Drive is a game. It is not a driving-school tool and does not replace RTA / ITC training or real traffic rules. Never play while driving a real vehicle.</li>
          <li><b>Map data.</b> Roads, speed limits, traffic signals, speed cameras and toll gates come from <b>© OpenStreetMap contributors</b> (ODbL). Where the data is missing, the game estimates limits and generates roads, so they may differ from reality. Always obey real road signs.</li>
          <li><b>Vehicles.</b> Cars in this game are fictional designs. They are not affiliated with, endorsed or licensed by Mercedes-Benz, Ferrari, Lamborghini or any other manufacturer.</li>
          <li><b>Fines.</b> Fines and black points are simulated using published UAE federal fine tables and have no real-world effect.</li>
          <li><b>Music.</b> The radio streams public internet radio stations or plays songs you choose from your own device. No music is included in the game.</li>
          <li><b>Privacy.</b> Sign-in only reads your public name and picture. Your progress is stored on this device.</li>
        </ul>
        <button class="btn primary big" data-go>I understand – continue</button>
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
    <div class="modal-screen login-bg">
      <div class="card login">
        <div class="logo-mark small">UAE<span>DRIVE</span></div>
        <h2>Sign in to save your progress</h2>
        <button class="btn social google" data-p="google" ${native && !p.google ? 'disabled' : ''}>
          <span class="ic">▶</span> Continue with Google Play Games</button>
        <button class="btn social facebook" data-p="facebook" ${native && !p.facebook ? 'disabled' : ''}>
          <span class="ic">f</span> Continue with Facebook</button>
        <button class="btn social instagram" data-p="instagram">
          <span class="ic">◎</span> Instagram</button>
        <div class="or">or</div>
        <button class="btn ghost" data-p="guest">Play as guest</button>
        <p class="note">${native
          ? (p.google || p.facebook ? '' : 'Online sign-in is not configured in this build yet – guest progress is saved on this phone.')
          : 'Google / Facebook sign-in works in the Android app. In a browser you can play as a guest.'}</p>
        <p class="msg"></p>
      </div>
    </div>`);
  click('[data-p]', async (el) => {
    const prov = el.dataset.p;
    const msg = screens.querySelector('.msg');
    if (prov === 'guest') {
      profile.provider = 'guest';
      profile.signedInOnce = true;
      saveProfile();
      return menu();
    }
    if (prov === 'instagram') {
      msg.textContent = 'Instagram no longer offers sign-in for apps (Meta shut down that API in December 2024). Instagram accounts are linked through Meta, so use "Continue with Facebook" instead.';
      return;
    }
    msg.textContent = 'Opening sign-in…';
    try {
      const r = await signIn(prov);
      profile.provider = prov;
      profile.name = r.name || profile.name;
      profile.avatar = r.avatar || '';
      profile.playerId = r.id;
      profile.signedInOnce = true;
      saveProfile();
      menu();
    } catch (e) {
      msg.textContent = e.message;
    }
  });
}

// ---------- dashboard ----------
let tab = 'drive';
let driveMode = 'free';

function ensureGarage() {
  if (!garage) garage = new Garage(renderer);
  const spec = carById(profile.selected);
  garage.show(spec.style, profile.paints[spec.id] ?? spec.paints[0]);
}

function menu() {
  mode = 'menu';
  ensureGarage();
  const spec = carById(profile.selected);
  const lv = level(profile);
  h(`
    <div class="dash">
      <header class="topbar">
        <div class="brand">UAE<span>DRIVE</span></div>
        <div class="player">
          <div class="avatar">${profile.avatar ? `<img src="${profile.avatar}">` : profile.name[0]}</div>
          <div><b>${escapeHtml(profile.name)}</b><small>Level ${lv.lvl} · ${providerLabel(profile.provider)}</small>
          <div class="xp"><div style="width:${Math.round(lv.progress * 100)}%"></div></div></div>
        </div>
        <div class="money"><small>Balance</small><b>AED ${fmt(profile.balance)}</b></div>
      </header>
      <nav class="tabs">
        ${[['drive', '🏁', 'Drive'], ['garage', '🚘', 'Garage'], ['profile', '👤', 'Profile'], ['settings', '⚙', 'Settings']]
          .map(([k, i, t]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}"><span>${i}</span>${t}</button>`).join('')}
      </nav>
      <main class="panel-main">${renderTab(tab, spec)}</main>
      <aside class="car-info">
        <small>${spec.brand} · ${spec.cls}</small>
        <h3>${spec.name}</h3>
        ${statBars(spec)}
      </aside>
      <div id="fps" class="${profile.settings.showFps ? '' : 'hidden'}"></div>
    </div>`);
  click('[data-tab]', (el) => {
    tab = el.dataset.tab;
    menu();
  });
  bindTab(tab);
}

function providerLabel(p) {
  return { google: 'Google Play Games', facebook: 'Facebook', guest: 'Guest' }[p] || 'Guest';
}

function statBars(spec) {
  const bars = [
    ['Top speed', spec.topSpeed / 400, `${spec.topSpeed} km/h`],
    ['0-100', (6 - spec.accel) / 4, `${spec.accel}s`],
    ['Handling', spec.handling, ''],
    ['Braking', spec.braking, ''],
  ];
  return `<div class="stats">${bars.map(([n, v, t]) => `<div class="stat"><span>${n}</span><div class="bar"><div style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></div></div><em>${t}</em></div>`).join('')}</div>`;
}

function renderTab(t, spec) {
  if (t === 'drive') {
    const modes = [
      ['free', 'Free roam', 'Explore the city, set a GPS destination on the map, enjoy the radio.'],
      ['taxi', 'Chauffeur run', 'Pick up a VIP and drop them off. Fast and clean pays best.'],
      ['test', 'Driving test', 'RTA-style route with checkpoints. One violation and you fail.'],
    ];
    return `
      <section class="modes">${modes.map(([k, n, d]) => `<button class="mode ${driveMode === k ? 'on' : ''}" data-mode="${k}"><b>${n}</b><small>${d}</small></button>`).join('')}</section>
      <h4>Choose a city</h4>
      <section class="regions">
        ${REGIONS.map((r) => `<button class="region" data-region="${r.id}"><span class="em">${r.emirate}</span><b>${r.name}</b><small>${r.blurb}</small><i>${bundled[r.id] ? '✓ Offline pack' : '⇩ Downloads (needs internet)'}</i></button>`).join('')}
        <button class="region anywhere" data-anywhere><span class="em">All 7 emirates</span><b>Explore anywhere</b><small>Pick a landmark, coordinates or your GPS location</small><i>⇩ Live OpenStreetMap</i></button>
        <button class="region" data-region="demo-city"><span class="em">Offline</span><b>Test track city</b><small>Generated Dubai-style grid, works without internet</small><i>✓ Always available</i></button>
      </section>`;
  }
  if (t === 'garage') {
    return `<section class="cars">${CARS.map((c) => {
      const owned = profile.owned.includes(c.id);
      const sel = profile.selected === c.id;
      return `<div class="car-card ${sel ? 'on' : ''}" data-car="${c.id}">
        <small>${c.brand} · ${c.cls}</small><b>${c.name}</b>
        <div class="car-row"><span>${c.topSpeed} km/h</span><span>0-100 ${c.accel}s</span></div>
        ${owned ? (sel ? '<em class="tag">Selected</em>' : '<button class="btn small" data-select>Select</button>') : `<button class="btn small gold" data-buy>Buy AED ${fmt(c.price)}</button>`}
        ${sel ? `<div class="paints">${c.paints.map((p) => `<button class="paint" data-paint="${p}" style="background:#${p.toString(16).padStart(6, '0')}"></button>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}</section>`;
  }
  if (t === 'profile') {
    const s = profile.stats;
    return `<section class="profile">
      <div class="kv"><span>Distance driven</span><b>${s.km.toFixed(1)} km</b></div>
      <div class="kv"><span>Top speed</span><b>${s.topSpeed} km/h</b></div>
      <div class="kv"><span>Missions completed</span><b>${s.missions}</b></div>
      <div class="kv"><span>Driving tests passed</span><b>${s.tests}</b></div>
      <div class="kv"><span>Fines received</span><b>${s.finesCount} · AED ${fmt(s.fines)}</b></div>
      <div class="kv"><span>Black points</span><b>${profile.blackPoints} / 24</b></div>
      <div class="kv"><span>Cars owned</span><b>${profile.owned.length} / ${CARS.length}</b></div>
      <div class="btn-row">
        <button class="btn" data-clear-points ${profile.blackPoints ? '' : 'disabled'}>Road-safety course (clear 8 pts · AED 800)</button>
        <button class="btn ghost" data-signout>${profile.provider === 'guest' ? 'Sign in' : 'Sign out'}</button>
        <button class="btn danger" data-reset>Reset progress</button>
      </div>
    </section>`;
  }
  const s = profile.settings;
  const sel = (key, options) => `<select data-set="${key}">${options.map(([v, n]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  return `<section class="settings">
    <label>Graphics quality ${sel('quality', [['auto', `Auto (${QUALITY[detectedQuality].name})`], ...Object.entries(QUALITY).map(([k, v]) => [k, v.name])])}</label>
    <label>Resolution ${sel('resolution', Object.entries(RESOLUTIONS).map(([k, v]) => [k, v.name]))}</label>
    <label>Steering ${sel('controls', [['arrows', 'Arrow buttons'], ['wheel', 'On-screen steering wheel'], ['tilt', 'Gyroscope (tilt the phone)']])}</label>
    <label>Steering sensitivity <input type="range" min="0.5" max="1.8" step="0.1" data-set="sensitivity" value="${s.sensitivity}"></label>
    <label>Default camera ${sel('camera', [['chase', 'Chase'], ['far', 'Far chase'], ['cockpit', 'Cockpit (interior)'], ['hood', 'Bonnet'], ['cinematic', 'Cinematic']])}</label>
    <label>Mirrors ${sel('mirrors', [['all', 'Rear-view + side mirrors'], ['rear', 'Rear-view only'], ['off', 'Off (faster)']])}</label>
    <label>Time of day ${sel('time', Object.entries(TIMES).map(([k, v]) => [k, v.name]))}</label>
    <label>Season / weather ${sel('season', Object.entries(SEASONS).map(([k, v]) => [k, v.name]))}</label>
    <label>Traffic density ${sel('trafficDensity', [[0.5, 'Light'], [1, 'Normal'], [1.5, 'Heavy (rush hour)']])}</label>
    <label>Master volume <input type="range" min="0" max="1" step="0.05" data-set="volume" value="${s.volume}"></label>
    <label class="row"><input type="checkbox" data-set="dynamicTime" ${s.dynamicTime ? 'checked' : ''}> Day/night cycle while driving</label>
    <label class="row"><input type="checkbox" data-set="showFps" ${s.showFps ? 'checked' : ''}> Show FPS counter</label>
    <p class="note">Tip: "1080p Full HD" and Ultra quality look best on flagship phones. On older phones choose Auto or Low for smooth driving.</p>
  </section>`;
}

function bindTab(t) {
  if (t === 'drive') {
    click('[data-mode]', (el) => {
      driveMode = el.dataset.mode;
      screens.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b === el));
    });
    click('[data-region]', (el) => startDrive(() => loadRegion(el.dataset.region, progress), el.dataset.region));
    click('[data-anywhere]', anywhere);
  } else if (t === 'garage') {
    click('[data-car]', (el, e) => {
      const c = carById(el.dataset.car);
      if (e.target.closest('[data-buy]')) {
        if (profile.balance < c.price) return toast(`You need AED ${fmt(c.price - profile.balance)} more. Drive, complete missions and pass tests to earn.`);
        profile.balance -= c.price;
        profile.owned.push(c.id);
        profile.selected = c.id;
        saveProfile();
        return menu();
      }
      const paint = e.target.closest('[data-paint]');
      if (paint) {
        profile.paints[c.id] = +paint.dataset.paint;
        saveProfile();
        garage.show(c.style, +paint.dataset.paint);
        return;
      }
      garage.show(c.style, profile.paints[c.id] ?? c.paints[0]);
      const info = document.querySelector('.car-info');
      if (info) info.innerHTML = `<small>${c.brand} · ${c.cls}</small><h3>${c.name}</h3>${statBars(c)}`;
      if (e.target.closest('[data-select]')) {
        profile.selected = c.id;
        saveProfile();
        menu();
      }
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
      profile.provider = 'guest';
      profile.signedInOnce = false;
      saveProfile();
      login();
    });
    click('[data-clear-points]', () => {
      if (profile.balance < 800) return toast('Not enough money for the course');
      profile.balance -= 800;
      profile.blackPoints = Math.max(0, profile.blackPoints - 8);
      saveProfile();
      menu();
    });
  } else if (t === 'settings') {
    screens.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.set;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'range' || k === 'trafficDensity') v = +v;
      profile.settings[k] = v;
      saveProfile();
      applyRenderSettings();
      if (k === 'showFps') document.getElementById('fps').classList.toggle('hidden', !v);
    }));
  }
}

function anywhere() {
  h(`
    <div class="modal-screen">
      <div class="card anywhere-card">
        <h2>Explore anywhere in the UAE</h2>
        <p class="note">Roads within ~1.2 km are downloaded live from OpenStreetMap (needs internet). Areas with few mapped roads are filled with generated roads.</p>
        <div class="landmarks">${LANDMARKS.map((l, i) => `<button class="chip" data-lm="${i}">${l.name}</button>`).join('')}</div>
        <div class="coords">
          <input type="number" step="0.0001" placeholder="Latitude e.g. 25.2048" class="lat">
          <input type="number" step="0.0001" placeholder="Longitude e.g. 55.2708" class="lon">
          <button class="btn" data-coords>Go</button>
          <button class="btn gold" data-gps>📍 My location</button>
        </div>
        <button class="btn ghost" data-back>Back</button>
      </div>
    </div>`);
  const go = (lat, lon, name) => startDrive(() => loadAnywhere({ lat, lon, radius: 1200, name, emirate: guessEmirate(lat, lon) }, progress), null);
  click('[data-lm]', (el) => {
    const l = LANDMARKS[+el.dataset.lm];
    go(l.lat, l.lon, l.name);
  });
  click('[data-coords]', () => {
    const lat = parseFloat(screens.querySelector('.lat').value), lon = parseFloat(screens.querySelector('.lon').value);
    if (!(lat > 22 && lat < 27 && lon > 51 && lon < 57)) return toast('Please enter coordinates inside the UAE');
    go(lat, lon, `${lat.toFixed(3)}, ${lon.toFixed(3)}`);
  });
  click('[data-gps]', () => {
    if (!navigator.geolocation) return toast('Location not available');
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => go(pos.coords.latitude, pos.coords.longitude, 'My location'),
      () => toast('Could not get your location – check permissions'),
      { enableHighAccuracy: false, timeout: 15000 },
    );
  });
  click('[data-back]', menu);
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'menu-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------- loading & driving ----------
function progress(text) {
  const el = document.querySelector('.load-text');
  if (el) el.textContent = text;
}

async function startDrive(loader, regionId) {
  audio.start();
  const tips = [
    'Radars in the UAE usually flash at 20 km/h over the posted limit. Here, too.',
    'Jumping a red light costs AED 1,000 and 12 black points.',
    'Use the indicators before turning – forgetting costs AED 400.',
    'Tap the minimap to open the full map and set a GPS destination.',
    'Stop at a green ⛽ station to refuel.',
    'Salik gates in Dubai and Darb gates in Abu Dhabi charge a toll each time you pass.',
    'Switch to cockpit view with 🎥 to use the live side and rear-view mirrors.',
  ];
  h(`
    <div class="loading">
      <div class="logo-mark">UAE<span>DRIVE</span></div>
      <div class="spinner"></div>
      <div class="load-text">Preparing…</div>
      <div class="tip">💡 ${tips[Math.floor(Math.random() * tips.length)]}</div>
    </div>`);
  await new Promise((r) => setTimeout(r, 50));
  try {
    progress('Starting physics engine…');
    await loadPhysicsCore();
    const map = await loader();
    progress('Building roads, buildings and traffic…');
    await new Promise((r) => setTimeout(r, 30));
    if (regionId) profile.lastRegion = regionId;
    saveProfile();
    applyRenderSettings();
    game = new Game({
      renderer, map, profile, qualityKey: qualityKey(), audio, radio, mode: driveMode,
      onExit: () => {
        game = null;
        mode = 'menu';
        nativeCall('setKeepScreenOn', false);
        menu();
      },
    });
    screens.innerHTML = '';
    mode = 'game';
    nativeCall('setKeepScreenOn', true);
    window.__game = game; // handy for debugging / automated tests
  } catch (e) {
    console.error(e);
    toast(`Could not load the map: ${e.message}`);
    menu();
  }
}

// pause when the app goes to the background
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game) game.setPaused(true);
    audio.suspend();
  } else audio.start();
});
// Android back button (sent by the native wrapper)
window.__onBackPressed = () => {
  if (game) {
    game.setPaused(!game.paused);
    return true;
  }
  if (screens.querySelector('[data-back]')) {
    menu();
    return true;
  }
  return false;
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

bundledIndex().then((b) => {
  bundled = b;
});
splash();
